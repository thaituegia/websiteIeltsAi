import { validateContentStructure } from "../../shared/content-visuals";
import type { StoredContent } from "../../shared/types";

/** Five original, server-only announcements for the third private Gate batch.
 * One bounded British narration per paper preserves the one-request allowance.
 * All organisations and arrangements are fictional teaching scenarios. */
const version = "duo-gate-20261110-v3";
const authoredAt = "2026-11-10T00:00:00.000Z";
type Fact = readonly [label: string, answer: string, evidence: string, explanation: string, alternatives?: string[]];

function listening(sitting: number, title: string, topic: string, text: string, facts: Fact[]): StoredContent {
  const id = `duo-private-listening-lesson-30-extra-20261110-${sitting}`;
  const sectionId = `${id}-section-1`, blockId = `${id}-notes`;
  const instructions = "Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.";
  const result: StoredContent = {
    id, skill: "listening", title, topic, band: 3, cefr: "A2", testType: "both", format: "lesson",
    description: "Bài nghe mới trong đợt bổ sung năm bộ đề riêng mốc 3.0 của lộ trình Duo.",
    durationMinutes: 12,
    sections: [{ id: sectionId, title, text,
      dialogue: [{ speaker: "Narrator", accent: "british", text }],
      instructions: "Listen to the announcement and complete the notes. The transcript opens after submission.",
      questionBlocks: [{ id: blockId, type: "note", title: "Information for participants", instructions,
        questionNumbers: facts.map((_, index) => index + 1),
        text: facts.map(([label], index) => `${label}: {{${index + 1}}}`).join("\n"),
      }],
    }],
    questions: facts.map(([label, answer, evidence, explanation, alternatives], index) => ({
      id: `${id}-q-${index + 1}`, number: index + 1, sectionIndex: 0,
      type: "text", questionType: "note-completion", prompt: `${label}. ${instructions}`,
      answer, evidence, explanation, wordLimit: 3, allowNumbers: true, blockId,
      ...(alternatives ? { acceptedAnswers: alternatives } : {}), subskill: "listening-for-practical-details",
    })),
    vocabularyIds: [], tags: ["duo-exclusive", "gate-assessment", "gate-supplement-20261110-v3"],
    source: "authored", quality: "authored-unreviewed", createdAt: authoredAt,
    estimatedDifficulty: { band: 3, cefr: "A2", basis: "Độ khó A2 mục tiêu của học liệu tự biên soạn; chưa hiệu chuẩn bằng kết quả thi thật." },
    provenance: { method: "authored", version, generatedAt: authoredAt },
    review: { status: "structural-checks-passed", checks: ["new-private-source", "numbered-questions", "answer-word-limits", "literal-evidence", "single-bounded-listening-turn"], limitations: ["Chưa được giám khảo độc lập thẩm định hoặc hiệu chuẩn band IELTS."] },
  };
  validateContentStructure(result);
  return result;
}

