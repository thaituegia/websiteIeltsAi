import { validateContentStructure } from "../../shared/content-visuals";
import type { QuestionBlock, StoredContent, StoredQuestion } from "../../shared/types";

/** Original fictional Gate sources. None of the earlier private papers are edited. */
const version = "duo-gate-20261110-v4";
const createdAt = "2026-11-10T00:00:00.000Z";
type Row = Omit<StoredQuestion, "id" | "number" | "sectionIndex">;
const idFor = (skill: "reading" | "grammar", sitting: number) => `duo-private-${skill}-lesson-30-extra-20261110-${sitting}`;

function make(skill: "reading" | "grammar", sitting: number, title: string, topic: string,
  text: string, rows: Row[], questionBlocks?: QuestionBlock[]): StoredContent {
  const id = idFor(skill, sitting);
  const result: StoredContent = {
    id, skill, title, topic, band: 3, cefr: "A2", testType: "both", format: "lesson",
    description: "Đề mới có nhiều dạng câu hỏi trong đợt bổ sung mười bộ Duo Gate mốc 3.0.",
    durationMinutes: skill === "reading" ? 18 : 15,
    sections: [{ id: `${id}-section-1`, title, text, ...(questionBlocks ? { questionBlocks } : {}),
      instructions: skill === "reading" ? "Read the labelled paragraphs and follow the instructions for each question group."
        : "Complete each separate sentence. Choose an option or write the requested word, as instructed." }],
    questions: rows.map((row, index) => ({ ...row, id: `${id}-q-${index + 1}`, number: index + 1, sectionIndex: 0 })),
    vocabularyIds: [], tags: ["duo-exclusive", "gate-assessment", "gate-supplement-20261110-v4", "varied-question-types"],
    source: "authored", quality: "authored-unreviewed", createdAt,
    estimatedDifficulty: { band: 3, cefr: "A2", basis: "Học liệu tự biên soạn ở mức A2 mục tiêu; chưa hiệu chuẩn bằng kết quả thi thật." },
    provenance: { method: "authored", version, generatedAt: createdAt },
    review: { status: "structural-checks-passed", checks: ["original-private-source", "varied-input-widgets", "numbered-blocks", "source-evidence", "bounded-answer-length"],
      limitations: ["Chưa có thẩm định độc lập hoặc hiệu chuẩn band IELTS."] },
  };
  validateContentStructure(result);
  return result;
}
function mc(prompt: string, answer: string, other: string[], evidence: string, explanation: string, rotation = 0): Row {
  const all = [answer, ...other];
  return { type: "choice", questionType: "multiple-choice", prompt, answer,
    options: [...all.slice(rotation), ...all.slice(0, rotation)], evidence, explanation, subskill: "understanding-stated-information" };
}
const tf = (prompt: string, answer: "TRUE" | "FALSE" | "NOT GIVEN", evidence: string, explanation: string): Row => ({
  type: "true-false", questionType: "true-false-not-given", prompt, answer, evidence, explanation, subskill: "checking-stated-information",
});
const match = (questionType: "matching-information" | "matching-headings" | "matching-features", prompt: string,
  answer: string, options: string[], evidence: string, explanation: string, groupInstructions: string): Row => ({
  type: "matching", questionType, prompt, answer, options, evidence, explanation, groupInstructions,
  subskill: questionType === "matching-headings" ? "identifying-main-ideas" : "matching-specific-information",
});
const short = (prompt: string, answer: string, evidence: string, explanation: string, wordLimit = 3, acceptedAnswers?: string[]): Row => ({
  type: "text", questionType: "short-answer", prompt, answer, evidence, explanation, wordLimit,
  ...(acceptedAnswers ? { acceptedAnswers } : {}), subskill: "locating-details",
});
const completion = (questionType: "sentence-completion" | "table-completion" | "summary-completion", prompt: string,
  answer: string, evidence: string, explanation: string, blockId: string, wordLimit = 2): Row => ({
  type: "text", questionType, prompt, answer, evidence, explanation, blockId, wordLimit, subskill: "completing-source-based-information",
});
const paragraphs = ["Paragraph A", "Paragraph B", "Paragraph C", "Paragraph D"];

