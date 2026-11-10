import { validateContentStructure } from "../../shared/content-visuals";
import type { QuestionBlock, StoredContent, StoredQuestion } from "../../shared/types";

/** Original fictional sources for the first half of the fourth private batch. */
const version = "duo-gate-20261110-v4";
type Row = Omit<StoredQuestion, "id" | "number" | "sectionIndex">;
const idFor = (skill: "reading" | "grammar", n: number) => `duo-private-${skill}-lesson-30-extra-20261110-${n}`;
function make(skill: "reading" | "grammar", n: number, title: string, topic: string, text: string,
  rows: Row[], blocks: QuestionBlock[] = []): StoredContent {
  const id = idFor(skill, n);
  const result: StoredContent = {
    id, skill, title, topic, band: 3, cefr: "A2", testType: "both", format: "lesson", durationMinutes: skill === "reading" ? 18 : 15,
    description: "Đề riêng mới mốc 3.0 với nhiều dạng câu hỏi thực sự khác nhau.",
    sections: [{ id: `${id}-section-1`, title, text,
      instructions: skill === "reading" ? "Read the passage and follow the instructions for each question group."
        : "Complete each separate grammar task. Follow the instruction for each question group.",
      ...(blocks.length ? { questionBlocks: blocks } : {}) }],
    questions: rows.map((row, index) => ({ ...row, id: `${id}-q-${index + 1}`, number: index + 1, sectionIndex: 0 })),
    tags: ["duo-exclusive", "gate-assessment", "gate-supplement-20261110-v4", "varied-question-types"], vocabularyIds: [],
    source: "authored", quality: "authored-unreviewed", createdAt: "2026-11-10T00:00:00.000Z",
    estimatedDifficulty: { band: 3, cefr: "A2", basis: "Độ khó A2 mục tiêu của học liệu tự biên soạn; chưa hiệu chuẩn bằng kết quả thi thật." },
    provenance: { method: "authored", version, generatedAt: "2026-11-10T00:00:00.000Z" },
    review: { status: "structural-checks-passed", checks: ["private-original-source", "real-mixed-task-controls", "numbered-blanks", "supported-keys"],
      limitations: ["Chưa được giám khảo độc lập thẩm định hoặc hiệu chuẩn band IELTS."] },
  };
  validateContentStructure(result);
  return result;
}
function mc(prompt: string, answer: string, others: string[], evidence: string, explanation: string, rotation = 0): Row {
  const options = [answer, ...others];
  return { type: "choice", questionType: "multiple-choice", prompt, answer,
    options: [...options.slice(rotation), ...options.slice(0, rotation)], evidence, explanation, subskill: "understanding-stated-information" };
}
const tf = (prompt: string, answer: "TRUE" | "FALSE" | "NOT GIVEN", evidence: string, explanation: string): Row => ({
  type: "true-false", questionType: "true-false-not-given", prompt, answer, evidence, explanation, subskill: "distinguishing-stated-and-unstated-information",
});
const match = (questionType: "matching-features" | "matching-information" | "matching-headings", prompt: string,
  answer: string, options: string[], evidence: string, explanation: string): Row => ({
  type: "matching", questionType, prompt, answer, options, evidence, explanation, subskill: "matching-information-and-main-ideas",
});
const short = (prompt: string, answer: string, evidence: string, limit: number, explanation: string, acceptedAnswers?: string[]): Row => ({
  type: "text", questionType: "short-answer", prompt, answer, evidence, wordLimit: limit, explanation,
  ...(acceptedAnswers ? { acceptedAnswers } : {}), subskill: "locating-specific-details",
});
const complete = (questionType: "table-completion" | "sentence-completion" | "flow-chart-completion", blockId: string,
  prompt: string, answer: string, evidence: string, limit: number, explanation: string, acceptedAnswers?: string[]): Row => ({
  type: "text", questionType, blockId, prompt, answer, evidence, wordLimit: limit, explanation,
  ...(acceptedAnswers ? { acceptedAnswers } : {}), subskill: "completing-information-in-context",
});

