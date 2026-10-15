# API contract

All paths are under `/api`. JSON bodies use `Content-Type: application/json`; authentication uses an HttpOnly cookie. Do not store tokens or passwords in localStorage. Errors use `{error:string}` and an HTTP status. Shared types are in `shared/types.ts` and `shared/duo.ts`. Personal reads/writes use the authenticated owner, never a client-provided user ID.

## Authentication and ordinary practice

Duo is the default and production mode. Only the two private configured phone identities can authenticate; names and the shared target 8.0 are fixed. Original phone numbers, names and password hashes belong only in private server configuration, not examples, source or frontend bundles. Legacy email/demo mode is explicitly disabled in production and exists only for isolated regression tests.

| Method/path | Request | Response/behavior |
| --- | --- | --- |
| GET health | — | `Health`; actual Mongo counts, `duoEnabled:true`, `authMode:'phone'`, `demoEnabled:false`, provider configuration flags. |
| GET auth/me | — | `{user:Profile}` or `{user:null}`; authenticated profile includes own phone/name/role. |
| POST auth/login | `{phone,password}` | `{user}`; normalize valid Vietnamese phone input; generic 401 for invalid identity/password. |
| POST auth/logout | — | `{ok:true}`; clears own session/cookie. |
| POST auth/register | Any | 403 in Duo; no third account registration. |
| POST auth/demo | Any | 403 in Duo. Email login also unavailable in Duo. |
| PATCH profile | `{name?,targetBand?,testType?,examDate?,weeklyMinutes?,dailyMinutes?,selfAssessment?}` | `{user}`; unchanged fixed name/target accepted; changing fixed identity or target away from 8 rejected. Personal timing, date/type and self-assessment up to 8 are editable. |
| GET dashboard | — | `Dashboard`; personal learning metrics, independent of the shared-band decision. |
| GET content | `skill?,topic?,band?,cefr?,testType?,format?,q?,page?,pageSize?,mode?` | `LibraryResult`; independently accessible catalog plus owner/mode-scoped completion summaries for the current page; private, no-store. |
| GET content/:id/progress | `mode?:practice|exam` | `{progress:ContentProgress}`: latest valid submitted summary, completion count and active draft ID; includes replacement sittings belonging to this original exercise. No answers or partner data. |
| GET content/:id | — | `{content:ContentItem}`; public content has no answer keys. |
| POST content/generate | `{skill,band,topic,testType}` | `{content}`; band up to 8.0, missing provider → 503. |
| POST content/:id/audio | — | Audio from configured ElevenLabs; missing provider → 503. |
| POST attempts | `{contentId,mode,duoAssessmentId?}` | `{attempt:Attempt}`. `mode` is `practice` or `exam`. Ordinary practice/mock works alone. Assessment context is server-validated and must use Exam. Reuses a compatible own unfinished attempt; ordinary attempts cannot become qualifying Duo attempts. |
| GET attempts | `skill?,status?` | `{attempts:AttemptSummary[]}`; own attempts only. |
| GET attempts/:id | — | `{attempt}`; another person's ID returns 404. |
| PATCH attempts/:id | `{responses?,essays?,transcript?,durationSeconds?}` | `{attempt}`; merge drafts, immutable after submission. |
| POST attempts/:id/submit | — | `{attempt}` with stored feedback; valid Duo linkage reconciles own assessment and shared progress. |
| POST attempts/:id/regrade | — | Own submitted Duo Writing/Speaking only. Reuses saved essays/private recording; requires real provider configuration. Missing AI → 503, conflicting grading → 409; no client-supplied score accepted. |
| POST attempts/:id/listening-source | — | `{sections,source:'browser-tts',notice}`; Exam allows one request and hides text in normal view. |
| POST attempts/:id/speaking | Multipart `audio?`, `transcript?` | JSON `{attempt}` or SSE with `Accept:text/event-stream`; saves own recording and grading results. |
| GET attempts/:id/audio | Optional `Range: bytes=...` | Private original Speaking recording after owner/file/integrity checks; single-range seek supports 206/416 and no-store. |
| GET attempts/:id/listening-audio | `sectionIndex?` and optional Range header | Prepared audio for valid submitted owned Listening; selected section or complete audio, repeatable without consuming a play or generating speech. Active POST keeps its one-play exam contract. |
| GET placement/:id/audio | `questionId` and optional Range header | Prepared audio for a Listening question actually served in an owned, valid completed placement; no new test or speech generation. |
| GET placement/active | — | `{placement:PlacementState}` or `{placement:null}`. |
| GET placement/history | — | `{placements:PlacementSummary[]}` for the owner. |
| POST placement/start | `{mode:'quick'}` or `{mode:'deep'}` | `{placement}`; 15 items/20 minutes or 30 items/40 minutes; resumes the persisted server deadline. Returns deadlineAt/serverNow, level/text-based suggestedQuestionSeconds and own saved draftAnswer. |
| POST placement/:id/draft | `{questionId,answer}` | Owner-scoped valid choice autosave; no keys/evidence while active. Expired requests return the completed saved test. |
| GET placement/:id | — | Owner view; settles an expired test and reviews only served questions, including the last saved/blank current item. Fewer than five nonblank answers leave the band null and do not update Duo placement. |
| POST placement/:id/answer | `{questionId,answer}` | `{placement}`; valid completed result syncs Duo placement, preserving any existing shared path. |
| GET vocabulary/bank | `q?,topic?,cefr?,page?,pageSize?` | `{items:VocabularyEntry[],total:number}`. |
| GET vocabulary/cards | — | `{cards:VocabularyCard[],dueCount:number}`. |
| POST vocabulary/cards | `{vocabularyId}` or `{word,meaning,example?,cefr?,topic?}` | `{card}`; idempotent owner save. |
| POST vocabulary/cards/:id/review | `{rating:1}` through `{rating:4}` | `{card}` with real FSRS scheduling. |
| POST attempts/:id/words | `{word,context?,sectionIndex?}` | `{saved:{cardId,word,alreadySaved}}`; owner-scoped visible single-word capture, no definition or answer material. Active exam tab checks remain enforced. |
| POST attempts/:id/words/translate | Same body | `{translation,card?}`; only owned, valid submitted work. Contextual Vietnamese meaning inline; saved pending card enriched only for its matching context, preserving FSRS/history. |
| POST placement/:id/words | `{word,context?,questionId?}` | Same save-only response. Active tests accept only the currently served question and exclude hidden Listening text. |
| POST placement/:id/words/translate | Same body | Same translation response; only valid completed tests and questions actually served to the owner. |
| GET plan | — | `{plan:StudyPlan}` for legacy/personal recommendations; never a source of Duo unlock authority. |
| PATCH plan/tasks/:id | `{completed:boolean}` | Legacy task status only; cannot bypass Duo lesson proof, Gate or promotion. |
| GET errors | — | `ErrorNotebook` owned by the current learner. |
| GET account/export | — | Owner-only profile, attempts, placement, cards, plans and recording metadata; Duo assessment history is exposed by its own owner-scoped endpoint. |
| DELETE account/history | `{confirm:true}` | 409 in Duo to preserve qualifying evidence and retained results. |

