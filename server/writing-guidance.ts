import { createHash } from "node:crypto";
import type { ChartVisual, ContentSection, ReferenceResponse, SpatialVisual, StoredContent, VisualAsset, WritingStudyGuide } from "../shared/types";
import { contentBank } from "./data/index";

type Family = "line" | "bar" | "pie" | "table" | "map" | "process" | "mixed" | "academic-report"
  | "letter-formal" | "letter-semi-formal" | "letter-informal" | "letter"
  | "opinion" | "discussion" | "advantages-disadvantages" | "problem-solution" | "causes-effects"
  | "causes-solutions" | "two-part" | "essay" | "unverified";
const labels: Record<Family, string> = {
  line: "Biểu đồ đường", bar: "Biểu đồ cột", pie: "Biểu đồ tròn", table: "Bảng số liệu",
  map: "Bản đồ / mặt bằng", process: "Quy trình", mixed: "Biểu đồ kết hợp", "academic-report": "Báo cáo Academic",
  "letter-formal": "Thư trang trọng", "letter-semi-formal": "Thư bán trang trọng", "letter-informal": "Thư thân mật", letter: "Thư General Training",
  opinion: "Nêu mức độ đồng ý", discussion: "Thảo luận hai quan điểm", "advantages-disadvantages": "Lợi ích và hạn chế",
  "problem-solution": "Vấn đề và giải pháp", "causes-effects": "Nguyên nhân và hệ quả", "causes-solutions": "Nguyên nhân và giải pháp",
  "two-part": "Hai câu hỏi trực tiếp", essay: "Bài nghị luận", unverified: "Hướng dẫn đọc bài mẫu đã lưu",
};
const taskOf = (section: ContentSection, reference: ReferenceResponse): 1 | 2 =>
  section.task ?? (/\bTask\s*1\b/iu.test(reference.title) ? 1 : 2);
const isChart = (asset: VisualAsset): asset is ChartVisual => ["line", "bar", "pie", "table"].includes(asset.type);
const bounded = (text: string, limit = 1600): string => text.length <= limit ? text : text.slice(0, limit);
const quote = (text: string): string => `“${bounded(text)}”`;

/** Normalise identifier remapping only, retaining all task/visual semantics. */
function sourceIdentity(section: ContentSection): unknown {
  const visual = (asset: VisualAsset): unknown => {
    if (isChart(asset)) { const { id: _id, ...rest } = asset; return rest; }
    const ids = new Map<string, string>();
    for (const key of ["labels", "nodes", "areas", "paths"] as const)
      for (const [index, item] of (asset[key] ?? []).entries()) ids.set(item.id, `${key}:${index}`);
    const { id: _id, ...rest } = asset;
    return {
      ...rest,
      labels: asset.labels.map(({ id: _labelId, ...item }) => item),
      ...(asset.nodes ? { nodes: asset.nodes.map(({ id: _nodeId, ...item }) => item) } : {}),
      ...(asset.areas ? { areas: asset.areas.map(({ id: _areaId, ...item }) => item) } : {}),
      ...(asset.paths ? { paths: asset.paths.map(({ id: _pathId, ...item }) => item) } : {}),
      ...(asset.connections ? { connections: asset.connections.map(edge => ({ ...edge, from: ids.get(edge.from) ?? `unresolved:${edge.from}`, to: ids.get(edge.to) ?? `unresolved:${edge.to}` })) } : {}),
    };
  };
  const { id: _id, ...rest } = section;
  return { ...rest, ...(section.visuals ? { visuals: section.visuals.map(visual) } : {}) };
}
function fingerprint(section: ContentSection, reference: ReferenceResponse, testType: StoredContent["testType"]): string {
  const order = (value: unknown): unknown => Array.isArray(value) ? value.map(order)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, order(entry)])) : value;
  const { sectionId: _id, ...saved } = reference;
  // Task 2 is identical in Academic/GT; a remapped mock may contain a lesson's
  // Task 2. Task 1 still includes its actual track in the proof.
  return createHash("sha256").update(JSON.stringify(order({
    section: sourceIdentity(section), reference: saved,
    track: taskOf(section, reference) === 2 ? "both" : testType,
  }))).digest("hex");
}
let bundledSources: Set<string> | undefined;
function matchesBundled(section: ContentSection, reference: ReferenceResponse, content: StoredContent): boolean {
  if (!bundledSources) {
    bundledSources = new Set<string>();
    for (const item of contentBank) {
      if (item.skill !== "writing") continue;
      for (const saved of item.referenceAnswers ?? []) {
        const source = item.sections.find(row => row.id === saved.sectionId);
        if (source) bundledSources.add(fingerprint(source, saved, item.testType));
      }
    }
  }
  return bundledSources.has(fingerprint(section, reference, content.testType));
}

