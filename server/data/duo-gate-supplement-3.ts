import { validateContentStructure } from "../../shared/content-visuals";
import type { ContentKind, StoredContent, StoredQuestion } from "../../shared/types";
import { fiveSupplementListeningPapers } from "./duo-gate-supplement-3-listening";

/** Five further private Gate sittings, authored as fictional teaching sources.
 * Previous batches keep their original IDs, content and paid audio scripts. */
export const FIVE_SUPPLEMENT_VERSION = "duo-gate-20261110-v3";
const authoredAt = "2026-11-10T00:00:00.000Z";
const paperId = (skill: ContentKind, sitting: number) => "duo-private-" + skill + "-lesson-30-extra-20261110-" + sitting;
export const FIVE_DUO_GATE_LISTENING_IDS = [
  paperId("listening", 7), paperId("listening", 8), paperId("listening", 9), paperId("listening", 10), paperId("listening", 11),
] as const;

type QuestionInput = Omit<StoredQuestion, "id" | "number" | "sectionIndex">;
function paper(skill: "reading" | "grammar", sitting: number, title: string, topic: string,
  text: string, rows: QuestionInput[]): StoredContent {
  const id = paperId(skill, sitting);
  const result: StoredContent = {
    id, skill, title, topic, band: 3, cefr: "A2", testType: "both", format: "lesson",
    description: "Bộ bổ sung thứ ba dành riêng cho lượt kiểm tra mốc 3.0 của lộ trình Duo.",
    durationMinutes: skill === "reading" ? 18 : 15,
    sections: [{ id: id + "-section-1", title, text,
      instructions: skill === "grammar" ? "Choose the one option that correctly completes each sentence."
        : "Read the passage and answer all eight questions. Use only the information in the passage." }],
    questions: rows.map((row, index) => ({ ...row, id: id + "-q-" + (index + 1), number: index + 1, sectionIndex: 0 })),
    vocabularyIds: [], tags: ["duo-exclusive", "gate-assessment", "gate-supplement-20261110-v3"],
    source: "authored", quality: "authored-unreviewed", createdAt: authoredAt,
    estimatedDifficulty: { band: 3, cefr: "A2", basis: "Độ khó A2 mục tiêu của học liệu tự biên soạn; chưa hiệu chuẩn bằng kết quả thi thật." },
    provenance: { method: "authored", version: FIVE_SUPPLEMENT_VERSION, generatedAt: authoredAt },
    review: { status: "structural-checks-passed", checks: ["new-private-source", "numbered-questions", "answer-word-limits",
      ...(skill === "grammar" ? ["single-correct-option"] : ["literal-evidence"])],
      limitations: ["Chưa được giám khảo độc lập thẩm định hoặc hiệu chuẩn band IELTS."] },
  };
  validateContentStructure(result);
  return result;
}
const short = (prompt: string, answer: string, evidence: string, wordLimit: number, explanation: string, acceptedAnswers?: string[]): QuestionInput => ({
  type: "text", questionType: "short-answer", prompt, answer, evidence, wordLimit,
  ...(acceptedAnswers ? { acceptedAnswers } : {}), explanation, subskill: "locating-specific-information",
});
const choice = (prompt: string, answer: string, distractors: string[], evidence: string, explanation: string, rotation = 0): QuestionInput => {
  const options = [answer, ...distractors];
  return { type: "choice", questionType: "multiple-choice", prompt, answer,
    options: [...options.slice(rotation), ...options.slice(0, rotation)], evidence, explanation, subskill: "understanding-stated-purpose" };
};
const statement = (prompt: string, answer: "TRUE" | "FALSE" | "NOT GIVEN", evidence: string, explanation: string): QuestionInput => ({
  type: "true-false", questionType: "true-false-not-given", prompt, answer, evidence, explanation,
  subskill: "distinguishing-stated-and-unstated-information",
});

