import { validateContentStructure } from "../../shared/content-visuals";
import type { QuestionBlock, StoredContent, StoredQuestion } from "../../shared/types";

/** Original private assessment sources. The organisations and arrangements are
 * fictional. Each paper uses three genuinely different listening tasks. */
const version = "duo-gate-20261110-v4";
const authoredAt = "2026-11-10T00:00:00.000Z";
type Draft = Omit<StoredQuestion, "id" | "number" | "sectionIndex">;
type Fact = readonly [label: string, answer: string, evidence: string, explanation: string, alternatives?: string[]];
interface Group { questions: Draft[]; completion?: { type: QuestionBlock["type"]; title: string; labels: string[] } }

function completion(type: QuestionBlock["type"], facts: Fact[]): Group {
  const instructions = "Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.";
  return { completion: { type, title: type === "flow-chart" ? "Preparation stages" : "Visitor information", labels: facts.map(fact => fact[0]) },
    questions: facts.map(([label, answer, evidence, explanation, acceptedAnswers]) => ({
      type: "text", questionType: `${type}-completion`, prompt: `${label} ${instructions}`,
      answer, evidence, explanation, wordLimit: 3, allowNumbers: true,
      ...(acceptedAnswers ? { acceptedAnswers } : {}), subskill: "listening-for-specific-information",
    })) };
}
function choice(prompt: string, answer: string, distractors: string[], evidence: string, explanation: string, rotation = 0): Draft {
  const options = [answer, ...distractors];
  return { type: "choice", questionType: "multiple-choice", prompt, answer, evidence, explanation,
    options: [...options.slice(rotation), ...options.slice(0, rotation)], subskill: "understanding-stated-arrangements" };
}
function matching(instructions: string, options: string[], facts: Fact[]): Group {
  return { questions: facts.map(([label, answer, evidence, explanation]) => ({
    type: "matching", questionType: "matching", prompt: label, groupInstructions: instructions,
    options, answer, evidence, explanation, subskill: "matching-people-places-and-functions",
  })) };
}
function paper(sitting: number, title: string, topic: string, text: string, groups: Group[]): StoredContent {
  const id = `duo-private-listening-lesson-30-extra-20261110-${sitting}`;
  const questions: StoredQuestion[] = [], blocks: QuestionBlock[] = [];
  groups.forEach((group, index) => {
    const first = questions.length + 1, blockId = `${id}-block-${index + 1}`;
    group.questions.forEach((question, offset) => questions.push({ ...question,
      id: `${id}-q-${first + offset}`, number: first + offset, sectionIndex: 0,
      ...(group.completion ? { blockId } : {}),
    }));
    if (group.completion) {
      const { type, title: blockTitle, labels } = group.completion;
      const questionNumbers = labels.map((_label, offset) => first + offset);
      const slot = (label: string, offset: number) => label.includes("___")
        ? label.replace("___", `{{${first + offset}}}`) : `${label}: {{${first + offset}}}`;
      blocks.push({ id: blockId, type, title: blockTitle,
        instructions: "Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.", questionNumbers,
        ...(type === "table" ? { rows: labels.map((label, offset) => ({ cells: [label, `{{${first + offset}}}`] })) }
          : type === "form" || type === "note" || type === "flow-chart"
            ? { rows: labels.map((label, offset) => ({ cells: [slot(label, offset)] })) }
            : { text: labels.map(slot).join("\n") }),
      });
    }
  });
  const result: StoredContent = {
    id, skill: "listening", title, topic, band: 3, cefr: "A2", testType: "both", format: "lesson",
    description: "Đề nghe riêng mốc 3.0, kết hợp chọn đáp án, nối thông tin và hoàn thành nội dung có đánh số.",
    durationMinutes: 12,
    sections: [{ id: `${id}-section-1`, title, text, dialogue: [{ speaker: "Narrator", accent: "british", text }],
      instructions: "Listen to the announcement. Follow the separate instructions for each question group.", questionBlocks: blocks }],
    questions, vocabularyIds: [], tags: ["duo-exclusive", "gate-assessment", "gate-supplement-20261110-v4", "mixed-listening-tasks"],
    source: "authored", quality: "authored-unreviewed", createdAt: authoredAt,
    estimatedDifficulty: { band: 3, cefr: "A2", basis: "Độ khó A2 mục tiêu của học liệu tự biên soạn; chưa hiệu chuẩn bằng kết quả thi thật." },
    provenance: { method: "authored", version, generatedAt: authoredAt },
    review: { status: "structural-checks-passed", checks: ["new-private-source", "mixed-input-tasks", "numbered-completion-layout", "literal-evidence", "single-bounded-listening-turn"],
      limitations: ["Chưa được giám khảo độc lập thẩm định hoặc hiệu chuẩn band IELTS."] },
  };
  validateContentStructure(result);
  return result;
}