function letterFamily(section: ContentSection, sample: string): Family {
  const prompt = section.text.toLowerCase();
  if (/write(?: a letter)? to (?:a |an |your |the )?(?:close )?(?:friend|brother|sister|cousin|parents|family member)/u.test(prompt)) return "letter-informal";
  if (/write(?: a letter)? to (?:a |an |your |the )?(?:new |former )?(?:neighbour|neighbor|colleague|landlord|teacher)/u.test(prompt)) return "letter-semi-formal";
  if (/write(?: a letter)? to (?:a |an |your |the )?(?:[\w-]+ )*(?:manager|company|office|administrator|council|department|editor|organiser|organizer|supervisor)/u.test(prompt)) return "letter-formal";
  if (/^Dear (?:Sir|Madam)|\bYours faithfully\b/imu.test(sample)) return "letter-formal";
  if (/\b(?:Lots of love|Love,|All the best|Cheers,)\b/iu.test(sample)) return "letter-informal";
  if (/\b(?:Best regards|Kind regards|Warm regards)\b/iu.test(sample)) return "letter-semi-formal";
  return "letter";
}
function classify(section: ContentSection, content: StoredContent, reference: ReferenceResponse): Family {
  if (taskOf(section, reference) === 1) {
    const types = [...new Set((section.visuals ?? []).map(item => item.type === "plan" ? "map" : item.type === "diagram" ? "process" : item.type))];
    if (types.length > 1) return "mixed";
    if (types.length === 1) return types[0] as Family;
    if (section.chart?.length) return section.chartType ?? "bar";
    if (content.testType === "general" || /\bwrite (?:a )?letter\b/iu.test(section.text)) return letterFamily(section, reference.sampleAnswer);
    return "academic-report";
  }
  const text = section.text.toLowerCase();
  // Evaluate the requested work, not incidental vocabulary in the background.
  // Keep imperative commands as well as questions (e.g. "Discuss both views").
  const commands = [
    ...(text.match(/[^.!?]*\?/gu) ?? []),
    ...text.split(/[.!?]/gu).filter(sentence => /^\s*(?:discuss|to what extent|give (?:your|reasons)|explain (?:why|how))\b/u.test(sentence)),
  ].join(" ").trim();
  const prompt = commands || text;
  if (/discuss both (?:views|opinions)|discuss (?:these|the) (?:two |both )?(?:views|opinions)/u.test(prompt)) return "discussion";
  if (/(?:advantages|benefits).*(?:disadvantages|drawbacks)|(?:disadvantages|drawbacks).*(?:advantages|benefits)|\boutweigh\b/su.test(prompt)) return "advantages-disadvantages";
  // A question about "why this choice matters" is not automatically a request
  // for root causes plus remedies; incidental "cause" can be a verb in a
  // problems question. Follow the command, not a single topic keyword.
  const causes = /\b(?:causes|reasons|factors)\b|\bwhat causes\b|\b(?:the|main|underlying) cause\b|\bsources of (?:this|the) problem\b/u.test(prompt)
    || /\bwhy (?:has|have) (?:this|that)\b|\bwhy (?:is|are) (?:this|that) (?:happening|occurring|the case)\b|\bwhy does this happen\b/u.test(prompt);
  const remedies = /\b(?:solutions?|solve|address(?:ed)?|tackle|measures|remed(?:y|ies)|reduce|preserv(?:e|ed)|revers(?:e|ed)|improv(?:e|ed)|respond)\b|what can be done/u.test(prompt);
  const asksProblems = /\bwhat (?:are (?:the )?(?:main )?)?(?:problems|difficulties|challenges)\b/u.test(prompt);
  const broadRemedy = remedies || /\bhow (?:can|could|should|might|would)\b|\bwhat (?:support|can|could)\b/u.test(prompt);
  if (asksProblems && broadRemedy) return "problem-solution";
  const asksEffects = /\bwhat (?:are (?:the )?)?(?:(?:main|possible|environmental|social|economic|negative|positive|long-term) )*(?:effects?|consequences?|impacts?)\b/u.test(prompt);
  if ((causes || /\bwhy\b/u.test(prompt)) && asksEffects) return "causes-effects";
  if (causes && remedies) return "causes-solutions";
  if (/\bagree or disagree\b|to what extent do you agree/u.test(prompt)) return "opinion";
  if ((prompt.match(/\?/gu)?.length ?? 0) > 1 || /\b(?:what|why|how|do you|is this)\b/u.test(prompt)) return "two-part";
  return "essay";
}