function reading12(): StoredContent {
  const text = `Trying an instrument before buying one

Paragraph A
At Westridge Community Hall, the cost of buying an instrument stopped some residents from beginning music lessons. The hall already had a few instruments from a closed music school. It decided to lend them to local people for a short period. The aim was to let people try a suitable instrument before spending money on one of their own. Borrowers do not have to promise that they will buy anything later.

Paragraph B
Different instruments have different arrangements. A violin can be borrowed by someone who can already play a simple tune. A music teacher listens to this tune before the loan begins. The flutes are intended for complete beginners, who must attend a short first lesson at the hall. A hand drum can be borrowed by a family that wants to make music together. No playing test is needed for the drum.

Paragraph C
Each borrower signs a paper agreement. It explains how to carry and clean the instrument and what to do if something is damaged. The agreement is a useful set of instructions, not a demand for payment in advance. Instruments travel in protective cases. When an instrument is not on loan, its case stays in the equipment room behind the stage, rather than in the public entrance.

Paragraph D
All loans finish on Thursday, when a volunteer is available to check the returned instruments. Borrowers hand in a condition card with the instrument. They record any loose part or other problem on this card. The hall wants to learn which instruments are useful to beginners, so it also asks one short question about the experience. It will review the loan period after three months.`;
  const instruments = ["violin", "flute", "hand drum", "piano"];
  return make("reading", 12, "Reading kiểm tra mốc 3.0 · Thử một nhạc cụ", "Music and borrowing", text, [
    match("matching-features", "Match the arrangement to an instrument: the borrower plays a simple tune before the loan.", "violin", instruments, "A violin can be borrowed by someone who can already play a simple tune. A music teacher listens to this tune before the loan begins.", "Điều kiện chơi thử một giai điệu được nêu riêng cho violin."),
    match("matching-features", "Match the arrangement to an instrument: a complete beginner attends a first lesson.", "flute", instruments, "The flutes are intended for complete beginners, who must attend a short first lesson at the hall.", "Người mới hoàn toàn phải dự buổi học đầu khi mượn flute."),
    match("matching-features", "Match the arrangement to an instrument: a family can use it to make music together without a playing test.", "hand drum", instruments, "A hand drum can be borrowed by a family that wants to make music together. No playing test is needed for the drum.", "Hand drum dành cho gia đình và không yêu cầu bài kiểm tra chơi nhạc."),
    mc("What is the main aim of the loan scheme?", "To help people try an instrument before buying one", ["To sell every instrument in the hall", "To choose musicians for a competition", "To replace the local music school"], "The aim was to let people try a suitable instrument before spending money on one of their own.", "Mục đích chính là cho thử nhạc cụ trước khi chi tiền mua.", 2),
    mc("What is the purpose of the paper agreement?", "To explain care and what to do about damage", ["To collect a payment before every loan", "To promise that a borrower will buy an instrument", "To book a public performance"], "It explains how to carry and clean the instrument and what to do if something is damaged.", "Giấy thỏa thuận hướng dẫn bảo quản và báo hỏng, không phải yêu cầu thanh toán trước.", 1),
    short("Where are cases kept when the instruments are not on loan? Write NO MORE THAN TWO WORDS from the passage.", "equipment room", "When an instrument is not on loan, its case stays in the equipment room behind the stage, rather than in the public entrance.", 2, "Nơi cất hộp là equipment room."),
    short("On which day do all loans finish? Write ONE WORD from the passage.", "Thursday", "All loans finish on Thursday, when a volunteer is available to check the returned instruments.", 1, "Tất cả lượt mượn kết thúc vào Thursday."),
    short("What card do borrowers return with the instrument? Write NO MORE THAN TWO WORDS from the passage.", "condition card", "Borrowers hand in a condition card with the instrument.", 2, "Thẻ cần nộp kèm nhạc cụ là condition card."),
  ]);
}