function bicycleWorkshop(): StoredContent {
  const text = `Hello, and thank you for booking our bicycle workshop. This session is for adults who want to repair a simple puncture themselves. You do not need to be a strong cyclist or own an expensive bicycle. We will work slowly, and a helper will check each stage before you continue. The workshop is on Saturday.

Please come to Canal Garage. It is the low building beside the footbridge, not the car repair business on the main road. We start at 9:45 in the morning. The doors open a little earlier, so you can bring your bicycle inside without rushing. Please walk with it through the entrance.

The fee is 14 pounds per person. This includes the small repair materials you will use during the lesson. Please bring an old towel to protect your clothes and keep small pieces together. We provide the tools, and you should not buy any special equipment before the session.

Your first practical task will be to remove a wheel. You will see a demonstration before trying this with a partner. If you are unsure about a step, hold up the yellow card on your table. A helper will then come to you, so there is no need to shout across the room.

Before leaving, put borrowed tools in the blue tray beside the exit. Please tell us if something is missing. We want the next group to have a complete set. Thank you, and we look forward to helping you learn a useful skill.`;
  return listening(7, "Repairing a bicycle puncture", "Everyday skills and transport", text, [
    ["Day of the workshop", "Saturday", "The workshop is on Saturday.", "Ngày tổ chức được xác nhận là Saturday."],
    ["Name of the workshop building", "Canal Garage", "Please come to Canal Garage.", "Địa điểm là Canal Garage, không phải cơ sở sửa ô tô trên đường chính."],
    ["Starting time", "9:45", "We start at 9:45 in the morning.", "Buổi học bắt đầu lúc 9:45 sáng; chấp nhận cách viết giờ tương đương.", ["09:45", "nine forty-five", "quarter to ten"]],
    ["Fee in pounds per person", "14", "The fee is 14 pounds per person.", "Phí cho một người là 14 bảng, đã gồm vật liệu sửa chữa.", ["fourteen"]],
    ["Item to bring to protect clothes", "old towel", "Please bring an old towel to protect your clothes and keep small pieces together.", "Vật cần mang là old towel; mạo từ an vẫn nằm trong giới hạn ba từ.", ["an old towel"]],
    ["First practical task", "remove a wheel", "Your first practical task will be to remove a wheel.", "Nhiệm vụ thực hành đầu tiên là tháo một bánh xe: remove a wheel."],
    ["Item to hold up when help is needed", "yellow card", "If you are unsure about a step, hold up the yellow card on your table.", "Giơ yellow card để gọi người hỗ trợ; không cần gọi lớn."],
    ["Container for returning borrowed tools", "blue tray", "Before leaving, put borrowed tools in the blue tray beside the exit.", "Dụng cụ mượn cần trả vào blue tray ở cạnh lối ra."],
  ]);
}

function radioVisit(): StoredContent {
  const text = `Welcome to our local radio station. I will explain the arrangements for your school group's visit. You will learn how a short programme is made, and everyone will have a chance to ask questions. The visit is on Tuesday. Please tell your teacher if you can no longer attend, as we need an accurate list before you arrive.

We are based at Orchard Studio. The street has several buildings with similar signs, so please check the name carefully. Enter through the back gate. The front entrance is reserved for people who are taking part in a live programme, and we do not want to interrupt them.

The tour begins at 11:15 in the morning. Please wait together outside until a member of staff comes to meet you. We can take a maximum of 12 students in each group. Teachers can join the group, but please do not bring friends who are not on the school list.

Your first stop inside will be the Green Room. Despite its name, it is a waiting room with cream walls. There you will hear a short explanation before entering a recording area. Please bring headphones for listening to your own practice recording. We will provide the microphone and explain how to use it.

After the visit, your teacher will receive the recordings by email on Friday. You may listen to them at school, but please ask before sharing someone else's voice online. We hope the visit helps you understand the work behind the programmes you hear.`;
  return listening(8, "A school visit to a local radio station", "Media and school visits", text, [
    ["Day of the school visit", "Tuesday", "The visit is on Tuesday.", "Buổi tham quan diễn ra vào Tuesday."],
    ["Name of the radio station's studio", "Orchard Studio", "We are based at Orchard Studio.", "Tên cần tìm trên biển là Orchard Studio."],
    ["Entrance for the school group", "back gate", "Enter through the back gate.", "Nhóm học sinh đi qua back gate; cửa chính dành cho chương trình trực tiếp."],
    ["Time the tour begins", "11:15", "The tour begins at 11:15 in the morning.", "Tour bắt đầu lúc 11:15 sáng, chấp nhận cách diễn đạt quarter past eleven.", ["eleven fifteen", "quarter past eleven"]],
    ["Maximum number of students in a group", "12", "We can take a maximum of 12 students in each group.", "Giới hạn là 12 học sinh; giáo viên có thể đi cùng.", ["twelve"]],
    ["First room the group visits", "Green Room", "Your first stop inside will be the Green Room.", "Tên phòng đầu tiên là Green Room dù tường không sơn xanh."],
    ["Equipment students should bring", "headphones", "Please bring headphones for listening to your own practice recording.", "Học sinh mang headphones; đài cung cấp microphone."],
    ["Day the teacher receives the recordings", "Friday", "After the visit, your teacher will receive the recordings by email on Friday.", "Bản thu được gửi cho giáo viên vào Friday, không phải ngay trong buổi tham quan."],
  ]);
}

