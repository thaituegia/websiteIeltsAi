import { validateContentStructure } from "../../shared/content-visuals";
import type { ContentKind, StoredContent, StoredQuestion } from "../../shared/types";

/** Second, additive batch of private Gate sittings. All settings and sources
 * in the first batch remain immutable. The situations below are fictional. */
export const ADDITIONAL_SUPPLEMENT_VERSION = "duo-gate-20261110-v2";
const authoredAt = "2026-11-10T00:00:00.000Z";
const paperId = (skill: ContentKind, sitting: number) => `duo-private-${skill}-lesson-30-extra-20261110-${sitting}`;
export const ADDITIONAL_DUO_GATE_LISTENING_IDS = [paperId("listening", 4), paperId("listening", 5), paperId("listening", 6)] as const;

type QuestionInput = Omit<StoredQuestion, "id" | "number" | "sectionIndex">;
function paper(skill: ContentKind, sitting: number, title: string, topic: string,
  text: string, rows: QuestionInput[]): StoredContent {
  const id = paperId(skill, sitting);
  const result: StoredContent = {
    id, skill, title, topic, band: 3, cefr: "A2", testType: "both", format: "lesson",
    description: "Bộ bổ sung thứ hai dành riêng cho lượt kiểm tra mốc 3.0 của lộ trình Duo.",
    durationMinutes: skill === "reading" ? 18 : skill === "listening" ? 12 : 15,
    sections: [{ id: `${id}-section-1`, title, text,
      ...(skill === "listening" ? { dialogue: [{ speaker: "Narrator", accent: "british" as const, text }] } : {}),
      instructions: skill === "listening"
        ? "Listen to the announcement and complete the notes. The transcript opens after submission."
        : skill === "grammar" ? "Choose the one option that correctly completes each sentence."
          : "Read the passage and answer all eight questions. Use only the information in the passage.",
    }],
    questions: rows.map((row, index) => ({ ...row, id: `${id}-q-${index + 1}`, number: index + 1, sectionIndex: 0 })),
    vocabularyIds: [], tags: ["duo-exclusive", "gate-assessment", "gate-supplement-20261110-v2"],
    source: "authored", quality: "authored-unreviewed", createdAt: authoredAt,
    estimatedDifficulty: { band: 3, cefr: "A2", basis: "Độ khó A2 mục tiêu của học liệu tự biên soạn; chưa hiệu chuẩn bằng kết quả thi thật." },
    provenance: { method: "authored", version: ADDITIONAL_SUPPLEMENT_VERSION, generatedAt: authoredAt },
    review: { status: "structural-checks-passed", checks: ["new-private-source", "numbered-questions", "answer-word-limits", ...(skill === "grammar" ? ["single-correct-option"] : ["literal-evidence"]), ...(skill === "listening" ? ["single-bounded-listening-turn"] : [])], limitations: ["Chưa được giám khảo độc lập thẩm định hoặc hiệu chuẩn band IELTS."] },
  };
  if (skill !== "listening") validateContentStructure(result);
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

function readingFour(): StoredContent {
  const text = `Umbrellas for the walk from Fenwick Station

Fenwick Station is a small railway stop on the edge of town. Many passengers walk from the station to a nearby bus stop. There is no roof over this short route, and people often get wet while waiting to continue their journey. A station worker called Tom suggested lending umbrellas to passengers. He wanted to make the journey more comfortable, rather than encourage people to buy something.

The service began in October. The umbrellas stand beside the ticket machine, so passengers can see them as soon as they enter the station. Each one has a yellow handle and a number. The colour helps people recognise a station umbrella, while the number helps staff keep a simple record. Passengers write the number on a paper form, but they do not need to give their address.

Borrowing an umbrella is free. People may keep it until the following evening, when they should return it to a box inside the station entrance. The box remains available after the ticket office closes. Anyone who notices a broken umbrella is asked to leave it at the information desk, where staff can separate it from the useful ones.

At first, the workers expected most umbrellas to disappear. However, many were returned on time, and some passengers even donated spare ones from home. The station does not accept very large umbrellas because they take up too much space on crowded trains.

Tom now checks the supply every Monday. He has asked a local sewing group whether it can repair small holes in the fabric. The group will try this next month. Staff will continue checking the metal frames themselves, as damaged frames may be unsafe.`;
  return paper("reading", 4, "Reading kiểm tra mốc 3.0 · Ô cho hành khách ở Fenwick", "Transport and everyday comfort", text, [
    choice("Why did Tom suggest lending umbrellas?", "To make passengers' journeys more comfortable", ["To sell more train tickets", "To advertise a new shop", "To persuade people to stop using buses"], "He wanted to make the journey more comfortable, rather than encourage people to buy something.", "Mục đích là giúp hành trình thuận tiện hơn khi trời mưa; bài không nói đến bán vé hay quảng cáo.", 3),
    short("In which month did the service begin? Write ONE WORD from the passage.", "October", "The service began in October.", 1, "Dịch vụ bắt đầu vào October."),
    short("Which machine are the umbrellas beside? Write NO MORE THAN TWO WORDS from the passage.", "ticket machine", "The umbrellas stand beside the ticket machine, so passengers can see them as soon as they enter the station.", 2, "Ô đặt cạnh ticket machine; giới hạn hai từ không cho phép thêm the."),
    short("What colour is each umbrella handle? Write ONE WORD from the passage.", "yellow", "Each one has a yellow handle and a number.", 1, "Yellow mô tả màu tay cầm, còn số dùng để ghi nhận chiếc ô."),
    statement("Passengers must provide their home address to borrow an umbrella.", "FALSE", "Passengers write the number on a paper form, but they do not need to give their address.", "Bài nói rõ không cần cung cấp địa chỉ, trái với nhận định."),
    statement("The return box can still be used after the ticket office closes.", "TRUE", "The box remains available after the ticket office closes.", "Hộp trả ô vẫn có thể sử dụng sau khi quầy vé đóng cửa."),
    statement("The station received more than fifty donated umbrellas in its first month.", "NOT GIVEN", "However, many were returned on time, and some passengers even donated spare ones from home.", "Bài có nhắc ô được tặng nhưng không cho số lượng hoặc số ô trong tháng đầu."),
    choice("What will the sewing group try next month?", "Repairing small holes in umbrella fabric", ["Painting the metal frames", "Making larger umbrellas", "Moving the return box outside"], "He has asked a local sewing group whether it can repair small holes in the fabric. The group will try this next month.", "This chỉ việc sửa lỗ nhỏ trên vải nêu ở câu ngay trước; khung kim loại vẫn do nhân viên kiểm tra.", 1),
  ]);
}

function readingFive(): StoredContent {
  const text = `A film evening made by pupils

Rosefield School wanted families to see more of the work pupils did outside their usual lessons. An art teacher suggested an evening of short films made by the children. The aim was to share their ideas, not to choose the best young actor. Every class could submit a film, and pupils could work behind the camera if they did not want to appear on screen.

The school held the first evening in March. It used the dining hall because this room had curtains that could keep out the evening light. A parent lent a projector, and staff put the chairs in short rows with a wide space between them. Families could move easily without stepping over other people's bags.

Each film had to be less than five minutes long. The pupils could tell a story, explain how to make something or show an interesting place. Before filming another person, they had to ask for permission. A teacher checked that everyone appearing in a film had agreed to take part. Music copied from the internet was not allowed unless the pupils had permission to use it.

Tickets were free, but families needed to collect them from the school office in advance. This helped staff arrange enough chairs. At the entrance, pupils gave visitors a printed programme with the film titles and class names. There were no prizes or marks at the end of the evening.

Afterwards, some grandparents said that quiet speech had been hard to hear. For the next evening, the pupils will add written words at the bottom of the screen. The school will also test the speakers before visitors arrive. The teacher hopes these changes will help everyone enjoy the films together.`;
  return paper("reading", 5, "Reading kiểm tra mốc 3.0 · Đêm phim của học sinh Rosefield", "School and creative communication", text, [
    choice("What was the main purpose of the film evening?", "To share pupils' ideas with their families", ["To select the school's best actor", "To sell films to local cinemas", "To raise money for a new dining hall"], "The aim was to share their ideas, not to choose the best young actor.", "Mục đích là chia sẻ ý tưởng của học sinh với gia đình, không phải cuộc thi diễn xuất.", 2),
    short("In which month was the first evening held? Write ONE WORD from the passage.", "March", "The school held the first evening in March.", 1, "Buổi đầu tiên được tổ chức vào March."),
    short("Which room did the school use? Write NO MORE THAN TWO WORDS from the passage.", "dining hall", "It used the dining hall because this room had curtains that could keep out the evening light.", 2, "Địa điểm là dining hall; không phải phòng học nghệ thuật."),
    statement("Pupils who did not want to appear in a film could still help make one.", "TRUE", "Every class could submit a film, and pupils could work behind the camera if they did not want to appear on screen.", "Học sinh có thể làm việc phía sau máy quay, nên không bắt buộc xuất hiện trên màn hình."),
    statement("Visitors paid for tickets when they arrived at the school.", "FALSE", "Tickets were free, but families needed to collect them from the school office in advance.", "Vé miễn phí và phải lấy trước; không phải trả tiền khi đến."),
    statement("The youngest pupil who made a film was seven years old.", "NOT GIVEN", "Every class could submit a film, and pupils could work behind the camera if they did not want to appear on screen.", "Bài nói mọi lớp có thể gửi phim nhưng không cho tuổi của học sinh nhỏ nhất."),
    short("What did pupils give visitors at the entrance? Write NO MORE THAN THREE WORDS from the passage.", "a printed programme", "At the entrance, pupils gave visitors a printed programme with the film titles and class names.", 3, "Vật phát ở cửa là a printed programme; có thể bỏ mạo từ a mà vẫn đúng.", ["printed programme"]),
    choice("What will pupils add to the next films to help visitors?", "Written words at the bottom of the screen", ["A prize after every film", "Longer music at the beginning", "A second story after the ending"], "For the next evening, the pupils will add written words at the bottom of the screen.", "Sau phản hồi khó nghe lời thoại nhỏ, học sinh sẽ thêm chữ ở cuối màn hình.", 1),
  ]);
}

function readingSix(): StoredContent {
  const text = `Water stops for dogs in Alder Park

In summer, Alder Park attracts many people walking their dogs. There are drinking taps for people near the playground, but these are some distance from the main dog-walking route. A park gardener noticed that owners often ended a walk early when their dogs became thirsty. She suggested small water stops along the route so that dogs could have a drink without a long journey back to the gate.

The first water stop opened in June. It is beside the old oak tree, where two paths meet. The place was chosen because it has shade during the warmest part of the day. A sign asks owners to keep dogs on a lead while they are near the bowls, even though dogs may run freely in some other parts of the park.

Each stop has two metal bowls. Volunteers wash them with a brush every morning and fill them with fresh water. They empty and clean the bowls again before the park closes. Owners are asked not to leave food there because food may attract rats. Anyone who finds an empty bowl during the day can tell the worker at the gate office.

For the first few weeks, the gardeners watched how people used the stop. They found that putting the bowls directly beside a narrow path made it difficult for other walkers to pass. The bowls were moved onto a small area of firm ground just off the path. People can now stop without blocking the route.

The park plans to add another water stop near the sports field. Before doing this, staff will check how easily water can be carried there. They do not want volunteers to lift heavy containers over a long distance. The new location will be confirmed after this check.`;
  return paper("reading", 6, "Reading kiểm tra mốc 3.0 · Điểm nước cho chó ở Alder Park", "Parks and animal care", text, [
    choice("Why did the gardener suggest water stops?", "To let dogs drink without going back to the gate", ["To keep all dogs away from the park", "To replace the playground taps", "To sell water to dog owners"], "She suggested small water stops along the route so that dogs could have a drink without a long journey back to the gate.", "Điểm nước giúp chó uống ngay trên tuyến đi dạo mà không phải quay xa về cổng.", 1),
    short("In which month did the first water stop open? Write ONE WORD from the passage.", "June", "The first water stop opened in June.", 1, "Điểm nước đầu tiên mở vào June."),
    short("Which tree is the first stop beside? Write NO MORE THAN THREE WORDS from the passage.", "old oak tree", "It is beside the old oak tree, where two paths meet.", 3, "Bài nêu old oak tree; oak tree cũng chỉ đúng cây được hỏi, còn giới hạn ba từ không cho phép thêm the old oak tree.", ["oak tree"]),
    statement("Dogs must be kept on a lead near the water bowls.", "TRUE", "A sign asks owners to keep dogs on a lead while they are near the bowls, even though dogs may run freely in some other parts of the park.", "Quy định tại khu vực bát nước là giữ chó bằng dây, dù nơi khác có thể cho chạy tự do."),
    short("What do volunteers use to wash the bowls? Write NO MORE THAN TWO WORDS from the passage.", "a brush", "Volunteers wash them with a brush every morning and fill them with fresh water.", 2, "Dụng cụ được nêu là a brush; brush cũng là đáp án hợp lệ.", ["brush"]),
    statement("Owners are encouraged to leave food beside the bowls.", "FALSE", "Owners are asked not to leave food there because food may attract rats.", "Chủ nuôi được yêu cầu không để thức ăn vì có thể thu hút chuột."),
    statement("More dogs visit the water stop in the evening than in the morning.", "NOT GIVEN", "For the first few weeks, the gardeners watched how people used the stop.", "Có hoạt động quan sát cách dùng nhưng không có số lượng theo buổi để so sánh."),
    choice("What must staff check before confirming the next stop?", "How easily water can be carried to the location", ["Whether the old oak tree needs cutting", "How much owners will pay to enter", "Whether the playground should close"], "Before doing this, staff will check how easily water can be carried there.", "Cần kiểm tra việc mang nước có thuận tiện không để tránh yêu cầu tình nguyện viên mang vật nặng quá xa.", 3),
  ]);
}

type ListeningFact = readonly [label: string, answer: string, evidence: string, alternatives?: string[]];
function listening(sitting: number, title: string, topic: string, text: string, facts: ListeningFact[]): StoredContent {
  const id = paperId("listening", sitting), blockId = `${id}-notes`;
  const instructions = "Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.";
  const result = paper("listening", sitting, title, topic, text, facts.map(([label, answer, evidence, alternatives]) => ({
    type: "text", questionType: "note-completion", prompt: `${label}. ${instructions}`, answer, evidence,
    wordLimit: 3, allowNumbers: true, blockId, ...(alternatives ? { acceptedAnswers: alternatives } : {}),
    explanation: "Nghe đúng chi tiết được người thông báo xác nhận trong câu trích dẫn; giữ đúng giới hạn từ và số.",
    subskill: "listening-for-practical-details",
  })));
  result.sections[0]!.questionBlocks = [{ id: blockId, type: "note", title: "Information for participants", instructions,
    questionNumbers: facts.map((_, index) => index + 1), text: facts.map(([label], index) => `${label}: {{${index + 1}}}`).join("\n") }];
  validateContentStructure(result);
  return result;
}

function listeningFour(): StoredContent {
  const text = `Hello, and welcome to our pottery painting session. You will choose a plain cup and give it your own design. Our next beginner session is on Tuesday. You do not need drawing experience, and we will show you some easy patterns before you begin. Please read the notes on your booking sheet while I explain what to expect.

Come to Pine Studio, the small shop between the flower shop and the post office. The session begins at 2:30 in the afternoon. Please arrive a few minutes early so that you have time to hang up your coat and wash your hands. We provide an apron, but it is sensible to wear clothes that can get a little paint on them.

The price is 16 pounds per person. This includes a cup, the paint and the final heating of your work. Please bring a pencil so you can plan your design on paper first. You will not put the pencil marks on the cup itself.

We will use soft brushes for the background colour. More detailed tools will be explained at the table. If you need help, ask the person wearing a red badge. They can show you how to change a colour without making the paint too thick.

Your cup will be ready to collect on Friday. Before leaving today, put your booking card in the wooden box by the door. Thank you, and enjoy making something special.`;
  return listening(4, "A first pottery painting session at Pine Studio", "Art and personal projects", text, [
    ["Day of the beginner session", "Tuesday", "Our next beginner session is on Tuesday."],
    ["Name of the studio", "Pine Studio", "Come to Pine Studio, the small shop between the flower shop and the post office."],
    ["Starting time", "2:30", "The session begins at 2:30 in the afternoon.", ["14:30", "two thirty", "half past two"]],
    ["Price in pounds per person", "16", "The price is 16 pounds per person.", ["sixteen"]],
    ["Item to bring for planning the design", "pencil", "Please bring a pencil so you can plan your design on paper first.", ["a pencil"]],
    ["Tools for the background colour", "soft brushes", "We will use soft brushes for the background colour.", ["brushes"]],
    ["Badge worn by the person who can help", "red badge", "If you need help, ask the person wearing a red badge."],
    ["Day the finished cup can be collected", "Friday", "Your cup will be ready to collect on Friday."],
  ]);
}

function listeningFive(): StoredContent {
  const text = `Good afternoon. I would like to give you the details of our evening looking at the night sky. The event is for beginners, so you do not need to know the names of stars. The evening is on Thursday. If you have a booking, please keep this information with you so that you arrive at the correct place and time.

We will meet at Hill Farm. Please use the small car park near the gate, rather than driving across the field. The welcome talk starts at 7:15. There will still be a little light then, which will help us show you where to walk safely. The group will stay together when we move away from the buildings.

Each visitor pays eight pounds. Children must stay with an adult, and everyone should wear warm clothes because the field can feel cold after dark. Please bring a torch. We will show you how to cover its light when we are looking through the telescope.

Our first activity will be to look at the moon. Later, the guide will help you find other objects in the sky. During the short break, you can buy hot chocolate from the kitchen. Water is also available there.

If there is heavy rain, we will telephone visitors before they leave home. Please check your phone before travelling. At the end, return any borrowed star cards to the gate office. The guide will wait there to answer questions about future evenings.`;
  return listening(5, "A beginner evening looking at the night sky", "Science and outdoor learning", text, [
    ["Day of the evening event", "Thursday", "The evening is on Thursday."],
    ["Meeting place", "Hill Farm", "We will meet at Hill Farm."],
    ["Time the welcome talk begins", "7:15", "The welcome talk starts at 7:15.", ["19:15", "seven fifteen", "quarter past seven"]],
    ["Price in pounds per visitor", "eight", "Each visitor pays eight pounds.", ["8"]],
    ["Item to bring for light", "torch", "Please bring a torch.", ["a torch"]],
    ["First object to be observed", "moon", "Our first activity will be to look at the moon.", ["the moon"]],
    ["Hot drink sold during the break", "hot chocolate", "During the short break, you can buy hot chocolate from the kitchen."],
    ["Place to return borrowed star cards", "gate office", "At the end, return any borrowed star cards to the gate office."],
  ]);
}

function listeningSix(): StoredContent {
  const text = `Hello, everyone. Here are the arrangements for our apple picking visit. This is a chance to find out how apples grow and choose some fruit to take home. Our group will visit on Monday. Please make sure that everyone in your family knows the plan. We cannot wait for late arrivals because the farmer has other work to do during the day.

Meet at West Orchard. There is a sign at the entrance, and a helper will show you where to leave your car or bicycle. The farm walk begins at 10:45. We will listen to a short talk before going between the trees, so please stay near the welcome area until the farmer asks us to move.

The visit costs five pounds per adult. You can pay for any apples you take home at the end. Please wear strong shoes because the ground may be wet. There is no long walk, but sandals are not suitable for working near the trees.

We will give each family a small basket for collecting fruit. Please do not use plastic bags while picking, as they can damage the apples. During the break, leave your basket beside the green bench. A member of staff will watch the baskets while you rest.

The visitor toilets are behind the barn. Please wash your hands before eating anything. Finally, if you cannot come, contact the farm by Sunday. This will allow another family to take your place. We hope you enjoy the fresh air and the fruit.`;
  return listening(6, "An apple picking visit to West Orchard", "Farming and family visits", text, [
    ["Day of the group visit", "Monday", "Our group will visit on Monday."],
    ["Meeting place", "West Orchard", "Meet at West Orchard."],
    ["Time the farm walk begins", "10:45", "The farm walk begins at 10:45.", ["ten forty-five", "quarter to eleven"]],
    ["Price in pounds per adult", "five", "The visit costs five pounds per adult.", ["5"]],
    ["Footwear to wear", "strong shoes", "Please wear strong shoes because the ground may be wet."],
    ["Item supplied for collecting fruit", "small basket", "We will give each family a small basket for collecting fruit.", ["basket", "a small basket"]],
    ["Place to leave baskets during the break", "green bench", "During the break, leave your basket beside the green bench."],
    ["Last day to report that you cannot attend", "Sunday", "Finally, if you cannot come, contact the farm by Sunday."],
  ]);
}

type GrammarRow = readonly [stem: string, answer: string, d1: string, d2: string, d3: string, reason: string];
function grammar(sitting: number, title: string, topic: string, context: string, rows: GrammarRow[]): StoredContent {
  return paper("grammar", sitting, title, topic, context, rows.map(([stem, answer, d1, d2, d3, explanation], index) => ({
    ...choice(stem, answer, [d1, d2, d3], stem.replace("___", answer), explanation, (index + sitting) % 4),
    subskill: "grammar-in-context",
  })));
}

function grammarFour(): StoredContent {
  return grammar(4, "Grammar in context · A pet adoption open day", "Animals and community",
    "An animal shelter is preparing an open day. Visitors will meet the animals and learn what care they need. Each sentence describes a separate routine, a completed task or an instruction for the event.", [
      ["The shelter ___ at nine every morning.", "opens", "open", "opening", "to open", "The shelter là chủ ngữ số ít; every morning chỉ thói quen, dùng opens."],
      ["Our team ___ the visitor signs last night.", "made", "makes", "making", "make", "Last night chỉ quá khứ; quá khứ của make là made."],
      ["The cats are ___ in the quiet room now.", "sleeping", "sleep", "slept", "sleeps", "Are và now cần hiện tại tiếp diễn: are sleeping."],
      ["There is ___ orange blanket in this basket.", "an", "a", "these", "many", "Blanket là danh từ số ít; orange bắt đầu bằng âm nguyên âm nên dùng an."],
      ["Please put the clean bowls ___ the shelf.", "on", "during", "between", "from", "Put something on the shelf là đặt vật lên kệ; các lựa chọn khác không phù hợp vị trí này."],
      ["These dogs are friendly, but you must ask before touching ___.", "them", "they", "their", "theirs", "Sau động từ touching cần tân ngữ, dùng them để chỉ these dogs."],
      ["___ the rabbit need fresh water every day?", "Does", "Do", "Are", "Is", "Câu hỏi hiện tại đơn có chủ ngữ số ít và động từ need dùng Does."],
      ["Visitors must not ___ the animals sweets.", "give", "gives", "gave", "giving", "Sau must not dùng động từ nguyên mẫu không to: give."],
      ["The young dog is smaller ___ its mother.", "than", "as", "then", "from", "Smaller là so sánh hơn, cần than để nối với đối tượng so sánh."],
      ["We have ___ empty cages than we had yesterday.", "fewer", "less", "little", "much", "Cages là danh từ đếm được số nhiều; so sánh số lượng ít hơn dùng fewer."],
    ]);
}

function grammarFive(): StoredContent {
  return grammar(5, "Grammar in context · Lunch for a school trip", "Food and school journeys",
    "A class is packing lunch for a visit to a nature centre. The sentences describe quantities, personal belongings and tasks before departure. Choose the option that fits the grammar and the time words in each separate sentence.", [
      ["Amir ___ the fruit before packing it every Tuesday.", "washes", "wash", "washing", "to wash", "Amir là ngôi ba số ít, every Tuesday chỉ thói quen nên dùng washes."],
      ["The class ___ to the nature centre last summer.", "went", "goes", "going", "go", "Last summer chỉ quá khứ; quá khứ của go là went."],
      ["How ___ sandwiches are in this box?", "many", "much", "little", "any", "Sandwiches đếm được số nhiều, dùng How many để hỏi số lượng."],
      ["There is not ___ juice left in the bottle.", "much", "many", "a", "an", "Juice không đếm được; trong câu phủ định dùng not much juice."],
      ["This lunch bag belongs to Mia. It is ___.", "hers", "her", "she", "herself's", "Cuối câu không có danh từ theo sau nên dùng đại từ sở hữu hers."],
      ["The bus will leave ___ half past eight.", "at", "on", "in", "to", "Dùng at với giờ cụ thể: at half past eight."],
      ["Please ___ your name on the lunch box.", "write", "writes", "wrote", "writing", "Câu mệnh lệnh sau please dùng động từ nguyên mẫu write."],
      ["We are ___ the bottles with drinking water now.", "filling", "fill", "fills", "filled", "Are và now tạo thì hiện tại tiếp diễn: are filling."],
      ["I need two ___ to cut the large cake.", "knives", "knife", "knifes", "knife's", "Sau two cần số nhiều; knife có số nhiều bất quy tắc là knives."],
      ["Everyone should ___ their rubbish home.", "take", "takes", "took", "taking", "Sau should dùng động từ nguyên mẫu không to: take."],
    ]);
}

function grammarSix(): StoredContent {
  return grammar(6, "Grammar in context · The chess club changes rooms", "Clubs and everyday arrangements",
    "A town chess club is moving its weekly meeting to a new room. Members are sharing directions, checking their equipment and discussing the move. Complete each separate sentence with the one grammatically correct option.", [
      ["The club ___ every Wednesday evening.", "meets", "meet", "meeting", "to meet", "The club là chủ ngữ số ít; every Wednesday chỉ thói quen nên dùng meets."],
      ["We ___ the new room for the first time yesterday.", "saw", "see", "seeing", "sees", "Yesterday chỉ quá khứ; quá khứ của see là saw."],
      ["There ___ four large tables in the new room.", "are", "is", "be", "was", "Four large tables là số nhiều nên cấu trúc hiện tại là There are."],
      ["The room is ___ than our old meeting place.", "brighter", "bright", "brightest", "brightly", "Có than nên cần tính từ so sánh hơn brighter."],
      ["You can ___ a chess set from the cupboard.", "borrow", "borrows", "borrowed", "borrowing", "Sau can dùng động từ nguyên mẫu không to: borrow."],
      ["The keys are in my pocket. I will give ___ to you.", "them", "they", "their", "theirs", "Give cần tân ngữ; them thay cho the keys."],
      ["___ do we need to bring a lamp? Because the small table is dark.", "Why", "Where", "Who", "Whose", "Câu trả lời bắt đầu bằng Because nêu lý do, nên từ hỏi là Why."],
      ["We do not play ___ music during matches.", "any", "many", "a", "an", "Music không đếm được; trong câu phủ định dùng any music."],
      ["Our next match is ___ 14 November.", "on", "at", "in", "to", "Dùng on với ngày cụ thể: on 14 November."],
      ["The two new ___ joined the club last week.", "children", "child", "childs", "child's", "Sau two cần số nhiều; số nhiều của child là children."],
    ]);
}

/** Return only the second batch, so preparing it cannot fund the first batch. */
export function newAdditionalDuoGatePapers(): StoredContent[] {
  return [readingFour(), listeningFour(), grammarFour(), readingFive(), listeningFive(), grammarFive(), readingSix(), listeningSix(), grammarSix()];
}
