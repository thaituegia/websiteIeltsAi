import { validateContentStructure } from "../../shared/content-visuals";
import type { IeltsQuestionType, QuestionBlock, StoredContent, StoredQuestion } from "../../shared/types";

/** Original private announcements, with genuine choice, matching and completion
 * tasks. All situations are fictional; each script is one bounded narration. */
const version = "duo-gate-20261110-v4";
const authoredAt = "2026-11-10T00:00:00.000Z";
const completionInstructions = "Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.";
type Draft = Omit<StoredQuestion, "id" | "number" | "sectionIndex" | "blockId"> & { layout?: string };

function choice(prompt: string, answer: string, distractors: string[], evidence: string, explanation: string, rotation = 0): Draft {
  const options = [answer, ...distractors];
  return { type: "choice", questionType: "multiple-choice", prompt, answer,
    options: [...options.slice(rotation), ...options.slice(0, rotation)], evidence, explanation,
    subskill: "identifying-stated-purpose-and-detail" };
}
function match(entity: string, answer: string, options: string[], evidence: string, explanation: string, instruction: string): Draft {
  return { type: "matching", questionType: "matching", prompt: `${instruction}: ${entity}`,
    answer, options, evidence, explanation, subskill: "matching-spoken-features" };
}
function fill(kind: QuestionBlock["type"], prompt: string, layout: string, answer: string,
  evidence: string, explanation: string, acceptedAnswers?: string[]): Draft {
  return { type: "text", questionType: `${kind}-completion` as IeltsQuestionType,
    prompt: `${prompt}. ${completionInstructions}`, layout, answer, evidence, explanation,
    wordLimit: 3, allowNumbers: true, ...(acceptedAnswers ? { acceptedAnswers } : {}),
    subskill: "listening-for-specific-details" };
}
function paper(sitting: number, title: string, topic: string, text: string,
  blockType: QuestionBlock["type"], blockTitle: string, drafts: Draft[]): StoredContent {
  const id = `duo-private-listening-lesson-30-extra-20261110-${sitting}`;
  const blockId = `${id}-${blockType}`;
  const completions = drafts.flatMap((draft, index) => draft.layout === undefined ? [] : [{ draft, number: index + 1 }]);
  const block: QuestionBlock = { id: blockId, type: blockType, title: blockTitle,
    instructions: completionInstructions, questionNumbers: completions.map(row => row.number),
    ...(blockType === "sentence" ? { text: completions.map(({ draft, number }) =>
      draft.layout!.replace("{{}}", `{{${number}}}`)).join("\n") }
      : { rows: completions.map(({ draft, number }) => ({ cells: blockType === "table"
        ? [draft.layout!.replace(/:\s*\{\{\}\}\.?$/u, ""), `{{${number}}}`]
        : [draft.layout!.replace("{{}}", `{{${number}}}`)] })) }),
  };
  const content: StoredContent = {
    id, skill: "listening", title, topic, band: 3, cefr: "A2", testType: "both", format: "lesson",
    description: "Bài nghe riêng mốc 3.0, kết hợp trắc nghiệm, nối thông tin và hoàn thành nội dung có đánh số.",
    durationMinutes: 12,
    sections: [{ id: `${id}-section-1`, title, text,
      dialogue: [{ speaker: "Narrator", accent: "british", text }],
      instructions: "Listen and answer all eight questions. Follow the instructions for each question group. The transcript opens after submission.",
      questionBlocks: [block],
    }],
    questions: drafts.map(({ layout, ...draft }, index) => ({ ...draft,
      id: `${id}-q-${index + 1}`, number: index + 1, sectionIndex: 0,
      ...(layout !== undefined ? { blockId } : {}),
    })),
    vocabularyIds: [], tags: ["duo-exclusive", "gate-assessment", "gate-supplement-20261110-v4", "mixed-listening-tasks"],
    source: "authored", quality: "authored-unreviewed", createdAt: authoredAt,
    estimatedDifficulty: { band: 3, cefr: "A2", basis: "Độ khó A2 mục tiêu của học liệu tự biên soạn; chưa hiệu chuẩn bằng kết quả thi thật." },
    provenance: { method: "authored", version, generatedAt: authoredAt },
    review: { status: "structural-checks-passed", checks: ["new-private-source", "mixed-input-widgets", "numbered-completion-block", "literal-evidence", "single-bounded-listening-turn"],
      limitations: ["Chưa được giám khảo độc lập thẩm định hoặc hiệu chuẩn band IELTS."] },
  };
  validateContentStructure(content);
  return content;
}