function reading13(): StoredContent {
  const text = `Shopping deliveries on a cargo bicycle

The weekly market at Southmere is popular with people who like buying from small food sellers. However, carrying heavy bags home was difficult for some customers without a car. The market team decided to try a cargo bicycle delivery service. Its purpose was to let these customers choose their shopping normally and have the bags taken home afterwards.

The service began in February. Deliveries are available to homes within two miles of the market. This is a small area, but the team wants to make sure that food reaches customers promptly. The rider uses checked cycle routes, rather than simply following the shortest line on a phone map. One steep lane is left out because a full bicycle would be difficult to control there.

Customers take their shopping to the market desk. A volunteer puts each order in a numbered box and writes the customer's address on a delivery sheet. Payment is made at the market desk too. An online booking form is available, but customers can book in person if they prefer. The rider does not take money at the front door, so nobody needs to search for cash when the delivery arrives.

The boxes stay with the service. After handing over the shopping, the rider brings the empty boxes back to the market for cleaning and reuse. Customers should be at home during the agreed delivery period. If nobody answers, the rider returns the bags to the desk instead of leaving food outside.

At the end of the first month, the team will compare the number of deliveries with the time each route takes. It has not decided to serve a larger area yet. Customers can give comments on paper at the desk, including suggestions about delivery periods. The team will use these comments when planning the next stage.`;
  const blockId = `${idFor("reading", 13)}-delivery-table`;
  return make("reading", 13, "Reading kiểm tra mốc 3.0 · Chở hàng từ chợ bằng xe đạp", "Shopping and local delivery", text, [
    complete("table-completion", blockId, "Complete the table: month the service began. Write ONE WORD from the passage.", "February", "The service began in February.", 1, "Dịch vụ bắt đầu vào February."),
    complete("table-completion", blockId, "Complete the table: maximum distance from the market. Write NO MORE THAN TWO WORDS from the passage.", "two miles", "Deliveries are available to homes within two miles of the market.", 2, "Phạm vi giao là two miles tính từ chợ."),
    complete("table-completion", blockId, "Complete the table: place where payment is made. Write NO MORE THAN TWO WORDS from the passage.", "market desk", "Payment is made at the market desk too.", 2, "Khách thanh toán tại market desk, không trả tiền ở cửa nhà."),
    tf("Customers can only book a delivery online.", "FALSE", "An online booking form is available, but customers can book in person if they prefer.", "Khách có thể đặt trực tiếp, nên không bắt buộc đặt qua mạng."),
    tf("The rider brings empty delivery boxes back for reuse.", "TRUE", "After handing over the shopping, the rider brings the empty boxes back to the market for cleaning and reuse.", "Sau giao hàng, thùng rỗng được mang về chợ để rửa và dùng lại."),
    tf("All the delivery volunteers are university students.", "NOT GIVEN", "A volunteer puts each order in a numbered box and writes the customer's address on a delivery sheet.", "Bài nhắc tình nguyện viên nhưng không nêu nghề nghiệp hoặc tình trạng sinh viên."),
    mc("Who was the service particularly intended to help?", "Customers who find heavy shopping hard to carry without a car", ["Sellers who want to close the market early", "Riders training for a bicycle race", "Customers who want to buy a cargo bicycle"], "However, carrying heavy bags home was difficult for some customers without a car.", "Nhóm cần hỗ trợ là khách khó mang túi nặng về khi không có ô tô.", 3),
    mc("Why is one steep lane not used?", "A fully loaded bicycle would be difficult to control there", ["The lane has no houses", "The team wants to charge people on that lane more", "The phone map does not show the lane"], "One steep lane is left out because a full bicycle would be difficult to control there.", "Lý do loại tuyến dốc là khả năng kiểm soát xe khi chở đầy hàng.", 1),
  ], [{ id: blockId, type: "table", title: "Cargo bicycle delivery service", instructions: "Complete the table using words from the passage.", questionNumbers: [1, 2, 3],
    rows: [{ cells: ["Information", "Detail"] }, { cells: ["Starting month", "{{1}}"] }, { cells: ["Maximum distance", "{{2}}"] }, { cells: ["Payment place", "{{3}}"] }] }]);
}

