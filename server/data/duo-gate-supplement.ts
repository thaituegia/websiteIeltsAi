import { validateContentStructure } from "../../shared/content-visuals";
import type { ContentKind, StoredContent, StoredQuestion } from "../../shared/types";

/** Three additional, server-only Gate sittings. Existing immutable papers and
 * audio scripts are deliberately left untouched. These sources are fictional
 * teaching scenarios, not accounts of real organisations or research. */
export const SUPPLEMENT_VERSION = "duo-gate-20261110-v1";
const authoredAt = "2026-11-10T00:00:00.000Z";
const paperId = (skill: ContentKind, sitting: number) => `duo-private-${skill}-lesson-30-extra-20261110-${sitting}`;
export const NEW_DUO_GATE_LISTENING_IDS = [paperId("listening", 1), paperId("listening", 2), paperId("listening", 3)] as const;

type QuestionInput = Omit<StoredQuestion, "id" | "number" | "sectionIndex">;
function paper(skill: ContentKind, sitting: number, title: string, topic: string,
  text: string, rows: QuestionInput[]): StoredContent {
  const id = paperId(skill, sitting);
  const content: StoredContent = {
    id, skill, title, topic, band: 3, cefr: "A2", testType: "both", format: "lesson",
    description: "Đề mới dành riêng cho lượt kiểm tra mốc 3.0 của lộ trình Duo.",
    durationMinutes: skill === "reading" ? 18 : skill === "listening" ? 12 : 15,
    sections: [{ id: `${id}-section-1`, title, text,
      ...(skill === "listening" ? { dialogue: [{ speaker: "Narrator", accent: "british" as const, text }] } : {}),
      instructions: skill === "listening"
        ? "Listen to the announcement and complete the notes. The transcript opens after submission."
        : skill === "grammar" ? "Choose the one option that correctly completes each sentence."
          : "Read the passage and answer all eight questions. Use only the information in the passage.",
    }],
    questions: rows.map((row, index) => ({ ...row, id: `${id}-q-${index + 1}`, number: index + 1, sectionIndex: 0 })),
    vocabularyIds: [], tags: ["duo-exclusive", "gate-assessment", "gate-supplement-20261110"],
    source: "authored", quality: "authored-unreviewed", createdAt: authoredAt,
    estimatedDifficulty: { band: 3, cefr: "A2", basis: "Độ khó A2 mục tiêu của học liệu tự biên soạn; chưa hiệu chuẩn bằng kết quả thi thật." },
    provenance: { method: "authored", version: SUPPLEMENT_VERSION, generatedAt: authoredAt },
    review: { status: "structural-checks-passed", checks: ["new-private-source", "numbered-questions", "answer-word-limits", ...(skill === "grammar" ? ["single-correct-option"] : ["literal-evidence"]), ...(skill === "listening" ? ["single-bounded-listening-turn"] : [])], limitations: ["Chưa được giám khảo độc lập thẩm định hoặc hiệu chuẩn band IELTS."] },
  };
  // Listening completion blocks are attached by listening() before validation.
  if (skill !== "listening") validateContentStructure(content);
  return content;
}
const short = (prompt: string, answer: string, evidence: string, wordLimit: number, explanation: string, acceptedAnswers?: string[]): QuestionInput => ({
  type: "text", questionType: "short-answer", prompt, answer, evidence, wordLimit,
  ...(acceptedAnswers ? { acceptedAnswers } : {}),
  explanation, subskill: "locating-specific-information",
});
const choice = (prompt: string, answer: string, distractors: string[], evidence: string, explanation: string, rotation = 0): QuestionInput => {
  const options = [answer, ...distractors];
  return { type: "choice", questionType: "multiple-choice", prompt, answer,
    options: [...options.slice(rotation), ...options.slice(0, rotation)], evidence,
    explanation, subskill: "understanding-stated-purpose" };
};
const statement = (prompt: string, answer: "TRUE" | "FALSE" | "NOT GIVEN", evidence: string, explanation: string): QuestionInput => ({
  type: "true-false", questionType: "true-false-not-given", prompt, answer, evidence,
  explanation, subskill: "distinguishing-stated-and-unstated-information",
});