function printMorning(): StoredContent {
  const text = `Hello, and thank you for booking our print-making morning. It is designed for adults who have never used printing tools. We will make simple pictures by pressing coloured shapes onto paper. Please listen to the practical arrangements before choosing a work table. The session begins at 10:20 in the morning. The fee is 11 pounds for each participant.

We chose foam shapes because they are easy to cut. You will see examples before designing your own picture. The price includes all the printing materials, but please bring a packed lunch. We cannot sell food in the workroom. Children may attend only with an adult. The adult must stay for the whole session rather than leaving a child with our helpers.

There are three activities after the introduction. For card printing, use a wooden roller to spread the colour evenly. Do not press too hard, or the paper may tear when you lift it. For fabric printing, use a sponge pad. This holds less colour and helps stop it spreading outside your design. For leaf printing, use a soft brush to put colour on the leaves before pressing them down. Metal stamps will stay in the cupboard today because they belong to a different course.

You may try every activity, but please finish one before moving to another table. At the end, place wet pictures on the drying shelves. Write your name on the back first. We will explain how to collect anything that is still wet when you leave.`;
  return paper(12, "Trying three simple printing techniques", "Art and practical skills", text, [
    completion("form", [
      ["Session starting time", "10:20", "The session begins at 10:20 in the morning.", "Buổi học bắt đầu lúc 10:20 sáng.", ["ten twenty", "twenty past ten"]],
      ["Fee in pounds per participant", "11", "The fee is 11 pounds for each participant.", "Mỗi người trả 11 bảng.", ["eleven"]],
    ]),
    { questions: [
      choice("Why were foam shapes chosen?", "they are easy to cut", ["they dry faster than paper", "they can be used without colour"], "We chose foam shapes because they are easy to cut.", "Lý do được nêu là dễ cắt, không phải tốc độ khô hoặc bỏ qua màu.", 1),
      choice("What should participants bring?", "a packed lunch", ["a set of printing tools", "a selection of metal stamps"], "The price includes all the printing materials, but please bring a packed lunch.", "Vật liệu in đã có; người tham gia cần tự mang bữa trưa.", 2),
      choice("When may children attend?", "only with an adult", ["only after the introduction", "only if they bring their own tools"], "Children may attend only with an adult.", "Trẻ chỉ được tham gia khi có người lớn ở cùng suốt buổi.", 0),
    ] },
    matching("Match each printing activity with its tool. Choose one option for each activity; one option is extra.",
      ["sponge pad", "metal stamps", "soft brush", "wooden roller"], [
        ["Card printing", "wooden roller", "For card printing, use a wooden roller to spread the colour evenly.", "In thiệp dùng wooden roller để trải màu đều."],
        ["Fabric printing", "sponge pad", "For fabric printing, use a sponge pad.", "In lên vải dùng sponge pad để hạn chế màu lan ngoài hình."],
        ["Leaf printing", "soft brush", "For leaf printing, use a soft brush to put colour on the leaves before pressing them down.", "In lá dùng soft brush để đưa màu lên bề mặt lá."],
      ]),
  ]);
}