function reading14(): StoredContent {
  const text = `Checking how lunch containers keep food warm

Paragraph A
At Bracken School, pupils sometimes said their lunches were cold before they could eat them. A science teacher suggested comparing two kinds of lunch container. She wanted the class to test the containers under the same conditions, rather than decide which one looked nicer. The pupils agreed to use the same simple meal for every test and to wait the same amount of time before checking it.

Paragraph B
The class borrowed a digital thermometer. Before starting, the teacher showed everyone how to hold it without touching the hot food. Two pupils checked each lid to make sure it was closed properly. The containers stood on the same table, away from an open window. Results were written in a shared notebook, together with the container type and the time of the reading.

Paragraph C
On the second day, one reading was much lower than the others. At first, the pupils thought the container was damaged. They then discovered that someone had left its lid open during the waiting period. The class marked that result clearly and repeated the test. They did not quietly remove the reading from the notebook, because the mistake helped explain why the conditions mattered.

Paragraph D
After several tests, the class could describe which container kept this meal warmer during the chosen waiting period. The teacher reminded them that their results did not prove how every kind of lunch would behave. Next month, another class will repeat the work with a different meal. The pupils will compare the new record with their own before writing advice for the school newsletter. They will explain the tests as well as giving their final suggestion.`;
  const paragraphs = ["Paragraph A", "Paragraph B", "Paragraph C", "Paragraph D"];
  return make("reading", 14, "Reading kiểm tra mốc 3.0 · So sánh hộp đựng bữa trưa", "School science and fair tests", text, [
    match("matching-information", "Which paragraph explains where the readings were written?", "Paragraph B", paragraphs, "Results were written in a shared notebook, together with the container type and the time of the reading.", "Thông tin ghi số đo vào sổ chung nằm trong đoạn B."),
    match("matching-information", "Which paragraph explains a mistake that affected one result?", "Paragraph C", paragraphs, "They then discovered that someone had left its lid open during the waiting period.", "Đoạn C giải thích số đo bất thường do nắp bị để mở."),
    match("matching-information", "Which paragraph describes the next class's planned work?", "Paragraph D", paragraphs, "Next month, another class will repeat the work with a different meal.", "Kế hoạch lớp khác lặp lại thử nghiệm với món ăn khác nằm ở đoạn D."),
    short("What instrument did the class borrow? Write NO MORE THAN TWO WORDS from the passage.", "digital thermometer", "The class borrowed a digital thermometer.", 2, "Dụng cụ đo là digital thermometer."),
    short("What part of each container was checked before the test? Write ONE WORD from the passage.", "lid", "Two pupils checked each lid to make sure it was closed properly.", 1, "Hai học sinh kiểm tra lid có đóng đúng hay chưa."),
    mc("What was the teacher's main aim?", "To compare the containers under the same conditions", ["To choose the container with the best appearance", "To discover pupils' favourite lunch", "To replace every school lunch with a hot meal"], "She wanted the class to test the containers under the same conditions, rather than decide which one looked nicer.", "Mục tiêu là so sánh công bằng, không chọn theo vẻ ngoài.", 1),
    mc("Which arrangement helped make the tests fair?", "Using the same meal and waiting time", ["Putting each container beside a different window", "Letting each pupil choose a different meal", "Taking readings only when the food looked cold"], "The pupils agreed to use the same simple meal for every test and to wait the same amount of time before checking it.", "Giữ nguyên món ăn và thời gian chờ giúp so sánh hai loại hộp công bằng.", 2),
    mc("What limit did the teacher identify?", "The results do not describe every possible lunch", ["The thermometer could only measure cold food", "The notebook could not contain the first results", "Nobody could repeat the test with another meal"], "The teacher reminded them that their results did not prove how every kind of lunch would behave.", "Thử nghiệm chỉ mô tả món ăn và điều kiện đã dùng, chưa đại diện mọi bữa trưa.", 3),
  ]);
}