function readingOne(): StoredContent {
  const text = `The bread shelf at Linden Court

Linden Court is a small block of flats near the town centre. Last winter, one resident, Mariam, noticed that several neighbours threw away bread at the end of the week. They often bought more than they could eat. Mariam suggested a bread shelf where people could leave fresh bread for other residents. Her aim was to reduce waste, rather than to sell food or raise money.

The shelf opened in February. It stands beside the laundry room, where many residents already go each week. People can leave bread there between eight and ten in the morning. The bread must be in a clean paper bag, with the date written clearly on the outside. Bread with meat or cream is not accepted because the shelf has no fridge.

Two volunteers check the shelf every morning. They remove damaged bags and wipe the wood with a clean cloth. They do not ask who has taken the bread. Anyone living in the block may help themselves, and there is no limit based on a person's income. Visitors from other buildings cannot use the shelf because the volunteers can only manage a small amount of food.

After six weeks, the volunteers asked residents what they thought. Some said that the shelf helped them avoid an extra trip to a shop. Others enjoyed meeting a neighbour while collecting bread. However, a few people could not visit during the morning hours because they were at work. The volunteers plan to test an evening collection time next month. They will keep the morning service until they know whether the new time is useful.`;
  return paper("reading", 1, "Reading kiểm tra mốc 3.0 · Bánh mì ở Linden Court", "Food and neighbours", text, [
    choice("Why did Mariam suggest the bread shelf?", "To reduce food waste", ["To raise money for the building", "To start a bakery", "To attract visitors to the flats"], "Her aim was to reduce waste, rather than to sell food or raise money.", "Mục đích được nêu trực tiếp là giảm lãng phí thực phẩm; không phải bán bánh hay gây quỹ.", 1),
    short("In which month did the shelf open? Write ONE WORD from the passage.", "February", "The shelf opened in February.", 1, "Câu đầu đoạn hai nêu tháng bắt đầu là February."),
    short("Which room is the shelf beside? Write NO MORE THAN TWO WORDS from the passage.", "laundry room", "It stands beside the laundry room, where many residents already go each week.", 2, "Kệ nằm cạnh laundry room, không phải bên trong phòng đó."),
    short("What must people write on the bag? Write ONE WORD from the passage.", "date", "The bread must be in a clean paper bag, with the date written clearly on the outside.", 1, "Thông tin cần ghi ngoài túi là ngày, date."),
    statement("The shelf accepts bread containing cream.", "FALSE", "Bread with meat or cream is not accepted because the shelf has no fridge.", "Bài nói rõ bánh có cream không được nhận, trái với nhận định."),
    statement("All residents of the block may take bread, whatever their income.", "TRUE", "Anyone living in the block may help themselves, and there is no limit based on a person's income.", "Mọi cư dân trong tòa nhà đều được lấy bánh, không có điều kiện thu nhập."),
    statement("More than half of the residents answered the volunteers' questions.", "NOT GIVEN", "After six weeks, the volunteers asked residents what they thought.", "Bài có việc hỏi ý kiến sau sáu tuần nhưng không cho biết bao nhiêu người trả lời hoặc tỷ lệ so với toàn bộ cư dân."),
    choice("What will the volunteers test next month?", "An evening collection time", ["A payment system", "A larger fridge", "A delivery service to other buildings"], "The volunteers plan to test an evening collection time next month.", "Kế hoạch mới là thử giờ lấy bánh buổi tối; giờ buổi sáng vẫn được giữ trong lúc thử.", 2),
  ]);
}