const approach: Record<Family, string> = {
  line: "Xác định trục thời gian, đơn vị và từng đường. Chọn xu hướng chung, điểm đầu/cuối, mức cao/thấp hoặc giao điểm có thật; không kể lần lượt mọi mốc.",
  bar: "Đọc tên các nhóm và đơn vị trước khi so sánh. Nhóm các cột theo điểm giống/khác; nêu mức cao nhất, thấp nhất và chênh lệch đáng chú ý. Chỉ dùng ngôn ngữ tăng/giảm theo thời gian khi hình thực sự có trục thời gian.",
  pie: "Đọc tổng thể mà mỗi hình tròn đại diện và đơn vị của phần chia. Chọn tỷ trọng lớn/nhỏ, rồi so sánh cơ cấu; phân biệt phần trăm với điểm phần trăm. Không suy ra số người nếu hình không cho tổng số.",
  table: "Đọc riêng đơn vị của từng cột. Chọn các hàng nổi bật và nhóm số liệu có thể so sánh; không cộng hoặc so trực tiếp các đại lượng khác đơn vị.",
  map: "Đối chiếu các mốc thời gian và cùng một khu vực ở từng bản đồ. Phân biệt công trình được giữ, thêm, bỏ hoặc thay thế; chỉ nêu vị trí/hướng khi hình thể hiện rõ. Không đoán lý do quy hoạch.",
  process: "Theo chiều mũi tên để xác định đầu vào, các bước và đầu ra; kiểm tra có nhánh hay vòng lặp. Mô tả trình tự có trong hình, dùng chủ động/bị động theo tác nhân; không thêm công đoạn từ kiến thức bên ngoài.",
  mixed: "Xác định thông tin và đơn vị riêng của từng hình. Tổng quan cần bao quát các hình; phần chi tiết có thể chia theo hình rồi nêu liên hệ thực sự có dữ kiện hỗ trợ. Không suy ra quan hệ nhân quả chỉ vì hai hình xuất hiện cùng nhau.",
  "academic-report": "Viết báo cáo khách quan: mở bài diễn đạt lại nhiệm vụ, tổng quan về đặc điểm chính, rồi chọn chi tiết để chứng minh. Chỉ mô tả thông tin thực sự được cung cấp.",
  "letter-formal": "Xác định người nhận trong vai trò công việc và mục đích viết. Dùng giọng lịch sự, rõ yêu cầu; mở/kết thư nhất quán với việc có biết tên người nhận hay không. Tránh tiếng lóng hoặc trách móc quá mức.",
  "letter-semi-formal": "Người nhận có quan hệ quen biết nhưng thư vẫn cần lịch sự, rõ mục đích. Chọn lời chào có tên nếu đề cho phép; giữ mức thân thiện vừa phải và không chuyển đột ngột sang tiếng lóng.",
  "letter-informal": "Viết tự nhiên cho người thân/bạn bè được nêu trong đề. Có thể dùng giọng thân mật, nhưng vẫn trả lời đủ các yêu cầu và chia đoạn rõ ràng; không biến thư thành một bài nghị luận.",
  letter: "Xác định quan hệ với người nhận từ chính đề để chọn mức trang trọng. Mở thư nêu mục đích, triển khai đủ các gạch đầu dòng và kết thư phù hợp; không áp một kiểu xưng hô cho mọi tình huống.",
  opinion: "Chọn mức độ đồng ý rõ ràng và duy trì từ mở bài đến kết luận. Mỗi luận điểm phải giải thích được vì sao bạn giữ quan điểm ấy; có thể đồng ý một phần nếu điều kiện và giới hạn được trình bày nhất quán.",
  discussion: "Giải thích cả hai quan điểm trước khi đánh giá. Nêu ý kiến riêng rõ ràng, đồng thời trình bày hợp lý lập luận của phía còn lại; không dành toàn bộ bài chỉ để bảo vệ một phía.",
  "advantages-disadvantages": "Phân tích lợi ích và hạn chế của đúng sự thay đổi trong đề. Nếu câu lệnh có “outweigh”, phải cân nhắc bên nào quan trọng hơn và giải thích tiêu chí đánh giá; liệt kê hai phía là chưa đủ.",
  "problem-solution": "Nêu vấn đề cụ thể và giải pháp xử lý đúng vấn đề đó. Giải thích cơ chế, người thực hiện và tính khả thi; tránh nêu một biện pháp chung chung không liên quan đến khó khăn vừa phân tích.",
  "causes-effects": "Tách nguyên nhân khỏi hệ quả. Với mỗi ý, giải thích chuỗi “vì sao xảy ra → dẫn đến điều gì”, dùng ví dụ phù hợp; không thay phần hệ quả bằng giải pháp khi đề không hỏi.",
  "causes-solutions": "Trả lời cả nguyên nhân và cách giải quyết. Liên kết mỗi giải pháp với một nguyên nhân đã nêu, giải thích ai thực hiện và bằng cách nào; không chỉ phân tích hệ quả rồi bỏ phần biện pháp.",
  "two-part": "Tách từng câu hỏi trong câu lệnh và bảo đảm có câu trả lời trực tiếp cho từng phần. Chia dung lượng hợp lý; một câu trả lời dài cho phần đầu không bù được việc bỏ qua phần sau.",
  essay: "Gạch chân phạm vi chủ đề và các động từ yêu cầu trong đề. Nêu câu trả lời trực tiếp, phát triển luận điểm bằng giải thích và ví dụ, rồi kết luận đúng những điều đã lập luận.",
  unverified: "Đọc bài mẫu đã lưu theo từng đoạn: tìm ý chính, cách giải thích và ví dụ. Chưa dùng các ghi chú này để kết luận bài mẫu phù hợp với đề hoặc hình đang hiển thị.",
};