function floodKitSession(): StoredContent {
  const text = `Good evening. Here are the arrangements for our neighbourhood flood-kit session. The aim is to help families prepare for a short period without power. We are not teaching people to enter deep water or repair damaged roads. Everyone will work with a sample kit indoors, so you do not need special outdoor clothing.

Please book by telephone. The office must check how many people need large-print information before confirming places. An online list would not give us that detail. The session is on Friday. Meet at Cedar Hall, the building beside the public garden. We begin at 6:15 in the evening, and the main activity lasts about an hour.

You will visit three practice stations. At the light station, you will test battery lamps. You can see how long each lamp works and practise changing its batteries. At the food station, you will pack sealed snacks. These do not need cooking, which makes them useful when a cooker cannot be used. At the message station, you will fill in contact cards. A clear card helps someone find the right telephone number quickly.

The kit also contains a basic radio, but you will not practise using it at a station this time. A helper will explain it at the end. Please do not bring food from home, because all the sample materials are ready on the tables. You may photograph your finished kit before leaving. We will give you a short checklist so you can prepare your own things later, without buying everything on the same day.`;
  const options = ["contact cards", "a basic radio", "battery lamps", "sealed snacks"];
  return paper(17, "A neighbourhood practical session", "Neighbourhood preparation", text, "table", "Session arrangements", [
    choice("What is the main purpose of the session?", "To prepare for a short loss of electricity", ["To learn to rescue people from deep water", "To repair local roads", "To practise outdoor camping"], "The aim is to help families prepare for a short period without power.", "Mục tiêu là chuẩn bị khi mất điện ngắn; hai hoạt động cứu hộ và sửa đường được loại trừ rõ.", 2),
    choice("Why must people book by telephone?", "Staff need to check information needs", ["The hall has no internet connection", "Everyone must pay during the call", "The session time changes each day"], "The office must check how many people need large-print information before confirming places.", "Nhân viên cần kiểm tra nhu cầu tài liệu chữ lớn; không có thông tin về thu tiền hoặc mất mạng.", 1),
    fill("table", "Day of the session", "Day: {{}}", "Friday", "The session is on Friday.", "Ngày tổ chức là Friday."),
    fill("table", "Meeting building", "Meeting building: {{}}", "Cedar Hall", "Meet at Cedar Hall, the building beside the public garden.", "Tên tòa nhà cần điền là Cedar Hall."),
    fill("table", "Starting time", "Starting time: {{}}", "6:15", "We begin at 6:15 in the evening, and the main activity lasts about an hour.", "6:15 buổi tối tương đương 18:15 hoặc quarter past six.", ["18:15", "six fifteen", "quarter past six"]),
    match("Light station", "battery lamps", options, "At the light station, you will test battery lamps.", "Trạm ánh sáng dùng battery lamps, không phải radio.", "Match each station with its practice item"),
    match("Food station", "sealed snacks", options, "At the food station, you will pack sealed snacks.", "Trạm thực phẩm chuẩn bị sealed snacks vì không cần nấu.", "Match each station with its practice item"),
    match("Message station", "contact cards", options, "At the message station, you will fill in contact cards.", "Trạm liên lạc dùng contact cards; radio chỉ được giới thiệu sau.", "Match each station with its practice item"),
  ]);
}