function readingTwo(): StoredContent {
  const text = `Students build a street-history trail

At Eastbank School, a class of fifteen-year-olds wanted to learn more about the streets around their school. Their teacher suggested making a short history trail for local families. The students chose six stops within walking distance. These included a former cinema, a water pump and the oldest shop in the street. They decided not to include the town's large museum because it was too far away for the planned route.

The class worked in pairs. Each pair researched one stop by reading old newspapers and speaking to people who remembered the area. A retired shopkeeper showed them a photograph of the street before cars were common. The students used a copy in their leaflet and returned the original photograph to her.

At first, the leaflet contained long paragraphs with many dates. The class tested it with a group of younger children, who found the details difficult to follow. The students then shortened the text and added a simple question at each stop. The questions asked walkers to look carefully at a building or an object, rather than remember a date.

The finished trail takes about forty minutes. Families can collect a free leaflet from the school office on weekdays. On Saturdays, copies are available at the corner bakery. There is no phone app: the class wanted people to look at the street instead of a screen. The route uses public pavements, and walkers do not need to enter any building.

The teacher was pleased that the project gave students a reason to listen to older residents. The class will check the route again in September because road repairs may change access to one stop. They have not decided whether to make a second trail.`;
  return paper("reading", 2, "Reading kiểm tra mốc 3.0 · Tuyến tìm hiểu lịch sử khu phố", "Local history and school projects", text, [
    choice("Why was the town museum left out of the trail?", "It was too far from the planned route", ["Its tickets were expensive", "It was closed for repairs", "The students had already visited it"], "They decided not to include the town's large museum because it was too far away for the planned route.", "Lý do duy nhất được nêu là bảo tàng quá xa tuyến đường dự kiến.", 3),
    short("What did the retired shopkeeper show the students? Write NO MORE THAN TWO WORDS from the passage.", "a photograph", "A retired shopkeeper showed them a photograph of the street before cars were common.", 2, "Người chủ tiệm đã nghỉ hưu cho xem a photograph; đáp án photograph cũng diễn đạt đúng vật được hỏi.", ["photograph"]),
    statement("The students kept the original photograph.", "FALSE", "The students used a copy in their leaflet and returned the original photograph to her.", "Học sinh chỉ dùng bản sao, còn ảnh gốc đã trả lại chủ sở hữu."),
    choice("Why did the students change their first leaflet?", "Younger children found it difficult to follow", ["The printer could not print photographs", "Older residents asked for more dates", "The school office lost the original"], "The class tested it with a group of younger children, who found the details difficult to follow.", "Các em nhỏ thấy nội dung khó theo dõi, nên học sinh rút ngắn bài và thêm câu hỏi quan sát.", 1),
    short("Where can families get a leaflet on Saturdays? Write NO MORE THAN THREE WORDS from the passage.", "the corner bakery", "On Saturdays, copies are available at the corner bakery.", 3, "Thứ Bảy nhận tờ hướng dẫn tại the corner bakery, khác với các ngày trong tuần.", ["corner bakery"]),
    statement("People can finish the trail without going inside a building.", "TRUE", "The route uses public pavements, and walkers do not need to enter any building.", "Người đi chỉ dùng vỉa hè công cộng, không cần vào tòa nhà nào."),
    statement("The teacher has lived in Eastbank for more than ten years.", "NOT GIVEN", "The teacher was pleased that the project gave students a reason to listen to older residents.", "Bài nêu cảm nhận của giáo viên nhưng không nêu nơi cư trú hoặc thời gian sống ở đó."),
    short("In which month will the class check the route again? Write ONE WORD from the passage.", "September", "The class will check the route again in September because road repairs may change access to one stop.", 1, "Lớp sẽ kiểm tra lại tuyến đường trong September do việc sửa đường có thể ảnh hưởng lối đi."),
  ]);
}

