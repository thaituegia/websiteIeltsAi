import type { Cefr, StoredContent } from "../../../shared/types.js";
import { extraGrammarQuestions } from "./support-grammar-extra.js";

type Pack = { title: string; topic: string; cefr: Cefr; rule: string; example: string; rows: string };
// Each pack targets a separate form/meaning decision. Contexts and feedback
// were composed independently; the extra lessons are not copies with names changed.
const packs: Pack[] = [
{title:"Describing personal information with be",topic:"Community",cefr:"A2",rule:"Use am with I, is with a singular person or thing, and are with you or plural subjects. Be can link a subject to an age, occupation or description.",example:"I am a volunteer. The new members are nervous but friendly.",rows:`
The information card says: I ___ nineteen years old.|am|is|are|be|I đi với am khi nói tuổi; không dùng have theo mẫu tiếng Việt.
The room ___ quiet before the visitors arrive.|is|are|am|do|Room số ít nhận is trước tính từ quiet.
You and your partner ___ on the afternoon team.|are|is|am|does|You and your partner là nhóm số nhiều, dùng are.
`},
{title:"Making questions by moving be",topic:"Travel",cefr:"A2",rule:"With be, place am/is/are before the subject to make a question. Do not add do or does before an ordinary be question.",example:"Is the reception desk open? Are these seats available?",rows:`
___ the entrance on the left of the building?|Is|Does|Do|Are|Entrance số ít; câu hỏi với be bắt đầu Is the entrance.
Which question asks whether two tickets are valid?|Are these tickets valid?|Do these tickets are valid?|Is these tickets valid?|These tickets are valid?|Đảo are trước these tickets; không thêm do và không dùng is với số nhiều.
___ I in the right queue for the ferry?|Am|Is|Are|Does|Be với I là am; đảo Am I để hỏi.
`},
{title:"This and these: one item or several",topic:"Technology",cefr:"A2",rule:"This refers to one nearby item; these refers to more than one nearby item. Use a singular or plural noun and matching be form.",example:"This connector is loose. These cables are spare ones.",rows:`
You hold two batteries: ___ batteries are fully charged.|These|This|That|It|Hai batteries ở gần cần these số nhiều.
___ screen is brighter than my old one.|This|These|Those|They|Screen số ít nên dùng this trước danh từ.
Choose a correct statement about three nearby chargers.|These chargers are for visitors.|This chargers are for visitors.|These charger is for visitors.|This chargers is for visitors.|These và chargers cùng số nhiều, động từ are phù hợp.
`},
{title:"That and those: pointing further away",topic:"Geography",cefr:"A2",rule:"That refers to a singular item farther from the speaker; those refers to several. This/these normally points to nearby items.",example:"That island is rocky. Those boats near the distant harbour are fishing boats.",rows:`
Point to one distant hill: ___ hill has a tower.|That|Those|These|They|Một hill xa người nói dùng that.
Point to several houses across the valley: ___ houses look very small.|Those|That|This|It|Houses số nhiều ở xa dùng those.
Which phrase identifies one distant bridge?|that bridge|those bridge|these bridge|them bridge|That phù hợp danh từ số ít và khoảng cách xa.
`},
{title:"Possession with apostrophe-s",topic:"Education",cefr:"A2",rule:"Use 's after a singular possessor and an apostrophe after a regular plural ending in s. The possessive tells who something belongs to.",example:"The tutor's bag is red. The students' coats hang outside.",rows:`
One teacher owns the dictionary. Choose the correct phrase.|the teacher's dictionary|the dictionary's teacher|the teachers' dictionary|the teacher dictionary's|Một teacher sở hữu nên teacher's; teachers' chỉ nhiều giáo viên.
Several pupils share the classroom. Write their classroom as ___.|the pupils' classroom|the pupil's classroom|the classroom owns pupils|the pupil classroom's|Pupils số nhiều đã có s, thêm apostrophe sau s.
The bicycle belongs to my mother. It is my ___.|mother's bicycle|the bicycle's mother|mothers' bicycle|mother bicycle's|Mother số ít sở hữu nhận 's đứng trước bicycle.
`},
{title:"Whose asks about ownership",topic:"Travel",cefr:"A2",rule:"Whose asks who owns an item. Who asks about a person; who's is a contraction of who is or who has.",example:"Whose suitcase is this? It belongs to the guide.",rows:`
___ gloves are beside the lost-property box? I want to return them to the owner.|Whose|Who's|Who|Where|Đang hỏi chủ sở hữu gloves, nên dùng whose.
Choose the question that asks about the owner of a passport.|Whose passport is this?|Who's passport is this?|Who passport is this?|Where passport is this?|Whose + noun hỏi vật thuộc về ai.
In 'Who's waiting at the desk?', who's means ___.|who is|whose|who owns|who's owner|Who's là viết tắt who is trước waiting, không phải từ hỏi sở hữu.
`},
{title:"Countable portions for uncountable food",topic:"Food",cefr:"A2",rule:"Use a countable container or portion to count an uncountable substance: a bottle of water, two slices of toast. Do not normally add plural-s to the substance in this sense.",example:"We need three cups of tea and a bowl of soup.",rows:`
The waiter brings two ___ of water.|bottles|waters|bottle|a bottle|Two cần danh từ đếm được số nhiều bottles; water ở đây không đếm được.
Choose the natural order for bread at the counter.|two slices of bread|two breads slices|two slice of breads|a two bread|Slices là đơn vị đếm; bread giữ dạng không đếm được.
She serves each guest a ___ of soup.|bowl|soups|bowls|many|A yêu cầu bowl số ít; soup là chất chứa trong bát.
`},
{title:"Some in offers and requests",topic:"Community",cefr:"A2",rule:"Questions often use any, but offers and requests expecting a positive response commonly use some. Some can accompany plural or uncountable nouns.",example:"Would you like some tea? Could I have some paper?",rows:`
You offer refreshments: Would you like ___ lemonade?|some|many|a|an|Lời mời dùng some với lemonade không đếm được.
You politely request material: Could I have ___ coloured pencils?|some|a|an|much|Some phù hợp lời yêu cầu và pencils số nhiều.
Which question is a natural offer?|Would you like some grapes?|Would you like a grapes?|Would you like much grape?|Would you like an grapes?|Lời mời dùng some + grapes số nhiều; các lựa chọn khác sai đếm được.
`},
{title:"Many with items and much with substances",topic:"Commerce",cefr:"A2",rule:"Use many with plural countable nouns and much with uncountable nouns, especially in questions and negatives. A lot of can be used with either type.",example:"How many boxes arrived? We haven't got much tape.",rows:`
How ___ cardboard boxes should we order?|many|much|a|an|Boxes là danh từ đếm được số nhiều, dùng many.
There isn't ___ wrapping paper left.|much|many|a few|several|Wrapping paper không đếm được, phủ định dùng much.
Choose a correct statement about the packing table.|There are a lot of labels on the table.|There is many labels on the table.|There are much labels on the table.|There are a little labels on the table.|A lot of đi với labels số nhiều và are.
`},
{title:"How much: price versus quantity",topic:"Finance",cefr:"A2",rule:"How much asks a price or an amount of an uncountable substance. How many asks a number of countable items.",example:"How much is the membership? How much fuel is left?",rows:`
You want the price of one ticket: How ___ is a ticket?|much|many|often|long|How much is ... hỏi giá tiền, dù ticket là vật đếm được.
You want the number of coins: How ___ coins do you need?|many|much|long|old|How many đi với coins số nhiều để hỏi số lượng.
How much water is left asks about ___.|the amount of water|the number of bottles only|the age of the water|the time the shop opens|How much + water hỏi lượng chất không đếm được, không bắt buộc đếm chai.
`},
{title:"There was and there were in descriptions",topic:"History",cefr:"A2",rule:"Use there was for a singular or uncountable thing in a past setting and there were for plural things. It describes what existed or was present.",example:"There was a well in the courtyard. There were workshops outside the gate.",rows:`
In the old photograph, there ___ three chimneys on the roof.|were|was|is|has|Three chimneys số nhiều trong quá khứ nhận there were.
There ___ no electricity in the village at that time.|was|were|are|have|Electricity không đếm được; thời quá khứ dùng was.
___ there a school beside the mill in 1910?|Was|Were|Is|Do|A school số ít và năm quá khứ, câu hỏi là Was there.
`},
{title:"Location: in, on and under",topic:"Home",cefr:"A2",rule:"In describes being inside a space; on describes contact with a surface; under describes a lower position beneath something.",example:"The scarf is in the drawer. The book is on the shelf. The bag is under the bench.",rows:`
The spoon is inside the closed cupboard. It is ___ the cupboard.|in|on|above|beside|Inside tương ứng in, không nằm trên hoặc cạnh tủ.
The bowl rests on the table surface. It is ___ the table.|on|in|under|behind|Đồ chạm mặt trên table dùng on.
The shoes are beneath the sofa. They are ___ the sofa.|under|on|inside|over|Beneath diễn đạt vị trí thấp phía dưới, tương ứng under.
`},
{title:"Dates: on a day and in a month",topic:"Planning",cefr:"A2",rule:"Use on with days and specific dates; use in with months, years and seasons in ordinary time expressions.",example:"The meeting is on Friday. The course starts in September.",rows:`
The consultation is ___ 14 March.|on|in|at|to|Ngày cụ thể 14 March đi với on.
We plant these seeds ___ spring.|in|on|at|by on|Một mùa thường dùng in spring.
The new centre opened ___ 2018.|in|on|at|of|Năm đi với in trong cách nói thời gian này.
`},
{title:"Clock times with at",topic:"PublicServices",cefr:"A2",rule:"Use at with clock times and certain expressions such as at noon and at night. On introduces a day, not the hour alone.",example:"The counter opens at half past eight and closes at noon on Saturdays.",rows:`
The collection truck arrives ___ six thirty.|at|on|in|from of|Clock time six thirty dùng at.
We can meet ___ noon outside the office.|at|in|on|during at|Cụm at noon là cách dùng thời gian chuẩn.
Choose the correctly combined time and day.|at ten on Monday|on ten at Monday|in ten in Monday|at Monday on ten|Giờ dùng at; ngày Monday dùng on.
`},
{title:"Frequency words before ordinary verbs",topic:"Health",cefr:"A2",rule:"Usually, often and never normally go before an ordinary main verb but after be. They express frequency rather than the time of one event.",example:"She often walks after dinner. She is usually home by seven.",rows:`
Choose a natural word order.|I usually drink water with lunch.|I drink usually water with lunch.|Usually I water drink with lunch.|I drink water usually with lunch every usually.|Usually thường đứng trước main verb drink.
The therapist ___ late for appointments.|is never|never is to|never does|does never be|Với be, never thường theo sau: is never late.
He ___ takes the lift because he prefers the stairs. Use a word meaning zero occasions.|never|always|often|sometimes|Zero occasions nghĩa never, các từ còn lại có tần suất khác.
`},
{title:"Negative imperatives for safety",topic:"Technology",cefr:"A2",rule:"Use don't plus a base verb to tell someone not to do something. The subject you is usually omitted.",example:"Don't touch the wet cable. Keep the access route clear.",rows:`
The safety notice says: Don't ___ this cover while the machine is running.|open|opens|opening|opened|Sau don't trong mệnh lệnh cần base verb open.
Choose a correct prohibition.|Don't put drinks beside the keyboard.|Not put drinks beside the keyboard.|Doesn't put drinks beside the keyboard.|Don't puts drinks beside the keyboard.|Don't + base verb put tạo mệnh lệnh phủ định.
To tell visitors not to run, write ___.|Don't run in the corridor.|No run you corridor.|Doesn't run in the corridor.|Don't running in the corridor.|Run giữ dạng cơ bản sau don't.
`},
{title:"Let's for a shared suggestion",topic:"Sport",cefr:"A2",rule:"Let's plus a base verb proposes something for the speaker and listener to do together. Let's not makes the proposal negative.",example:"Let's practise the first exercise together. Let's not rush the warm-up.",rows:`
Let's ___ the route before we leave.|check|checks|checking|checked|Let's theo sau base verb check.
Which suggestion includes the speaker?|Let's take a short break.|You take a short break without me.|He takes a short break.|They took a short break yesterday.|Let's đề xuất hành động chung gồm người nói.
Choose a correct negative suggestion.|Let's not skip the warm-up.|Let's don't skip the warm-up.|Let's not skipping the warm-up.|Let's doesn't skip the warm-up.|Let's not + base verb là cấu trúc phủ định chuẩn.
`},
{title:"Want followed by to-infinitive",topic:"Education",cefr:"A2",rule:"Want commonly takes to plus a base verb when describing an intended action. Want to do something differs from want an object.",example:"I want to improve my handwriting. She wants a quieter desk.",rows:`
The new student wants ___ the choir.|to join|joining|join|joined|Want nhận to-infinitive to join.
I want to ___ the instructions again.|read|reading|reads|readed|Sau to dùng base form read.
Choose a correct sentence about a plan.|We want to study together tonight.|We want studying together tonight.|We want study together tonight.|We wants to studying together tonight.|Want + to study thể hiện mong muốn hành động.
`},
{title:"Like and would like mean different things",topic:"Travel",cefr:"A2",rule:"Like commonly describes enjoyment or preferences. Would like expresses a polite wish or request, often with to-infinitive.",example:"I like walking by the sea. I would like to book a room.",rows:`
You politely request a room: I ___ like a single room, please.|would|did|am|have|Would like là lời yêu cầu lịch sự, không phải sở thích chung.
Choose the sentence expressing enjoyment in general.|I like visiting quiet gardens.|I would like to book for tomorrow.|I liked the garden yesterday only.|I am a garden.|Like + visiting diễn đạt sở thích chung.
We would like ___ the museum after lunch.|to visit|visiting|visit|visited|Would like nhận to-infinitive to visit.
`},
{title:"Good at followed by an activity",topic:"Arts",cefr:"A2",rule:"Good at can be followed by a noun or an -ing activity. At is the normal preposition for this meaning of ability.",example:"She is good at drawing faces. He is good at rhythm games.",rows:`
My partner is good ___ remembering melodies.|at|on|for|from|Good at là kết hợp chỉ giỏi việc gì.
The child is good at ___ simple shapes.|drawing|draw|to draw|draws|Sau preposition at, động từ thành drawing.
Choose a grammatically correct description.|He is good at painting landscapes.|He is good to paint at landscapes.|He is good on painting landscapes.|He is good at paint landscapes.|Good at + -ing painting mô tả năng lực.
`},
{title:"Enjoy needs an -ing form",topic:"Nature",cefr:"A2",rule:"Enjoy takes a noun or an -ing verb form, rather than a to-infinitive. Its subject still determines present-simple agreement.",example:"We enjoy watching birds. She enjoys quiet walks.",rows:`
The group enjoys ___ birds from the hide.|watching|to watch|watch|watched|Enjoy nhận gerund watching, không to watch.
I enjoy ___ new plants in the garden.|growing|to grow|grow|grows|Sau enjoy, hoạt động viết dạng -ing growing.
Choose the correct sentence.|She enjoys walking through the meadow.|She enjoy walking through the meadow.|She enjoys to walk through the meadow.|She enjoying walk through the meadow.|She nhận enjoys, sau đó walking.
`},
{title:"Can and can't for ability",topic:"Technology",cefr:"A2",rule:"Can and can't take a base verb without to or -s. They describe ability or inability in the present context.",example:"I can use the spreadsheet. The old printer can't scan documents.",rows:`
This tablet can ___ video calls.|make|makes|making|to make|Can đi với base form make, không thêm s dù tablet số ít.
Choose a correct statement of inability.|I can't open the file on this device.|I don't can open the file on this device.|I can't to open the file on this device.|I can't opening the file on this device.|Can't tự mang phủ định; theo sau base verb open.
She can ___ the microphone to the computer.|connect|connects|connecting|connected|Modal can giữ động từ connect dạng cơ bản.
`},
{title:"Could for general past ability",topic:"Sport",cefr:"A2",rule:"Could plus a base verb describes general ability in the past. Couldn't describes inability. A particular completed success may need was able to at higher levels.",example:"When I was younger, I could swim for a long time.",rows:`
As a child, he could ___ without using a float.|swim|swam|swimming|to swim|Could mang nghĩa quá khứ; swim vẫn dạng cơ bản.
Which sentence describes general past ability?|She could ride a bicycle at six.|She can rides yesterday.|She could rode a bicycle at six.|She could to ride a bicycle at six.|Could + ride nêu năng lực trong thời thơ ấu.
I ___ lift that weight when I was small; it was too heavy.|couldn't|can tomorrow|could always|am able|Vật quá nặng và người nói hồi nhỏ không làm được, dùng couldn't.
`},
{title:"Was and were with past descriptions",topic:"Work",cefr:"A2",rule:"Use was with I and a singular third-person subject; use were with you and plural subjects for a past description.",example:"The workshop was cold. The trainees were ready before nine.",rows:`
The two supervisors ___ at the warehouse yesterday.|were|was|is|am|Hai supervisors số nhiều và yesterday, nên were.
I ___ tired after my first night shift.|was|were|are|be|I dùng was khi miêu tả quá khứ.
___ you satisfied with yesterday's training?|Were|Was|Are now|Does|You nhận were trong câu hỏi về yesterday.
`},
{title:"Past questions: did plus the base verb",topic:"Media",cefr:"A2",rule:"Did carries the past tense in questions with ordinary verbs. The main verb stays in its base form after did.",example:"Did the reporter call yesterday? Where did you see the announcement?",rows:`
Did the editor ___ your email last night?|receive|received|receives|receiving|Sau did, receive không thêm ed hoặc s.
Where ___ you find the old newspaper yesterday?|did|does|are|have to|Yesterday yêu cầu past simple; câu hỏi dùng did.
Choose a correct past question.|Did they publish the correction?|Did they published the correction?|Do they published the correction?|Were they publish the correction?|Did + subject + base verb publish tạo câu hỏi quá khứ.
`},
{title:"Next and last without a preposition",topic:"Planning",cefr:"A2",rule:"Expressions with next, last, this or every normally need no in/on/at before the time noun. Use a preposition with a specific date instead.",example:"We meet next Tuesday. We met on 5 May.",rows:`
Choose the usual expression for the coming week.|next week|in next week|on next week|at next week|Next week không cần preposition trong mẫu này.
The shop closed ___ Tuesday. Choose the option meaning the previous Tuesday.|last|in last|on last|at last|Last Tuesday là cụm thời gian tự đủ, không thêm in/on/at.
Which sentence uses the time phrase correctly?|The course begins this month.|The course begins in this month.|The course begins on this month.|The course begins at this month.|This month không cần giới từ thời gian.
`},
{title:"Adverbs describe how an action happens",topic:"Transport",cefr:"A2",rule:"An adjective usually describes a noun; an adverb describes how an action is done. Many manner adverbs add -ly, while good commonly becomes well.",example:"The careful driver parks carefully. She drives well.",rows:`
The learner drove ___ through the narrow gate.|carefully|careful|care|carefulness|Drove là hành động; carefully mô tả cách thực hiện.
She is a good cyclist and she rides ___.|well|good|goodly|wellness|Trạng từ của good trong nghĩa này là well.
Choose the sentence with a correct manner adverb.|The bus moved slowly through the crowd.|The bus moved slowliness through the crowd.|The bus moved a slowly through the crowd.|The bus moved slowestness through the crowd.|Slowly bổ nghĩa moved, thể hiện cách di chuyển.
`},
{title:"Because gives a reason; but gives contrast",topic:"Climate",cefr:"A2",rule:"Because introduces the cause or reason for a statement. But links contrasting ideas. The intended relationship determines the connector.",example:"We stayed indoors because it rained. It was wet, but the race continued.",rows:`
We carried umbrellas ___ heavy rain was forecast.|because|but|or|until after|Dự báo mưa là lý do mang ô, nên because.
The morning was cold, ___ the sun was bright.|but|because of|if then|so that to|Cold và bright sunshine tương phản nhưng cùng xảy ra; but phù hợp.
Choose the sentence that states a reason clearly.|The walk was cancelled because the bridge was unsafe.|The walk was cancelled but because of bridge was unsafe.|The walk was cancelled or the bridge because.|The walk cancelled because of was unsafe.|Because nối mệnh đề có subject + verb nêu nguyên nhân.
`},
{title:"Since identifies a starting point",topic:"Work",cefr:"B1",rule:"Use since with the start of a period continuing to now, commonly with present perfect. For introduces the length of the period.",example:"She has worked here since 2021. She has worked here for several years.",rows:`
The manager has led the team ___ January.|since|for|during of|ago|January là mốc bắt đầu, dùng since.
We have used this system ___ its launch.|since|for|ago|while of|Its launch là sự kiện mở đầu thời gian kéo đến nay.
Choose the correct continuing-time statement.|I have lived here since I left college.|I have lived here for I left college.|I live here ago I left college.|I have lived here during of I left college.|Since có thể giới thiệu mệnh đề quá khứ nêu mốc bắt đầu.
`},
{title:"For identifies a duration",topic:"Health",cefr:"B1",rule:"For plus a time span says how long. In a situation continuing to now, present perfect commonly links the duration to the present.",example:"He has followed the plan for three weeks.",rows:`
She has practised these exercises ___ two months.|for|since|ago|on|Two months là độ dài thời gian, dùng for.
Which phrase states a duration rather than a starting date?|for six days|since Monday|at noon|on 12 June|For six days nói khoảng dài sáu ngày.
I have waited ___ half an hour, and I am still here.|for|since|ago|at|Chờ tiếp đến hiện tại và half an hour là duration, dùng for.
`},
{title:"Already and yet in completion checks",topic:"Planning",cefr:"B1",rule:"Already often indicates completion earlier than expected in a positive statement. Yet often marks expected completion in questions or negatives.",example:"The team has already checked the labels. Have they tested the form yet?",rows:`
We haven't finished the risk review ___.|yet|already yesterday|since of|tomorrow ago|Phủ định present perfect dùng yet cho việc vẫn chưa hoàn tất.
The engineer has ___ repaired it, so no further visit is needed.|already|yet not|ago|since yesterday of|Already nêu việc đã hoàn thành và có kết quả hiện tại.
Choose a natural question about expected completion.|Have you submitted the checklist yet?|Have you submitted the checklist ago?|Did you have submit the checklist yet?|Are you submit the checklist already been?|Have + participle submitted, yet phù hợp câu hỏi hoàn tất.
`},
{title:"Finished time takes past simple",topic:"Travel",cefr:"B1",rule:"Use past simple with a finished date such as last July. Present perfect connects to now without a finished-time expression in the usual experience pattern.",example:"We stayed there last July. We have stayed there twice.",rows:`
The ranger ___ our group yesterday morning.|guided|has guided yesterday|has guiding|guides ago|Yesterday morning đã kết thúc nên guided là past simple.
No finished date is stated: We ___ that trail before, so we know the steep section.|have walked|walked tomorrow|had walk|are walk|Kinh nghiệm đến hiện tại với before dùng have walked.
Choose the sentence with a finished time and an appropriate tense.|She visited the island in 2019.|She has visited the island in 2019.|She has visiting the island in 2019.|She visits the island ago 2019.|In 2019 là quá khứ xác định; visited phù hợp.
`},
{title:"When in a future time clause",topic:"Technology",cefr:"B1",rule:"After when, as soon as or before in a future time clause, use present simple rather than will for the future event. The main clause can use will.",example:"I will send the file when the upload finishes.",rows:`
We will restart the device when the update ___.|finishes|will finishes|will finish|finished yesterday|When-clause nói tương lai thường dùng finishes.
As soon as the screen ___ ready, press Start.|is|will is|will be|was last week|As soon as giới thiệu time clause dùng present simple is.
Choose the correct future sequence.|I will call you before I leave.|I will call you before I will leave.|I call you before I will leaving.|I will call you before leaving I will.|Before I leave dùng hiện tại đơn trong mệnh đề thời gian tương lai.
`},
{title:"Present continuous for an arranged meeting",topic:"Education",cefr:"B1",rule:"Present continuous can describe a future arrangement, especially with a stated time and an agreed plan. Be must agree with the subject.",example:"We are meeting the tutor at four tomorrow.",rows:`
The appointment is confirmed: I ___ seeing the adviser on Thursday.|am|is|are|have|I + am seeing diễn đạt cuộc hẹn đã sắp xếp.
Choose the future arrangement with correct grammar.|They are visiting the laboratory tomorrow.|They is visiting the laboratory tomorrow.|They are visit the laboratory tomorrow.|They visiting the laboratory tomorrow are to.|They nhận are + visiting, tomorrow chỉ tương lai.
We ___ having the group interview at ten; everyone has agreed.|are|is|am|be|We + are having diễn đạt arrangement xác nhận.
`},
{title:"Will for a prediction rather than a timetable",topic:"Energy",cefr:"B1",rule:"Will plus a base verb often expresses the speaker's prediction. A published schedule normally uses present simple. Do not add -s after will.",example:"I think demand will rise. The scheduled inspection starts at nine.",rows:`
I think household energy use will ___ next winter.|increase|increases|increasing|increased|Prediction dùng will + base form increase.
The published schedule says the inspection ___ at nine tomorrow.|starts|will starts|starting|to starts|Lịch cố định dùng present simple starts; will starts sai dạng.
Choose a correctly formed prediction.|Prices will probably fall next month.|Prices will probably falls next month.|Prices will probably falling next month.|Prices will probably to fall next month.|Will theo sau fall dạng cơ bản; probably thể hiện dự đoán.
`},
{title:"Going to for an evidence-based prediction",topic:"Climate",cefr:"B1",rule:"Be going to plus a base verb can predict an event from current evidence. Choose the be form to match the subject.",example:"Those dark clouds suggest it is going to rain.",rows:`
The loose sign is moving in the wind. It is going to ___.|fall|falls|falling|fell|Going to cần base verb fall; có bằng chứng hiện tại.
Look at the overflowing bucket: the water ___ going to spill.|is|are|am|has|Water không đếm được làm subject số ít, dùng is.
Choose the complete evidence-based prediction.|Those clouds mean we are going to get wet.|Those clouds mean we going to get wet.|Those clouds mean we is going to get wet.|Those clouds mean we are going getting wet.|We are going to + get là cấu trúc đúng.
`},
{title:"Unless means if not",topic:"PublicServices",cefr:"B1",rule:"Unless introduces a condition meaning if not. Use present simple in an ordinary future condition; avoid an unnecessary second negative.",example:"The event will continue unless the river rises further.",rows:`
The pool will open unless the safety check ___.|fails|will fail|will fails|failing|Unless-clause nói điều kiện tương lai dùng present simple fails.
'Unless you register, you cannot enter' means ___.|If you do not register, you cannot enter.|If you register, you cannot enter.|Registration is forbidden.|Everyone can enter without registering.|Unless you register tương đương if you do not register.
Choose the condition allowing entry except when an application is rejected.|You may enter unless your application is rejected.|You may enter unless your application is not rejected.|You may enter if rejection is required.|You may enter unless applying you rejected.|Unless rejected cho phép vào trừ khi bị từ chối; phủ định thêm làm đổi nghĩa.
`},
{title:"Second conditional for an unlikely present situation",topic:"Urban",cefr:"B1",rule:"Use if plus past form and would plus base verb to imagine an unlikely or unreal present/future situation. The past form here marks distance from reality.",example:"If the flat were larger, we would add a study room.",rows:`
If I had a quieter room, I ___ study more comfortably.|would|will to|had|am to|Giả định hiện tại dùng would + study.
We do not own a car. If we ___ one, parking would be difficult.|had|have tomorrow|will have|having|Second conditional dùng past form had cho giả định trái hiện tại.
Choose the correctly formed imagined result.|If the path were wider, wheelchairs would pass easily.|If the path will wider, wheelchairs would passes easily.|If the path wider, wheelchairs had pass easily.|If the path is widened yesterday, wheelchairs would passing.|If were + would base pass tạo giả định hiện tại chuẩn.
`},
{title:"Used to for a discontinued habit",topic:"History",cefr:"B1",rule:"Used to plus a base verb describes a past habit or state that is no longer true. After did or didn't, use use to.",example:"The town used to hold a weekly livestock market.",rows:`
The square used to ___ a fountain, but it was removed.|have|had|having|has|Used to đi với have dạng cơ bản.
Choose the correct negative about a past habit.|We didn't use to visit this district.|We didn't used to visit this district.|We not used to visiting this district.|We didn't using to visit this district.|Didn't mang quá khứ; use to giữ base form.
'She used to cycle to work' normally suggests ___.|Cycling to work was a past habit that has changed.|She will cycle for the first time tomorrow.|She is accustomed to every current route.|She never cycled at any time.|Used to nói thói quen quá khứ không còn như trước.
`},
{title:"Ask or tell someone to act",topic:"Work",cefr:"B1",rule:"Ask/tell plus an object and to-infinitive describes a request or instruction. A negative instruction uses not to before the base verb.",example:"The supervisor asked us to label the boxes and told us not to block the door.",rows:`
The manager asked the assistant ___ the visitor list.|to update|updating|update|updated|Ask + person + to-infinitive là mẫu chuẩn.
She told us ___ enter the storage room without permission.|not to|to not have|don't|not|Phủ định mệnh lệnh gián tiếp dùng object + not to enter.
Choose a correct reported instruction.|The ranger told the walkers to stay on the path.|The ranger told to stay the walkers on the path.|The ranger told the walkers staying on the path.|The ranger told the walkers stay on the path.|Tell cần object rồi to + base stay.
`},
{title:"Too and enough describe a usable limit",topic:"Home",cefr:"B1",rule:"Too plus adjective indicates excess for a purpose. Adjective plus enough indicates sufficient degree. Enough precedes a noun.",example:"The shelf is too high to reach. The chair is strong enough to support the box.",rows:`
The doorway is wide ___ for the trolley.|enough|too|such|many|Enough đứng sau adjective wide.
The tea is ___ hot to drink safely now.|too|enough|much of|many|Too hot to drink nêu nhiệt độ vượt mức phù hợp.
Choose the statement meaning sufficient space is available.|We have enough room for both desks.|We have room enoughly for both desks.|We have too room for both desks.|We have enough of room a both desks.|Enough đứng trước danh từ room để nói lượng đủ.
`},
{title:"An infinitive can explain purpose",topic:"Environment",cefr:"B1",rule:"To plus a base verb can explain why an action is done. For plus a noun can name an intended use; avoid for to in this ordinary pattern.",example:"They planted shrubs to shelter the garden from wind.",rows:`
We put a lid on the tank ___ keep leaves out.|to|for to|for|because to|To keep diễn đạt mục đích của hành động đậy nắp.
Choose the correct purpose phrase.|The volunteers came to collect litter.|The volunteers came for collect litter.|The volunteers came to collecting litter.|The volunteers came for to collecting litter.|To collect dùng base verb sau to.
She recorded the coordinates ___ the site could be found later.|so that|to because|for to|because of that to|So that giới thiệu mệnh đề mục đích có subject the site + could.
`},
{title:"Mustn't prohibits; needn't removes necessity",topic:"Health",cefr:"B1",rule:"Mustn't means an action is not allowed. Needn't or don't have to means it is not necessary but may still be allowed.",example:"You mustn't enter the sterile area. You needn't bring your own towel.",rows:`
The sign forbids food in the room: You ___ eat here.|mustn't|needn't|don't have to|may choose to|Forbidden tương ứng mustn't, không phải chỉ không cần ăn.
Towels are supplied, so visitors ___ bring their own.|needn't|mustn't|are forbidden to|cannot ever|Đã được cấp nên không bắt buộc mang; needn't phù hợp.
'You don't have to attend' means ___.|Attendance is optional.|Attendance is prohibited.|Attendance has already happened.|Attendance is required tomorrow.|Don't have to loại bỏ nghĩa vụ, không cấm tham gia.
`},
{title:"Should gives advice with a base verb",topic:"Sport",cefr:"B1",rule:"Should and shouldn't normally express advice rather than strict permission. They take a base verb without to or -s.",example:"You should check your shoes before the hike.",rows:`
Beginners should ___ the pace gradually.|increase|increases|increasing|to increase|Should theo sau base verb increase.
Choose a correctly formed piece of advice.|You shouldn't ignore pain during exercise.|You shouldn't to ignore pain during exercise.|You don't should ignore pain during exercise.|You shouldn't ignores pain during exercise.|Shouldn't đã mang phủ định; dùng ignore dạng cơ bản.
The coach says we should rest. This is mainly ___.|a recommendation|a completed past event|proof that rest is forbidden|a question about ownership|Should trong câu này đưa lời khuyên, không kể chuyện quá khứ.
`},
{title:"Could you and would you for polite requests",topic:"Community",cefr:"B1",rule:"Could you and would you followed by a base verb commonly make polite requests. They do not necessarily refer to past time.",example:"Could you hold the door? Would you sign this form?",rows:`
Could you ___ the chairs away from the exit?|move|moved|moving|to move|Could you + move là yêu cầu lịch sự, không chuyển verb sang quá khứ.
Choose the correctly formed request.|Would you show me the booking sheet?|Would you showed me the booking sheet?|Would you to show me the booking sheet?|Would you showing me the booking sheet?|Would you cần base form show.
In 'Could you help me now?', could mainly expresses ___.|a polite request|an event completed yesterday|a prohibition|a count of helpers|Now cho thấy yêu cầu hiện tại; could tăng lịch sự.
`},
{title:"Present passive for a routine process",topic:"Commerce",cefr:"B1",rule:"Use am/is/are plus a past participle when the subject receives an action. In present passive, be carries subject agreement.",example:"Parcels are weighed before they are dispatched.",rows:`
Each product ___ checked before sale.|is|are|have|does|Each product số ít nhận is checked trong passive.
The labels are ___ by the office printer.|printed|printing|print|prints|Sau are passive cần past participle printed.
Choose the correct passive description.|Payments are recorded automatically.|Payments is recorded automatically.|Payments are recording automatically by the system.|Payments recorded are to automatically.|Payments số nhiều + are recorded thể hiện việc được ghi nhận.
`},
{title:"Past passive for a completed repair",topic:"PublicServices",cefr:"B1",rule:"Use was/were plus a past participle to describe a completed action received by the subject in the past.",example:"The damaged pipe was replaced last night.",rows:`
The streetlights ___ repaired yesterday.|were|was|is|have to|Streetlights số nhiều, past passive là were repaired.
The road was ___ after the inspection.|reopened|reopening|reopen|reopens|Past passive dùng participle reopened.
Choose the correct past passive sentence.|The warning notice was removed on Monday.|The warning notice were removed on Monday.|The warning notice was removing on Monday by staff.|The warning notice removed on Monday was to.|Notice số ít + was removed mô tả tác động đã hoàn tất.
`},
{title:"Who and which in defining relative clauses",topic:"Education",cefr:"B1",rule:"Who usually refers to people and which to things. A defining relative clause identifies which person or thing is meant and normally has no commas.",example:"The tutor who teaches chemistry is away. The room which has the projector is upstairs.",rows:`
The student ___ won the competition will give a short talk.|who|which|where|whose of|Student là người và làm chủ ngữ won, dùng who.
The workbook ___ contains practice tests is on the desk.|which|who|where|when|Workbook là vật, relative subject dùng which.
Choose the correctly linked description.|The teacher who runs the club is new.|The teacher which runs the club is new.|The teacher where runs the club is new.|The teacher whose runs the club is new.|Who thay teacher và làm chủ ngữ runs.
`},
{title:"Where describes the place of an action",topic:"Travel",cefr:"B1",rule:"Where introduces a relative clause in which an action happens at a place. Use which/that when the place itself is the object of the verb.",example:"The hostel where we stayed is small. The hostel that we booked is small.",rows:`
The café ___ we had lunch overlooks the harbour.|where|who|whose|when|Had lunch diễn ra tại café, nên where.
The museum ___ we visited has a new gallery.|that|where|when|who|We visited cần object là museum; that phù hợp, không where.
Choose the place-relative clause with correct meaning.|This is the beach where the boats land.|This is the beach who the boats land.|This is the beach which the boats land.|This is the beach whose the boats land.|Boats land tại beach, where chỉ địa điểm hành động.
`},
{title:"Comparing equality with as...as",topic:"Technology",cefr:"B1",rule:"Use as plus a base adjective or adverb plus as for equality. Not as...as expresses a lower degree. Do not use a comparative form inside this pattern.",example:"The new screen is as bright as the old one.",rows:`
This battery lasts as ___ as the other one.|long|longer|longest|length|As...as dùng base adjective/adverb long.
The older model is not as ___ as this one.|reliable|more reliable|most reliable|reliably of|Sau not as cần base adjective reliable.
Choose a statement of equal weight.|The two devices are as heavy as each other.|The two devices are as heavier as each other.|The two devices are heavy than each other equal.|The two devices are as heaviest as each other.|As heavy as diễn đạt bằng nhau về cân nặng.
`},
{title:"Much and a little modify a comparative",topic:"Transport",cefr:"B1",rule:"Much, far and a little can modify comparative forms. Very normally modifies a base adjective rather than a comparative.",example:"The new route is much shorter. The detour is a little longer.",rows:`
The direct train is ___ faster than the stopping service.|much|very|most|as|Much bổ nghĩa faster; very faster không chuẩn.
The revised walk is a little ___ than the original one.|longer|longest|long|length|Than và a little cùng chỉ mức so sánh hơn, dùng longer.
Choose a natural comparative description.|The new seats are far more comfortable.|The new seats are very more comfortable.|The new seats are far most comfortable than.|The new seats are far comfortable than.|Far more comfortable tăng mức comparative của tính từ dài.
`},
{title:"Superlatives with experience clauses",topic:"Arts",cefr:"B1",rule:"A superlative can be followed by a present-perfect experience clause to compare with all relevant experiences up to now. Use the before the ordinary superlative noun phrase.",example:"It is the most moving film I have seen.",rows:`
This is the ___ exhibition I have visited.|most varied|more varied|much varied|varied than|So toàn bộ trải nghiệm dùng superlative most varied.
It is ___ best recital I have heard this year.|the|a|an|some|The đi trước superlative best trong noun phrase này.
Choose the correct experience comparison.|That was the quietest gallery I have ever entered.|That was quieter gallery I have ever entered all.|That was the most quietest gallery I have ever entered.|That was the quietest gallery I have ever enter.|Quietest đã là superlative; have entered cần participle.
`},
{title:"Reported statements with a past reporting verb",topic:"Media",cefr:"B1",rule:"After said or reported in past narration, present simple commonly shifts to past simple. Pronouns and time references should match the reporting viewpoint.",example:"The editor said, 'I need the image.' Later: The editor said she needed the image.",rows:`
Yesterday he said, 'I work at the station.' Report it with normal backshift.|He said he worked at the station.|He said he works yesterday station.|He said I worked at the station.|He said he working at the station.|Past reporting said shifts work to worked and I to he.
The guide said she ___ a spare map. Use normal backshift from 'I have a spare map'.|had|has yesterday|having|have|Have trong trực tiếp thường backshift thành had.
Choose the correctly formed reported statement.|They said the office was closed.|They said that the office is been closed yesterday.|They said was the office closed.|They said the office were closed.|Statement giữ thứ tự subject + verb, office số ít was.
`},
{title:"Reported questions keep statement word order",topic:"Work",cefr:"B1",rule:"In a reported question, use subject before verb and do not keep the direct-question do/does/did. If/whether can introduce a reported yes/no question.",example:"She asked where the files were. He asked if the form was ready.",rows:`
Report 'Where is the entrance?' correctly.|She asked where the entrance was.|She asked where was the entrance.|She asked where did the entrance was.|She asked where the entrance did is.|Reported where-clause dùng subject the entrance trước was.
He asked ___ the delivery had arrived.|if|that question|what if had|does|If giới thiệu yes/no reported question.
Choose the correct report of 'What time does it close?' with backshift.|He asked what time it closed.|He asked what time did it close.|He asked what time it did closed.|He asked what time closed it.|Bỏ does và giữ subject it + closed.
`},
{title:"Prepositions followed by -ing",topic:"Planning",cefr:"B1",rule:"When a verb follows a preposition such as after, without or by, use an -ing form. This differs from to used as an infinitive marker.",example:"Check the list before leaving. We saved time by sharing the tasks.",rows:`
They improved the schedule by ___ unnecessary steps.|removing|remove|to remove|removed|By là preposition, theo sau removing.
Do not publish the file without ___ its contents.|checking|check|to check|checked|Without nhận gerund checking.
Choose a correct sequence phrase.|After reviewing the plan, we changed the deadline.|After to review the plan, we changed the deadline.|After review the plan, we changed the deadline.|After reviewed the plan, we changed the deadline.|After + reviewing tạo cụm nói hành động trước đó.
`},
{title:"Question tags use the matching auxiliary",topic:"Community",cefr:"B1",rule:"An ordinary positive statement commonly takes a negative tag, and a negative statement a positive tag. Match the tense, auxiliary and subject pronoun.",example:"The hall is open, isn't it? You didn't book online, did you?",rows:`
The meeting starts at seven, ___?|doesn't it|isn't it|didn't it|don't they|Present simple starts nhận auxiliary does trong tag; meeting thay it.
You haven't signed the form, ___?|have you|haven't you|did you|are you|Statement phủ định haven't nên tag khẳng định have you.
The volunteers were helpful, ___?|weren't they|wasn't it|didn't they|aren't it|Were và volunteers số nhiều tương ứng weren't they.
`},
{title:"Present perfect continuous for an ongoing activity",topic:"Research",cefr:"B2",rule:"Have/has been plus -ing emphasises an activity continuing to now or with a present result. Use a simple perfect for many completed counts.",example:"The analysts have been checking records all morning. They have checked sixty records.",rows:`
The task is still in progress: We ___ analysing the interviews since nine.|have been|have done|are yesterday|had to be yesterday|Since nine nối đến hiện tại và đang tiếp tục, dùng have been analysing.
Choose the form emphasising a completed count.|We have coded forty interviews.|We have been forty interviews coded.|We are coded forty interviews since.|We have coding forty interviews.|Have coded nhấn số lượng hoàn tất, không continuous sai cấu trúc.
She has been ___ the data, which is why her desk is covered in printouts.|reviewing|review|reviewed|reviews|Perfect continuous cần been + reviewing.
`},
{title:"Past perfect orders two past events",topic:"History",cefr:"B2",rule:"Had plus a past participle places an event before another past reference point. The later event commonly uses past simple.",example:"The archive had closed before the visitor arrived.",rows:`
By the time the historian arrived, the documents ___ been moved.|had|have|are|will|Mốc arrived ở quá khứ; việc move xảy ra trước, dùng had been moved.
Choose the earlier event in 'The bridge had collapsed before the rescue team arrived'.|The bridge collapsed.|The rescue team arrived.|Both happened after today.|The rescue team built a bridge.|Had collapsed đánh dấu sự kiện trước arrived.
The curator had ___ the object before the label was printed.|identified|identify|identifying|identifies|Past perfect cần past participle identified.
`},
{title:"Future continuous for activity at a future moment",topic:"Travel",cefr:"B2",rule:"Will be plus -ing describes an activity in progress at a future time, or an expected activity in the normal course of events.",example:"At midday tomorrow, we will be crossing the plateau.",rows:`
At ten tomorrow, the group will be ___ through the gorge.|walking|walk|walked|walks|Future continuous cấu tạo will be walking.
Choose the sentence describing an activity in progress at a stated future time.|At sunset, we will be sailing towards the island.|At sunset, we will sailed towards the island.|At sunset, we be sail towards the island.|At sunset, we will being sail towards the island.|Will be sailing đặt hoạt động đang diễn ra ở mốc sunset tương lai.
During your call tomorrow, I ___ be travelling, so reception may be poor.|will|have|am yesterday|had|Will be travelling là continuous tương lai thích hợp.
`},
{title:"Future perfect for a deadline",topic:"Planning",cefr:"B2",rule:"Will have plus a past participle describes completion before a stated future point, often introduced by by or by the time.",example:"By Friday, the team will have completed the checks.",rows:`
By the end of the month, we will have ___ the trial.|finished|finish|finishing|finishes|Will have cần participle finished cho hoàn tất trước deadline.
Choose the sentence emphasising completion before a future date.|By June, the repairs will have been completed.|By June, the repairs will being completed.|By June, the repairs will have completing.|By June, the repairs have will completed.|Future perfect passive là will have been completed.
'They will have left by six' means ___.|Their departure is expected to be complete no later than six.|They necessarily start leaving after six.|They left yesterday at six.|They must remain until next week.|By six nêu giới hạn hoàn tất, không thời điểm bắt đầu sau sáu giờ.
`},
{title:"Third conditional for an unreal past",topic:"Transport",cefr:"B2",rule:"Use if plus past perfect and would have plus participle to imagine a different past condition and outcome.",example:"If we had read the notice, we would have avoided the closed road.",rows:`
If the driver had checked the route, she would have ___ the delay.|avoided|avoid|avoiding|avoids|Would have cần participle avoided trong kết quả giả định quá khứ.
Choose the correct unreal-past condition.|If the signal had worked, the train would have stopped.|If the signal has worked, the train would stopped.|If the signal would have worked, the train had stop.|If the signal worked tomorrow, the train would have stops.|If had worked + would have stopped tạo third conditional.
We missed the bus. If we ___ left earlier, we would have caught it.|had|have|will|would|If-clause quá khứ trái thực dùng had left.
`},
{title:"Mixed conditional: past cause and present result",topic:"Work",cefr:"B2",rule:"If plus past perfect can combine with would plus a base verb when an unreal past event has an imagined present consequence.",example:"If I had accepted the transfer, I would live abroad now.",rows:`
She rejected the course last year. If she had taken it, she ___ qualified now.|would be|would have been yesterday only|will be yesterday|had being|Now là kết quả hiện tại của điều kiện quá khứ, dùng would be.
Choose the correctly mixed time pattern.|If we had saved the manual, we would know the procedure now.|If we have save the manual, we would knew now.|If we saved tomorrow, we would have known now yesterday.|If we would have saved the manual, we had know now.|Had saved nói quá khứ; would know now nói hiện tại trái thực.
If he had trained in accounting, he would ___ the figures more easily today.|understand|understood|understanding|have understand|Would + base understand cho kết quả hiện tại today.
`},
{title:"Wish plus past form for present dissatisfaction",topic:"Home",cefr:"B2",rule:"Wish plus a past form can express a desired situation that differs from the present. Formal English often uses were with be in this pattern.",example:"I wish the room were quieter.",rows:`
Our flat has no balcony. I wish it ___ one.|had|has|will have|having|Wish + had diễn đạt trái tình hình hiện tại.
Choose the desired present situation using the formal were pattern.|I wish the windows were larger.|I wish the windows will larger.|I wish the windows are been larger.|I wish the windows have larger.|Wish + were biểu đạt mong hiện tại khác đi.
She wishes she ___ closer to the library; the current journey is long.|lived|lives|will lives|living|Past form lived sau wishes nói mong trái hiện tại, không quá khứ thật.
`},
{title:"Wish plus past perfect for a past regret",topic:"Education",cefr:"B2",rule:"Wish plus had and a past participle expresses regret about a completed past event. The event cannot now be changed by the grammar.",example:"I wish I had checked the submission date.",rows:`
I submitted late yesterday. I wish I ___ read the reminder.|had|have|will|would to|Regret về hôm qua dùng had read.
Choose a past-regret sentence.|She wishes she had chosen the earlier seminar.|She wishes she chooses the earlier seminar yesterday.|She wishes she has choose the earlier seminar.|She wishes she choosing the earlier seminar.|Wish + had chosen nêu lựa chọn quá khứ muốn khác.
We wish we had ___ more carefully before answering.|listened|listen|listening|listens|Had nhận participle listened.
`},
{title:"Be used to versus used to",topic:"Society",cefr:"B2",rule:"Be used to plus noun or -ing means accustomed to. Used to plus base verb describes a discontinued past habit. To is a preposition in be used to.",example:"I am used to sharing a kitchen. I used to live alone.",rows:`
She is used to ___ with a large household.|living|live|lived|to live|Be used to nhận gerund living vì to là preposition.
'He used to work nights' differs from 'He is used to working nights' because the first describes ___.|a past habit rather than current familiarity|a future guarantee|a compulsory current rule|a prohibition|Used to work là thói quen quá khứ; is used to working là đã quen.
Choose the correctly formed accustomed statement.|We are used to the noisy market.|We are use to the noisy market.|We used to the noisy market now are.|We are used the noisy market to.|Are used to + noun phrase mô tả đã quen.
`},
{title:"Get used to describes becoming accustomed",topic:"Travel",cefr:"B2",rule:"Get used to plus noun or -ing describes the process of becoming familiar with something. It can take different tenses.",example:"We gradually got used to the higher altitude.",rows:`
It took time to get used to ___ on the left.|driving|drive|drove|to drive|To trong get used to là preposition; dùng driving.
Choose the sentence describing a completed adjustment.|I got used to the unfamiliar timetable after a week.|I got used to follow the unfamiliar timetable after a week.|I get used yesterday timetable after a week.|I got use to the unfamiliar timetable after a week.|Got used to + noun mô tả quá trình thích nghi đã hoàn tất.
She is getting used to the climate means ___.|She is in the process of becoming accustomed to it.|She has never noticed the climate.|She no longer lives in that climate.|The climate is legally required.|Getting used to nhấn quá trình quen dần hiện tại.
`},
{title:"Have something done by another person",topic:"Home",cefr:"B2",rule:"Have plus an object and past participle can describe arranging a service by someone else. The object receives the action.",example:"We had the roof inspected by a surveyor.",rows:`
The owners had the windows ___ last month.|replaced|replacing|replace|replaces|Object windows được tác động, dùng participle replaced.
'She had her boiler serviced' normally means ___.|She arranged for someone to service it.|She necessarily did every step herself.|The boiler served her a meal.|She bought a boiler tomorrow.|Causative have nói sắp xếp dịch vụ, không khẳng định chủ thể tự làm.
Choose the correct service arrangement.|We are having the kitchen painted.|We are having painted the kitchen to.|We are have the kitchen painting.|We having the kitchen paints.|Have + object kitchen + participle painted là mẫu chuẩn.
`},
{title:"Passive reporting: is said to",topic:"Media",cefr:"B2",rule:"A passive reporting structure can use subject plus is/are said or believed plus to-infinitive. A perfect infinitive refers to an earlier action.",example:"The building is said to be older than the records suggest.",rows:`
The painting is believed ___ from the seventeenth century.|to date|dating|date|dated to|Is believed nhận to-infinitive to date.
Choose the correct reported passive.|The artefacts are thought to have been traded locally.|The artefacts are thought have traded locally to.|The artefacts is thought to have traded locally.|The artefacts are thinking to been traded locally.|Are thought + perfect passive infinitive to have been traded nói hành động trước.
'The tower is said to have collapsed in 1800' places the collapse ___.|before the present reporting situation|after next year|only after the report tomorrow|at an unspecified future deadline|To have collapsed là perfect infinitive nhấn sự kiện trước hiện tại.
`},
{title:"Non-defining relatives add extra information",topic:"History",cefr:"B2",rule:"A non-defining relative is separated by commas and adds supplementary information. Use who or which rather than that in the ordinary non-defining pattern.",example:"The old hall, which was restored recently, is open again.",rows:`
The museum, ___ opened in 1932, has a new entrance.|which|that|what|where it|Commas cho thấy thông tin thêm; which thay museum làm subject opened.
Choose the correct supplementary clause.|The curator, who lives nearby, cycles to work.|The curator, that lives nearby, cycles to work.|The curator, whom nearby lives, cycles to work.|The curator, which lives nearby, cycles to work.|Người dùng who và commas bao mệnh đề thêm.
In 'My only brother, who is a doctor, lives abroad', the relative clause is ___.|extra information about an already identified person|needed to choose one brother from several|a direct question|a command to the doctor|My only brother đã xác định người; who-clause thêm thông tin.
`},
{title:"Whose links possession in relative clauses",topic:"Arts",cefr:"B2",rule:"Whose plus a noun introduces a possessive relationship in a relative clause. It can refer to people and, in suitable formal contexts, organisations or things.",example:"The artist whose studio flooded is exhibiting elsewhere.",rows:`
The composer ___ score won the award will attend.|whose|who's|who|which's|Score thuộc composer, nên whose + score.
Choose the correct possessive relative.|The gallery whose roof was damaged has reopened.|The gallery who roof was damaged has reopened.|The gallery which roof was damaged has reopened.|The gallery who's roof was damaged has reopened.|Whose roof diễn đạt mái của gallery, không who's = who is.
The volunteer whose bicycle was stolen refers to ___.|the volunteer who owned the stolen bicycle|the person who stole every bicycle|the bicycle that owned a volunteer|a future buyer of a bicycle|Whose nêu quan hệ sở hữu giữa volunteer và bicycle.
`},
{title:"Relative prepositions in formal writing",topic:"Research",cefr:"B2",rule:"In formal relatives, a preposition may precede which or whom. Do not use that immediately after a fronted preposition.",example:"The method on which the analysis relies is explained below.",rows:`
The framework on ___ this measure is based was revised.|which|that|what|who|Sau preposition on trong relative dùng which cho vật.
Choose the formal relative referring to people.|The participants to whom we sent reminders returned the forms.|The participants to that we sent reminders returned the forms.|The participants to which we sent reminders returned the forms.|The participants to who we sent reminders returned the forms.|To whom là dạng formal đúng chỉ people.
The report ___ which the figures were taken is publicly available.|from|of to|than|despite from|Figures were taken from the report, nên from which.
`},
{title:"Despite followed by a noun or -ing",topic:"Climate",cefr:"B2",rule:"Despite and in spite of normally take a noun or -ing phrase. Although takes a clause with its own subject and verb.",example:"Despite the rain, the work continued. Although it rained, the work continued.",rows:`
Despite ___ little sleep, the team followed the safety checklist.|getting|they got|got|to get|Despite nhận gerund getting, không mệnh đề trần.
Choose the correct contrast sentence.|Although the wind was strong, the ferry operated.|Despite the wind was strong, the ferry operated.|In spite the wind was strong, the ferry operated.|Although of the wind strong, the ferry operated.|Although đi với clause the wind was strong.
In spite ___ the heat, the volunteers finished early.|of|to|for|by|Cụm chuẩn in spite of + noun phrase.
`},
{title:"Even though and even if differ",topic:"Policy",cefr:"B2",rule:"Even though introduces a fact contrasted with the result. Even if introduces a hypothetical condition; it does not assert that the condition is true.",example:"Even though the grant was small, it helped. Even if the grant is refused, the plan will continue.",rows:`
The fee was definitely higher, but attendance rose: ___ the fee was higher, attendance rose.|Even though|Even if tomorrow|Unless|As long as not|Điều higher fee là sự thật đã biết, dùng even though.
'Even if the application fails, we will try again' means ___.|Trying again does not depend on success this time.|The application has definitely failed.|They will try again only if it succeeds.|Trying again is prohibited.|Even if giữ result trong tình huống giả định, không khẳng định failure đã xảy ra.
Choose the hypothetical-condition version.|Even if costs rise, we will maintain the service.|Even though costs might tomorrow condition rise only.|Despite costs rise, we will maintain the service.|Even if of costs rising, we will maintain the service.|Even if + clause nêu điều kiện có thể xảy ra.
`},
{title:"So and such in result structures",topic:"Commerce",cefr:"B2",rule:"So usually precedes an adjective/adverb; such precedes a noun phrase. So/such...that can explain an outcome.",example:"The queue was so long that we waited outside. It was such a long queue that we waited outside.",rows:`
It was ___ a confusing label that customers asked for help.|such|so|too so|enough|Such đứng trước a + adjective + noun label.
The text was ___ small that many readers missed it.|so|such|such a|enough of|So bổ nghĩa adjective small.
Choose a correct result structure.|It was such an expensive repair that we compared alternatives.|It was so an expensive repair that we compared alternatives.|It was such expensive that repair compared.|It was an expensive such repair that we compared alternatives.|Such an + adjective + singular noun phù hợp kết quả that-clause.
`},
{title:"Gerund or infinitive after stop",topic:"Technology",cefr:"B2",rule:"Stop doing means end an activity. Stop to do means interrupt another activity in order to perform the infinitive action.",example:"She stopped typing. She stopped to answer a call.",rows:`
'He stopped checking his phone' means ___.|He ended the activity of checking it.|He paused another task in order to check it.|He promised to check it tomorrow.|He never owned a phone.|Stop + gerund kết thúc activity checking.
We paused the installation ___ read the warning carefully.|to|for reading of|that|of|Stopped/paused to read nêu mục đích của sự gián đoạn.
Choose the sentence meaning the alarms no longer sounded.|The alarms stopped ringing.|The alarms stopped to ring.|The alarms stopped for ring.|The alarms stopped ring to.|Stopped ringing nghĩa việc reo đã kết thúc.
`},
{title:"Remember doing versus remember to do",topic:"Planning",cefr:"B2",rule:"Remember doing recalls a past action. Remember to do means not forget a necessary future or intended action.",example:"I remember locking the door. Remember to lock it before leaving.",rows:`
'I remember saving the document' refers to ___.|a memory of an earlier save|an instruction to save later only|a file that cannot be saved|a future certainty without evidence|Remember + saving nhớ lại hành động quá khứ.
Before you leave, remember ___ the lights off.|to turn|turning yesterday|turned|turns|Nhắc làm việc cần thực hiện dùng remember to turn.
Choose the sentence about recalling a previous visit.|She remembers meeting the curator last year.|She remembers to meet the curator last year.|She remembers met the curator last year.|She remember meeting the curator last year.|Remembers meeting nói ký ức việc đã gặp, last year xác nhận quá khứ.
`},
{title:"Try doing versus try to do",topic:"Health",cefr:"B2",rule:"Try to do means make an effort to achieve something. Try doing suggests an experiment with a possible solution.",example:"Try moving the chair closer. I tried to lift the box but it was too heavy.",rows:`
The lamp still flickers. Try ___ a different bulb as an experiment.|using|use|used|uses|Try using đề xuất thử một giải pháp.
'I tried to open the stiff door' mainly describes ___.|an effort to achieve an action|a definite memory of opening it|a prohibition on entry|a guaranteed successful experiment|Try to open nhấn cố gắng, chưa chắc thành công.
Choose a sentence proposing an experimental change.|Try sitting further from the screen and see if it helps.|Try sat further from the screen and see if it helps.|Try sit further from the screen and see if it helps.|Try sits further from the screen and see if it helps.|Try + sitting diễn đạt thử cách ngồi mới.
`},
{title:"Would rather plus a base verb",topic:"Travel",cefr:"B2",rule:"Would rather plus a base verb expresses preference. When the preferred action has another subject, a past form commonly follows.",example:"I would rather walk. I would rather you waited here.",rows:`
I would rather ___ the quieter route.|take|to take|taking|took|Would rather nhận base verb take, không to.
I'd rather you ___ until the ranger returns.|waited|will wait|waiting|to wait|Khác subject you sau would rather dùng past form waited cho mong muốn hiện tại.
Choose the correct negative preference.|We would rather not drive at night.|We would not rather to drive at night.|We would rather don't drive at night.|We would rather not driving at night.|Rather not + base drive là dạng chuẩn.
`},
{title:"Had better gives situation-specific advice",topic:"PublicServices",cefr:"B2",rule:"Had better plus a base verb gives advice often linked to a possible negative consequence. The negative is had better not.",example:"You had better check the warning before entering.",rows:`
The river is rising. We had better ___ the lower path.|avoid|to avoid|avoided|avoiding|Had better theo sau base verb avoid.
Choose the correct negative advice.|They had better not park beside the emergency exit.|They had not better to park beside the emergency exit.|They had better don't park beside the emergency exit.|They had better not parking beside the emergency exit.|Had better not + park đưa lời khuyên phủ định.
Had better in this context generally expresses ___.|strong advice for the present situation|a completed achievement in the past|a comparison of two previous results|formal permission to ignore warnings|Dù có had, cấu trúc đưa lời khuyên hiện tại, không kể hành động đã làm.
`},
{title:"Perfect modals for past deduction",topic:"Research",cefr:"B2",rule:"Must have plus participle expresses a strong deduction about the past; might have expresses possibility; can't have expresses judged impossibility.",example:"The file must have been copied before the server stopped.",rows:`
The sealed envelope is untouched. She can't have ___ the letter.|read|reads|reading|to read|Can't have + participle read /red/ nêu suy luận không thể đã đọc.
Choose the possibility rather than certainty.|The sample might have been contaminated.|The sample must certainly be clean by definition.|The sample cannot ever change.|The sample will definitely be tested tomorrow.|Might have been diễn đạt khả năng về quá khứ.
The access log proves someone entered. They must have ___ the code.|known|know|knowing|knows|Must have cần participle known cho suy luận quá khứ.
`},
{title:"Should have for a missed recommended action",topic:"Work",cefr:"B2",rule:"Should have plus a participle can evaluate a past action that would have been advisable. It often implies it was not done. Shouldn't have evaluates an action as inadvisable.",example:"We should have checked the delivery address.",rows:`
The package went to the wrong building. We should have ___ the address.|verified|verify|verifying|verifies|Should have verified đánh giá việc nên làm trước nhưng đã bỏ sót.
Choose the criticism of a past action.|He shouldn't have shared the private link.|He shouldn't shared the private link.|He shouldn't have share the private link.|He shouldn't to have sharing the private link.|Shouldn't have + shared nêu hành động quá khứ không nên làm.
'I should have taken notes' normally suggests ___.|Taking notes would have been advisable then.|Notes are prohibited now.|The speaker definitely took perfect notes.|A future note-taking deadline has already passed tomorrow.|Should have đánh giá lời khuyên lỡ làm ở quá khứ.
`},
{title:"Needn't have versus didn't need to",topic:"Travel",cefr:"B2",rule:"Needn't have plus participle says an action was done but unnecessary. Didn't need to says there was no necessity and does not by itself prove whether the action occurred.",example:"We needn't have brought towels; they were supplied.",rows:`
'She needn't have paid in advance' implies ___.|She paid, although it was unnecessary.|She definitely did not pay.|Advance payment was forbidden in every case.|She will pay tomorrow.|Needn't have paid xác nhận action xảy ra nhưng không cần.
Choose the sentence whose wording leaves whether payment happened open.|She didn't need to pay in advance.|She needn't have paid in advance.|She paid in advance.|She certainly never paid.|Didn't need to nói thiếu nghĩa vụ, tự câu chưa khẳng định action xảy ra.
We needn't have ___ the extra tent; there was room indoors.|packed|pack|packing|packs|Perfect modal cần participle packed.
`},
{title:"Quantifiers: few versus a few",topic:"Community",cefr:"B2",rule:"Few emphasises a small or insufficient number; a few highlights that some exist. Both take plural countable nouns.",example:"Few people attended, so the vote was postponed. A few people stayed to help.",rows:`
Attendance was disappointingly low: ___ residents came, so there was no quorum.|Few|A little|Much|Each|Few nhấn số lượng ít/không đủ và đi với residents số nhiều.
'A few volunteers stayed' highlights ___.|that some volunteers stayed|that no volunteer stayed|that every volunteer stayed|an amount of uncountable material|A few mang sắc thái có một số, không none.
Choose the phrase appropriate to countable books.|a few reference books|a little reference books|much reference books|an few reference books|Books số nhiều nhận a few.
`},
{title:"Both, either and neither for two choices",topic:"Policy",cefr:"B2",rule:"Both includes two items; either can select one of two or mean each is acceptable; neither excludes both. Meaning depends on the sentence.",example:"Both proposals were discussed. Neither proposal was approved.",rows:`
Neither application was accepted means ___.|Both applications were rejected.|Both applications were accepted.|Exactly one application was accepted.|Only the first application existed.|Neither loại cả hai trong nhóm hai.
You may use either entrance means ___.|Each of the two entrances is an available choice.|You must use both entrances at once.|No entrance is allowed.|Only an unspecified third entrance works.|Either trong quyền lựa chọn cho phép dùng một trong hai.
Choose the statement including two routes.|Both routes pass the station.|Neither route passes the station.|One route alone passes the station.|No route passes the station.|Both nói cả hai cùng đáp ứng điều kiện.
`},
{title:"Noun clauses introduced by what",topic:"Design",cefr:"C1",rule:"What can introduce a fused relative noun clause meaning the thing(s) that. Do not add an antecedent such as the thing immediately before this what-clause.",example:"What users need is a clear next step.",rows:`
___ the review revealed was a problem with text spacing.|What|Which that|The thing what|That what to|What-clause làm chủ ngữ nghĩa điều mà review phát hiện.
Choose the correctly formed noun clause.|We changed what the users found confusing.|We changed the thing what the users found confusing.|We changed what did the users found confusing.|We changed what confusing users did found.|What the users found confusing làm tân ngữ changed; statement word order.
In 'What matters is clarity', what matters means ___.|the thing that is important|a direct request for a price|an unspecified location|a past action that certainly failed|What kết hợp antecedent và relative trong một noun clause.
`},
{title:"It-clefts focus one element",topic:"Research",cefr:"C1",rule:"It is/was plus a focused element and a that/who clause highlights the focus. The cleft should preserve the original event and participants.",example:"It was the wording that caused confusion, not the scale.",rows:`
Focus on the method in 'The method changed the result'.|It was the method that changed the result.|It was the result that changed the method.|It changed the method was that result.|It was that changed the method the result.|Cleft giữ method là nguyên nhân, result là điều bị đổi.
It was in the second trial ___ the difference emerged.|that|who|what|whose|It-cleft focus địa điểm/giai đoạn dùng that-clause.
Which cleft highlights the person who raised the concern?|It was the technician who raised the concern.|It was the concern who raised the technician.|It the technician raised was concern.|It was raised who the technician concern.|Who-clause giữ technician là người raised.
`},
{title:"Pseudo-clefts focus the outcome",topic:"Education",cefr:"C1",rule:"A what-clause plus be can focus a complement: What we need is clearer feedback. Keep the clause internally in statement order.",example:"What the students requested was more practice with evidence.",rows:`
What the tutor recommended ___ a shorter but more frequent practice routine.|was|were being to|did|has to|Noun what-clause làm subject; was nối complement singular routine.
Choose a correctly formed pseudo-cleft.|What learners value most is specific feedback.|What do learners value most is specific feedback.|What learners most is value specific feedback.|What learners value most specific feedback is did.|What-clause dùng subject learners trước value, không direct question do.
In 'What we changed was the order', the focused new information is ___.|the order|an unmentioned date|the people who never attended|a future prohibition|Pseudo-cleft đặt focus complement sau was.
`},
{title:"Negative adverbial inversion",topic:"Law",cefr:"C1",rule:"After a fronted negative or restrictive adverbial such as never or rarely, invert the auxiliary and subject. Add do/does/did when needed with a simple verb.",example:"Rarely does the court hear such an unusual argument.",rows:`
Never ___ the committee seen such complete records.|has|it has|having|does has|Never đứng đầu yêu cầu auxiliary has trước subject committee.
Choose correct inversion with a simple present verb.|Rarely do these procedures produce an immediate result.|Rarely these procedures do produce an immediate result.|Rarely produces these procedures an immediate result.|Rarely these procedures produces an immediate result.|Simple present plural thêm do trước subject sau rarely.
Seldom ___ a single witness resolve every disputed detail.|does|a|has does|is do|Resolve base form dùng does-support sau fronted seldom.
`},
{title:"Only after triggers main-clause inversion",topic:"Planning",cefr:"C1",rule:"When an only plus time/condition phrase begins a sentence, invert the main clause, not the clause inside the phrase.",example:"Only after the audit ended did the team publish the results.",rows:`
Only after the checks were complete ___ the app restart.|did|the app did|was did|had did|Fronted only after yêu cầu main clause did the app restart.
Choose the correct inversion placement.|Only when the team agreed did we proceed.|Only when did the team agree we proceeded.|Only when the team agreed we did proceeded.|Only when agreed the team proceeded we.|When-clause giữ statement order; inversion nằm main clause did we.
Only with sufficient evidence ___ we justify that claim.|can|we can|can to|do can|Only with đứng đầu làm modal can đảo trước we.
`},
{title:"Not until keeps the inversion in the main clause",topic:"History",cefr:"C1",rule:"A sentence beginning not until plus a time or clause inverts the following main clause. The until-clause itself keeps normal statement order.",example:"Not until the archive opened did researchers see the full record.",rows:`
Not until 1998 ___ the collection become publicly accessible.|did|the collection did|has did|was did|Not until đứng đầu yêu cầu did trước subject trong main clause.
Choose the correct clause order.|Not until the letter was found did the sequence become clear.|Not until was the letter found the sequence became clear.|Not until the letter found did became clear the sequence.|Not until the letter was found the sequence did became clear.|Until-clause giữ the letter was found; main clause did...become.
In the example, clarity arose ___.|only when the letter was found|before any letter existed|at every earlier moment|only after next year|Not until giới hạn mốc đầu tiên xảy ra kết quả.
`},
{title:"No sooner and hardly link close past events",topic:"Transport",cefr:"C1",rule:"No sooner had...than and hardly had...when describe one event followed almost immediately by another. Initial negative phrases trigger inversion.",example:"No sooner had the train stopped than passengers approached the doors.",rows:`
No sooner had the barrier risen ___ traffic began moving.|than|when|that|as of|No sooner phối hợp với than.
Hardly had the announcement ended ___ the queue started to form.|when|than|to|whose|Hardly...when là cặp liên từ thời gian chuẩn.
Choose a correctly inverted close-event sentence.|No sooner had we arrived than the gates closed.|No sooner we had arrived than the gates closed.|No sooner had arrived we when the gates closed.|No sooner did we had arrived than the gates closed.|Had đảo trước we; arrived participle và than giới thiệu sự kiện kế tiếp.
`},
{title:"Conditional inversion with had",topic:"Travel",cefr:"C1",rule:"Had plus subject and participle can replace if plus past perfect in a formal unreal-past condition. Do not retain if as well.",example:"Had we checked the tide, we would have chosen another departure time.",rows:`
___ the walkers read the warning, they would have avoided the ford.|Had|Have|Did|Were|Had + subject + read /red/ là conditional inversion quá khứ.
Choose a faithful inversion of 'If she had booked, she would have had a seat'.|Had she booked, she would have had a seat.|If had she booked, she would have had a seat.|Had booked she, she would have a seat yesterday do.|Did she had booked, she would have had a seat.|Đảo had trước subject she và bỏ if.
Had we ___ earlier, the trip would have been cheaper.|reserved|reserve|reserving|reserves|Had trong inversion vẫn cần participle reserved.
`},
{title:"Conditional inversion with should",topic:"PublicServices",cefr:"C1",rule:"Should plus subject and base verb can introduce a tentative future condition equivalent to if...should. It does not by itself express ordinary advice.",example:"Should the supply fail, contact the emergency number.",rows:`
Should you ___ any damage, report it immediately.|notice|noticed|noticing|notices|Should-inversion dùng subject you + base notice.
Choose the conditionally inverted instruction.|Should the alarm sound, leave by the marked exit.|Should sounds the alarm, leave by the marked exit.|If should the alarm sound, leave by the marked exit.|Should the alarm sounded, leave by the marked exit.|Should + subject + base sound thay if the alarm should sound.
Here 'Should a delay occur' means ___.|if a delay happens|a delay definitely happened yesterday|someone must cause a delay|no delay is possible|Should-inversion nêu điều kiện dự phòng, không khẳng định xảy ra.
`},
{title:"Were inversion for a remote condition",topic:"Policy",cefr:"C1",rule:"Were plus subject plus to-infinitive can introduce an unlikely future condition. Were it not for introduces an unreal present dependency.",example:"Were costs to rise sharply, the plan would need revision.",rows:`
Were demand ___ fall, the facility would run below capacity.|to|that|for|of|Were + subject + to-infinitive là mẫu giả định formal.
Were it not ___ the grant, the service would close.|for|of|at|than|Were it not for + noun phrase là cấu trúc cố định.
Choose the faithful formal inversion.|Were the policy to change, applicants would need new guidance.|Were to change the policy, applicants would needs new guidance.|If were the policy change, applicants would need new guidance.|Was the policy to changing, applicants would needed new guidance.|Were + the policy + to change giữ remote condition và would need.
`},
{title:"Mandative subjunctive after a recommendation",topic:"Law",cefr:"C1",rule:"The formal mandative subjunctive uses a base verb after that when recommending or requiring an action. Be remains be for all subjects; should plus base is another valid pattern in British English.",example:"The panel required that every file be retained.",rows:`
Use the base-form subjunctive: The judge ordered that the record ___ preserved.|be|is|was|being|Mandative subjunctive dùng base be dù record số ít.
The committee recommends that each office ___ a named contact. Use the base-form pattern.|appoint|appoints|appointed yesterday|appointing|Recommendation + that dùng appoint base, không agrees s.
Choose a correct British should-pattern.|The adviser recommended that the form should state the deadline.|The adviser recommended that the form should states the deadline.|The adviser recommended that the form should stated the deadline.|The adviser recommended that the form should to state the deadline.|Should + base state là biến thể đúng.
`},
{title:"If only expresses strong regret",topic:"Education",cefr:"C1",rule:"If only plus past form expresses a strong wish about the present; if only plus past perfect expresses a past regret. Choose the time relation from context.",example:"If only I knew the answer. If only I had read the final instruction.",rows:`
The submission is already lost: If only I ___ saved a copy.|had|have|will|am|Action quá khứ đã không làm; if only + had saved.
I cannot understand this explanation now. If only it ___ clearer.|were|will be|has been tomorrow|being|Mong trái tình hình hiện tại dùng past form were.
Choose the sentence regretting yesterday's decision.|If only we had asked for clarification before agreeing.|If only we ask for clarification yesterday before agreeing.|If only we would asked for clarification before agreeing.|If only we had ask for clarification before agreeing.|Past regret cần had asked, không had ask.
`},
{title:"Adjective-fronted concession with as or though",topic:"Arts",cefr:"C1",rule:"Adjective plus as or though plus subject and verb can express concession: difficult though it was. Preserve a complete clause after the adjective.",example:"Unusual though the design was, visitors understood it.",rows:`
Expensive ___ the materials were, the result justified the cost.|though|despite|however of|even of|Adjective-fronted concession dùng though + subject + verb.
Choose the correct formal concession.|Simple as the melody was, it remained memorable.|Simple despite the melody was, it remained memorable.|Simple as was it melody, it remained memorable.|Simple as the melody, was remained it memorable.|Simple as + the melody was tạo concessive clause.
The concessive example means ___.|The design was unusual, but visitors still understood it.|Visitors understood it because every design was ordinary.|No visitor understood the design.|The design will become unusual next year.|Though nêu tương phản giữa unusual và understood.
`},
{title:"Participial clauses need a shared logical subject",topic:"Research",cefr:"C1",rule:"An introductory -ing clause normally has the same logical subject as the main clause. Avoid dangling modifiers that make an inanimate result seem to perform the action.",example:"Reviewing the recordings, the analysts noticed a missing response.",rows:`
Choose the sentence with a clear shared subject.|Reading the transcript, the researcher spotted an omission.|Reading the transcript, an omission spotted the researcher.|Reading the transcript, the desk was uncomfortable.|Reading the transcript, the room's temperature fell.|Researcher thực hiện cả reading và spotted, nên modifier không bị treo.
After checking the dataset, ___ corrected the labels.|the analyst|the labels|the table legs|the error itself|Subject main clause phải là người thực hiện checking, analyst.
Why is 'Walking to the site, the rain started' usually problematic?|It suggests the rain was walking.|It uses a passive participle correctly.|It lacks an article before rain in every dialect.|It is a valid conditional inversion.|Introductory walking ngầm gắn subject rain, tạo nghĩa không hợp lý.
`},
{title:"Perfect participles mark an earlier completed action",topic:"Work",cefr:"C1",rule:"Having plus participle introduces an action completed before the main event, normally by the same subject. Having been plus participle makes it passive.",example:"Having checked the figures, the accountant signed the report.",rows:`
Having ___ the instructions, the team began the repair.|read|reading|reads|to read|Having + past participle read /red/ nói hành động đọc đã hoàn tất.
Choose the passive perfect participial clause.|Having been inspected, the equipment was released for use.|Having inspecting, the equipment was released for use.|Having inspect, the equipment was released for use.|Having been inspecting by nobody, the equipment was released for use.|Equipment được inspect trước; having been inspected giữ passive.
In 'Having completed the checks, she approved the release', the checks occurred ___.|before her approval|only after next week's approval|at an unknown future deadline|because approval never happened|Perfect participle biểu thị thứ tự hoàn tất trước main event.
`},
{title:"Reduced relatives distinguish agent and recipient",topic:"Technology",cefr:"C1",rule:"An -ing reduced relative commonly describes an active relationship; a past participle describes a passive one. The noun being modified must fit that relationship.",example:"Users requesting access receive a notice. Data stored offline remain local.",rows:`
The files ___ by the archive team are encrypted.|stored|storing|stores|store|Files được đội lưu nên passive participle stored.
Employees ___ permission should complete the form.|requesting|requested|are requested|have request|Employees chủ động request, dùng requesting.
Choose the faithful reduction of 'the logs which were generated overnight'.|the logs generated overnight|the logs generating overnight by system|the logs generate overnight|the logs were generated overnight clause|Past participle generated giữ nghĩa logs được tạo.
`},
{title:"Nominalisation preserves the original relationship",topic:"Science",cefr:"C1",rule:"Nominalisation turns an action or quality into a noun, but should preserve who did what and the relevant cause or object. Avoid noun strings that conceal responsibility.",example:"The team evaluated the method becomes the team's evaluation of the method.",rows:`
Choose the faithful nominalisation of 'The researchers compared the samples'.|the researchers' comparison of the samples|the samples' comparison of the researchers|the samples comparing researchers' result|the comparison researchers by samples|Comparison thuộc researchers, object samples giữ qua of.
The ___ of the instrument improved the measurements.|calibration|calibrate|calibratingly|calibrated to|Noun subject calibration phù hợp the ... of.
Which version retains the agent clearly?|The agency's rejection of the application delayed the work.|The application's rejection of the agency delayed the work.|The work's rejection delayed the agency of application.|Rejection happened without any describable participant.|Agency là bên reject, application bị reject, quan hệ được giữ rõ.
`},
{title:"Parallelism after paired conjunctions",topic:"Education",cefr:"C1",rule:"Not only...but also and either...or should connect grammatically comparable elements. Place the paired words so their scope is clear.",example:"The course teaches not only summarising but also evaluating evidence.",rows:`
Choose the parallel pair.|The task requires both careful reading and accurate note-taking.|The task requires both careful reading and to notes accurately.|The task requires both reading carefully and accurate is notes.|The task requires both to read and notes taking accurate.|Hai noun phrases cùng vai trò sau both...and.
The workshop aims to identify errors, explain patterns and ___ better strategies.|develop|development|developing|developed|Sau một to, coordinated infinitives giữ base develop.
Choose the correctly scoped paired expression.|Students learn not only to describe results but also to evaluate them.|Students learn to not only results but also evaluating describe them.|Students not only learn to describe results but also they evaluation.|Students learn not only to describe results but also evaluating them.|Hai to-infinitives song song giữ cùng cấp cú pháp.
`},
{title:"Agreement follows the head noun",topic:"Measurement",cefr:"C1",rule:"In a complex subject noun phrase, the verb generally agrees with the head rather than a nearby plural noun inside an of-phrase.",example:"The precision of the instruments is adequate.",rows:`
The range of recorded temperatures ___ wider in the second trial.|is|are|have|were to being|Head range số ít, nên is dù temperatures số nhiều gần đó.
A collection of rare coins ___ displayed downstairs.|is|are|have|do|Head collection số ít điều khiển is displayed.
Choose the correct head-noun agreement.|The quality of the responses has improved.|The quality of the responses have improved.|The quality of the responses are improved been.|The quality of the responses do improved.|Quality số ít nhận has, không theo responses.
`},
{title:"A number of versus the number of",topic:"Society",cefr:"C1",rule:"A number of plus plural noun normally takes a plural verb. The number of focuses on a singular count and takes a singular verb.",example:"A number of residents have moved. The number of residents has fallen.",rows:`
A number of households ___ requested a paper form.|have|has|is|does|A number of + households nhận động từ số nhiều have.
The number of returned questionnaires ___ increasing.|is|are|have|do|The number là head số ít, dùng is.
Choose the correct contrast.|A number of claims are pending, but the number is small.|A number of claims is pending, but the number are small.|The number of claims are pending, and a number is small.|A number claims has pending, but the number have small.|A number of claims số nhiều; the number số ít.
`},
{title:"Distributive each controls agreement",topic:"Policy",cefr:"C1",rule:"Each/every as the head or determiner of a singular subject normally takes a singular verb. Each of plus plural noun still has singular each as its head.",example:"Each of the applications requires a signature.",rows:`
Each of the proposed changes ___ an implementation cost.|has|have|are|do|Head each số ít nên has.
Every office and every branch ___ the same reporting rule. Use ordinary distributive agreement.|follows|follow|following|have follow|Every lặp lại nhấn từng đơn vị, ordinary singular follows.
Choose the correctly formed distributive statement.|Each participant is given a separate code.|Each participants are given a separate code.|Each of participant are given a separate code.|Each participant have given a separate code.|Each + singular participant + is là mẫu đúng.
`},
{title:"Hedging with appears and seems",topic:"Research",cefr:"C1",rule:"Appears/seems plus to-infinitive offers a cautious interpretation. A perfect infinitive places the possible event earlier than the observation.",example:"The pattern appears to reflect a sampling difference.",rows:`
The discrepancy appears ___ arise from the changed procedure.|to|that to|of|for to|Appears nhận to-infinitive to arise.
Choose a grammatical cautious interpretation.|The effect seems to be stronger in the smaller sample.|The effect seems be stronger in the smaller sample.|The effect seems to being stronger in the smaller sample.|The effect seems stronger to is in the smaller sample.|Seems to be + adjective là cấu trúc đúng.
'The instrument appears to have failed earlier' places the suspected failure ___.|before the present assessment|necessarily after tomorrow|only at the moment of the next test|outside any possible time relation|To have failed là perfect infinitive về sự kiện trước quan sát hiện tại.
`},
{title:"Modal certainty must fit the evidence",topic:"Science",cefr:"C1",rule:"May/might/could express possibilities, while must as deduction expresses strong confidence. Grammar cannot turn an association into established causation without evidence.",example:"The difference may reflect an unmeasured factor.",rows:`
The study is observational and alternatives remain. Choose the cautious claim.|The association may reflect several underlying factors.|The association proves a unique cause in every setting.|The association guarantees the same outcome for everyone.|The association necessarily rules out all alternatives.|May và multiple factors phù hợp mức chứng cứ giới hạn.
The pattern might ___ when a larger sample is used.|change|changes|changing|changed|Might là modal cần base change.
Which phrase avoids claiming certainty about an untested explanation?|could be explained by|is indisputably proved by|must in all cases be caused by|is guaranteed solely by|Could be explained by để mở các giải thích khác.
`},
{title:"Quantifier scope with not every",topic:"Community",cefr:"C1",rule:"Not every/all denies universal coverage without specifying an exact number. None says zero. Preserve the scope of negation in paraphrases.",example:"Not every resident attended does not mean no resident attended.",rows:`
'Not every applicant qualified' entails ___.|At least one applicant did not qualify.|No applicant qualified.|Exactly half qualified.|Every applicant qualified.|Not every phủ định tính toàn bộ, không kết luận none hay tỷ lệ chính xác.
Choose the sentence meaning zero proposals were approved.|None of the proposals was approved.|Not all proposals were approved.|Some proposals were approved.|Only two proposals were approved.|None diễn đạt zero; not all chỉ không phải mọi proposal.
'Only the chair signed the letter' focuses the exclusion on ___.|other possible signers|all possible writing dates|the existence of the letter|the number of words in it|Only trước the chair giới hạn người ký, không ngày hoặc độ dài.
`},
{title:"Substitution with so and not",topic:"Communication",cefr:"C1",rule:"So can substitute for an affirmative proposition after verbs such as think and hope. Not can substitute for a negative proposition after hope and certain other patterns.",example:"Will it be ready? I hope so. Will it be delayed? I hope not.",rows:`
'Will the reply arrive today?' 'I hope ___.'|so|one|ones|it to|Hope so thay toàn proposition reply arrives today.
'Is the venue closed?' 'I hope ___; we have booked it.'|not|no one|none of|don't to|Hope not diễn đạt mong proposition venue closed không đúng.
Choose the natural substitution for agreement with an expectation.|I think so.|I think ones.|I think such that.|I think to so.|Think so có thể thay nội dung mệnh đề đã nêu.
`},
{title:"Ellipsis preserves tense and polarity",topic:"Arts",cefr:"C1",rule:"An auxiliary can replace recoverable verb material while keeping tense and polarity. Neither plus auxiliary plus subject expresses a matching negative.",example:"I liked the recital and she did too. I didn't enjoy the film and neither did she.",rows:`
The director has read the script, and the producer ___ too.|has|does|is|was|Has giữ present perfect thay has read.
I wasn't impressed, and neither ___ my companion.|was|wasn't|didn't|has|Neither đã phủ định; auxiliary was đảo trước companion.
Choose a matching negative with correct inversion.|The critics didn't agree, and neither did the audience.|The critics didn't agree, and neither didn't the audience.|The critics didn't agree, and neither the audience did.|The critics didn't agree, and neither was agree the audience.|Neither did + subject phù hợp past simple negative.
`},
{title:"Fronted objects need clear reference",topic:"Language",cefr:"C1",rule:"Fronting can emphasise an object while retaining a complete subject and verb. It does not normally cause auxiliary inversion unless a separate trigger exists.",example:"That interpretation, I cannot accept.",rows:`
Choose the correctly fronted object.|This conclusion, we cannot support with the present evidence.|This conclusion, cannot we support with the present evidence statement.|This conclusion, support we not cannot evidence.|This conclusion cannot with we present support evidence.|Object fronted nhưng main clause we cannot support giữ statement order.
In 'The first draft, she revised immediately', the fronted phrase is ___.|the object of revised|the person performing the revision|a future time clause|a negative inversion trigger|First draft là thứ she revised, không subject.
Choose a fronted phrase that preserves who did what.|The final question, the tutor explained in detail.|The tutor, the final question explained in detail.|The final question tutor in detail was explain.|The final question, explained tutor did who.|Tutor vẫn là agent explained, final question là object fronted.
`},
{title:"Proportion expressions and the following noun",topic:"Society",cefr:"C1",rule:"In phrases such as half of and most of, agreement commonly follows the noun referring to what is being quantified. Uncountable material differs from plural people.",example:"Most of the water is clean. Most of the residents are satisfied.",rows:`
Most of the information ___ available online.|is|are|have|do|Information không đếm được, dùng is.
Half of the respondents ___ completed both forms.|have|has|is|does|Respondents số nhiều nên have trong phrase này.
Choose the correct proportion agreement.|Two thirds of the households are connected.|Two thirds of the households is connected.|Two thirds of the households has connected been.|Two third households is connected.|Households số nhiều điều khiển are; fraction two thirds cũng đúng dạng.
`},
];