function chartFacts(chart: ChartVisual): string[] {
  const facts = [`Hình ${quote(chart.title)} dùng đơn vị ${quote(chart.unit)}; các nhóm dữ liệu: ${chart.series.slice(0, 8).map(quote).join(", ")}.`];
  const rows = chart.rows.filter(row => row.values.some(Number.isFinite));
  if (!rows.length) return facts;
  const selected = rows.length === 1 ? rows : [rows[0], rows.at(-1)!];
  for (const row of selected) {
    const data = row.values.slice(0, chart.series.length).flatMap((value, index) => Number.isFinite(value) ? [`${chart.series[index]} = ${value}`] : []);
    if (data.length) facts.push(`Dữ kiện để đối chiếu tại ${quote(row.label)}: ${data.slice(0, 8).join("; ")} (${chart.unit}).`);
  }
  return facts;
}
function spatialFacts(asset: SpatialVisual): string[] {
  const text = [...asset.labels, ...(asset.nodes ?? [])].filter(item => Boolean(item.text)).map(item => item.text!);
  const facts = text.length ? [`Các nhãn thực sự có trong ${quote(asset.title)}: ${[...new Set(text)].slice(0, 10).map(quote).join(", ")}.`] : [];
  if (asset.type === "process" || asset.type === "diagram") {
    const nodes = new Map([...asset.labels, ...(asset.nodes ?? [])].map(node => [node.id, node.text]));
    const edges = (asset.connections ?? []).flatMap(edge => {
      const from = nodes.get(edge.from), to = nodes.get(edge.to);
      return from && to ? [`${quote(from)} → ${quote(to)}${edge.label ? ` (${edge.label})` : ""}`] : [];
    });
    if (edges.length) facts.push(`Một số liên kết theo đúng mũi tên: ${edges.slice(0, 5).join("; ")}. Kiểm tra toàn bộ các nhánh trong hình trước khi viết.`);
  }
  return facts;
}
function letterBullets(section: ContentSection): string[] {
  return section.cuePoints?.filter(Boolean) ?? section.text.split(/\n/gu)
    .filter(line => /^\s*(?:[•*-]|\d+[.)])\s+/u.test(line)).map(line => line.replace(/^\s*(?:[•*-]|\d+[.)])\s+/u, "").trim());
}
function facts(section: ContentSection, family: Family): string[] {
  if (family.startsWith("letter")) return letterBullets(section).slice(0, 6).map((bullet, index) => `Yêu cầu ${index + 1} cần được trả lời: ${quote(bullet)}.`);
  if (section.task !== 1) return [];
  const visuals = section.visuals ?? [];
  if (visuals.length) return visuals.slice(0, 6).flatMap(asset => isChart(asset) ? chartFacts(asset) : spatialFacts(asset));
  if (section.chart?.length) return chartFacts({ id: "legacy", type: section.chartType ?? "bar", title: section.title,
    rows: section.chart, series: section.chartSeries ?? [], unit: section.chartUnit ?? "đơn vị ghi trong đề" });
  return [];
}