function reading17(): StoredContent {
  const text = `A. The organisers of the Fernleigh street festival wanted to reduce the number of cups thrown away after the event. Last year, bins filled quickly, and volunteers spent hours picking cups up from the grass. This year, drink stalls will lend strong reusable cups. The aim is to reduce rubbish, rather than sell a special festival souvenir. Visitors may still bring a suitable cup from home if they prefer.

B. A visitor pays a small deposit when borrowing a festival cup. The drink itself is paid for separately. After finishing, the visitor may return the cup to any drink stall, not just the one where it was borrowed. The deposit is then returned. Nobody needs to keep a paper receipt, because the festival cups have a clear mark on the bottom. Ordinary cups from home cannot be exchanged for a deposit.

C. Used cups go into red boxes behind the stalls. A small van takes them to the school kitchen, where trained staff wash them. Volunteers at the festival do not wash cups in buckets of cold water. Clean cups return in covered containers. The organisers have chosen this arrangement because the school has suitable washing equipment and is close enough for several collections during the day.

D. Two volunteers will explain the system at the main entrance. The signs use pictures as well as words, so visitors can understand the process quickly. At the end of the festival, staff will count how many cups came back and how many were damaged. They will compare the amount of rubbish with last year's record before deciding whether to use the system again. There is no plan to make borrowing a festival cup compulsory. Good information, the organisers say, is more useful than arguing with visitors.`;
  return make("reading", 17, "Reading kiểm tra mốc 3.0 · Cốc dùng lại ở lễ hội", "Festivals and reducing waste", text, [
    match("matching-information", "Which paragraph explains where the cups are washed?", "Paragraph C", paragraphs,
      "A small van takes them to the school kitchen, where trained staff wash them.", "Đoạn C mô tả nơi và cách rửa cốc sau khi thu gom.", "Choose the paragraph A–D containing each detail. A paragraph may be used more than once."),
    match("matching-information", "Which paragraph describes how the system will be evaluated?", "Paragraph D", paragraphs,
      "They will compare the amount of rubbish with last year's record before deciding whether to use the system again.", "Đoạn D nêu việc đếm cốc và so sánh lượng rác trước khi quyết định tiếp tục.", "Choose the paragraph A–D containing each detail. A paragraph may be used more than once."),
    mc("What is the main purpose of lending festival cups?", "To reduce rubbish", ["To sell souvenirs", "To increase drink prices", "To stop visitors bringing cups"],
      "The aim is to reduce rubbish, rather than sell a special festival souvenir.", "Mục tiêu được nói trực tiếp là giảm rác thải.", 1),
    tf("A borrowed cup must be returned to the same stall that lent it.", "FALSE", "After finishing, the visitor may return the cup to any drink stall, not just the one where it was borrowed.", "Có thể trả tại bất kỳ quầy đồ uống nào, không bắt buộc đúng quầy ban đầu."),
    tf("Visitors are allowed to bring their own suitable cups.", "TRUE", "Visitors may still bring a suitable cup from home if they prefer.", "Bài cho phép khách mang cốc phù hợp từ nhà."),
    tf("The festival has ordered exactly two thousand reusable cups.", "NOT GIVEN", "This year, drink stalls will lend strong reusable cups.", "Bài nêu việc cho mượn cốc nhưng không cho tổng số cốc được đặt."),
    short("What colour are the boxes for used cups? Write ONE WORD from the passage.", "red", "Used cups go into red boxes behind the stalls.", "Màu thùng chứa cốc đã dùng là red.", 1),
    mc("Why did the organisers choose the school kitchen?", "It has suitable equipment and is nearby", ["It can sell drinks to visitors", "It has the largest festival entrance", "It has no other staff during the day"],
      "The organisers have chosen this arrangement because the school has suitable washing equipment and is close enough for several collections during the day.", "Nhà bếp có thiết bị phù hợp và đủ gần để thu gom nhiều lần.", 3),
  ]);
}