function readingSeven(): StoredContent {
  const text = [
    "Returning lost objects at Bramley Sports Centre",
    "People sometimes leave jackets, water bottles and other small things at Bramley Sports Centre. In the past, staff put everything into one large cupboard. A visitor looking for a red jacket had to wait while someone searched through many different objects. The centre wanted to return things more quickly without making visitors enter the staff area.",
    "In January, staff introduced a simple picture list. They photograph ordinary items and put the pictures on the centre's website. A person can look at the list before making a journey. Phones and jewellery are not shown online. These valuable objects stay in a locked drawer, and their owners must describe them to a member of staff.",
    "Each ordinary item goes into a clear bag. Staff write the date on the bag and give it a number. The bags are kept in the staff room, arranged by the week in which they were found. A visitor who recognises a picture should write down its number. This helps the receptionist find the right bag.",
    "Visitors must collect their things in person. Staff do not send objects by post because the centre cannot provide a delivery service. When collecting something, a person is asked to describe one detail that is not clear in the picture. For example, there may be a small mark inside a jacket.",
    "After a month, staff found that the numbered bags made their work easier. However, some visitors did not use the internet. The centre will therefore put a paper copy of the picture list beside the front desk. Staff will update both versions every Friday. They hope this will help more people find their things.",
  ].join("\n\n");
  return paper("reading", 7, "Reading kiểm tra mốc 3.0 · Tìm đồ thất lạc ở Bramley", "Everyday services and lost property", text, [
    choice("What problem did the sports centre want to solve?", "Visitors waited while staff searched for lost objects", ["Visitors often entered the pool without paying", "The website could not accept new bookings", "Staff had nowhere to store sports equipment"], "A visitor looking for a red jacket had to wait while someone searched through many different objects.", "Vấn đề là khách phải chờ nhân viên tìm trong nhiều đồ vật, nên trung tâm muốn trả đồ nhanh hơn.", 2),
    short("In which month did staff introduce the picture list? Write ONE WORD from the passage.", "January", "In January, staff introduced a simple picture list.", 1, "Danh sách hình ảnh được áp dụng vào January."),
    short("What information do staff write on each bag, apart from its number? Write ONE WORD from the passage.", "date", "Staff write the date on the bag and give it a number.", 1, "Ngoài số nhận dạng, trên túi có date để sắp xếp theo tuần tìm thấy."),
    short("In which room are the bags kept? Write NO MORE THAN TWO WORDS from the passage.", "staff room", "The bags are kept in the staff room, arranged by the week in which they were found.", 2, "Các túi được giữ trong staff room; không phải ngay quầy lễ tân."),
    statement("Pictures of lost jewellery are included on the website.", "FALSE", "Phones and jewellery are not shown online.", "Điện thoại và trang sức không được đưa hình lên mạng, trái với nhận định."),
    statement("People have to collect their objects at the centre themselves.", "TRUE", "Visitors must collect their things in person.", "In person nghĩa là trực tiếp đến nhận, không nhận qua bưu điện."),
    statement("Water bottles are the objects most often left at the centre.", "NOT GIVEN", "People sometimes leave jackets, water bottles and other small things at Bramley Sports Centre.", "Bài liệt kê các loại đồ nhưng không so sánh loại nào bị bỏ quên nhiều nhất."),
    choice("What change will the centre make for people who do not use the internet?", "Put a paper picture list beside the front desk", ["Post every lost object to its owner", "Show valuable objects on the website", "Open the staff room to all visitors"], "The centre will therefore put a paper copy of the picture list beside the front desk.", "Giải pháp là bản danh sách hình ảnh bằng giấy gần quầy, phục vụ người không dùng internet.", 1),
  ]);
}