function exactExcerpt(paragraph: string): string {
  const first = paragraph.match(/^[\s\S]*?[.!?](?:\s|$)/u)?.[0].trim() ?? paragraph;
  if (first.length <= 360) return first;
  const shortened = first.slice(0, 360), end = shortened.lastIndexOf(" ");
  return end > 0 ? shortened.slice(0, end) : shortened;
}
function paragraphNotes(sample: string, task: 1 | 2, family: Family): WritingStudyGuide["paragraphs"] {
  const parts = sample.split(/\n\s*\n/gu).map(part => part.trim()).filter(Boolean);
  const letter = family.startsWith("letter");
  const firstBody = letter && /^Dear\b/iu.test(parts[0] ?? "") ? 1 : 0;
  return parts.map((paragraph, index) => {
    const excerpt = exactExcerpt(paragraph);
    if (family === "unverified") return { index, role: `Đoạn ${index + 1} trong mẫu đã lưu`, excerpt,
      guidance: "Tìm ý chính và các câu hỗ trợ trong đoạn này. Chỉ đối chiếu cách viết của mẫu; chưa xác nhận nội dung khớp với nguồn hiện tại." };
    if (letter) {
      if (index === 0 && /^Dear\b/iu.test(paragraph)) return { index, role: "Lời chào", excerpt, guidance: "Đối chiếu cách xưng hô với quan hệ người nhận trong đề; không sao chép tên riêng nếu tình huống của bạn khác." };
      if (/^(?:Yours (?:faithfully|sincerely)|(?:Best|Kind|Warm) (?:wishes|regards)|Love,|All the best|Cheers,)/iu.test(paragraph))
        return { index, role: "Lời kết và ký tên", excerpt, guidance: "Kiểm tra lời kết nhất quán với mức trang trọng và lời chào. Tên trong bài mẫu là ví dụ, không phải dữ kiện phải dùng." };
      return { index, role: index === firstBody ? "Mở thư: nêu mục đích" : "Triển khai nội dung thư", excerpt,
        guidance: index === firstBody ? "Xem mẫu nêu lý do viết và bối cảnh ngắn gọn như thế nào. Kiểm tra thông tin này trả lời đúng yêu cầu của thư."
          : "Đối chiếu đoạn với từng gạch đầu dòng: ý nào đã được trả lời, chi tiết nào hỗ trợ và yêu cầu nào còn cần bổ sung. Chi tiết hư cấu hợp lý trong thư không phải đáp án bắt buộc." };
    }
    if (task === 1) return { index, excerpt,
      role: index === 0 ? /\boverall\b/iu.test(paragraph) ? "Mở bài và tổng quan" : "Mở bài" : /^(?:Overall|In general|On the whole)\b/iu.test(paragraph) ? "Tổng quan" : "Thân bài: mô tả và so sánh",
      guidance: index === 0 ? "Xác định mẫu đã diễn đạt lại đối tượng và phạm vi đề ra sao; tìm câu tổng quan nếu nó nằm cùng đoạn này."
        : /^(?:Overall|In general|On the whole)\b/iu.test(paragraph) ? "Tìm đặc điểm bao quát thay vì từng con số. Kiểm tra tổng quan dựa trên hình và không đưa quan điểm cá nhân."
        : "Kiểm tra từng số liệu, đơn vị, nhãn hoặc bước trong đoạn với hình gốc; chú ý cách nhóm thông tin và liên kết các chi tiết với tổng quan." };
    return { index, excerpt, role: index === 0 ? "Mở bài" : index === parts.length - 1 ? "Đoạn kết" : `Thân bài ${index}`,
      guidance: index === 0 ? "Xem cách mở bài giới hạn đúng chủ đề và giới thiệu câu trả lời/quan điểm. Phân biệt diễn đạt lại đề với việc thêm một nhận định chưa được chứng minh."
        : index === parts.length - 1 ? "Đối chiếu kết luận với các luận điểm đã phát triển. Kết luận cần chốt câu trả lời, không mở thêm một ý mới chưa giải thích."
        : "Tìm câu nêu ý chính, phần giải thích và ví dụ/điều kiện hỗ trợ. Tự hỏi đoạn này trả lời phần nào của câu lệnh và vì sao ví dụ có liên quan." };
  });
}