function reading18(): StoredContent {
  const id = idFor("reading", 18), blockId = `${id}-sentences`;
  const text = `A. The wooden footbridge beside Bellmere Lake has been closed for repairs. Workers found damage under its middle section during a routine check. People can still walk around the lake, but they must use a different route between the café and the playground. The council has put up a large map at both ends of the closed bridge. Nobody should move the barriers or try to cross them.

B. The temporary route follows a wide path past the boat store. It is longer than the usual route but has no steps. Council staff tested it with a wheelchair user and a parent pushing a buggy. A small hole near the store was filled before the route opened. Yellow arrows now show the direction at each turning. The arrows point to the lakeside path, rather than through the busy boat yard.

C. There are two benches on the temporary route. One is near the café and the other is beside a large willow tree. Walkers may rest there without blocking the path. The café toilets remain open during their normal hours. A notice near the playground explains that the repair workers cannot answer questions while using noisy tools. People who need more information should speak to the worker at the park office.

D. The repair is expected to take three weeks, but very wet weather could delay the work. Staff will update the notices every Friday. They will not announce an opening date until the new wood and handrail have been checked. Several residents have asked whether the temporary route can remain marked afterwards. The council will consider this because some people prefer a route without steps, even when it involves a longer walk.`;
  const headings = ["Why the bridge has closed", "Preparing an accessible alternative", "Facilities and help along the route", "Plans for a new café", "Changes to boat prices"];
  return make("reading", 18, "Reading kiểm tra mốc 3.0 · Tuyến đi tạm quanh hồ", "Walking routes and accessibility", text, [
    match("matching-headings", "Choose the best heading for paragraph A.", headings[0]!, headings, "Workers found damage under its middle section during a routine check.", "Ý chính đoạn A là nguyên nhân đóng cầu và việc chuyển sang tuyến khác.", "Choose one heading for each paragraph. Not all headings are needed."),
    match("matching-headings", "Choose the best heading for paragraph B.", headings[1]!, headings, "Council staff tested it with a wheelchair user and a parent pushing a buggy.", "Đoạn B tập trung chuẩn bị và kiểm tra tuyến thay thế không có bậc thang.", "Choose one heading for each paragraph. Not all headings are needed."),
    match("matching-headings", "Choose the best heading for paragraph C.", headings[2]!, headings, "There are two benches on the temporary route.", "Đoạn C giới thiệu ghế nghỉ, nhà vệ sinh và nơi hỏi thông tin.", "Choose one heading for each paragraph. Not all headings are needed."),
    completion("sentence-completion", "Complete sentence 4. Write NO MORE THAN TWO WORDS from the passage.", "Yellow arrows", "Yellow arrows now show the direction at each turning.", "Yellow arrows là dấu chỉ hướng tại các chỗ rẽ.", blockId),
    completion("sentence-completion", "Complete sentence 5. Write ONE WORD from the passage.", "Friday", "Staff will update the notices every Friday.", "Thông báo được cập nhật mỗi Friday.", blockId, 1),
    mc("Who should visitors ask for more information?", "The worker at the park office", ["Workers using noisy tools", "A member of the boat crew", "The person checking the café toilets"], "People who need more information should speak to the worker at the park office.", "Bài chỉ rõ người phụ trách tại văn phòng công viên là nơi hỏi thông tin.", 2),
    mc("Why might the council keep the alternative route marked?", "Some walkers prefer a route without steps", ["The café is moving to the boat yard", "The old bridge will never reopen", "The park office needs a shorter path"], "The council will consider this because some people prefer a route without steps, even when it involves a longer walk.", "Một số người thích tuyến không có bậc dù đi xa hơn.", 1),
    tf("The bridge will reopen after three weeks whatever the weather is like.", "FALSE", "The repair is expected to take three weeks, but very wet weather could delay the work.", "Ba tuần là dự kiến; mưa nhiều có thể làm chậm công việc."),
  ], [{ id: blockId, type: "sentence", title: "The temporary walking route", instructions: "Write NO MORE THAN TWO WORDS from the passage for each answer.",
    questionNumbers: [4, 5], text: "{{4}} show walkers where to turn.\nThe notices are updated every {{5}}." }]);
}