function skatingVisit(): StoredContent {
  const text = `Hello, and welcome to the information line for our outdoor skating visit. This is an introduction for people who have never skated before. The visit is on Sunday. Our group meets at Mill Park. Please look for the small office beside the pond rather than the café on the main path.

We start at 9:20 in the morning. Please arrive before then so the staff can check the size of your boots. The first lesson stays in a small practice area. We have chosen this area because it is close to a rail that beginners can hold. We are not asking you to move quickly or join a race.

Bring thick socks. We lend boots and helmets, so buying them before a first visit is unnecessary. If the weather makes skating unsafe, staff will send a text message before you leave home. Please check your phone rather than travelling to see whether the rink is open.

There are three places you should know. The fitting tent is where staff check that your boots are secure. Take time here, because loose boots can make standing difficult. The rest bench is where you remove ice from the blades before putting on the protective covers. The practice gate is where you wait for an instructor before going onto the rink.

The café is available after the lesson, but food is not included in the booking. Please return all borrowed equipment before ordering a drink. A member of staff will explain future sessions if you enjoy your first morning on the ice.`;
  const options = ["Remove ice from the blades", "Buy food and drinks", "Wait for an instructor", "Check that boots are secure"];
  return paper(18, "A first morning on the ice", "Leisure and safe introductions", text, "form", "Visit information", [
    fill("form", "Day of the visit", "Day: {{}}", "Sunday", "The visit is on Sunday.", "Buổi làm quen diễn ra vào Sunday."),
    fill("form", "Meeting place", "Meeting place: {{}}", "Mill Park", "Our group meets at Mill Park.", "Điểm gặp là Mill Park, cụ thể gần văn phòng bên hồ."),
    fill("form", "Starting time", "Starting time: {{}}", "9:20", "We start at 9:20 in the morning.", "Giờ bắt đầu là 9:20 sáng.", ["09:20", "nine twenty", "twenty past nine"]),
    choice("Why is the first lesson in a small practice area?", "Beginners can hold a nearby rail", ["The group will prepare for a race", "The café overlooks that area", "The main rink is being repaired"], "We have chosen this area because it is close to a rail that beginners can hold.", "Lý do chọn khu tập là có thanh vịn gần đó, không phải để thi đua.", 3),
    choice("What should visitors do if they are unsure whether bad weather will cancel the visit?", "Check their phone before travelling", ["Go to the park to inspect the ice", "Buy their own helmet", "Wait inside the café"], "Please check your phone rather than travelling to see whether the rink is open.", "Cần kiểm tra tin nhắn trước khi đi; không tự đến công viên để xem tình hình.", 1),
    match("Fitting tent", "Check that boots are secure", options, "The fitting tent is where staff check that your boots are secure.", "Tại lều thử đồ, nhân viên kiểm tra giày vừa và chắc.", "Match each place with the action visitors should take there"),
    match("Rest bench", "Remove ice from the blades", options, "The rest bench is where you remove ice from the blades before putting on the protective covers.", "Tại ghế nghỉ, gỡ băng khỏi lưỡi trượt trước khi lắp đồ bảo vệ.", "Match each place with the action visitors should take there"),
    match("Practice gate", "Wait for an instructor", options, "The practice gate is where you wait for an instructor before going onto the rink.", "Tại cổng khu tập, phải chờ hướng dẫn viên trước khi vào sân.", "Match each place with the action visitors should take there"),
  ]);
}

function movingBooks(): StoredContent {
  const text = `Good morning, volunteers. Today we are moving donated books into our new book room. Please leave your coats near the entrance and listen to the order of the work. A clear routine will help us keep the records correct, and nobody should lift a box that feels too heavy.

First, read the code number on each box. The number tells you which section should receive it, so do not guess from the picture on the outside. Next, move the box using a padded trolley. The soft base protects the corners, and a helper will show you how to turn safely in the narrow doorway. Put damaged books on the red shelf. They must stay apart from the collection until someone has checked them.

Two kinds of books have special places. The large picture books go on the lower shelves, where they are easier to reach without stretching. The magazines go in wire baskets, which keep the current issue in front. The locked cupboard is for staff records, and the desk drawer holds spare labels. Do not use those spaces for the donated books.

Please stop accepting new donations at noon. We need time to count everything before the delivery van arrives; the room itself will remain open. One volunteer will record the final totals, so tell her about any box that has no number. At the end, take empty boxes to the recycling cage. Do not leave them by the door, as the van driver will need a clear path. Thank you for helping the room open with an organised collection.`;
  const options = ["desk drawer", "lower shelves", "locked cupboard", "wire baskets"];
  return paper(19, "Moving a donated book collection", "Volunteering and practical routines", text, "flow-chart", "Order of the moving tasks", [
    fill("flow-chart", "Information to read on each box", "Read the {{}} on the box.", "code number", "First, read the code number on each box.", "Bước đầu là đọc code number, không đoán theo hình trên hộp."),
    fill("flow-chart", "Equipment for moving a box", "Move the box using a {{}}.", "padded trolley", "Next, move the box using a padded trolley.", "Bước tiếp theo sử dụng padded trolley để bảo vệ góc sách."),
    fill("flow-chart", "Place for damaged books", "Place damaged books on the {{}}.", "red shelf", "Put damaged books on the red shelf.", "Sách hỏng được tách riêng trên red shelf."),
    match("Large picture books", "lower shelves", options, "The large picture books go on the lower shelves, where they are easier to reach without stretching.", "Sách tranh lớn đặt ở các kệ thấp để lấy dễ hơn.", "Match each collection with its storage place"),
    match("Magazines", "wire baskets", options, "The magazines go in wire baskets, which keep the current issue in front.", "Tạp chí đặt trong wire baskets, không phải tủ hồ sơ hoặc ngăn nhãn.", "Match each collection with its storage place"),
    choice("Why will the team stop accepting donations at noon?", "They need time to count the collection", ["The book room closes at noon", "The volunteer team will leave for lunch", "The collection is already too large"], "We need time to count everything before the delivery van arrives; the room itself will remain open.", "Việc nhận đồ dừng để kiểm đếm trước khi xe tới; phòng vẫn mở.", 2),
    choice("What should volunteers report to the person recording totals?", "A box without a number", ["A book with a large picture", "A trolley with a soft base", "A magazine's current issue"], "One volunteer will record the final totals, so tell her about any box that has no number.", "Cần báo hộp thiếu số vì ảnh hưởng việc ghi nhận số lượng.", 3),
    choice("Why must empty boxes be moved away from the door?", "The delivery driver needs a clear path", ["Visitors may take them home", "Staff will paint the doorway", "They might hide the room number"], "Do not leave them by the door, as the van driver will need a clear path.", "Cần để lối cửa thông thoáng cho tài xế xe giao hàng.", 1),
  ]);
}