const phrases: [string, string][] = [
  ["Overall", "Nhìn chung; mở phần tổng quan dựa trên dữ kiện."], ["In conclusion", "Tóm lại; chốt câu trả lời từ các lập luận đã nêu."],
  ["By contrast", "Trái lại; nêu sự tương phản rõ ràng."], ["compared with", "So với; so sánh hai đối tượng có cơ sở tương ứng."],
  ["accounted for", "Chiếm; diễn đạt tỷ trọng hoặc phần đóng góp."], ["remained unchanged", "Không thay đổi; chỉ dùng khi dữ kiện thể hiện sự ổn định."],
  ["was replaced by", "Được thay thế bằng; mô tả thay đổi có trong hình."], ["were replaced by", "Được thay thế bằng; dùng với chủ ngữ số nhiều."],
  ["subsequently", "Sau đó; nối các thời điểm hoặc bước có thứ tự."], ["initially", "Ban đầu; chỉ giai đoạn khởi đầu."],
  ["whereas", "Trong khi; đối chiếu hai thông tin khác nhau."], ["while", "Trong khi; nghĩa cụ thể phụ thuộc câu (thời gian hoặc tương phản)."],
  ["I am writing", "Tôi viết thư này; giới thiệu mục đích trong thư."], ["I would appreciate", "Tôi sẽ rất cảm kích; đưa yêu cầu lịch sự."],
  ["Could you", "Bạn/ông/bà có thể…; mở một yêu cầu hoặc câu hỏi lịch sự."], ["Yours faithfully", "Lời kết trang trọng, thường đi với lời chào chưa biết tên người nhận."],
  ["Yours sincerely", "Lời kết trang trọng, thường đi với lời chào có tên người nhận."], ["Best regards", "Lời chúc/lời kết lịch sự, tương đối thân thiện."],
  ["In my opinion", "Theo ý kiến của tôi; đánh dấu quan điểm cá nhân."], ["In my view", "Theo cách nhìn của tôi; nêu quan điểm."],
  ["for example", "Ví dụ; đưa trường hợp minh họa cho luận điểm."], ["For instance", "Chẳng hạn; giới thiệu ví dụ liên quan."],
  ["However", "Tuy nhiên; chỉ sự tương phản hoặc giới hạn."], ["Nevertheless", "Dẫu vậy; nêu ý đối lập với điều vừa đề cập."],
  ["provided that", "Với điều kiện là; giới hạn phạm vi của nhận định."], ["rather than", "Thay vì; đối chiếu hai lựa chọn."],
  ["therefore", "Vì vậy; nối một kết quả có cơ sở từ ý trước."], ["as a result", "Kết quả là; diễn đạt hệ quả."],
  ["although", "Mặc dù; thừa nhận một ý trước khi nêu giới hạn/đối lập."], ["On the other hand", "Mặt khác; chuyển sang phía còn lại của vấn đề."],
];
function usefulLanguage(sample: string): WritingStudyGuide["usefulLanguage"] {
  return phrases.flatMap(([phrase, meaningVi]) => {
    const expression = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "iu");
    const match = sample.match(expression);
    return match ? [{ phrase: match[0], meaningVi }] : [];
  }).slice(0, 8);
}