function reading19(): StoredContent {
  const id = idFor("reading", 19), blockId = `${id}-table`;
  const text = `A. Three volunteers have started a costume service for the town's small theatre groups. Buying new clothes for every play was expensive, and many useful costumes stayed in private cupboards after a performance. The volunteers now keep a shared collection in a room above the old bookshop. Groups can borrow items for a short production instead of making everything again. Ordinary clothing donations are checked before joining the collection.

B. Lila welcomes visitors and helps them find a suitable size. She asks when the costumes will be needed and writes the return date on a borrowing form. Oscar checks each item for loose buttons or small tears. He makes simple repairs but does not change a costume's size without permission. Mei photographs the collection and updates the online list. Her pictures show the costume from the front and back, rather than showing actors wearing it.

C. Each item has a cloth label with its own number. Borrowers use this number on all forms, because two coats may look almost identical. The service opens on Thursday evenings. A group must arrange a visit by telephone before coming, as the room is too small for several groups at once. There is no borrowing charge, but a group pays for any specialist cleaning that its performance makes necessary.

D. Returned clothes are left on a separate rail until Oscar has checked them. Wet items must be dried before they are packed away. The volunteers have refused a donation of very large furniture because their room is intended for clothing and small accessories. Next month they will try lending small sewing kits as well. They want groups to fix a loose button safely during a performance, while leaving larger repairs to Oscar.`;
  const people = ["Lila", "Oscar", "Mei"];
  return make("reading", 19, "Reading kiểm tra mốc 3.0 · Kho trang phục dùng chung", "Theatre and shared resources", text, [
    match("matching-features", "Who records when borrowed costumes should be returned?", "Lila", people, "Lila welcomes visitors and helps them find a suitable size. She asks when the costumes will be needed and writes the return date on a borrowing form.", "She trong đoạn B là Lila, người tiếp đón và ghi ngày trả.", "Match each responsibility to Lila, Oscar or Mei. A person may be used more than once."),
    match("matching-features", "Who repairs small tears in the costumes?", "Oscar", people, "Oscar checks each item for loose buttons or small tears. He makes simple repairs but does not change a costume's size without permission.", "Oscar kiểm tra và sửa những hư hỏng nhỏ.", "Match each responsibility to Lila, Oscar or Mei. A person may be used more than once."),
    match("matching-features", "Who keeps the online photographs up to date?", "Mei", people, "Mei photographs the collection and updates the online list.", "Mei phụ trách ảnh và danh sách trực tuyến.", "Match each responsibility to Lila, Oscar or Mei. A person may be used more than once."),
    completion("table-completion", "Complete table row 4. Write NO MORE THAN TWO WORDS from the passage.", "cloth label", "Each item has a cloth label with its own number.", "Số riêng của mỗi đồ nằm trên cloth label.", blockId),
    completion("table-completion", "Complete table row 5. Write ONE WORD from the passage.", "telephone", "A group must arrange a visit by telephone before coming, as the room is too small for several groups at once.", "Đặt lịch tham quan bằng telephone, không phải chỉ đến trực tiếp.", blockId, 1),
    mc("Why does each costume have its own number?", "Similar items may be hard to tell apart", ["Borrowers must buy all numbered items", "The numbers show the price of each costume", "Every actor must wear the same size"], "Borrowers use this number on all forms, because two coats may look almost identical.", "Mã số giúp phân biệt các món trông gần giống nhau.", 3),
    tf("Every theatre group pays a fee simply to borrow clothing.", "FALSE", "There is no borrowing charge, but a group pays for any specialist cleaning that its performance makes necessary.", "Mượn đồ không mất phí; vệ sinh chuyên biệt khi cần là khoản khác."),
    mc("What will the volunteers try lending next month?", "Small sewing kits", ["Large pieces of furniture", "New digital cameras", "Bigger storage cupboards"], "Next month they will try lending small sewing kits as well.", "Đợt thử tiếp theo là cho mượn bộ may nhỏ để sửa việc đơn giản.", 1),
  ], [{ id: blockId, type: "table", title: "Using the costume service", instructions: "Write NO MORE THAN TWO WORDS from the passage for each answer.",
    questionNumbers: [4, 5], rows: [{ cells: ["Detail", "Information"] }, { cells: ["Where the item number appears", "{{4}}"] }, { cells: ["Method of arranging a visit", "{{5}}"] }] }]);
}