function reading15(): StoredContent {
  const text = `Words that cinema visitors can see

Paragraph A
Oakfield Cinema wanted to make more of its usual screenings useful to people who found speech difficult to hear. Some films already offered written words at the bottom of the large screen, but these versions were not always available at a convenient time. The cinema decided to try glasses that show the film's written dialogue to the person wearing them. Other visitors continue watching the ordinary screen.

Paragraph B
Visitors reserve the glasses when booking a supported film. They collect them at the ticket office and receive a short explanation from a member of staff. No smartphone is needed. After the film, the visitor puts the glasses in a padded box at the same office. Staff clean and charge them before the next loan. There is no additional charge for borrowing a pair.

Paragraph C
Before the first screening, staff held a quiet practice session. Visitors could adjust the position of the words and check that the frame felt comfortable. Someone who wears ordinary glasses could try the equipment with them. The practice session did not include a full film, because its purpose was to let people ask questions without missing a story. Staff wrote down problems so they could improve the explanation.

Paragraph D
Not every film works with this equipment. Before booking, visitors can read a list of supported films on the cinema's website or ask at the office. The cinema will ask users for comments after each loan during the trial. It wants to learn whether the equipment and the booking arrangements are helpful. Staff will review those comments before deciding whether to buy more pairs. The trial does not replace the screenings that already have words on the large screen.`;
  const headings = ["Why the cinema tried a new service", "Borrowing and returning the equipment", "Making the equipment comfortable", "Reviewing availability and users' comments", "Building a larger screen"];
  const blockId = `${idFor("reading", 15)}-sentences`;
  return make("reading", 15, "Reading kiểm tra mốc 3.0 · Hỗ trợ người xem phim khó nghe", "Cinema and access", text, [
    match("matching-headings", "Choose the best heading for Paragraph B.", "Borrowing and returning the equipment", headings, "Visitors reserve the glasses when booking a supported film. They collect them at the ticket office and receive a short explanation from a member of staff.", "Đoạn B tập trung vào cách đặt, nhận và trả thiết bị."),
    match("matching-headings", "Choose the best heading for Paragraph C.", "Making the equipment comfortable", headings, "Visitors could adjust the position of the words and check that the frame felt comfortable.", "Đoạn C mô tả buổi thử và điều chỉnh thiết bị cho dễ chịu."),
    tf("Visitors must have a smartphone to use the glasses.", "FALSE", "No smartphone is needed.", "Bài nói trực tiếp rằng không cần điện thoại thông minh."),
    tf("The cinema will collect comments from people who borrow the glasses.", "TRUE", "The cinema will ask users for comments after each loan during the trial.", "Rạp sẽ hỏi ý kiến người dùng sau mỗi lần mượn trong đợt thử."),
    tf("Everyone who attended the practice session was over fifty.", "NOT GIVEN", "Before the first screening, staff held a quiet practice session.", "Bài không cho tuổi hoặc khẳng định mọi người tham gia đều trên năm mươi."),
    complete("sentence-completion", blockId, "Complete sentence 6. Write NO MORE THAN TWO WORDS from the passage.", "ticket office", "They collect them at the ticket office and receive a short explanation from a member of staff.", 2, "Nơi nhận thiết bị là ticket office."),
    complete("sentence-completion", blockId, "Complete sentence 7. Write NO MORE THAN TWO WORDS from the passage.", "padded box", "After the film, the visitor puts the glasses in a padded box at the same office.", 2, "Sau phim, kính được đặt vào padded box."),
    complete("sentence-completion", blockId, "Complete sentence 8. Write ONE WORD from the passage.", "films", "Before booking, visitors can read a list of supported films on the cinema's website or ask at the office.", 1, "Danh sách cho biết những films tương thích với thiết bị."),
  ], [{ id: blockId, type: "sentence", title: "Using the cinema equipment", instructions: "Complete the sentences with words from the passage.", questionNumbers: [6, 7, 8],
    text: "Visitors collect the glasses from the {{6}}.\nAfter the film, visitors put them in a {{7}}.\nThe website has a list of supported {{8}}." }]);
}

