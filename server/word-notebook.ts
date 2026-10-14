import type { Express, NextFunction, Request, Response } from "express";
import { MongoServerError } from "mongodb";
import { z } from "zod";
import type { ContentSection, Feedback, StoredContent, VocabularyCard, WordOrigin, WordRequest, WordTranslation } from "../shared/types";
import { learnerOf } from "./auth";
import { ApiError } from "./errors";
import { newScheduler, vocabularyMetrics } from "./learning";
import { newId, type AttemptRecord, type CardRecord, type Database, type PlacementRecord } from "./storage";
import { translateWordWithOpenAI, type WordTranslationOptions } from "./word-translation";

export interface WordNotebookOptions {
  now?: () => number;
  /** Reuses the application's existing exam tab/lease checks for active saves. */
  assertActiveRequest?: (request: Request, kind: WordOrigin["kind"], resourceId: string) => Promise<void>;
  /** Settles leases/cancellations before a source is read, including Duo parts. */
  inspectSource?: (request: Request, kind: WordOrigin["kind"], resourceId: string) => Promise<void>;
  translation?: WordTranslationOptions;
}

const wordRequestSchema = z.object({
  word: z.string().trim().min(1).max(80),
  context: z.string().trim().min(1).max(2_000).optional(),
  sectionIndex: z.number().int().min(0).max(100).optional(),
  questionId: z.string().min(1).max(180).optional(),
}).strict();

const asyncRoute = (fn: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction) => { void fn(request, response).catch(next); };

function resourceId(request: Request): string {
  const id = request.params.id;
  if (typeof id !== "string" || !/^[\w:.-]{1,180}$/.test(id)) throw new ApiError(400, "Mã bản ghi không hợp lệ.");
  return id;
}

function plainText(text: string): string {
  return text.normalize("NFC").replace(/[’‘]/gu, "'").replace(/\s+/gu, " ").trim();
}