function reading20(): StoredContent {
  const id = idFor("reading", 20), blockId = `${id}-summary`;
  const text = `A. The nature club at Dunley is inviting residents to help count birds in the public gardens. People often notice birds while walking, but their reports are difficult to compare when everyone watches for a different amount of time. The club wants a simple record made in the same way at several locations. Beginners are welcome, and nobody needs to identify every bird before taking part.

B. Each pair watches one marked area for twenty minutes. They write down the largest number of each kind seen together, rather than adding every arrival to a running total. A bird that leaves and returns could otherwise be counted twice. Volunteers receive a picture sheet showing the six common kinds expected in the gardens. Uncertain identifications are written in a separate notes box, not guessed on the main list.

C. There are three watching points. The pond path is good for seeing birds near water, but walkers must keep the path clear. The orchard seat has a wide view of low trees. The shelter beside the wall is useful on windy days. Each pair is given one location in advance, so the records do not all come from the most popular spot. The club supplies pencils and clipboards, but volunteers should bring warm clothing.

D. Sessions will be held on two Sunday mornings in February. Children must attend with an adult. If heavy rain is expected, the organiser will telephone volunteers the previous evening. The club will compare the two mornings but will not use a small difference to claim that the whole bird population has changed. Garden activity and the weather can affect what people see. A short report will explain these limits as well as showing the numbers.`;
  return make("reading", 20, "Reading kiểm tra mốc 3.0 · Ghi nhận chim trong vườn", "Citizen observation and nature", text, [
    match("matching-information", "Which paragraph explains how to avoid counting the same bird twice?", "Paragraph B", paragraphs, "A bird that leaves and returns could otherwise be counted twice.", "Đoạn B giải thích quy tắc ghi số lớn nhất nhìn thấy cùng lúc.", "Choose the paragraph A–D containing each detail. A paragraph may be used more than once."),
    match("matching-information", "Which paragraph describes the different observation locations?", "Paragraph C", paragraphs, "There are three watching points.", "Đoạn C nêu đặc điểm của ba vị trí quan sát.", "Choose the paragraph A–D containing each detail. A paragraph may be used more than once."),
    match("matching-information", "Which paragraph explains what will happen if heavy rain is expected?", "Paragraph D", paragraphs, "If heavy rain is expected, the organiser will telephone volunteers the previous evening.", "Đoạn D nói người tổ chức sẽ gọi điện vào tối hôm trước khi dự báo mưa lớn.", "Choose the paragraph A–D containing each detail. A paragraph may be used more than once."),
    completion("summary-completion", "Complete summary blank 4. Write NO MORE THAN TWO WORDS from the passage.", "twenty minutes", "Each pair watches one marked area for twenty minutes.", "Thời gian quan sát của mỗi cặp là twenty minutes.", blockId),
    completion("summary-completion", "Complete summary blank 5. Write NO MORE THAN TWO WORDS from the passage.", "picture sheet", "Volunteers receive a picture sheet showing the six common kinds expected in the gardens.", "Picture sheet giúp nhận diện các loài chim thường gặp.", blockId),
    short("What should volunteers bring to wear? Write NO MORE THAN TWO WORDS from the passage.", "warm clothing", "The club supplies pencils and clipboards, but volunteers should bring warm clothing.", "Câu lạc bộ có bút và bảng kẹp; người tham gia mang warm clothing.", 2),
    short("In which month will the sessions take place? Write ONE WORD from the passage.", "February", "Sessions will be held on two Sunday mornings in February.", "Hai buổi diễn ra vào February.", 1),
    mc("Why will the report discuss the weather and garden activity?", "These may affect the birds people observe", ["They determine the price of joining the club", "They show which volunteer is the best observer", "They make picture sheets unnecessary"], "Garden activity and the weather can affect what people see.", "Cần giải thích những yếu tố ảnh hưởng quan sát, không suy ngay ra thay đổi quần thể.", 2),
  ], [{ id: blockId, type: "summary", title: "How the count works", instructions: "Write NO MORE THAN TWO WORDS from the passage for each answer.",
    questionNumbers: [4, 5], text: "A pair observes its area for {{4}}. A {{5}} helps volunteers recognise common birds." }]);
}