## Shared Duo learning path

Selected words reuse the personal vocabulary collection. Pending cards have `meaningStatus:'pending'`, an empty meaning and source context, and are excluded from due-card review until enriched. Translation uses a matching bank example or the configured private OpenAI binding with a short timeout; provider failures preserve the saved word. See [word-notebook.md](word-notebook.md).

All Duo endpoints require one of the configured identities. A request cannot set members, band, threshold, scores, readiness of another person or curriculum. Two completed placements create one shared path at `MIN(A,B)`, restricted to half-band steps from 3.0 to 8.0. New placement estimates do not reset the path. Default curriculum is 20 sessions/band, Gate every 5 sessions; server configuration can choose 10 or vary session count per band.

| Method/path | Request | Response/behavior |
| --- | --- | --- |
| GET duo | — | `{duo:DuoSnapshot}`; `path:null` until both placements; shared/current/target separate from individual estimates; both members' aggregate completion/results but only own assessment list. |
| GET duo/history | `page?,pageSize?` | `DuoHistoryResult`; owner-scoped paginated complete assessment history, `total`, pagination and `serverNow`. |
| POST duo/lessons/:id/complete | `{attemptId}` or server-curriculum vocabulary `{cardIds}` | `{duo}`; lesson must be unlocked and proof owned, submitted and valid. Objective lessons need at least 80% of slots answered; Writing every required task at 150/250 words; Speaking sufficiently substantive text or owned saved recording. |
| POST duo/gates/:id/start | — | `{assessment:DuoAssessmentView}`; both finish preceding sessions; independent Gate attempts. Already passed results are retained, failures may retry. |
| GET duo/assessments/:id | — | `{assessment}` for the owner; reconciles server feedback, never exposes partner responses. States: `in-progress`, `pending-ai`, `passed`, `failed`. |
| POST duo/rooms | — | 201 `{room:DuoRoomView}`; requires complete band curriculum and all Gates passed; opens/reuses current band's room. |
| GET duo/rooms/:id | — | `{room}`; member presence/readiness, server countdown and deadline; no partner answers. |
| POST duo/rooms/:id/join | — | `{room}`; joins only the signed-in member. |
| POST duo/rooms/:id/heartbeat | — | `{room}`; refreshes own presence. Frontend uses 10-second heartbeat while participating. |
| POST duo/rooms/:id/ready | `{ready:boolean,companion?:boolean}` | `{room}`; both live and Ready start server countdown. Companion is allowed only for a retained pass and non-strict mode. |
| POST duo/rooms/:id/leave | — | `{room}`; clears own readiness/presence; pre-start countdown cannot proceed with one absent person. |
| POST duo/rooms/:id/start | — | `{room,assessment,companion}`; only after legitimate two-member Ready/countdown. Companion has `assessment:null`; others receive separate assessment IDs. Rejoining cannot reset time. |