function harbourSignals(): StoredContent {
  const text = `Welcome to our harbour visitor day. We will explore how messages can be sent when people are too far apart to speak normally. Please stay on the marked path and ask before touching any equipment. You will visit three demonstration areas, and the helpers will explain each method before you try it.

At the flag area, you will copy a signal using coloured cloth. The helper will begin with a simple pattern, and you can work with a partner across the grass. At the bell area, you will repeat a message using a short rhythm. Listen carefully to the spaces between the sounds, as those spaces are part of the pattern. At the radio area, you will practise a clear spoken message. You will use a training set that does not send anything to working boats. The printed map helps you find each area, but it is not one of the message methods you will practise.

The opening talk lasts 20 minutes. After that, groups leave from the welcome tent, where a helper will check your booking. Please bring a notebook if you want to record the signal patterns. We provide pencils, so you do not need to carry a full set of materials.

If strong wind makes a flag difficult to use, that demonstration will move into the boat shed. The other areas will remain where they are. Please tell a helper if you need a quiet break; there is no need to finish every activity quickly. At the end, return your visitor badge before looking around the small exhibition.`;
  const options = ["a clear spoken message", "coloured cloth", "a printed map", "a short rhythm"];
  return paper(20, "Ways of sending messages across a harbour", "Communication and visitor activities", text, "sentence", "Details for visitors", [
    match("Flag area", "coloured cloth", options, "At the flag area, you will copy a signal using coloured cloth.", "Khu cờ truyền tín hiệu bằng coloured cloth.", "Match each demonstration area with the method visitors use"),
    match("Bell area", "a short rhythm", options, "At the bell area, you will repeat a message using a short rhythm.", "Khu chuông dùng nhịp âm thanh ngắn; khoảng ngừng cũng là một phần tín hiệu.", "Match each demonstration area with the method visitors use"),
    match("Radio area", "a clear spoken message", options, "At the radio area, you will practise a clear spoken message.", "Khu radio luyện thông điệp nói rõ; bản đồ chỉ giúp tìm đường.", "Match each demonstration area with the method visitors use"),
    fill("sentence", "Length of the opening talk in minutes", "The opening talk lasts {{}} minutes.", "20", "The opening talk lasts 20 minutes.", "Bài giới thiệu đầu kéo dài hai mươi phút.", ["twenty"]),
    fill("sentence", "Place from which groups leave after the talk", "Groups leave from the {{}} after the talk.", "welcome tent", "After that, groups leave from the welcome tent, where a helper will check your booking.", "Các nhóm xuất phát từ welcome tent sau phần giới thiệu."),
    fill("sentence", "Item visitors can bring for recording signal patterns", "Visitors can record patterns in a {{}}.", "notebook", "Please bring a notebook if you want to record the signal patterns.", "Có thể mang notebook để ghi lại mẫu tín hiệu; bút chì đã được cung cấp."),
    choice("What happens to the flag activity in strong wind?", "It moves inside the boat shed", ["Every activity is cancelled", "It moves to the radio area", "Visitors use the flags on working boats"], "If strong wind makes a flag difficult to use, that demonstration will move into the boat shed.", "Chỉ hoạt động cờ chuyển vào nhà thuyền khi gió mạnh, không phải hủy mọi hoạt động.", 2),
    choice("What should visitors do if they need a quiet break?", "Tell one of the helpers", ["Finish every demonstration first", "Return home immediately", "Ask a working boat to wait"], "Please tell a helper if you need a quiet break; there is no need to finish every activity quickly.", "Người cần nghỉ yên tĩnh nên báo người hỗ trợ; không phải làm xong mọi hoạt động trước.", 3),
  ]);
}