function readingEight(): StoredContent {
  const text = [
    "Shorter walks after the evening bus",
    "Willowbridge is a town with several long roads leading away from its centre. During the day, passengers on the local bus can usually walk easily from a normal stop to their homes. After dark, some people felt uncomfortable about the same walk. The bus company decided to test a service that allowed passengers to request an extra stopping place.",
    "The trial began in November on route seven. The service is available after eight in the evening. It does not change the streets used by the bus, and passengers still pay the ordinary fare. The extra stopping places are points that the company has already checked. They are between the normal stops and have enough space for people to get off safely.",
    "Passengers must tell the driver about their request when they get on the bus. Asking only when the bus reaches the required place may be too late. Drivers cannot stop at an unchecked location, even if it is closer to someone's front door. A leaflet explains the available places and gives each one a short name.",
    "At first, some passengers thought the bus would wait while they walked home. The leaflet now makes clear that the bus continues its journey as soon as they have got off. The driver does not leave the bus or accompany anyone. The service simply reduces the distance between the bus and the passenger's destination.",
    "The company will collect comments for six weeks. Paper forms are available in the library for people who do not want to use the online form. Before deciding whether to include another route, staff will check how much time the extra stops add to each journey. They want to keep the timetable useful for everyone.",
  ].join("\n\n");
  return paper("reading", 8, "Reading kiểm tra mốc 3.0 · Điểm xuống xe buýt buổi tối", "Public transport and evening journeys", text, [
    choice("Why did the company introduce extra stopping places?", "To reduce some passengers' walks after dark", ["To allow buses to use shorter roads", "To replace all the normal bus stops", "To increase the evening fare"], "After dark, some people felt uncomfortable about the same walk. The bus company decided to test a service that allowed passengers to request an extra stopping place.", "Dịch vụ nhằm rút ngắn quãng đường khách đi bộ sau khi xuống xe lúc trời tối.", 3),
    short("In which month did the trial begin? Write ONE WORD from the passage.", "November", "The trial began in November on route seven.", 1, "Thời điểm bắt đầu thử nghiệm là November."),
    short("What does a leaflet give each extra stopping place? Write NO MORE THAN THREE WORDS from the passage.", "a short name", "A leaflet explains the available places and gives each one a short name.", 3, "Mỗi điểm có a short name giúp khách nói rõ yêu cầu với tài xế.", ["short name"]),
    statement("Passengers pay a higher fare to use an extra stopping place.", "FALSE", "It does not change the streets used by the bus, and passengers still pay the ordinary fare.", "Khách vẫn trả giá vé thông thường, không phải giá cao hơn."),
    statement("Passengers should make their request when they board the bus.", "TRUE", "Passengers must tell the driver about their request when they get on the bus.", "When they get on the bus là lúc lên xe; yêu cầu không nên để đến sát điểm cần xuống."),
    statement("Most people using the service are older than sixty.", "NOT GIVEN", "The company will collect comments for six weeks.", "Bài không có số liệu về độ tuổi hoặc tỷ lệ người dùng trên sáu mươi."),
    short("Where can people get paper comment forms? Write NO MORE THAN TWO WORDS from the passage.", "the library", "Paper forms are available in the library for people who do not want to use the online form.", 2, "Mẫu góp ý bằng giấy có tại the library; library cũng đúng và trong giới hạn từ.", ["library"]),
    choice("What will staff check before adding another route?", "How much time the extra stops add to a journey", ["How many drivers live near the bus station", "Whether ordinary fares should be removed", "How many passengers own a computer"], "Before deciding whether to include another route, staff will check how much time the extra stops add to each journey.", "Cần đánh giá thời gian phát sinh để lịch xe vẫn phù hợp với mọi hành khách.", 1),
  ]);
}