function readingThree(): StoredContent {
  const text = `A quieter hour at Brookside Pool

Brookside Pool is usually busy with school groups, swimming lessons and families. For some visitors, the music and loud announcements made a visit uncomfortable. Pool manager Jo asked a small group of these visitors what would help. They did not want a separate building or special lessons. They wanted a time when they could swim in a calmer place.

In April, the pool began a quiet hour every Thursday. The session runs from two until three in the afternoon, when no school groups are booked. During this hour, the music is turned off. Staff speak directly to swimmers if they need to give information, instead of using the loudspeaker. Safety alarms continue to operate as normal, and a trained lifeguard remains beside the water.

The pool admits no more than twenty swimmers during the quiet hour. Visitors can book a place by telephone or at the front desk. An online booking system is also available, but nobody has to use it. Entry costs the same as an ordinary afternoon swim. People who already have a monthly membership do not pay an extra fee.

Before the first session, staff moved a row of metal chairs away from the changing rooms because they made a loud noise when people pulled them across the floor. They also put a picture guide near the entrance. It shows the way to the lockers, showers and pool, so first-time visitors can find their way without asking for help.

After a month, Jo received encouraging comments, but she said that the session would not suit everyone. Some visitors could only come after work. She will ask about possible evening times before changing the timetable. For now, the Thursday session will continue at its usual time.`;
  return paper("reading", 3, "Reading kiểm tra mốc 3.0 · Giờ yên tĩnh ở hồ bơi Brookside", "Leisure and accessibility", text, [
    choice("What did the visitors ask the pool manager to provide?", "A calmer time for swimming", ["A new swimming building", "Free swimming lessons", "Longer school sessions"], "They wanted a time when they could swim in a calmer place.", "Nhóm khách muốn một khoảng thời gian bơi yên tĩnh hơn, không yêu cầu công trình hay lớp học mới.", 2),
    short("On which day is the quiet hour? Write ONE WORD from the passage.", "Thursday", "In April, the pool began a quiet hour every Thursday.", 1, "Lịch cố định của giờ yên tĩnh là Thursday."),
    statement("Safety alarms are turned off during the quiet hour.", "FALSE", "Safety alarms continue to operate as normal, and a trained lifeguard remains beside the water.", "Chuông an toàn vẫn hoạt động bình thường; chỉ nhạc và thông báo thường qua loa được điều chỉnh."),
    short("What is the largest number of swimmers allowed during the session? Write ONE WORD from the passage.", "twenty", "The pool admits no more than twenty swimmers during the quiet hour.", 1, "No more than twenty là tối đa hai mươi người.", ["20"]),
    statement("Visitors can book a place without using the internet.", "TRUE", "Visitors can book a place by telephone or at the front desk.", "Có thể đặt qua điện thoại hoặc quầy; sử dụng hệ thống trực tuyến không bắt buộc."),
    statement("Most visitors to the quiet hour have a monthly membership.", "NOT GIVEN", "People who already have a monthly membership do not pay an extra fee.", "Bài nói quy định phí đối với người có thẻ tháng nhưng không cho biết tỷ lệ người có thẻ tham gia."),
    short("What did staff put near the entrance to help new visitors? Write NO MORE THAN THREE WORDS from the passage.", "a picture guide", "They also put a picture guide near the entrance.", 3, "A picture guide chỉ đường đến các khu vực, giúp khách mới tự tìm lối.", ["picture guide"]),
    choice("What will Jo do before changing the timetable?", "Ask about possible evening times", ["Close the Thursday session", "Remove the online booking system", "Increase the membership price"], "She will ask about possible evening times before changing the timetable.", "Jo sẽ hỏi ý kiến về các giờ buổi tối trước khi quyết định thay đổi lịch.", 3),
  ]);
}

type ListeningFact = readonly [label: string, answer: string, evidence: string, alternatives?: string[]];
function listening(sitting: number, title: string, topic: string, text: string, facts: ListeningFact[]): StoredContent {
  const id = paperId("listening", sitting), blockId = `${id}-notes`;
  const instructions = "Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.";
  const content = paper("listening", sitting, title, topic, text, facts.map(([label, answer, evidence, alternatives]) => ({
    type: "text", questionType: "note-completion", prompt: `${label}. ${instructions}`,
    answer, evidence, wordLimit: 3, allowNumbers: true, blockId,
    ...(alternatives ? { acceptedAnswers: alternatives } : {}),
    explanation: "Nghe chi tiết được người thông báo xác nhận trong câu trích dẫn; giữ đúng giới hạn từ và số.",
    subskill: "listening-for-practical-details",
  })));
  content.sections[0]!.questionBlocks = [{ id: blockId, type: "note", title: "Information for participants", instructions,
    questionNumbers: facts.map((_, index) => index + 1),
    text: facts.map(([label], index) => `${label}: {{${index + 1}}}`).join("\n"),
  }];
  validateContentStructure(content);
  return content;
}