function choirRehearsal(): StoredContent {
  const text = `Hello, and welcome to the information line for our community choir. We are inviting new singers to an evening where they can try singing with the group. You do not need to read music or pass a test. The welcome rehearsal is on Wednesday. We hope that people who have never joined a choir will feel comfortable coming along.

Meet us at Maple Church. We use the meeting room behind the main building, and there will be signs from the street. The rehearsal starts at 6:30 in the evening. Please arrive before that time so that we can find a seat for you without stopping the first song.

The charge for the evening is five pounds. This helps to pay for the room and copies of the music. Please bring a water bottle. Singing can make your throat feel dry, and you can refill the bottle at the tap near the toilets. All the printed music will be ready on your chair.

The first song is called River Song. It has a simple tune, and we will learn it in small sections before singing together. During the break, we will offer apple juice. Please keep drinks away from the electric piano and put used cups on the table.

When you arrive, leave large bags in the front cupboard. This keeps the space between the chairs clear. You can keep a small bag with you if it fits under your seat. At the end, someone will explain how to join regular rehearsals, but there is no need to decide that evening.`;
  return listening(9, "Trying a community choir", "Music and community activities", text, [
    ["Day of the welcome rehearsal", "Wednesday", "The welcome rehearsal is on Wednesday.", "Buổi tập chào đón người mới diễn ra vào Wednesday."],
    ["Meeting place", "Maple Church", "Meet us at Maple Church.", "Điểm hẹn là Maple Church; nhóm sử dụng phòng họp phía sau."],
    ["Time the rehearsal starts", "6:30", "The rehearsal starts at 6:30 in the evening.", "6:30 buổi tối tương đương 18:30 hoặc half past six.", ["18:30", "six thirty", "half past six"]],
    ["Charge in pounds for the evening", "five", "The charge for the evening is five pounds.", "Phí tham gia buổi tối là năm bảng.", ["5"]],
    ["Item singers should bring", "water bottle", "Please bring a water bottle.", "Người hát cần mang water bottle; a water bottle cũng đúng giới hạn.", ["a water bottle"]],
    ["Title of the first song", "River Song", "The first song is called River Song.", "Bài đầu tiên có tên River Song, là tên riêng nên giữ đủ hai từ."],
    ["Drink offered during the break", "apple juice", "During the break, we will offer apple juice.", "Đồ uống được cung cấp trong giờ nghỉ là apple juice."],
    ["Place to leave large bags", "front cupboard", "When you arrive, leave large bags in the front cupboard.", "Túi lớn để trong front cupboard nhằm giữ lối giữa các ghế thông thoáng."],
  ]);
}

function rockSession(): StoredContent {
  const text = `Good afternoon. Here is some information about our museum session for people who are interested in rocks. You do not need a collection of your own, and we will begin with very simple examples. The session is on Sunday. It is suitable for adults and children over ten who are happy to work carefully at a table.

Please meet in Hall Two. A member of the museum team will wait near the lift to show you the way. We begin at 2:15 in the afternoon. The session is separate from the morning guided tour, so you do not need to book that tour as well.

The price is seven pounds per person. This includes the use of all the equipment during the session. We will put a cotton mat on each table. Place the rocks on this mat rather than directly on the wood, as some pieces have rough edges. You may pick up the teaching samples after the guide says it is safe.

To see small details, you will use a hand lens. The guide will show you how close to hold it. Your first task is to look for a white spot on one of the samples. This is a simple way to practise looking closely before discussing how the rocks are different.

At the end, return all the rocks to the wooden tray. The lenses stay on the tables for staff to collect. Please check that nothing has fallen onto the floor before leaving. We hope the session encourages you to notice the different stones around you.`;
  return listening(10, "Looking closely at rocks in the museum", "Museums and practical science", text, [
    ["Day of the rock session", "Sunday", "The session is on Sunday.", "Buổi tìm hiểu đá diễn ra vào Sunday."],
    ["Hall where the group meets", "Hall Two", "Please meet in Hall Two.", "Nhóm tập trung ở Hall Two; cách viết Hall 2 cũng được chấp nhận.", ["Hall 2", "Two", "2"]],
    ["Starting time", "2:15", "We begin at 2:15 in the afternoon.", "2:15 chiều là 14:15 hoặc quarter past two.", ["14:15", "two fifteen", "quarter past two"]],
    ["Price in pounds per person", "seven", "The price is seven pounds per person.", "Giá cho một người là bảy bảng, đã gồm sử dụng dụng cụ.", ["7"]],
    ["Material placed on the table for the rocks", "cotton mat", "We will put a cotton mat on each table.", "Mẫu đá được đặt lên cotton mat để bảo vệ mặt bàn.", ["a cotton mat"]],
    ["Tool for seeing small details", "hand lens", "To see small details, you will use a hand lens.", "Dụng cụ quan sát chi tiết là hand lens, không phải kính hiển vi.", ["a hand lens"]],
    ["Feature to find on the first sample", "white spot", "Your first task is to look for a white spot on one of the samples.", "Đặc điểm cần tìm trong nhiệm vụ đầu là white spot.", ["a white spot"]],
    ["Container for returning all rocks", "wooden tray", "At the end, return all the rocks to the wooden tray.", "Cuối buổi trả tất cả mẫu đá vào wooden tray; kính lúp để trên bàn."],
  ]);
}