function filmHouse(): StoredContent {
  const text = `Welcome to our old film house. This visit is for people who want to discover how the building was used before modern cinemas arrived. You do not need any technical knowledge. Our next tour is on Monday. It starts at 1:40 in the afternoon. The visit lasts 50 minutes, including time for questions at the end.

You will visit two rooms in small groups. The Sound Room is used for recorded memories. You will hear local residents describe their first visits to the cinema. The Picture Room is used for old machines. A guide will show you how one machine moved the film. The other possible activities, live performances and children's games, take place during special events rather than on this tour.

Please book through the library. We considered asking people to telephone the building, but there is not always a volunteer near the phone. The library staff can check the whole list and confirm a place while you are there. You do not need to pay a booking fee.

If you have an old cinema ticket, please bring it. A volunteer can photograph it for our collection without keeping the original. Please do not bring large posters because we do not have a safe place to lay them out. Our next public event will show short cartoons. It will be suitable for families, unlike some of the longer films in our evening programme. Details will be printed on a leaflet beside the exit, and you may take one home.`;
  return paper(13, "Exploring a former film house", "Local culture and buildings", text, [
    completion("table", [
      ["Day of the next tour", "Monday", "Our next tour is on Monday.", "Tour tiếp theo diễn ra vào Monday."],
      ["Starting time", "1:40", "It starts at 1:40 in the afternoon.", "1:40 chiều tương đương 13:40.", ["13:40", "one forty", "twenty to two"]],
      ["Tour length in minutes", "50", "The visit lasts 50 minutes, including time for questions at the end.", "Tổng thời gian đã gồm phần hỏi đáp là 50 phút.", ["fifty"]],
    ]),
    matching("Match each room with what visitors will find there. Two options are extra.",
      ["children's games", "old machines", "live performances", "recorded memories"], [
        ["Sound Room", "recorded memories", "The Sound Room is used for recorded memories.", "Sound Room phát các ký ức đã được ghi âm."],
        ["Picture Room", "old machines", "The Picture Room is used for old machines.", "Picture Room trưng bày máy móc cũ liên quan đến phim."],
      ]),
    { questions: [
      choice("Where should visitors book?", "through the library", ["at the cinema ticket machine", "by telephoning the building"], "Please book through the library.", "Cần đặt qua thư viện vì không phải lúc nào cũng có người trực điện thoại tại tòa nhà.", 2),
      choice("What personal object is useful to bring?", "an old cinema ticket", ["a large film poster", "a modern camera manual"], "If you have an old cinema ticket, please bring it.", "Vé xem phim cũ có thể được chụp lưu vào bộ sưu tập; bản gốc vẫn trả lại.", 1),
      choice("What will the next public event show?", "short cartoons", ["long historical films", "live interviews with actors"], "Our next public event will show short cartoons.", "Sự kiện tiếp theo sẽ chiếu phim hoạt hình ngắn phù hợp cho gia đình.", 0),
    ] },
  ]);
}