function listeningOne(): StoredContent {
  const text = `Hello, and thank you for joining our kite-making morning. I am going to explain the arrangements, so please have your information sheet ready. The event is on Saturday. We chose a weekend so that children and adults can come together. You do not need to have made a kite before, and our helpers will explain each step slowly.

We will meet at Mill Hall. This is the small building opposite the bus stop, rather than the larger sports centre along the road. The activity starts at 10:15. Please arrive a little early so that everyone can sit down before the first demonstration begins. We will finish before lunch, and there will be a short break during the morning.

The price is 12 pounds for each person making a kite. This includes the frame, paper and a handle. Please bring some thin string from home. We have scissors and glue at the hall, so there is no need to buy these. Children must work with an adult when they use the scissors.

When you arrive, look for the blue folder on the welcome table. Write your name on the list inside it. Please use the side door because a different group is using the main entrance. A helper will stand outside to show you the way.

Finally, tell us by Friday if you cannot attend. We can then offer your place to someone on the waiting list. Thank you, and we look forward to seeing your designs.`;
  return listening(1, "Making a kite at Mill Hall", "Creative activities", text, [
    ["Day of the event", "Saturday", "The event is on Saturday."],
    ["Meeting place", "Mill Hall", "We will meet at Mill Hall."],
    ["Starting time", "10:15", "The activity starts at 10:15.", ["ten fifteen", "quarter past ten"]],
    ["Price in pounds per kite maker", "12", "The price is 12 pounds for each person making a kite.", ["twelve"]],
    ["Material to bring from home", "thin string", "Please bring some thin string from home."],
    ["Item containing the arrival list", "blue folder", "When you arrive, look for the blue folder on the welcome table. Write your name on the list inside it."],
    ["Entrance to use", "side door", "Please use the side door because a different group is using the main entrance."],
    ["Last day to report that you cannot attend", "Friday", "Finally, tell us by Friday if you cannot attend."],
  ]);
}

function listeningTwo(): StoredContent {
  const text = `Welcome to the toy hospital. We repair favourite toys so that children can enjoy them again. Some visitors bring a teddy bear with a missing ear, while others bring a wooden train with a loose wheel. Today I will explain the arrangements for our next volunteer morning. You do not need previous repair experience because an experienced helper will work with every new volunteer.

Our next session is on Wednesday. It is a morning session, and it is separate from the public drop-off time in the afternoon. Please come to Room Four at the community centre. The room is on the ground floor, close to the toilets. We begin at 9:30, so please be seated before then for a short safety talk.

Bring a cloth bag for carrying any toys that you take to a work table. We supply all the tools, and nobody should bring their own electrical equipment. For this session, volunteers must be at least 18 years old. Younger people can visit the display with an adult during the afternoon, but they cannot join the repair team.

When a toy is ready to collect, place it in one of the plastic boxes beside the window. Then put a green sticker on its card so the collection team knows the repair is finished. Please do not write directly on the toy.

Before you leave, return your visitor badge to reception. This helps the centre check who is still in the building. Thank you for giving your time to the toy hospital.`;
  return listening(2, "A volunteer morning at the toy hospital", "Volunteering and repair", text, [
    ["Day of the volunteer session", "Wednesday", "Our next session is on Wednesday."],
    ["Room at the community centre", "Room Four", "Please come to Room Four at the community centre.", ["Room 4", "Four", "4"]],
    ["Starting time", "9:30", "We begin at 9:30, so please be seated before then for a short safety talk.", ["09:30", "nine thirty", "half past nine"]],
    ["Item to bring for carrying toys", "cloth bag", "Bring a cloth bag for carrying any toys that you take to a work table."],
    ["Minimum volunteer age in years", "18", "For this session, volunteers must be at least 18 years old.", ["eighteen"]],
    ["Containers for repaired toys", "plastic boxes", "When a toy is ready to collect, place it in one of the plastic boxes beside the window."],
    ["Item to put on the card after a repair", "green sticker", "Then put a green sticker on its card so the collection team knows the repair is finished."],
    ["Place to return your visitor badge", "reception", "Before you leave, return your visitor badge to reception."],
  ]);
}