function reading16(): StoredContent {
  const text = `A village clock returns to work

For many years, the clock above Northwick's village shop showed the wrong time. Its wooden case still looked familiar, but the hands often stopped. Residents wanted to repair it rather than replace the whole clock with a modern sign. A small team agreed to carry out the work, with help from a person experienced in repairing old clocks.

The team worked in a careful order. First, it made a record of the separate parts using photographs. This meant that nothing depended on one person's memory when the clock was put together again. Next, the metal pieces were cleaned with a soft brush. Strong cleaning liquid was not used because it might damage the old surfaces. Finally, the hands were checked against a radio clock while the clock ran indoors.

Each helper had a different job. Sam worked with the experienced repairer to check the mechanism. He did not change the wooden case. Maya kept the cost records and stored the receipts for materials. Nora arranged times when residents could visit the workroom and see the progress. Liam made a safe cover for moving the clock between the workroom and the shop.

The wooden case was kept because residents wanted the clock to retain its familiar appearance. A broken corner was repaired, but the team did not paint over the old colour. Before returning the clock to its high position, the repairer tested it for a full week. If it stopped again, it would be easier to reach on the workroom table.

The clock is now back above the shop. The team will check it after the first winter, when cold and wet weather may affect its behaviour. Residents can report a problem at the shop counter. The team has not promised that the clock will never need further work.`;
  const blockId = `${idFor("reading", 16)}-repair-flow`;
  const people = ["Sam", "Maya", "Nora", "Liam"];
  return make("reading", 16, "Reading kiểm tra mốc 3.0 · Sửa chiếc đồng hồ làng", "History and practical repair", text, [
    complete("flow-chart-completion", blockId, "Complete repair stage 1. Write ONE WORD from the passage.", "photographs", "First, it made a record of the separate parts using photographs.", 1, "Bước đầu dùng photographs để ghi lại từng bộ phận."),
    complete("flow-chart-completion", blockId, "Complete repair stage 2. Write NO MORE THAN TWO WORDS from the passage.", "soft brush", "Next, the metal pieces were cleaned with a soft brush.", 2, "Bước hai vệ sinh bằng soft brush, không dùng dung dịch mạnh."),
    complete("flow-chart-completion", blockId, "Complete repair stage 3. Write NO MORE THAN TWO WORDS from the passage.", "radio clock", "Finally, the hands were checked against a radio clock while the clock ran indoors.", 2, "Bước cuối đối chiếu kim với radio clock."),
    match("matching-features", "Match the responsibility to a helper: checking the mechanism with the repairer.", "Sam", people, "Sam worked with the experienced repairer to check the mechanism.", "Sam phụ trách kiểm tra bộ máy với người thợ."),
    match("matching-features", "Match the responsibility to a helper: keeping the material costs and receipts.", "Maya", people, "Maya kept the cost records and stored the receipts for materials.", "Maya giữ sổ chi phí và hóa đơn vật liệu."),
    mc("Why did residents keep the wooden case?", "To preserve the clock's familiar appearance", ["To make the clock much heavier", "To avoid taking any photographs", "To hide a new electronic sign"], "The wooden case was kept because residents wanted the clock to retain its familiar appearance.", "Người dân muốn giữ vẻ ngoài quen thuộc của đồng hồ.", 2),
    mc("Why was the clock tested indoors before it was put back?", "A stopped clock would be easier to reach on the table", ["The shop counter had no space for receipts", "Residents wanted to buy the clock", "The new paint needed a full winter to dry"], "If it stopped again, it would be easier to reach on the workroom table.", "Thử trong phòng giúp dễ tiếp cận sửa tiếp nếu máy lại dừng.", 1),
    mc("When will the team make a later check?", "After the first winter", ["Before taking the first photograph", "Only when the shop changes owner", "Every hour for the next ten years"], "The team will check it after the first winter, when cold and wet weather may affect its behaviour.", "Lần kiểm tra sau dự kiến sau mùa đông đầu tiên.", 3),
  ], [{ id: blockId, type: "flow-chart", title: "Order of the repair work", instructions: "Complete the three stages with words from the passage.", questionNumbers: [1, 2, 3],
    rows: [
      { cells: ["Record the separate parts using {{1}}."] },
      { cells: ["Clean the metal pieces with a {{2}}."] },
      { cells: ["Check the hands against a {{3}}."] },
    ] }]);
}

type GrammarItem = readonly [stem: string, answer: string, d1: string, d2: string, d3: string, reason: string];
function grammar(n: number, title: string, context: string, items: GrammarItem[], forms: readonly [stem: string, answer: string, reason: string][] = []): StoredContent {
  const rows: Row[] = items.map(([stem, answer, d1, d2, d3, explanation], index) => ({ ...mc(stem, answer, [d1, d2, d3], stem.replace("___", answer), explanation, (n + index) % 4), subskill: "grammar-in-context" }));
  const blockId = `${idFor("grammar", n)}-word-forms`;
  forms.forEach(([stem, answer, explanation]) => rows.push({
    ...complete("sentence-completion", blockId, "Complete the numbered sentence using ONE WORD. Use the word in brackets in the correct form.", answer, stem.replace("___", answer), 1, explanation), subskill: "grammar-word-forms",
  }));
  const numbers = forms.map((_item, index) => items.length + index + 1);
  return make("grammar", n, title, "Grammar in practical contexts", context, rows,
    forms.length ? [{ id: blockId, type: "sentence", title: "Complete the correct word forms", instructions: "Write ONE WORD in each gap. Use the word in brackets in the correct form.", questionNumbers: numbers,
      text: forms.map(([stem], index) => stem.replace("___", `{{${numbers[index]}}}`)).join("\n") }] : []);
}