function lunchRota(): StoredContent {
  const text = `Hello, and thank you for helping with our neighbourhood lunch deliveries. The meals go to residents who cannot easily leave home. We begin the new rota on Monday. Please meet at Garden Kitchen. We will check the route sheets together before anyone sets off, and new volunteers will work with an experienced partner.

There are three stages, each with its own kind of box. At the packing stage, use the insulated box. It keeps the meals warm between the kitchen and the resident's home. At the return stage, use the green box for empty meal containers. Keep these separate from any food still waiting to be delivered. At the paperwork stage, use the flat box for completed route sheets. A round basket holds spare fruit, but it is not part of the delivery routine.

Please phone the coordinator if a resident does not answer the door. Do not leave a hot meal outside, and do not decide on your own that the person has gone away. The coordinator can check the contact details while you wait in a safe place.

Only write that a meal has been delivered after the resident has received it. Making the mark earlier could cause a missing meal to be overlooked. If a route takes longer than usual, tell the kitchen before starting your next delivery. This allows another volunteer to help while the food is still warm. At the end, leave the vehicle keys with the kitchen manager. Please do not pass them directly to the next driver, because the manager must record who is using each vehicle.`;
  const options = ["green box", "flat box", "round basket", "insulated box"];
  return paper(21, "Joining a neighbourhood meal rota", "Volunteering and local services", text, "note", "First-day arrangements", [
    fill("note", "Day the new rota begins", "Starting day: {{}}", "Monday", "We begin the new rota on Monday.", "Lịch phân công mới bắt đầu vào Monday."),
    fill("note", "Meeting place", "Meeting place: {{}}", "Garden Kitchen", "Please meet at Garden Kitchen.", "Tình nguyện viên tập trung tại Garden Kitchen để kiểm tra lộ trình."),
    match("Packing stage", "insulated box", options, "At the packing stage, use the insulated box.", "Giai đoạn đóng đồ dùng insulated box để giữ ấm.", "Match each stage with the container volunteers use"),
    match("Return stage", "green box", options, "At the return stage, use the green box for empty meal containers.", "Giai đoạn thu hồi dùng green box cho hộp đựng bữa ăn rỗng.", "Match each stage with the container volunteers use"),
    match("Paperwork stage", "flat box", options, "At the paperwork stage, use the flat box for completed route sheets.", "Giai đoạn xử lý giấy tờ dùng flat box cho phiếu lộ trình đã hoàn thành.", "Match each stage with the container volunteers use"),
    choice("What should a volunteer do if a resident does not answer?", "Phone the coordinator", ["Leave the meal outside the door", "Assume the resident has gone away", "Ask the next driver to keep the meal"], "Please phone the coordinator if a resident does not answer the door.", "Phải gọi điều phối viên; không tự để đồ ăn bên ngoài hoặc kết luận người nhận đi vắng.", 1),
    choice("Why must volunteers wait until the resident receives the meal before marking the sheet?", "An early mark could hide a missing delivery", ["The resident must choose the next route", "The sheet is needed to keep food warm", "The kitchen closes after each delivery"], "Making the mark earlier could cause a missing meal to be overlooked.", "Đánh dấu quá sớm có thể làm bỏ sót một bữa chưa giao.", 3),
    choice("Why should vehicle keys be returned to the kitchen manager?", "The manager records who uses each vehicle", ["The next driver must buy a new key", "All vehicles are kept inside the kitchen", "Residents sometimes need to borrow a vehicle"], "Please do not pass them directly to the next driver, because the manager must record who is using each vehicle.", "Quản lý cần ghi nhận người sử dụng từng xe, nên không chuyền chìa khóa thẳng cho tài xế tiếp theo.", 2),
  ]);
}

export function tenBatchListeningB(): StoredContent[] {
  return [floodKitSession(), skatingVisit(), movingBooks(), harbourSignals(), lunchRota()];
}