function reading21(): StoredContent {
  const text = `A. The short passenger boat between Portwell and West Island carries visitors as well as local residents. During the summer, large bags often blocked the narrow space beside the seats. The crew has introduced clearer luggage arrangements so that passengers can move safely. Travellers may still bring a small bag to their seat, provided it fits underneath. The new arrangement does not change the boat's ticket prices.

B. Before boarding, passengers with a large bag should visit the ticket desk. The worker there gives each bag a numbered tag and hands the matching part to its owner. People should keep this until the bag is returned. No booking is needed for an ordinary suitcase, but anyone bringing an unusually large item should telephone the office before the day of travel. The boat cannot carry furniture or bicycles with a trailer.

C. At the boarding gate, a crew member checks that tags are attached properly. Large bags then go into a covered storage area near the front of the boat. Passengers must not put bags there themselves because the crew needs to keep the load balanced. A coloured sticker marks any bag containing a fragile object. The sticker does not replace suitable packaging, so owners should protect breakable things before arriving.

D. On reaching the island, passengers collect their bags from the collection table beside the landing stage. The crew checks the matching number before handing a bag over. Anyone who cannot find a bag should speak to the person at the information hut rather than walking back onto the boat. The company will review the arrangement after the busy season. Staff will consider both passenger comments and the time needed to load the bags before deciding whether any changes are required.`;
  const places = ["Ticket desk", "Boarding gate", "Collection table", "Information hut"];
  return make("reading", 21, "Reading kiểm tra mốc 3.0 · Hành lý trên chuyến tàu ngắn", "Boat journeys and luggage", text, [
    match("matching-features", "Where does a passenger receive the first numbered tag?", "Ticket desk", places, "Before boarding, passengers with a large bag should visit the ticket desk. The worker there gives each bag a numbered tag and hands the matching part to its owner.", "Thẻ số được phát ở ticket desk trước lúc lên tàu.", "Match each action to the correct place. A place may be used more than once."),
    match("matching-features", "Where are attached luggage tags checked before loading?", "Boarding gate", places, "At the boarding gate, a crew member checks that tags are attached properly.", "Nhân viên kiểm tra thẻ đã gắn đúng tại boarding gate.", "Match each action to the correct place. A place may be used more than once."),
    match("matching-features", "Where should a passenger report a missing bag?", "Information hut", places, "Anyone who cannot find a bag should speak to the person at the information hut rather than walking back onto the boat.", "Đồ thất lạc cần báo tại information hut, không tự quay lại tàu.", "Match each action to the correct place. A place may be used more than once."),
    tf("Passengers may keep a small bag under their seat.", "TRUE", "Travellers may still bring a small bag to their seat, provided it fits underneath.", "Bài cho phép túi nhỏ vừa khoảng trống bên dưới ghế."),
    tf("Passengers load large bags into the storage area themselves.", "FALSE", "Passengers must not put bags there themselves because the crew needs to keep the load balanced.", "Tổ tàu thực hiện xếp hành lý để giữ cân bằng tải trọng."),
    tf("More than half the passengers travel with an ordinary suitcase.", "NOT GIVEN", "No booking is needed for an ordinary suitcase, but anyone bringing an unusually large item should telephone the office before the day of travel.", "Quy tắc đối với va-li được nêu nhưng không có tỷ lệ hành khách mang va-li."),
    mc("What is the purpose of the coloured sticker?", "To identify bags with fragile contents", ["To show a passenger's ticket price", "To reserve an extra seat", "To show that no protective packaging is needed"], "A coloured sticker marks any bag containing a fragile object.", "Nhãn màu đánh dấu đồ dễ vỡ; chủ đồ vẫn phải đóng gói thích hợp.", 3),
    mc("When will the company review the luggage arrangements?", "After the busy season", ["Before the first summer journey", "At the end of every crossing", "Only when ticket prices change"], "The company will review the arrangement after the busy season.", "Việc xem xét lại diễn ra sau mùa cao điểm.", 1),
  ]);
}

type GrammarItem = readonly [stem: string, answer: string, other: readonly [string, string, string], reason: string];
function grammar(sitting: number, title: string, context: string, items: GrammarItem[], textNumbers: number[] = []): StoredContent {
  return make("grammar", sitting, title, "Grammar in everyday situations", context, items.map(([stem, answer, other, reason], index) =>
    textNumbers.includes(index + 1)
      ? short(`Complete the sentence. Write ONE WORD: ${stem}`, answer, stem.replace("___", answer), reason, 1)
      : mc(stem, answer, [...other], stem.replace("___", answer), reason, (index + sitting) % 4)).map(row => ({ ...row, subskill: "grammar-in-context" })));
}