function theatreHelpers(): StoredContent {
  const text = `Good afternoon, and thank you for helping at our theatre open day. We need people to welcome visitors rather than perform on stage. No previous theatre experience is required. A member of staff will explain every job before visitors arrive. The main entrance is closed because the steps are being repaired. Please use the level entrance beside the garden.

Helpers who move the display boards should wear gloves. We have several clean pairs on the table, so there is no need to bring your own. After moving the boards, allow 15 minutes for checking the room before opening the doors. This check is part of the plan, even if everything looks ready. Put spare tickets in the blue box after the check. Do not leave them on a chair where a visitor might pick them up by mistake.

Please notice the badges worn by the three team leaders. The person with a red badge is responsible for ticket questions. Ask that person if a booking cannot be found on the list. The person with a green badge is responsible for finding seats. They can help a visitor who needs more space beside a chair. The person with a white badge is responsible for taking photographs. Tell them if a visitor does not want to appear in a picture. Cleaning equipment is managed by the caretaker, who does not wear one of these badges.

At the end, we will meet briefly to hear what went well and what should change next time. Your comments will help us make future open days easier for everyone.`;
  return paper(14, "Helping at a theatre open day", "Volunteering and public events", text, [
    { questions: [
      choice("What experience do helpers need?", "No previous theatre experience", ["Experience selling theatre tickets", "Experience performing on stage"], "No previous theatre experience is required.", "Không cần kinh nghiệm làm việc tại nhà hát; mỗi công việc đều có hướng dẫn.", 1),
      choice("Why is the main entrance closed?", "the steps are being repaired", ["a performance is taking place", "the garden is being watered"], "The main entrance is closed because the steps are being repaired.", "Lối chính đóng vì đang sửa bậc thang, không phải do hoạt động biểu diễn.", 2),
    ] },
    completion("sentence", [
      ["Helpers moving display boards should wear ___.", "gloves", "Helpers who move the display boards should wear gloves.", "Người di chuyển bảng trưng bày cần đeo gloves."],
      ["Allow ___ minutes for the room check.", "15", "After moving the boards, allow 15 minutes for checking the room before opening the doors.", "Dành 15 phút kiểm tra phòng trước khi mở cửa.", ["fifteen"]],
      ["Spare tickets should go in the ___.", "blue box", "Put spare tickets in the blue box after the check.", "Vé dư để trong blue box sau khi kiểm tra."],
    ]),
    matching("Match each leader's badge colour with their responsibility. One option is extra.",
      ["finding seats", "cleaning equipment", "ticket questions", "taking photographs"], [
        ["Red badge", "ticket questions", "The person with a red badge is responsible for ticket questions.", "Người có huy hiệu đỏ giải đáp vấn đề về vé."],
        ["Green badge", "finding seats", "The person with a green badge is responsible for finding seats.", "Người có huy hiệu xanh lá hỗ trợ tìm chỗ ngồi."],
        ["White badge", "taking photographs", "The person with a white badge is responsible for taking photographs.", "Người có huy hiệu trắng phụ trách chụp ảnh."],
      ]),
  ]);
}

function aquariumCare(): StoredContent {
  const text = `Hello, and welcome to our practical session about looking after a small aquarium. This is a beginner class using the teaching tanks in our community centre. Please follow the preparation stages in order. First, check the temperature. The guide will show you where to read it. Then leave fresh tap water for one night before using it. Before pouring any water, find a clean jug. Keep this jug for the tanks rather than using one from the kitchen.

There is no need to buy equipment for today because the fee includes all the tools. You can try them before deciding what is useful at home. We will also explain why ordinary soap is kept away from the tanks: it can harm the fish. Use only the cleaning materials provided by the guide, and ask before adding anything to the water.

Three helpers have different jobs during the session. Nina checks the water level. She will visit each table before the practical work starts. Omar prepares the food. He will explain how to measure a small amount without using a large spoon. Beth cleans the outside glass. She will demonstrate how to avoid marks without touching the inside of a tank. Repairing the lights is the caretaker's job, so please do not ask a helper to open an electrical fitting.

The final part of the session is for questions about your own tanks. You may bring a photograph, but please leave fish and other animals at home. We cannot safely move them between different tanks during a short class.`;
  return paper(15, "A beginner session on aquarium care", "Practical learning and animal care", text, [
    completion("flow-chart", [
      ["First, check the ___.", "temperature", "First, check the temperature.", "Bước đầu tiên là kiểm tra temperature."],
      ["Then leave fresh tap water for ___.", "one night", "Then leave fresh tap water for one night before using it.", "Theo hướng dẫn trong bài, để nước máy mới trong one night.", ["1 night"]],
      ["Before pouring, find a clean ___.", "jug", "Before pouring any water, find a clean jug.", "Trước khi rót nước, tìm một chiếc jug sạch."],
    ]),
    { questions: [
      choice("What does today's fee include?", "all the tools", ["a fish to take home", "a new aquarium light"], "There is no need to buy equipment for today because the fee includes all the tools.", "Phí đã gồm toàn bộ dụng cụ dùng trong buổi học, không gồm cá hay đèn mới.", 2),
      choice("Why should ordinary soap be kept away?", "it can harm the fish", ["it makes the glass too dark", "it causes the tools to rust"], "We will also explain why ordinary soap is kept away from the tanks: it can harm the fish.", "Lý do được nêu là xà phòng có thể gây hại cho cá.", 1),
    ] },
    matching("Match each helper with their job. One option is extra.",
      ["repairs the lights", "prepares the food", "cleans the outside glass", "checks the water level"], [
        ["Nina", "checks the water level", "Nina checks the water level.", "Nina kiểm tra mực nước."],
        ["Omar", "prepares the food", "Omar prepares the food.", "Omar chuẩn bị thức ăn và hướng dẫn đo lượng nhỏ."],
        ["Beth", "cleans the outside glass", "Beth cleans the outside glass.", "Beth vệ sinh mặt kính bên ngoài, không chạm vào bên trong bể."],
      ]),
  ]);
}