const bandByLevel: Record<Cefr, number> = { A2: 3.5, B1: 5, B2: 6.5, C1: 8 };
const generatedAt = "2026-10-11T00:00:00.000Z";
export const expandedGrammarLessons: StoredContent[] = packs.map((p, i) => {
  const id = `fresh-x3-g-${String(i + 1).padStart(3, "0")}`;
  const subskill = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const questions = p.rows.trim().split("\n").map((line, qi) => {
    const f = line.split("|");
    if (f.length !== 6 || f.some(x => !x.trim())) throw new Error(`Invalid x3 grammar ${id}/${qi + 1}`);
    const [prompt, answer, a, b, c, explanation] = f as [string,string,string,string,string,string];
    const choices = [answer, a, b, c], offset = (i + qi) % 4;
    return { id: `${id}-q${qi + 1}`, number: qi + 1, type: "choice" as const, prompt, options: [...choices.slice(offset), ...choices.slice(0, offset)], answer, explanation, evidence: p.rule, sectionIndex: 0, subskill };
  });
  const extra = extraGrammarQuestions[id];
  if (!extra) throw new Error(`Missing fourth grammar decision for ${id}`);
  questions.push({ ...extra, id: `${id}-q4`, number: 4, type: "choice", evidence: p.rule, sectionIndex: 0, subskill });
  const band = bandByLevel[p.cefr];
  return { id, skill:"grammar", title:p.title, description:"Four independent contextual decisions linking form to meaning, with a focused rule and Vietnamese answer explanations.", topic:p.topic, cefr:p.cefr, band, testType:"both", durationMinutes:12, format:"lesson", sections:[{id:`${id}-s1`, title:p.title, text:`${p.rule}\n\nExample:\n${p.example}`, instructions:"Read the rule, then choose the one answer that fits both grammar and the stated meaning. Explanations are available after submission."}], questions, vocabularyIds:[], tags:["grammar",subskill,`cefr:${p.cefr}`,"fresh-bank-x3"], source:"ai",quality:"ai-unreviewed",createdAt:generatedAt,estimatedDifficulty:{band,cefr:p.cefr,basis:"Estimated from grammatical complexity, temporal interpretation and discourse scope; not psychometrically calibrated."},objectives:[`Apply ${p.title.toLowerCase()} in context.`,"Distinguish a grammatical form from a change in the intended meaning."],errorTypes:[`${subskill}:form`,`${subskill}:meaning`,"context-insensitive-choice"],provenance:{method:"ai-assisted",version:"fresh-bank-x3",generatedAt},review:{status:"unreviewed",checks:[],limitations:["AI-assisted material has not received independent IELTS specialist review.","CEFR and band labels are pedagogical estimates rather than official examiner ratings."]} };
});