/** Derive notes without mutating a prompt, sample, feedback, bank or database. */
export function buildWritingGuides(content: StoredContent, references: ReferenceResponse[], options: { sourceVerified?: boolean } = {}): WritingStudyGuide[] {
  if (content.skill !== "writing") return [];
  return content.sections.flatMap(section => {
    const reference = references.find(row => row.sectionId === section.id && row.sampleAnswer.trim());
    if (!reference) return [];
    const sourceVerified = options.sourceVerified === true || matchesBundled(section, reference, content);
    const task = taskOf(section, reference);
    const family = sourceVerified ? classify(section, content, reference) : "unverified";
    const letter = family.startsWith("letter");
    const planningMinutes = task === 1 ? 3 : 5, writingMinutes = task === 1 ? 14 : 30, checkingMinutes = task === 1 ? 3 : 5;
    const minimumWords = task === 1 ? 150 : 250;
    const analysis = sourceVerified
      ? [`Nhiệm vụ cần đối chiếu: ${quote(section.text)}.`, approach[family], ...facts(section, family)]
      : [approach.unverified, "Không có đủ bằng chứng để đối chiếu đề hiện tại với bài mẫu của lượt cũ. Các hướng dẫn dưới đây chỉ giúp đọc cấu trúc và ngôn ngữ trong mẫu đã lưu."];
    const planning = !sourceVerified ? "Ghi lại các ý và chức năng từng đoạn trong mẫu đã lưu; chưa dùng chúng làm dàn ý cho đề hiện tại."
      : task === 2 ? approach[family]
      : letter ? "Đánh dấu từng gạch đầu dòng; ghi người nhận, mục đích và ý cần viết cho mỗi yêu cầu. Chọn lời chào/kết nhất quán."
      : "Đọc hình và đơn vị; ghi đặc điểm cho tổng quan rồi chia nhóm chi tiết. Với bản đồ/quy trình, kiểm tra nhãn và mũi tên thay vì tự thêm dữ kiện.";
    return [{
      sectionId: section.id, task, taskType: family, taskTypeLabel: labels[family], sourceVerified,
      ...(!sourceVerified ? { notice: "Chưa xác minh bài mẫu đã lưu khớp với đề hiện tại. Không dùng số liệu hoặc dạng bài hiện tại để diễn giải lại mẫu cũ; hãy đối chiếu nguồn trước khi áp dụng." } : {}),
      timePlan: { totalMinutes: task === 1 ? 20 : 40, planningMinutes, writingMinutes, checkingMinutes, minimumWords },
      analysis,
      steps: [
        { title: `Phân tích và lập dàn ý · khoảng ${planningMinutes} phút`, detail: planning },
        { title: `Viết bài · khoảng ${writingMinutes} phút`, detail: !sourceVerified ? "Tập nhận diện cách mẫu nối các câu và phát triển ý. Nếu viết lại, chỉ làm sau khi có đề gốc phù hợp để kiểm tra nội dung."
          : task === 2 ? "Viết mở bài trả lời trực tiếp; mỗi đoạn thân bài phát triển một ý với giải thích và ví dụ; kết luận chốt câu trả lời. Dùng ngôn ngữ bạn kiểm soát được, không nhồi từ hiếm."
          : letter ? "Mở thư nêu mục đích; dành dung lượng phù hợp cho các yêu cầu; kết thư lịch sự. Chi tiết bổ sung phải hợp lý và không mâu thuẫn với đề."
          : "Diễn đạt lại nhiệm vụ; viết tổng quan về đặc điểm chính; dùng các đoạn chi tiết để chứng minh bằng đúng dữ liệu/hình. Không nêu quan điểm hoặc nguyên nhân không được cung cấp." },
        { title: "Đối chiếu bài mẫu theo từng đoạn", detail: "Đọc các trích đoạn bên dưới cùng toàn bộ bài mẫu. So sánh cách triển khai, không học thuộc một bài để áp vào mọi đề; quan điểm hoặc cách diễn đạt khác vẫn có thể hợp lệ." },
        { title: `Rà soát · khoảng ${checkingMinutes} phút`, detail: `Kiểm tra trả lời đủ yêu cầu, mạch đoạn, từ vựng, thì và cấu trúc câu. Mốc tối thiểu Task ${task} là ${minimumWords} từ; số từ không tự quy đổi thành band. Đây là thời gian gợi ý cho một bài luyện, không phải đồng hồ nộp bài mới.` },
      ],
      paragraphs: paragraphNotes(reference.sampleAnswer, task, family),
      usefulLanguage: usefulLanguage(reference.sampleAnswer),
      checklist: [
        ...(!sourceVerified ? ["Đã tìm và đối chiếu lại đề gốc trước khi áp dụng nội dung của mẫu."]
          : task === 2 ? ["Đã trả lời mọi phần của câu lệnh và giữ câu trả lời/quan điểm nhất quán.", "Mỗi luận điểm có giải thích và ví dụ liên quan, không chỉ là một ý liệt kê."]
          : letter ? ["Đã xử lý đủ từng gạch đầu dòng và nêu rõ mục đích viết thư.", "Lời chào, mức trang trọng và lời kết phù hợp người nhận."]
          : ["Có tổng quan nêu đặc điểm chính, không chỉ một danh sách chi tiết.", "Các con số, đơn vị, nhãn, vị trí hoặc bước đều kiểm tra được từ nguồn."]),
        "Các đoạn có chức năng rõ ràng; từ nối diễn đạt đúng mối quan hệ giữa ý.",
        "Từ vựng chính xác và câu đủ chủ ngữ/động từ; đã kiểm tra thì, hòa hợp và chính tả.",
        `Đạt ít nhất ${minimumWords} từ và dành thời gian đọc lại; không coi độ dài là điểm số.`,
      ],
      pitfalls: [
        !sourceVerified ? "Gán số liệu, thể loại hoặc bối cảnh của đề hiện tại vào một mẫu cũ chưa được xác minh."
          : task === 2 ? "Lạc phạm vi đề, bỏ một câu hỏi hoặc thay đổi quan điểm ở kết luận."
          : letter ? "Bỏ gạch đầu dòng, sai mức trang trọng hoặc tự thêm tình tiết trái với đề."
          : "Bịa nguyên nhân/số liệu, nhầm đơn vị hoặc chỉ liệt kê chi tiết mà thiếu tổng quan.",
        "Sao chép nguyên bài mẫu hoặc ép một khung thuộc lòng vào mọi tình huống.",
        "Dùng từ/cấu trúc phức tạp nhưng sai nghĩa; bài mẫu minh họa không phải cam kết band hay đáp án duy nhất.",
      ],
    } satisfies WritingStudyGuide];
  });
}