function memoryDay(): StoredContent {
  const text = `Welcome to our neighbourhood memory day. Local residents have brought photographs and stories about the streets where they grew up. We have arranged three work desks so that visitors can choose what they want to do. At the Window Desk, you can scan photographs. At the Long Desk, you can label photographs. At the Small Desk, you can record memories. Repairing cameras is not one of today's activities, but the library has a separate guide to repair services.

The afternoon session starts at 1:30. Please come a little early if you need help choosing a desk. Each recording may last a maximum of six minutes. This gives everyone time to speak and keeps the files easy for volunteers to organise. A helper will explain the equipment before the recording begins.

You keep all your original photographs. Volunteers will make a digital copy if you agree, and you can decide which pictures are included in the neighbourhood collection. Please do not leave valuable albums at the centre overnight. We cannot provide secure storage after the event has finished.

We ask you to write names clearly because future readers need to identify the people. A picture can be interesting even when its date is uncertain, but please tell us what you know rather than guess. Next month's event will focus on local shops. We hope to hear from former shop workers as well as customers. If you would like to contribute, leave a contact number with the welcome volunteer before going home.`;
  return paper(16, "Contributing to a neighbourhood collection", "Community history and volunteering", text, [
    matching("Match each desk with its activity. One option is extra.",
      ["record memories", "repair cameras", "label photographs", "scan photographs"], [
        ["Window Desk", "scan photographs", "At the Window Desk, you can scan photographs.", "Window Desk dùng để quét ảnh thành bản số."],
        ["Long Desk", "label photographs", "At the Long Desk, you can label photographs.", "Long Desk dùng để ghi chú nhận diện ảnh."],
        ["Small Desk", "record memories", "At the Small Desk, you can record memories.", "Small Desk dùng để thu âm các ký ức kể lại."],
      ]),
    completion("note", [
      ["Afternoon session starting time", "1:30", "The afternoon session starts at 1:30.", "1:30 buổi chiều tương đương 13:30.", ["13:30", "one thirty", "half past one"]],
      ["Maximum recording length in minutes", "six", "Each recording may last a maximum of six minutes.", "Mỗi lượt thu âm kéo dài tối đa sáu phút.", ["6"]],
    ]),
    { questions: [
      choice("What happens to visitors' original photographs?", "You keep all your original photographs", ["They stay at the centre overnight", "They are sent to a repair service"], "You keep all your original photographs.", "Người tham gia giữ bản gốc; tình nguyện viên chỉ tạo bản số khi được đồng ý.", 1),
      choice("Why should names be written clearly?", "future readers need to identify the people", ["the event is choosing a handwriting winner", "volunteers want to print new identity cards"], "We ask you to write names clearly because future readers need to identify the people.", "Tên rõ giúp người xem sau này xác định các nhân vật trong ảnh.", 2),
      choice("What is the subject of next month's event?", "local shops", ["new cameras", "school sports"], "Next month's event will focus on local shops.", "Sự kiện tháng tới tập trung vào các cửa hàng địa phương.", 0),
    ] },
  ]);
}

export function tenBatchListeningA(): StoredContent[] {
  return [printMorning(), filmHouse(), theatreHelpers(), aquariumCare(), memoryDay()];
}