function readingNine(): StoredContent {
  const text = [
    "Keeping a rain record at Moorfield School",
    "Children at Moorfield School often talked about the weather on their way into class. One pupil said that rain fell almost every day, while another thought that most mornings were dry. Their teacher suggested keeping a rain record. The aim was to compare their memories with observations, rather than decide who had the best memory.",
    "The project started in May. The class used a clear jar with straight sides and placed it on the grass behind the school. It stood away from the roof, because water falling from a roof could make the reading too high. The same jar stayed in the same place throughout the project.",
    "Two pupils checked the jar before the first lesson each morning. They read the level against a simple paper scale and wrote it in a shared notebook. After taking the reading, they emptied the jar and put it back. On a dry morning, they recorded zero rather than leaving the space empty. The teacher explained that an empty space could mean that nobody had checked.",
    "Pupils worked in different pairs so that everyone had a turn. They did not compare the amounts collected on different days until they had checked that each reading covered the same length of time. For example, a Monday reading included the whole weekend. They marked this clearly in the notebook instead of treating it as one ordinary day.",
    "At the end, the class made a wall chart showing the record. Some children were surprised by the number of dry days. Next term, the teacher plans to compare the school record with one from a nearby farm. She reminded the class that a short project could describe these particular weeks, but could not predict the weather for the following year.",
  ].join("\n\n");
  return paper("reading", 9, "Reading kiểm tra mốc 3.0 · Sổ đo mưa ở trường Moorfield", "School science and careful records", text, [
    choice("Why did the teacher suggest keeping a rain record?", "To compare pupils' memories with observations", ["To choose the pupil with the best memory", "To predict the weather for the next year", "To collect enough water for the school garden"], "The aim was to compare their memories with observations, rather than decide who had the best memory.", "Mục tiêu là đối chiếu điều các em nhớ với quan sát thực tế, không phải chọn người nhớ giỏi nhất.", 1),
    short("In which month did the project start? Write ONE WORD from the passage.", "May", "The project started in May.", 1, "Dự án bắt đầu vào May."),
    short("What container did the class use? Write NO MORE THAN THREE WORDS from the passage.", "a clear jar", "The class used a clear jar with straight sides and placed it on the grass behind the school.", 3, "Vật được dùng là a clear jar; clear jar cũng diễn tả đúng chiếc bình.", ["clear jar"]),
    short("Where did pupils write the readings? Write NO MORE THAN THREE WORDS from the passage.", "a shared notebook", "They read the level against a simple paper scale and wrote it in a shared notebook.", 3, "Các số đo được ghi vào a shared notebook để cả lớp cùng theo dõi.", ["shared notebook"]),
    statement("The pupils moved the jar to a different location every afternoon.", "FALSE", "The same jar stayed in the same place throughout the project.", "Chiếc bình được giữ nguyên vị trí trong suốt dự án, trái với nhận định."),
    statement("A dry morning was recorded with a zero.", "TRUE", "On a dry morning, they recorded zero rather than leaving the space empty.", "Các em ghi zero vào buổi sáng khô, thay vì để trống."),
    statement("The school bought the jar from a shop near the farm.", "NOT GIVEN", "The class used a clear jar with straight sides and placed it on the grass behind the school.", "Bài mô tả chiếc bình nhưng không cho biết nơi mua hoặc nguồn gốc của nó."),
    choice("What does the teacher plan to do next term?", "Compare the school record with a nearby farm's record", ["Move the jar onto the school roof", "Ask one pupil to take every reading", "Use the record to predict next year's weather"], "Next term, the teacher plans to compare the school record with one from a nearby farm.", "Kế hoạch tiếp theo là đối chiếu sổ ghi của trường với dữ liệu từ trang trại gần đó.", 2),
  ]);
}