function listeningThree(): StoredContent {
  const text = `Good morning. Here is some information about our family photo trail. This is a walking activity, and you do not need an expensive camera. A simple phone camera is fine. The aim is to look closely at familiar places and find details that people often walk past. Families work together, so children should stay with the adults in their group throughout the activity.

The trail takes place on Sunday. Please collect your activity pack at the old market. Our table will be under the clock, where it is easy to find us. Pack collection starts at 11:45. You can come later, but we suggest allowing enough time to finish before the museum closes.

Each family pays six pounds for a pack. The fee covers the activity sheets and a small prize at the end. You will also receive a printed map. Please follow this map rather than a route on your phone, because one narrow lane is closed at the moment.

The first photograph should show the red bridge. You can see it clearly from the public footpath, so there is no need to go down to the water. After that, follow the clues in the order on your sheet. We suggest allowing 90 minutes for the full walk, including time to stop and look around. You may take a rest whenever you need one.

When you finish, take your answer sheet to the museum desk. A member of staff will check it and give your family its prize. Enjoy the walk, and please be careful when crossing roads.`;
  return listening(3, "A family photo trail around town", "Family activities and places", text, [
    ["Day of the trail", "Sunday", "The trail takes place on Sunday."],
    ["Place to collect the activity pack", "old market", "Please collect your activity pack at the old market."],
    ["Time pack collection begins", "11:45", "Pack collection starts at 11:45.", ["eleven forty-five", "quarter to twelve"]],
    ["Price in pounds per family", "six", "Each family pays six pounds for a pack.", ["6"]],
    ["Item to follow instead of a phone route", "printed map", "You will also receive a printed map. Please follow this map rather than a route on your phone, because one narrow lane is closed at the moment."],
    ["Subject of the first photograph", "red bridge", "The first photograph should show the red bridge."],
    ["Suggested number of minutes for the walk", "90", "We suggest allowing 90 minutes for the full walk, including time to stop and look around.", ["ninety"]],
    ["Place to hand in the answer sheet", "museum desk", "When you finish, take your answer sheet to the museum desk."],
  ]);
}

type GrammarRow = readonly [stem: string, answer: string, d1: string, d2: string, d3: string, reason: string];
function grammar(sitting: number, title: string, topic: string, context: string, rows: GrammarRow[]): StoredContent {
  return paper("grammar", sitting, title, topic, context, rows.map(([stem, answer, d1, d2, d3, explanation], index) => ({
    ...choice(stem, answer, [d1, d2, d3], stem.replace("___", answer), explanation, (index + sitting) % 4),
    subskill: "grammar-in-context",
  })));
}

function grammarOne(): StoredContent {
  return grammar(1, "Grammar in context · A neighbourhood puppet show", "Arts and community",
    "A neighbourhood group is preparing a small puppet show in the meeting room. The notes describe the weekly practice, yesterday's preparation and the arrangements for visitors. Choose the option that makes each separate sentence grammatically correct.", [
      ["Nina ___ the puppets every Friday afternoon.", "paints", "paint", "painting", "to paint", "Nina là chủ ngữ số ít; every Friday chỉ thói quen nên dùng hiện tại đơn paints."],
      ["We ___ the stage curtains yesterday.", "washed", "wash", "washing", "washes", "Yesterday là mốc quá khứ đã kết thúc, cần quá khứ đơn washed."],
      ["The children are ___ a short song now.", "practising", "practise", "practised", "practises", "Are và now tạo thì hiện tại tiếp diễn: are practising."],
      ["There are three ___ behind the small stage.", "boxes", "box", "box's", "boxs", "Sau three cần số nhiều; box thêm -es thành boxes."],
      ["The first performance begins ___ Sunday morning.", "on", "at", "in", "to", "Dùng on với một ngày cụ thể, kể cả Sunday morning."],
      ["Please give the tickets to Sara. They are for ___.", "her", "she", "hers", "herself's", "Sau giới từ for cần đại từ tân ngữ her."],
      ["Can you ___ this chair closer to the door?", "move", "moves", "moved", "moving", "Sau can dùng động từ nguyên mẫu không to: move."],
      ["The new puppet is bigger ___ the old one.", "than", "as", "from", "that", "Bigger là so sánh hơn, nối với đối tượng sau bằng than."],
      ["We do not need ___ extra chairs today.", "any", "a", "an", "much", "Trong câu phủ định với danh từ đếm được số nhiều chairs, dùng any."],
      ["___ did the children put the music player?", "Where", "What", "Who", "Whose", "Cần hỏi vị trí đặt máy nghe nhạc nên dùng Where; What sẽ lặp đối tượng đã có trong câu."],
    ]);
}