function grammar12(): StoredContent {
  return grammar(12, "Grammar in context · Getting ready for a music lesson", "A music tutor is checking a room before an individual lesson. The first six questions are multiple choice. Then complete four numbered sentences with the correct form of the word in brackets.", [
    ["The tutor ___ the room before each lesson.", "checks", "check", "checking", "to check", "The tutor là chủ ngữ số ít; before each lesson chỉ thói quen nên dùng checks."],
    ["There are two ___ beside the piano.", "chairs", "chair", "chair's", "chaires", "Sau two cần danh từ số nhiều chairs."],
    ["Please give this music book to Ben. It belongs to ___.", "him", "he", "his", "himself's", "Sau giới từ to cần đại từ tân ngữ him."],
    ["The next lesson starts ___ half past three.", "at", "on", "in", "to", "Dùng at với giờ cụ thể."],
    ["You should ___ your hands before touching the keys.", "wash", "washes", "washed", "washing", "Sau should dùng động từ nguyên mẫu wash."],
    ["The new room is quieter ___ the room upstairs.", "than", "as", "then", "from", "Quieter là so sánh hơn nên dùng than."],
  ], [
    ["Yesterday, Ella ___ her first song. (play)", "played", "Yesterday chỉ quá khứ, play thêm -ed thành played."],
    ["The tutor is ___ the lesson now. (start)", "starting", "Is và now tạo hiện tại tiếp diễn: is starting."],
    ["One pupil has three music ___. (book)", "books", "Sau three cần số nhiều books."],
    ["Ben usually ___ his guitar on Fridays. (bring)", "brings", "Ben là ngôi ba số ít và usually chỉ thói quen nên dùng brings."],
  ]);
}

function grammar13(): StoredContent {
  return grammar(13, "Grammar in context · Preparing a small exhibition", "A photographer is arranging a small exhibition in a local shop. These sentences refer to finished tasks, current arrangements and instructions. Choose the one grammatically correct option.", [
    ["The photographer ___ the frames last weekend.", "cleaned", "cleans", "cleaning", "clean", "Last weekend chỉ thời gian quá khứ đã kết thúc, dùng cleaned."],
    ["We are ___ the largest picture near the door.", "hanging", "hang", "hung", "hangs", "Sau are trong hiện tại tiếp diễn cần hanging."],
    ["This frame is made ___ wood.", "of", "at", "on", "during", "Cấu trúc made of wood mô tả vật liệu vẫn nhận biết được."],
    ["There is ___ empty space above the desk.", "an", "a", "many", "any", "Space là danh từ số ít trong cụm này; empty bắt đầu bằng âm nguyên âm nên dùng an."],
    ["How ___ pictures can we fit on this wall?", "many", "much", "little", "any", "Pictures đếm được số nhiều, dùng How many."],
    ["The small prints are cheaper ___ the large ones.", "than", "as", "then", "from", "Cheaper là so sánh hơn nên nối bằng than."],
    ["Visitors must not ___ the photographs.", "touch", "touches", "touched", "touching", "Sau must not dùng động từ nguyên mẫu touch."],
    ["This picture belongs to Rosa. It is ___.", "hers", "her", "she", "herself's", "Không có danh từ theo sau nên dùng đại từ sở hữu hers."],
    ["The exhibition opens ___ 16 December.", "on", "in", "at", "to", "Dùng on với một ngày tháng cụ thể."],
    ["We stayed late ___ the last visitors arrived after six.", "because", "because of", "during", "despite", "Theo sau là mệnh đề có chủ ngữ và động từ, nên dùng because."],
  ]);
}

function grammar14(): StoredContent {
  return grammar(14, "Grammar in context · A school kitchen test", "Pupils are preparing a simple classroom test with kitchen equipment. Answer six multiple-choice questions, then complete four genuine sentence gaps with the correct word forms.", [
    ["The teacher ___ the instructions slowly every time.", "reads", "read", "reading", "to read", "The teacher là số ít; every time chỉ thói quen nên dùng reads."],
    ["There is not ___ sugar in this jar.", "much", "many", "a", "an", "Sugar là danh từ không đếm được, dùng not much sugar."],
    ["The metal bowl is heavier ___ the plastic bowl.", "than", "as", "then", "that", "Heavier là so sánh hơn, nối bằng than."],
    ["Please put the clean spoon ___ the tray.", "on", "during", "between", "from", "Put something on the tray diễn tả đặt vật lên khay."],
    ["Can I ___ another reading now?", "take", "takes", "took", "taking", "Sau can dùng động từ nguyên mẫu take."],
    ["These cups are wet. We need to dry ___.", "them", "they", "their", "theirs", "Sau dry cần đại từ tân ngữ them thay cho cups."],
  ], [
    ["Last Tuesday, we ___ the same test. (do)", "did", "Last Tuesday chỉ quá khứ; quá khứ của do là did."],
    ["Mira is ___ the result in her book now. (write)", "writing", "Sau is cần writing trong hiện tại tiếp diễn; write bỏ e trước -ing."],
    ["We put four ___ on the table. (dish)", "dishes", "Sau four cần số nhiều; dish thêm -es thành dishes."],
    ["The teacher always ___ each lid before starting. (close)", "closes", "The teacher số ít và always chỉ thói quen nên dùng closes."],
  ]);
}