Promotion parts expose `startsAt`/`deadlineAt`, with a shared server schedule; later sections cannot start before their time or before previous work is submitted. Lost connection after legitimate start does not discard saved work or cancel the partner's ongoing attempt. Only two valid passes change `Shared Current Band` atomically; one pass waits and is retained for the next joint retake. Shared band remains capped at 8.0. Gate results never change band.

A `pending-ai` Writing/Speaking result means submitted work is saved but has no valid final band. Missing AI/acoustic evidence cannot promote either person. Speaking requires real audio-derived evidence; OpenAI text feedback alone is insufficient. The regrade endpoint reuses owned saved work when services are available.

## Grading and data limits

SSE Speaking sends `progress` with the transcription/pronunciation/audio-scoring/evaluation/saving stage, final `result` with `{attempt}`, or `error` with `{error}`. Drafts, deadlines, recordings and all assessment histories persist in MongoDB. Answer keys/evidence never appear in public content before grading. Practice-only advanced lesson guides are hidden during Exam and Duo assessment.

`estimatedBand:null` is correct for short objective drills and ungraded Writing/Speaking. Full 40-item Reading/Listening forms use indicative reference conversion. The bank contains original, unreviewed content; structural checks do not establish IELTS examiner review or psychometric calibration.

The active fresh-20261011-v3 seed contains 810 lessons, 156 mocks, 648 vocabulary entries and 480 placement items. Ordinary seed adds only missing fresh IDs and preserves progress; startup refuses earlier seed IDs. The separately authorized bank-reset operation backs up the IELTS database, keeps the two configured account IDs/password hashes, clears all other documents and resets profile progress before inserting the new bank. `/health.bank.version` identifies this release.

Completed objective feedback now contains question number, prompt, context, section title, options and accepted answers, in addition to the saved key/result/evidence. Placement snapshots the exact adaptive question at answer time; completed historical reviews are owner scoped. Stored referenceAnswers are never exposed in public content or active feedback; submitted Writing/Speaking feedback supplies task-specific illustrative models (including per-question Speaking responses), even when offline grading has a null band. The preserving updater adds 540 lessons, 104 mocks, 432 vocabulary entries and 320 placement items, retaining all v2 IDs/documents and private learner data; see exam-upgrade.md.

OpenAI Audio feedback may include audioAssessment {provider,model,durationSeconds,observations:[{criterion,startSeconds,endSeconds,quote,observation}]}; these are AI observations from the waveform, not Azure percentages or official examiner results. Timestamp ranges and transcript quotations are validated before feedback is attached. Writing scoring receives the task’s chart series/units and complete visual data (including maps/processes), not only the textual prompt.

Submitted Speaking may include `speakingReview` with the saved authored prompts, actual recording availability and transcript provenance (`speech-recognition`, `typed`, or legacy `unknown`). Recognized text is attached to the exact recording before later grading; a new recording cannot inherit an older file's recognition. This retains the current whole-attempt practice format. See [listening-audio.md](listening-audio.md) for review controls and [time-answer-marking.md](time-answer-marking.md) for equivalent clock answers in newly graded fill questions; stored historical scores remain authoritative.