function pastaClass(): StoredContent {
  const text = `Hello, and thank you for choosing our beginner pasta class. We will make a small meal together and explain each stage as we go. You do not need to be a confident cook, and nobody is expected to work quickly. The class is on Friday. Please read the instructions on your booking email before you travel.

The venue is Harbour Kitchen. It is above the indoor market, and you can reach it by the stairs or the lift. The lesson begins at 10:30 in the morning. Please arrive a little early to wash your hands and find your place at the work table.

The price is 18 pounds per person. This covers all the ingredients and the use of an apron. Bring a small box for taking your finished food home. We cannot provide boxes, and a paper bag will not keep the pasta in good condition on your journey.

We will start by putting flour on the table. The teacher will show you how to make a space in the middle before adding the other ingredients. You will practise moving the mixture with your hands before using any machines. Please ask for help if the mixture feels difficult to work with.

The fresh pasta needs four minutes in boiling water. The teacher will explain how to check it before taking it out. After eating, place used bowls in the deep sink. Staff will clean the machines themselves. We hope you leave with the confidence to try making a simple meal at home.`;
  return listening(11, "A beginner pasta-making class", "Food and everyday skills", text, [
    ["Day of the beginner class", "Friday", "The class is on Friday.", "Lớp nấu ăn cho người mới diễn ra vào Friday."],
    ["Name of the venue", "Harbour Kitchen", "The venue is Harbour Kitchen.", "Địa điểm là Harbour Kitchen, nằm phía trên chợ trong nhà."],
    ["Time the lesson begins", "10:30", "The lesson begins at 10:30 in the morning.", "Buổi học bắt đầu lúc 10:30 sáng; half past ten là cách viết tương đương.", ["ten thirty", "half past ten"]],
    ["Price in pounds per person", "18", "The price is 18 pounds per person.", "Giá cho một người là 18 bảng, gồm nguyên liệu và sử dụng tạp dề.", ["eighteen"]],
    ["Item to bring for taking food home", "small box", "Bring a small box for taking your finished food home.", "Cần mang small box để đựng thành phẩm; túi giấy không phù hợp.", ["a small box"]],
    ["First ingredient put on the table", "flour", "We will start by putting flour on the table.", "Nguyên liệu đầu tiên được đặt lên bàn là flour."],
    ["Number of minutes needed in boiling water", "four", "The fresh pasta needs four minutes in boiling water.", "Thời gian nấu mì tươi được xác nhận là bốn phút.", ["4"]],
    ["Place for used bowls after eating", "deep sink", "After eating, place used bowls in the deep sink.", "Bát đã dùng được đặt vào deep sink; nhân viên sẽ tự vệ sinh máy."],
  ]);
}

export function fiveSupplementListeningPapers(): StoredContent[] {
  return [bicycleWorkshop(), radioVisit(), choirRehearsal(), rockSession(), pastaClass()];
}