function grammar17(): StoredContent {
  return grammar(17, "Grammar in context · Checking a weather station", "A school caretaker is checking a small weather station. These separate sentences describe regular checks, yesterday's work and the equipment being used now. Choose the grammatically correct option.", [
    ["The caretaker ___ the temperature every morning.", "records", ["record", "recording", "to record"], "The caretaker là chủ ngữ số ít và every morning chỉ thói quen, nên dùng records."],
    ["We ___ the damaged cover yesterday.", "replaced", ["replace", "replacing", "replaces"], "Yesterday cần quá khứ đơn replaced."],
    ["There ___ a small battery inside the box.", "is", ["are", "be", "were"], "A small battery là số ít nên dùng There is."],
    ["The pupils are ___ the rain gauge now.", "checking", ["check", "checked", "checks"], "Are và now cần hiện tại tiếp diễn checking."],
    ["Please keep the instruction sheet ___ a dry place.", "in", ["on", "during", "to"], "Cụm in a dry place diễn tả nơi bảo quản khô ráo."],
    ["This sensor is smaller ___ the old one.", "than", ["as", "then", "from"], "So sánh hơn smaller đi với than."],
    ["You must ___ the lid carefully.", "close", ["closes", "closed", "closing"], "Sau must dùng động từ nguyên mẫu close."],
    ["We have not got ___ spare batteries left.", "any", ["much", "a", "an"], "Batteries số nhiều trong câu phủ định đi với any."],
    ["The notebook belongs to me. It is ___.", "mine", ["my", "me", "I"], "Cuối câu không có danh từ sau nên dùng đại từ sở hữu mine."],
    ["The next check is ___ Monday afternoon.", "on", ["at", "in", "to"], "Dùng on với buổi của một ngày cụ thể."],
  ]);
}

function grammar18(): StoredContent {
  return grammar(18, "Grammar in context · A picnic by the canal", "A family is planning a picnic by the canal. Choose an option for questions 1–6. For questions 7–10, write one word to complete the sentence; the word in brackets gives the required verb.", [
    ["How ___ apples shall we take?", "many", ["much", "little", "any"], "Apples đếm được số nhiều nên dùng How many."],
    ["There is ___ cheese in the cool bag.", "some", ["many", "a", "an"], "Cheese không đếm được, dùng some cheese."],
    ["The picnic blanket is ___ than the small towel.", "larger", ["large", "largest", "largely"], "Có than nên cần tính từ so sánh hơn larger."],
    ["Mum ___ the sandwiches last night.", "made", ["makes", "making", "make"], "Last night cần quá khứ đơn; make có quá khứ made."],
    ["Please put the empty bottles ___ the bag.", "in", ["during", "between", "from"], "Put something in the bag nghĩa là đặt vật vào túi."],
    ["We should ___ before it gets dark.", "leave", ["leaves", "left", "leaving"], "Sau should dùng động từ nguyên mẫu leave."],
    ["Ben usually ___ the fruit before eating it. (wash)", "washes", ["wash", "washing", "washed"], "Ben là ngôi ba số ít; wash thêm -es thành washes."],
    ["We ___ our cousins at the picnic yesterday. (meet)", "met", ["meet", "meeting", "meets"], "Quá khứ đơn của meet là met."],
    ["The children are ___ the path at the moment. (follow)", "following", ["follow", "followed", "follows"], "Are và at the moment cần following."],
    ["Dad ___ the basket beside the tree an hour ago. (put)", "put", ["puts", "putting", "to put"], "Quá khứ của put vẫn là put; an hour ago chỉ thời gian đã qua."],
  ], [7, 8, 9, 10]);
}

function grammar19(): StoredContent {
  return grammar(19, "Grammar in context · A local flower shop", "A new assistant is learning how a flower shop works. Each sentence has its own time reference. Choose the one grammatically correct option.", [
    ["The florist ___ fresh flowers each morning.", "arranges", ["arrange", "arranging", "to arrange"], "The florist số ít nên dùng hiện tại đơn arranges."],
    ["We ___ three large orders last Friday.", "finished", ["finish", "finishes", "finishing"], "Last Friday cần quá khứ đơn finished."],
    ["Please give these roses to Eva. They are for ___.", "her", ["she", "hers", "herself's"], "Sau giới từ for cần đại từ tân ngữ her."],
    ["There are four empty ___ beside the sink.", "vases", ["vase", "vase's", "vases'"], "Sau four cần danh từ số nhiều vases, không phải dạng sở hữu."],
    ["The delivery van arrives ___ half past ten.", "at", ["in", "on", "to"], "Dùng at với giờ cụ thể."],
    ["Can you ___ this address clearly?", "write", ["writes", "wrote", "writing"], "Sau can dùng động từ nguyên mẫu write."],
    ["These flowers are more expensive ___ those ones.", "than", ["as", "then", "from"], "So sánh hơn more expensive đi với than."],
    ["We do not need ___ extra paper today.", "any", ["many", "a", "an"], "Paper không đếm được; trong câu phủ định dùng any."],
    ["The assistant is ___ the leaves now.", "removing", ["remove", "removed", "removes"], "Is và now cần hiện tại tiếp diễn removing."],
    ["___ are the blue ribbons? In the top drawer.", "Where", ["Who", "Whose", "What"], "Câu trả lời là địa điểm nên hỏi Where."],
  ]);
}