function readingTen(): StoredContent {
  const text = [
    "Stories that people can hear by telephone",
    "The small library in Elmcombe wanted to reach people who could not visit the building easily. Some residents had poor eyesight, while others lived a long way from the library. A volunteer suggested a telephone story service. People would be able to hear a short recording without needing a computer or a special application.",
    "The service opened in August. Each fortnight, volunteers record two new stories. A caller presses a button to choose one of them. The recordings are short enough to hear during a quiet break, and callers may listen again if they wish. People do not have to give a library membership number to use the service.",
    "The telephone number is printed on a green bookmark. Copies are available at the library front desk and are also taken to the village lunch club. The bookmark explains the buttons in large writing. A volunteer first tested the instructions with people who had not used the service before, and changed one sentence that caused confusion.",
    "The readers choose stories carefully. A story with too many different characters can be difficult to follow when a listener cannot turn back a page. Volunteers therefore introduce the main characters clearly and leave a short pause between important parts. They record in a quiet room after the library closes, so ordinary conversations do not interrupt the reading.",
    "Staff can see how many calls the service receives, but they do not make a list of callers' names. The library asks for comments at the front desk or by letter. Several listeners have asked for poems as well as stories. Volunteers plan to include a short poem in the next recording, while keeping the two story choices. They will ask listeners whether this is a useful addition.",
  ].join("\n\n");
  return paper("reading", 10, "Reading kiểm tra mốc 3.0 · Nghe truyện qua điện thoại ở Elmcombe", "Libraries and accessible stories", text, [
    choice("Who was the telephone story service especially intended to reach?", "People who could not easily visit the library", ["Only people who already used a library app", "Children attending lessons in the building", "Readers who wanted to buy recording equipment"], "The small library in Elmcombe wanted to reach people who could not visit the building easily.", "Dịch vụ hướng tới người khó đến thư viện, gồm người nhìn kém hoặc ở xa.", 2),
    short("In which month did the service open? Write ONE WORD from the passage.", "August", "The service opened in August.", 1, "Dịch vụ bắt đầu hoạt động vào August."),
    short("What colour is the bookmark showing the number? Write ONE WORD from the passage.", "green", "The telephone number is printed on a green bookmark.", 1, "Số điện thoại được in trên dấu trang màu green."),
    short("Where in the library can people get the bookmark? Write NO MORE THAN TWO WORDS from the passage.", "front desk", "Copies are available at the library front desk and are also taken to the village lunch club.", 2, "Địa điểm trong thư viện là front desk, tức quầy tiếp đón."),
    statement("People need a library membership number before they can listen.", "FALSE", "People do not have to give a library membership number to use the service.", "Không cần cung cấp số thẻ thư viện để sử dụng dịch vụ."),
    statement("The volunteers record after the library has closed.", "TRUE", "They record in a quiet room after the library closes, so ordinary conversations do not interrupt the reading.", "Việc thu âm diễn ra sau giờ đóng cửa để tránh tiếng nói chuyện."),
    statement("All the volunteers reading the stories are retired teachers.", "NOT GIVEN", "Each fortnight, volunteers record two new stories.", "Bài chỉ gọi họ là tình nguyện viên, không nêu nghề nghiệp trước đây hoặc tình trạng nghỉ hưu."),
    choice("What will be added to the next recording?", "A short poem", ["A list of callers' names", "A third long story", "Instructions for buying a computer"], "Volunteers plan to include a short poem in the next recording, while keeping the two story choices.", "Bản thu tới thêm một bài thơ ngắn và vẫn giữ hai truyện để chọn.", 3),
  ]);
}

function readingEleven(): StoredContent {
  const text = [
    "A drying room for wet camping clothes",
    "Hawthorn Campsite stands close to a group of popular walking paths. Visitors often return from a walk with wet coats, even when the morning has been sunny. In a small tent, these coats can stay damp for a long time. The campsite owners decided to provide a drying room so that visitors could use their walking clothes again the next day.",
    "The room opened in April in a building that had once stored garden tools. It is behind reception, and visitors can enter it using the same card that opens the shower block. There is no extra charge. A notice asks everyone to close the door properly, because warm air escapes if the door is left open.",
    "Inside, there are numbered hooks and shelves. Visitors write their tent number on a label and attach it to each coat or bag. This makes it easier to tell similar items apart. Muddy boots must stay outside under the covered roof. The owners do not want mud from the paths to spread across the clean floor.",
    "A member of staff checks the room each morning. Visitors are asked to take dry clothes away before setting out for the day, leaving space for other people later. The room is intended for clothes and small bags, not for drying whole tents. Large tents would cover the hooks and prevent air from moving around the other items.",
    "During the first weeks, several visitors left empty bags on the shelves to reserve a space. Staff have now explained that spaces cannot be kept in this way. The campsite will test an extra row of hooks next month, but the owners want to make sure people can still move around comfortably. They will ask visitors for comments before making the change permanent.",
  ].join("\n\n");
  return paper("reading", 11, "Reading kiểm tra mốc 3.0 · Phòng hong đồ ở Hawthorn Campsite", "Camping and practical facilities", text, [
    choice("Why did the campsite provide a drying room?", "So visitors could use wet walking clothes again the next day", ["So visitors could rent larger tents", "To create a new place to store garden tools", "To encourage visitors to stay indoors all day"], "The campsite owners decided to provide a drying room so that visitors could use their walking clothes again the next day.", "Mục đích là giúp quần áo đi bộ khô để dùng tiếp vào ngày hôm sau.", 1),
    short("In which month did the room open? Write ONE WORD from the passage.", "April", "The room opened in April in a building that had once stored garden tools.", 1, "Phòng được mở vào April."),
    short("Which building is the drying room behind? Write ONE WORD from the passage.", "reception", "It is behind reception, and visitors can enter it using the same card that opens the shower block.", 1, "Phòng nằm phía sau reception, không phải sau khu nhà tắm."),
    short("What number must visitors put on the label? Write NO MORE THAN TWO WORDS from the passage.", "tent number", "Visitors write their tent number on a label and attach it to each coat or bag.", 2, "Thông tin nhận diện trên nhãn là tent number."),
    statement("The building was previously used to keep garden tools.", "TRUE", "The room opened in April in a building that had once stored garden tools.", "Had once stored garden tools cho biết công dụng cũ là nơi chứa dụng cụ làm vườn."),
    statement("Visitors can put muddy boots on the shelves inside the room.", "FALSE", "Muddy boots must stay outside under the covered roof.", "Ủng lấm bùn phải ở bên ngoài dưới mái che, không đặt trong phòng."),
    statement("Every coat dries within exactly two hours.", "NOT GIVEN", "A member of staff checks the room each morning.", "Bài không nêu thời gian cần để làm khô từng chiếc áo hoặc bảo đảm hai giờ."),
    choice("What will the campsite test next month?", "An extra row of hooks", ["A fee for using the shower card", "A storage space for whole tents", "A system of reserving shelves with empty bags"], "The campsite will test an extra row of hooks next month, but the owners want to make sure people can still move around comfortably.", "Kế hoạch thử nghiệm là thêm một hàng móc, đồng thời kiểm tra lối đi còn đủ rộng.", 2),
  ]);
}