function grammarTwo(): StoredContent {
  return grammar(2, "Grammar in context · A school uniform exchange", "School and reuse",
    "A school is holding a uniform exchange. Families bring clean clothes that their children no longer need and look for a suitable size. These separate sentences describe the preparation, the volunteers and the instructions at the exchange.", [
      ["Each jacket ___ a size label inside.", "has", "have", "having", "are", "Each jacket là chủ ngữ số ít, dùng has."],
      ["The volunteers ___ the tables at the moment.", "are arranging", "arranges", "arranged", "is arranging", "At the moment cần hiện tại tiếp diễn; volunteers số nhiều nên dùng are arranging."],
      ["My son ___ this shirt when he was smaller.", "wore", "wears", "wearing", "wear", "When he was smaller chỉ thời gian quá khứ; quá khứ của wear là wore."],
      ["We have ___ information about the available sizes.", "some", "many", "a", "an", "Information không đếm được; some information là cụm đúng, không dùng a/an hay many."],
      ["The shoes are ___ the table, next to the blue box.", "under", "between", "during", "into", "Under diễn tả vị trí dưới bàn; between cần hai mốc, during chỉ thời gian, into chỉ chuyển động."],
      ["This coat is too small. Is there a ___ one?", "larger", "large", "largest", "largely", "Cần áo lớn hơn chiếc này nên dùng tính từ so sánh hơn larger."],
      ["___ your daughter need a winter coat?", "Does", "Do", "Is", "Are", "Câu hỏi hiện tại đơn có động từ need và chủ ngữ số ít dùng Does."],
      ["These are our bags, and those are ___.", "theirs", "their", "them", "they", "Cuối câu không có danh từ theo sau nên cần đại từ sở hữu theirs."],
      ["Visitors must ___ the clothes clean before bringing them.", "keep", "keeps", "keeping", "kept", "Sau must dùng động từ nguyên mẫu keep."],
      ["The exchange is open ___ two hours this afternoon.", "for", "since", "at", "on", "For đi với khoảng thời gian two hours."],
    ]);
}

function grammarThree(): StoredContent {
  return grammar(3, "Grammar in context · Breakfast on a small ferry", "Travel and everyday services",
    "The crew of a small passenger ferry is preparing breakfast for an early sailing. Some sentences describe usual jobs, while others refer to this morning's tasks or yesterday's journey. Choose the one grammatically correct option for each sentence.", [
      ["The cook usually ___ bread before the first sailing.", "cuts", "cut", "cutting", "to cut", "The cook là ngôi ba số ít; usually chỉ thói quen nên dùng cuts."],
      ["There ___ six passengers in the café yesterday.", "were", "was", "is", "be", "Six passengers số nhiều và yesterday là quá khứ nên dùng were."],
      ["How ___ milk is left in the fridge?", "much", "many", "few", "several", "Milk không đếm được nên hỏi lượng bằng How much."],
      ["The passengers are waiting ___ their breakfast.", "for", "on", "at", "to", "Cấu trúc wait for something có nghĩa chờ một thứ gì đó."],
      ["I would like ___ egg and a piece of toast.", "an", "a", "many", "some", "Egg là danh từ đếm được số ít bắt đầu bằng âm nguyên âm nên dùng an."],
      ["The ferry leaves at seven, so please ___ late.", "do not be", "does not be", "not are", "are not be", "Câu mệnh lệnh phủ định dùng do not và động từ nguyên mẫu be."],
      ["My cup is empty. Could I have ___ tea, please?", "some more", "many more", "a few", "another a", "Tea không đếm được; some more tea là cách xin thêm trà phù hợp."],
      ["This tray belongs to Leo. It is ___ tray.", "his", "him", "he", "he's", "Trước danh từ tray cần tính từ sở hữu his."],
      ["The café was quieter today ___ it was yesterday.", "than", "as", "then", "that", "Quieter là so sánh hơn; cấu trúc đúng là quieter ... than."],
      ["We ___ the breakfast menu last night.", "changed", "change", "changes", "changing", "Last night là mốc quá khứ đã kết thúc nên dùng changed."],
    ]);
}

/** New content only; callers append it to the private inventory, never public practice. */
export function newDuoGatePapers(): StoredContent[] {
  return [readingOne(), listeningOne(), grammarOne(), readingTwo(), listeningTwo(), grammarTwo(), readingThree(), listeningThree(), grammarThree()];
}