export function normalizeSelectedWord(word: string): string {
  const normalized = plainText(word).toLowerCase();
  if (normalized.length > 80 || !/^[a-z]+(?:['-][a-z]+)*$/u.test(normalized))
    throw new ApiError(400, "Hãy chọn một từ tiếng Anh trong bài.");
  return normalized;
}

function tokens(text: string): { word: string; index: number }[] {
  return [...text.matchAll(/(?<![\p{L}\p{N}])[A-Za-z]+(?:['-][A-Za-z]+)*(?![\p{L}\p{N}])/gu)]
    .map(match => ({ word: match[0].toLowerCase(), index: match.index }));
}

/** The caller may point to a sentence, but cannot supply new context or keys. */
export function visibleWordContext(word: string, sourceTexts: string[], supplied?: string): string {
  const wanted = supplied === undefined ? undefined : plainText(supplied);
  const wantedTokens = wanted ? tokens(wanted).filter(token => token.word === word) : [];
  if (wanted && !wantedTokens.length)
    throw new ApiError(400, "Từ đã chọn không nằm trong ngữ cảnh này.");
  for (const raw of sourceTexts) {
    const text = plainText(raw);
    const token = tokens(text).find(item => item.word === word && (!wanted || wantedTokens.some(candidate => {
      const anchor = item.index - candidate.index;
      return anchor >= 0 && text.startsWith(wanted, anchor);
    })));
    if (!token) continue;
    const position = token.index;
    const left = Math.max(text.lastIndexOf(".", position - 1), text.lastIndexOf("!", position - 1), text.lastIndexOf("?", position - 1)) + 1;
    const ending = /[.!?]/u.exec(text.slice(position + word.length));
    const right = ending ? position + word.length + ending.index + 1 : text.length;
    // Long passages are never forwarded to the provider in full.
    const begin = Math.max(left, position - 280);
    const end = Math.min(right, begin + 600);
    return text.slice(begin, end).trim();
  }
  throw new ApiError(400, "Từ hoặc ngữ cảnh không nằm trong phần bài đang hiển thị.");
}

function sectionTexts(section: ContentSection, hideTranscript: boolean): string[] {
  const texts = [section.title];
  if (!hideTranscript) {
    texts.push(section.text, section.instructions ?? "", ...(section.cuePoints ?? []));
    for (const line of section.dialogue ?? []) texts.push(line.text, line.speaker);
  }
  for (const block of section.questionBlocks ?? []) {
    texts.push(block.title, block.instructions, block.text ?? "");
    for (const row of block.rows ?? []) texts.push(row.label ?? "", ...row.cells);
  }
  for (const visual of section.visuals ?? []) {
    texts.push(visual.title, visual.description ?? "");
    if ("rows" in visual) {
      texts.push(...visual.series, visual.unit, visual.xLabel ?? "", visual.yLabel ?? "", ...visual.rows.map(row => row.label));
    } else {
      texts.push(...visual.labels.map(label => label.text ?? ""), ...(visual.nodes ?? []).map(node => node.text ?? ""));
      texts.push(...(visual.connections ?? []).map(connection => connection.label ?? ""));
    }
  }
  return texts;
}

function attemptTexts(content: StoredContent, record: AttemptRecord, input: WordRequest): string[] {
  if (input.questionId !== undefined) throw new ApiError(400, "Lượt luyện dùng chỉ số phần bài.");
  if (input.sectionIndex !== undefined && !content.sections[input.sectionIndex])
    throw new ApiError(400, "Phần bài không hợp lệ.");
  const hideTranscript = content.skill === "listening" && record.mode === "exam" && record.status !== "submitted";
  const sections = input.sectionIndex === undefined ? content.sections : [content.sections[input.sectionIndex]];
  const texts = [content.title, content.description, ...sections.flatMap(section => sectionTexts(section, hideTranscript))];
  for (const question of content.questions) {
    if (input.sectionIndex !== undefined && question.sectionIndex !== input.sectionIndex) continue;
    const visibleOptions = question.options ?? (question.type === "true-false"
      ? ["TRUE", "FALSE", "NOT GIVEN"] : question.type === "yes-no" ? ["YES", "NO", "NOT GIVEN"] : []);
    texts.push(question.prompt, question.groupInstructions ?? "", ...visibleOptions);
  }
  // Submitted feedback is visible too; private answer material is excluded while active.
  if (record.status === "submitted" && record.feedback) {
    if (["reading", "listening", "grammar"].includes(content.skill)) {
      // The application reconstructs missing legacy answer rows from content
      // after submission; match that same visible review material here.
      for (const question of content.questions) {
        if (input.sectionIndex !== undefined && question.sectionIndex !== input.sectionIndex) continue;
        if (!record.feedback.answers.some(answer => answer.questionId === question.id))
          texts.push(question.answer, question.explanation, question.evidence, ...(question.acceptedAnswers ?? []));
      }
    }
    for (const answer of record.feedback.answers) {
      const question = content.questions.find(item => item.id === answer.questionId);
      if (input.sectionIndex !== undefined && question?.sectionIndex !== input.sectionIndex) continue;
      texts.push(answer.prompt ?? "", answer.context ?? "", answer.sectionTitle ?? "", answer.explanation, answer.evidence,
        answer.answer, ...(answer.options ?? []));
    }
    for (const reference of record.feedback.referenceAnswers ?? content.referenceAnswers ?? []) {
      if (input.sectionIndex !== undefined && reference.sectionId !== content.sections[input.sectionIndex].id) continue;
      texts.push(reference.title, reference.sampleAnswer, reference.explanation, ...reference.keyPoints);
      for (const item of reference.responses ?? []) texts.push(item.prompt, item.sampleAnswer, item.explanation ?? "");
    }
  }
  return texts;
}

function invalidAttempt(record: AttemptRecord): boolean {
  return record.status === "invalidated" || Boolean(record.invalidatedAt) || record.integrity?.status === "invalidated";
}

function invalidPlacement(record: PlacementRecord): boolean {
  return record.completionReason === "invalidated" || Boolean(record.invalidatedAt) || record.integrity?.status === "invalidated";
}

function completedPlacement(record: PlacementRecord): boolean {
  return !invalidPlacement(record) && record.currentQuestionId === null && record.result !== null &&
    (record.answers.length >= record.total || record.completionReason === "deadline");
}

function reviewTexts(answer: Feedback["answers"][number]): string[] {
  return [answer.context ?? "", answer.prompt ?? "", ...(answer.options ?? []), answer.explanation,
    answer.evidence, answer.answer, answer.sectionTitle ?? ""];
}

function publicCard(card: CardRecord, now: number): VocabularyCard {
  const { _id: _id, userId: _userId, scheduler, reviewLog: _logs, ...view } = card;
  return { ...view, ...vocabularyMetrics(scheduler, new Date(now)),
    ...(card.meaningStatus === "pending" ? { due: false } : {}) };
}

/** Registered behind the application's existing authentication middleware. */
export function registerWordNotebookRoutes(app: Express, database: Database, options: WordNotebookOptions = {}): void {
  const now = options.now ?? Date.now;
  const translations = new Map<string, { translation: WordTranslation; expiresAt: number }>();
  const inFlight = new Map<string, Promise<WordTranslation>>();

  async function resolveSource(request: Request, kind: WordOrigin["kind"], input: WordRequest, translate: boolean): Promise<WordOrigin> {
    const id = resourceId(request);
    const userId = learnerOf(request).id;
    const word = normalizeSelectedWord(input.word);
    let texts: string[];
    let questionId = input.questionId;
    if (kind === "attempt") {
      let record = await database.attempts.findOne({ _id: id, userId });
      if (!record) throw new ApiError(404, "Không tìm thấy lượt luyện của bạn.");
      if (options.inspectSource) {
        await options.inspectSource(request, kind, id);
        record = await database.attempts.findOne({ _id: id, userId });
        if (!record) throw new ApiError(404, "Không tìm thấy lượt luyện của bạn.");
      }
      if (invalidAttempt(record)) throw new ApiError(409, "Lượt đã bị hủy; không thể tra từ.");
      if (translate && record.status !== "submitted") throw new ApiError(409, "Nghĩa của từ chỉ xuất hiện sau khi nộp bài.");
      if (!translate && record.status === "in-progress") {
        await options.assertActiveRequest?.(request, kind, id);
        record = await database.attempts.findOne({ _id: id, userId });
        if (!record) throw new ApiError(404, "Không tìm thấy lượt luyện của bạn.");
        if (invalidAttempt(record)) throw new ApiError(409, "Lượt đã bị hủy; không thể lưu từ.");
      }
      const content = await database.content.findOne({ _id: record.contentId });
      if (!content) throw new ApiError(404, "Không tìm thấy nội dung của lượt luyện.");
      texts = attemptTexts(content, record, input);
    } else {
      if (input.sectionIndex !== undefined) throw new ApiError(400, "Bài đầu vào dùng mã câu hỏi.");
      let record = await database.placements.findOne({ _id: id, userId });
      if (!record) throw new ApiError(404, "Không tìm thấy bài đầu vào của bạn.");
      if (options.inspectSource) {
        await options.inspectSource(request, kind, id);
        record = await database.placements.findOne({ _id: id, userId });
        if (!record) throw new ApiError(404, "Không tìm thấy bài đầu vào của bạn.");
      }
      if (invalidPlacement(record)) throw new ApiError(409, "Bài đã bị hủy; không thể tra từ.");
      const complete = completedPlacement(record);
      if (translate && !complete) throw new ApiError(409, "Nghĩa của từ chỉ xuất hiện sau khi hoàn thành bài đầu vào.");
      if (!complete) {
        await options.assertActiveRequest?.(request, kind, id);
        record = await database.placements.findOne({ _id: id, userId });
        if (!record) throw new ApiError(404, "Không tìm thấy bài đầu vào của bạn.");
        if (invalidPlacement(record)) throw new ApiError(409, "Bài đã bị hủy; không thể lưu từ.");
        if (!record.currentQuestionId || input.questionId && input.questionId !== record.currentQuestionId)
          throw new ApiError(400, "Câu hỏi không đang hiển thị trong bài đầu vào.");
        questionId = record.currentQuestionId;
        const item = await database.placementItems.findOne({ _id: questionId });
        if (!item) throw new ApiError(404, "Không tìm thấy câu hỏi.");
        texts = [item.question, ...item.options, ...(item.skill === "reading" ? [item.text] : [])];
      } else {
        const attempted = input.questionId ? record.answers.filter(answer => answer.questionId === input.questionId) : record.answers;
        if (!attempted.length) throw new ApiError(400, "Câu hỏi không nằm trong bài đầu vào đã hoàn thành.");
        texts = [];
        for (const answer of attempted) {
          const snapshot = record.result?.answers.find(item => item.questionId === answer.questionId) ?? answer.review;
          if (snapshot) texts.push(...reviewTexts(snapshot));
          else {
            const item = await database.placementItems.findOne({ _id: answer.questionId });
            if (item) texts.push(item.text, item.question, ...item.options, item.explanation, item.answer);
          }
        }
      }
    }
    return { kind, resourceId: id, context: visibleWordContext(word, texts, input.context),
      ...(input.sectionIndex === undefined ? {} : { sectionIndex: input.sectionIndex }),
      ...(questionId === undefined ? {} : { questionId }) };
  }

  async function saveWord(userId: string, word: string, origin: WordOrigin): Promise<{ card: CardRecord; alreadySaved: boolean }> {
    async function keepExisting(card: CardRecord): Promise<{ card: CardRecord; alreadySaved: boolean }> {
      // A word first captured in an abandoned/invalidated paper must remain
      // resolvable when the learner deliberately captures it in another paper.
      if (card.meaningStatus === "pending" && JSON.stringify(card.origin) !== JSON.stringify(origin)) {
        card = await database.cards.findOneAndUpdate({ _id: card.id, userId, meaningStatus: "pending" },
          { $set: { origin, example: origin.context } }, { returnDocument: "after" }) ?? card;
      }
      return { card, alreadySaved: true };
    }
    const existing = await database.cards.findOne({ userId, word });
    if (existing) return keepExisting(existing);
    const id = newId();
    const scheduler = newScheduler(new Date(now()));
    const card: CardRecord = {
      _id: id, id, userId, vocabularyId: null, word, meaning: "", meaningStatus: "pending", origin,
      example: origin.context, cefr: "B1", topic: "Personal", savedAt: new Date(now()).toISOString(),
      ...vocabularyMetrics(scheduler, new Date(now())), due: false, scheduler, reviewLog: [],
    };
    try {
      await database.cards.insertOne(card);
      return { card, alreadySaved: false };
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      const duplicate = await database.cards.findOne({ userId, word });
      if (!duplicate) throw error;
      return keepExisting(duplicate);
    }
  }

  async function translationFor(userId: string, word: string, origin: WordOrigin): Promise<WordTranslation> {
    const key = JSON.stringify([userId, origin.kind, origin.resourceId, word, origin.context]);
    const cached = translations.get(key);
    if (cached && cached.expiresAt > now()) return cached.translation;
    if (cached) translations.delete(key);
    const shared = inFlight.get(key);
    if (shared) return shared;
    const work = (async () => {
      const card = await database.cards.findOne({ userId, word });
      if (card?.meaningStatus === "ready" && card.translationContext === origin.context && card.translationSource && card.meaning) {
        return { word, meaning: card.meaning, definition: card.definition, partOfSpeech: card.partOfSpeech,
          source: card.translationSource, context: origin.context };
      }
      const bank = await database.vocabulary.findOne({ word: { $regex: `^${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, $options: "i" } });
      const context = plainText(origin.context).toLowerCase();
      const bankFits = bank?.examples.some(example => {
        const sentence = plainText(example).toLowerCase();
        return Boolean(sentence && tokens(sentence).some(token => token.word === word) &&
          (context.includes(sentence) || tokens(context).length >= 3 && sentence.includes(context)));
      });
      const translation: WordTranslation = bank && bankFits
        ? { word, meaning: bank.meaning, definition: bank.definition, partOfSpeech: bank.partOfSpeech, source: "bank", context: origin.context }
        : await translateWordWithOpenAI(word, origin.context, options.translation);
      if (translations.size >= 500) translations.delete(translations.keys().next().value!);
      translations.set(key, { translation, expiresAt: now() + 30 * 60_000 });
      return translation;
    })();
    inFlight.set(key, work);
    try { return await work; }
    finally { inFlight.delete(key); }
  }

  for (const kind of ["attempt", "placement"] as const) {
    const base = kind === "attempt" ? "/api/attempts/:id/words" : "/api/placement/:id/words";
    app.post(base, asyncRoute(async (request, response) => {
      const input = wordRequestSchema.parse(request.body);
      const origin = await resolveSource(request, kind, input, false);
      const word = normalizeSelectedWord(input.word);
      const { card, alreadySaved } = await saveWord(learnerOf(request).id, word, origin);
      response.set("Cache-Control", "private, no-store").status(alreadySaved ? 200 : 201)
        .json({ saved: { cardId: card.id, word: card.word, alreadySaved } });
    }));
    app.post(`${base}/translate`, asyncRoute(async (request, response) => {
      const input = wordRequestSchema.parse(request.body);
      const origin = await resolveSource(request, kind, input, true);
      const userId = learnerOf(request).id;
      const word = normalizeSelectedWord(input.word);
      const translation = await translationFor(userId, word, origin);
      // Provider work can outlive a cancellation. Recheck the disclosure
      // boundary before enriching a card or sending any meaning to the learner.
      const latest = await resolveSource(request, kind, input, true);
      if (latest.context !== origin.context)
        throw new ApiError(409, "Ngữ cảnh của lượt đã thay đổi. Hãy tải lại bài.");
      // Only a previously captured unresolved card is enriched. FSRS and all
      // history, including an established personal meaning, stay untouched.
      const resolved = await database.cards.findOneAndUpdate({ userId, word, meaningStatus: "pending", "origin.context": translation.context }, {
        $set: { meaning: translation.meaning, meaningStatus: "ready", translationSource: translation.source,
          translationContext: translation.context, definition: translation.definition, partOfSpeech: translation.partOfSpeech,
          origin: latest, example: translation.context },
      }, { returnDocument: "after" });
      const card = resolved ?? await database.cards.findOne({ userId, word });
      response.set("Cache-Control", "private, no-store").json({ translation, ...(card ? { card: publicCard(card, now()) } : {}) });
    }));
  }
}