function grammar20(): StoredContent {
  return grammar(20, "Grammar in context · Preparing a cycling trip", "Two friends are getting ready for a short cycling trip. Choose an option for questions 1–5. For questions 6–10, write one word using the verb in brackets.", [
    ["We need ___ water for the journey.", "some", ["many", "a", "an"], "Water không đếm được, dùng some water."],
    ["This road is quieter ___ the main road.", "than", ["as", "then", "from"], "Quieter là so sánh hơn nên dùng than."],
    ["You must ___ a helmet on this ride.", "wear", ["wears", "wore", "wearing"], "Sau must dùng động từ nguyên mẫu wear."],
    ["The maps belong to us. They are ___.", "ours", ["our", "us", "we"], "Cuối câu cần đại từ sở hữu ours."],
    ["The trip begins ___ Saturday morning.", "on", ["at", "in", "to"], "Dùng on với buổi của ngày cụ thể."],
    ["Sam ___ his bicycle to school every day. (ride)", "rides", ["ride", "riding", "rode"], "Sam là chủ ngữ số ít và every day chỉ thói quen: rides."],
    ["We ___ the route on a paper map yesterday. (choose)", "chose", ["choose", "choosing", "chooses"], "Quá khứ đơn của choose là chose."],
    ["Mila is ___ the tyres now. (check)", "checking", ["check", "checked", "checks"], "Is và now tạo hiện tại tiếp diễn checking."],
    ["Our friend ___ us a small repair kit last night. (give)", "gave", ["give", "giving", "gives"], "Quá khứ của give là gave."],
    ["It often ___ in this valley in winter. (rain)", "rains", ["rain", "raining", "rained"], "It là ngôi ba số ít, often chỉ thói quen nên dùng rains."],
  ], [6, 7, 8, 9, 10]);
}

function grammar21(): StoredContent {
  return grammar(21, "Grammar in context · Repairing a garden gate", "A neighbour is fixing a wooden garden gate. Choose an option for questions 1–8. Complete the last two sentences with one word, using the verb in brackets.", [
    ["The old gate ___ a new handle.", "needs", ["need", "needing", "to need"], "The old gate số ít nên hiện tại đơn là needs."],
    ["There ___ two loose screws near the bottom.", "are", ["is", "be", "was"], "Two loose screws số nhiều nên dùng are."],
    ["Please put the tools ___ the box when you finish.", "in", ["during", "between", "from"], "Put the tools in the box nghĩa là cất dụng cụ vào hộp."],
    ["This screw is longer ___ that one.", "than", ["as", "then", "from"], "Longer là so sánh hơn nên dùng than."],
    ["You should ___ gloves when handling rough wood.", "wear", ["wears", "wore", "wearing"], "Sau should dùng động từ nguyên mẫu wear."],
    ["The hammer belongs to Jo. Please give it to ___.", "her", ["she", "hers", "herself's"], "Sau to cần đại từ tân ngữ her."],
    ["We have not got ___ spare handles left.", "any", ["much", "a", "an"], "Handles số nhiều trong câu phủ định đi với any."],
    ["The repair shop closes ___ five o'clock.", "at", ["on", "in", "to"], "Dùng at với giờ cụ thể."],
    ["Theo ___ the broken handle yesterday. (remove)", "removed", ["remove", "removes", "removing"], "Yesterday chỉ quá khứ, dùng removed."],
    ["He is ___ the new handle now. (attach)", "attaching", ["attach", "attached", "attaches"], "Is và now cần attaching để tạo hiện tại tiếp diễn."],
  ], [9, 10]);
}

/** Reading and Grammar only; the V4 aggregator adds the matching Listening IDs. */
export function tenBatchReadingGrammarB(): StoredContent[] {
  return [reading17(), grammar17(), reading18(), grammar18(), reading19(), grammar19(), reading20(), grammar20(), reading21(), grammar21()];
}