type GrammarRow = readonly [stem: string, answer: string, d1: string, d2: string, d3: string, reason: string];
function grammar(sitting: number, title: string, topic: string, context: string, rows: GrammarRow[]): StoredContent {
  return paper("grammar", sitting, title, topic, context, rows.map(([stem, answer, d1, d2, d3, explanation], index) => ({
    ...choice(stem, answer, [d1, d2, d3], stem.replace("___", answer), explanation, (index + sitting) % 4),
    subskill: "grammar-in-context",
  })));
}
function grammarSeven(): StoredContent {
  return grammar(7, "Grammar in context · Ordering materials for an art class", "School and creative materials",
    "A teacher is checking materials for an art class. The notes describe usual jobs, yesterday's purchases and the instructions for today's activity. Choose the one option that makes each separate sentence correct.", [
      ["The teacher ___ the paint bottles every Monday.", "counts", "count", "counting", "to count", "The teacher là chủ ngữ số ít; every Monday chỉ thói quen nên dùng counts."],
      ["We ___ some new brushes yesterday.", "bought", "buy", "buying", "buys", "Yesterday chỉ quá khứ; quá khứ của buy là bought."],
      ["There is ___ paper in the blue cupboard.", "some", "many", "a", "an", "Paper chỉ vật liệu không đếm được trong câu này; dùng some paper."],
      ["Please put these two ___ beside the sink.", "brushes", "brush", "brush's", "brushs", "Sau two cần số nhiều; brush thêm -es thành brushes."],
      ["The pupils are ___ their pictures at the moment.", "finishing", "finish", "finished", "finishes", "Are và at the moment cần hiện tại tiếp diễn: are finishing."],
      ["The art club starts ___ four o'clock.", "at", "on", "in", "to", "Dùng at với một giờ cụ thể: at four o'clock."],
      ["You must ___ the lids after using the paint.", "close", "closes", "closed", "closing", "Sau must dùng động từ nguyên mẫu không to: close."],
      ["This paper is cheaper ___ the thick card.", "than", "as", "then", "from", "Cheaper là so sánh hơn và nối với đối tượng sau bằng than."],
      ["This pencil belongs to me. It is ___.", "mine", "my", "me", "I", "Cuối câu không có danh từ theo sau nên cần đại từ sở hữu mine."],
      ["We stayed inside ___ it was raining.", "because", "because of", "during", "despite", "Sau chỗ trống là mệnh đề it was raining, nên dùng because; because of và despite cần cụm danh từ."],
    ]);
}
function grammarEight(): StoredContent {
  return grammar(8, "Grammar in context · Helping in the station café", "Work and everyday services",
    "A new helper is learning the routine in a small station café. Some sentences describe daily work, while others refer to yesterday or to tasks in progress. Choose the option that fits the grammar and the time reference.", [
      ["The café ___ breakfast from six every morning.", "serves", "serve", "serving", "to serve", "The café là chủ ngữ số ít; every morning chỉ hiện tại đơn, dùng serves."],
      ["The last customer ___ at eight yesterday evening.", "left", "leaves", "leaving", "leave", "Yesterday evening là quá khứ; quá khứ của leave là left."],
      ["How ___ coffee is in the large pot?", "much", "many", "few", "several", "Coffee trong câu này không đếm được nên hỏi bằng How much."],
      ["The cups are clean, but we need to dry ___.", "them", "they", "their", "theirs", "Sau động từ dry cần đại từ tân ngữ them thay cho the cups."],
      ["Please ___ the price on the board.", "write", "writes", "wrote", "writing", "Câu mệnh lệnh sau please dùng động từ nguyên mẫu write."],
      ["The helper is ___ a sandwich now.", "making", "make", "made", "makes", "Is và now cần cấu trúc hiện tại tiếp diễn is making."],
      ["This bag contains three ___.", "loaves", "loaf", "loafs", "loaf's", "Sau three cần số nhiều; loaf có số nhiều là loaves."],
      ["We have not got ___ clean spoons left.", "any", "much", "a", "an", "Spoons là danh từ số nhiều; trong câu phủ định dùng any clean spoons."],
      ["A small cup is lighter ___ a large mug.", "than", "as", "then", "from", "Lighter là so sánh hơn nên dùng than."],
      ["The café is closed ___ Sundays.", "on", "at", "in", "to", "Dùng on với ngày trong tuần: on Sundays."],
    ]);
}
function grammarNine(): StoredContent {
  return grammar(9, "Grammar in context · Postcards for new neighbours", "Neighbourhoods and communication",
    "Residents are preparing postcards to welcome families moving into their street. They check names, write short messages and arrange deliveries. Complete each sentence using its own time words and grammatical structure.", [
      ["Lena usually ___ the welcome cards by hand.", "writes", "write", "writing", "to write", "Lena là ngôi ba số ít; usually chỉ thói quen nên dùng writes."],
      ["We ___ the first cards last week.", "sent", "send", "sending", "sends", "Last week chỉ quá khứ; quá khứ của send là sent."],
      ["There ___ a small map on the back of each card.", "is", "are", "be", "were", "A small map là số ít, dùng There is."],
      ["These cards are for the new family. Please give the cards to ___.", "them", "they", "their", "theirs", "Sau giới từ to cần đại từ tân ngữ them."],
      ["Can you ___ the house number more clearly?", "print", "prints", "printed", "printing", "Sau can dùng động từ nguyên mẫu không to: print."],
      ["The new design is ___ than the old one.", "simpler", "simple", "simplest", "simply", "Có than nên cần tính từ so sánh hơn simpler."],
      ["We are ___ the envelopes this afternoon.", "addressing", "address", "addresses", "addressed", "Sau are cần động từ dạng -ing để tạo hiện tại tiếp diễn: addressing."],
      ["Please leave the finished cards ___ the table.", "on", "during", "between", "from", "Leave something on the table diễn tả để vật trên bàn; các lựa chọn khác không hoàn chỉnh ở đây."],
      ["___ name should we put at the end? Ours.", "Whose", "Who", "Where", "When", "Cần hỏi tên thuộc về ai, dùng Whose name."],
      ["Our next delivery is ___ Saturday morning.", "on", "at", "in", "to", "Dùng on với buổi của một ngày cụ thể: on Saturday morning."],
    ]);
}
function grammarTen(): StoredContent {
  return grammar(10, "Grammar in context · Moving the school library", "Books and school organisation",
    "A class is helping move books into a new school library. The sentences concern the boxes, the shelves and the work already completed. Choose the one option that correctly completes each separate sentence.", [
      ["The librarian ___ each box before we move it.", "labels", "label", "labelling", "to label", "The librarian là chủ ngữ số ít nên động từ hiện tại đơn là labels."],
      ["The children ___ the picture books yesterday.", "carried", "carry", "carrying", "carries", "Yesterday chỉ quá khứ; carry đổi -y thành -ied: carried."],
      ["These ___ are too heavy for one person.", "boxes", "box", "box's", "boxs", "These cần danh từ số nhiều; số nhiều của box là boxes."],
      ["There are not ___ books on the bottom shelf yet.", "any", "much", "a", "an", "Books đếm được số nhiều; câu phủ định dùng any books."],
      ["We should ___ the small boxes first.", "move", "moves", "moved", "moving", "Sau should dùng động từ nguyên mẫu move."],
      ["The new library is larger ___ the old room.", "than", "as", "then", "from", "Larger là so sánh hơn nên nối bằng than."],
      ["The students are ___ the shelves now.", "cleaning", "clean", "cleaned", "cleans", "Are và now cần hiện tại tiếp diễn: are cleaning."],
      ["This notebook belongs to Ms Lane. It is ___.", "hers", "her", "she", "herself's", "Cuối câu cần đại từ sở hữu hers vì không có danh từ theo sau; Ms Lane là người phụ nữ được nhắc đến."],
      ["___ many dictionaries do we need on this shelf?", "How", "What", "Who", "Where", "Cấu trúc hỏi số lượng là How many và danh từ đếm được số nhiều."],
      ["The library opens ___ September.", "in", "on", "at", "to", "Dùng in với tháng: in September."],
    ]);
}
function grammarEleven(): StoredContent {
  return grammar(11, "Grammar in context · A weekend garden food stall", "Food and small community events",
    "A gardening group is preparing a small stall to sell its vegetables. These separate sentences describe regular tasks, yesterday's preparation and instructions for the volunteers. Choose the one grammatically correct option.", [
      ["Our gardener ___ vegetables at the weekend market.", "sells", "sell", "selling", "to sell", "Our gardener là chủ ngữ ngôi ba số ít, dùng sells."],
      ["We ___ the carrots early yesterday.", "picked", "pick", "picking", "picks", "Yesterday chỉ quá khứ nên dùng picked."],
      ["How ___ tomatoes are in this basket?", "many", "much", "little", "any", "Tomatoes là danh từ đếm được số nhiều, dùng How many."],
      ["There is only ___ water in the bottle.", "a little", "a few", "many", "an", "Water không đếm được nên dùng a little water, không dùng a few."],
      ["The volunteers are ___ the price cards now.", "checking", "check", "checked", "checks", "Are và now tạo hiện tại tiếp diễn: are checking."],
      ["Please ___ the empty basket under the table.", "put", "puts", "putting", "to put", "Câu mệnh lệnh sau please dùng động từ nguyên mẫu put."],
      ["This small basket is ___ than the large box.", "lighter", "light", "lightest", "lightly", "Có than nên cần tính từ so sánh hơn lighter."],
      ["The stall is open ___ nine until twelve.", "from", "at", "on", "in", "Cặp diễn tả khoảng thời gian là from nine until twelve."],
      ["These bags belong to us. They are ___.", "ours", "our", "us", "we", "Cuối câu không có danh từ theo sau nên cần đại từ sở hữu ours."],
      ["Everyone must ___ their hands before handling food.", "wash", "washes", "washed", "washing", "Sau must dùng động từ nguyên mẫu không to: wash."],
    ]);
}

/** New batch only: preparing it never grants another allowance to older audio. */
export function newFiveDuoGatePapers(): StoredContent[] {
  const listening = fiveSupplementListeningPapers();
  const readings = [readingSeven(), readingEight(), readingNine(), readingTen(), readingEleven()];
  const grammarPapers = [grammarSeven(), grammarEight(), grammarNine(), grammarTen(), grammarEleven()];
  if (listening.length !== 5) throw new Error("The third Gate supplement requires five Listening papers.");
  return readings.flatMap((reading, index) => [reading, listening[index]!, grammarPapers[index]!]);
}