function grammar15(): StoredContent {
  return grammar(15, "Grammar in context · Reserving seats for a concert", "A parent is booking seats for a small concert. Choose the option that correctly completes each independent sentence about the booking, the family and the arrangements.", [
    ["The booking office ___ at ten on weekdays.", "opens", "open", "opening", "to open", "The booking office là chủ ngữ số ít; dùng opens."],
    ["I ___ the concert programme yesterday.", "received", "receive", "receiving", "receives", "Yesterday chỉ quá khứ nên dùng received."],
    ["There ___ five seats left in the front row.", "are", "is", "be", "was", "Five seats số nhiều nên cấu trúc hiện tại là There are."],
    ["Our seats are closer to the stage ___ yours.", "than", "as", "then", "that", "Closer là so sánh hơn, dùng than."],
    ["You must ___ your ticket at the entrance.", "show", "shows", "showed", "showing", "Sau must dùng động từ nguyên mẫu show."],
    ["The concert is ___ Saturday evening.", "on", "in", "at", "to", "Dùng on với buổi của một ngày cụ thể."],
    ["These are my tickets. Those two are ___.", "yours", "your", "you", "yourself's", "Cuối câu không có danh từ theo sau nên cần đại từ sở hữu yours."],
    ["We have not booked ___ seats near the stairs.", "any", "much", "a", "an", "Seats đếm được số nhiều; trong câu phủ định dùng any."],
    ["___ does the final song begin? At half past eight.", "When", "Who", "Whose", "Where", "Câu trả lời chỉ thời gian, nên từ hỏi là When."],
    ["The children are ___ for the music to start.", "waiting", "wait", "waited", "waits", "Sau are cần dạng -ing để tạo hiện tại tiếp diễn."],
  ]);
}

function grammar16(): StoredContent {
  return grammar(16, "Grammar in context · Helping a repair team", "A young assistant is helping repair old household objects. Each sentence has its own time reference. Choose the one option that makes it grammatically correct.", [
    ["The assistant usually ___ the small parts in a box.", "keeps", "keep", "keeping", "to keep", "The assistant là chủ ngữ số ít; usually chỉ thói quen nên dùng keeps."],
    ["We ___ a loose wheel on the cart last night.", "found", "find", "finding", "finds", "Last night chỉ quá khứ; quá khứ của find là found."],
    ["There are six ___ on the workbench.", "brushes", "brush", "brush's", "brushs", "Sau six cần số nhiều brushes."],
    ["How ___ glue do we need for this small repair?", "much", "many", "few", "several", "Glue không đếm được, dùng How much."],
    ["Please give the old handle to Omar. He can repair ___.", "it", "he", "its", "they", "It thay cho the old handle và làm tân ngữ của repair."],
    ["The assistant is ___ the tools now.", "counting", "count", "counted", "counts", "Is và now cần hiện tại tiếp diễn: is counting."],
    ["This small case is easier to carry ___ the wooden box.", "than", "as", "then", "from", "Easier là so sánh hơn nên dùng than."],
    ["We should ___ the floor before visitors arrive.", "clear", "clears", "cleared", "clearing", "Sau should dùng động từ nguyên mẫu clear."],
    ["The next repair session is ___ January.", "in", "on", "at", "to", "Dùng in với tháng January."],
    ["We stopped working ___ the room became too dark.", "because", "because of", "during", "despite", "Theo sau là mệnh đề the room became too dark, nên dùng because."],
  ]);
}

export function tenBatchReadingGrammarA(): StoredContent[] {
  return [reading12(), grammar12(), reading13(), grammar13(), reading14(), grammar14(), reading15(), grammar15(), reading16(), grammar16()];
}
