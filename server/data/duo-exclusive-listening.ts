import type { ContentSection, DialogueLine, StoredContent, StoredQuestion } from "../../shared/types";
import { validateContentStructure } from "../../shared/content-visuals";

/** Authored exclusively for protected Duo sittings; never export through the
 * public practice bank. Variant facts describe a different event or study. */
const authoredAt = "2026-11-05T00:00:00.000Z";
type Fact = { label: string; ask: string; answer: string; evidence: string; detail: string };
type Situation = {
  title: string; topic: string; opening: string; purpose: string; constraint: string;
  activities: [string, string]; items: [string, string]; rooms: [string, string]; outcome: string;
};

const bookings: Situation[] = [
  { title: "Borrowing a family camping kit", topic: "Outdoor recreation",
    opening: "Our household wants to try a short camping trip before buying equipment. We have used a tent in a friend's garden, but we have never borrowed a complete kit from a community service.",
    purpose: "The equipment library lets families discover what they actually need instead of buying a large collection of objects that will remain in a cupboard.",
    constraint: "The tents must be checked while they are dry. Returning a damp tent without telling the assistant can damage the fabric before the next family collects it.",
    activities: ["tent assembly", "stove safety"], items: ["groundsheet", "water carrier"], rooms: ["equipment store", "outdoor classroom"],
    outcome: "The borrower practises packing the kit, signs the condition sheet and knows how to report a missing part." },
  { title: "Booking an accessible evening film", topic: "Arts and accessibility",
    opening: "I am arranging a small film visit for a relative who finds crowded entrances tiring. I would like to understand the access arrangements before I reserve places for the group.",
    purpose: "This screening uses a smaller audience and a longer arrival period. People can settle into the building without feeling that they must hurry through the foyer.",
    constraint: "The accessible entrance remains available throughout the screening, but the ordinary ticket desk closes when the film begins. Late arrivals should use the bell beside the side door.",
    activities: ["caption demonstration", "audio introduction"], items: ["headphones", "seat cushion"], rooms: ["small auditorium", "access lounge"],
    outcome: "Every member of the group receives the access information before the visit, rather than relying on a companion to explain it in the queue." },
  { title: "Joining a coastal pottery session", topic: "Creative learning",
    opening: "I saw a notice for the pottery sessions near the harbour. I can work with clay at a basic level, but I would like to learn a technique that does not require an electric wheel.",
    purpose: "The class introduces useful hand-building techniques through ordinary household objects. Learners can judge the thickness of a piece before it goes into the kiln.",
    constraint: "Nothing can be taken home immediately after the class because the clay has to dry slowly. Carrying a wet piece along the seafront could change its shape.",
    activities: ["coil building", "surface printing"], items: ["cotton apron", "small towel"], rooms: ["clay studio", "harbour workshop"],
    outcome: "Learners leave their work on a labelled board and receive a message when the firing process has finished." },
  { title: "Booking a home energy advice session", topic: "Housing and energy",
    opening: "We have moved into an older flat and our electricity use is higher than we expected. I want advice about practical changes before we commit to replacing expensive equipment.",
    purpose: "The adviser looks at the way a home is used as well as the appliances inside it. A useful recommendation must suit the occupants' daily routines.",
    constraint: "The adviser cannot remove wall panels or alter electrical wiring. If a safety problem appears, the written report explains which qualified professional the resident should contact.",
    activities: ["draught check", "meter reading"], items: ["recent bill", "floor plan"], rooms: ["advice office", "housing centre"],
    outcome: "The resident receives a short list of changes in order of likely benefit and can choose which recommendations to follow." },
  { title: "Registering with a neighbourhood tool library", topic: "Sharing and consumption",
    opening: "I need a few tools for a small repair, but I do not have space to store them at home. A neighbour suggested joining your lending service instead of buying everything.",
    purpose: "The library makes occasional repairs more affordable and helps residents learn which tool is suitable for a particular job. Borrowers should describe the task before choosing equipment.",
    constraint: "Some powered tools can only be borrowed after an induction. Watching a video at home is useful preparation but does not replace the demonstration at the library.",
    activities: ["battery handling", "blade inspection"], items: ["identity card", "safety glasses"], rooms: ["repair cabin", "training room"],
    outcome: "New members can identify the safety check they must complete and understand how to extend a loan before it becomes overdue." },
  { title: "Enrolling in a confidence-in-water class", topic: "Health and leisure",
    opening: "I am interested in the adult water-confidence course. I can move around in shallow water, but I would prefer a class that does not assume everyone can already swim a length.",
    purpose: "The sessions develop confidence gradually. Participants first learn how the water supports them and can agree a smaller personal goal with the instructor.",
    constraint: "The course is not a rescue qualification. Anyone who needs a professional certificate should ask about the separate programme rather than using these sessions as a substitute.",
    activities: ["floating practice", "breathing practice"], items: ["swimming cap", "spare towel"], rooms: ["teaching pool", "poolside classroom"],
    outcome: "Participants understand the first exercise and know that they may remain in the shallow area while they build confidence." },
  { title: "Taking part in a community seed exchange", topic: "Food and gardening",
    opening: "Our balcony garden produced more seeds than we need. I would like to bring some to the exchange, but I have not used the local seed-sharing scheme before.",
    purpose: "The exchange encourages people to keep notes about growing conditions instead of simply choosing plants from a colourful photograph. Useful information travels with each packet.",
    constraint: "Seeds from a plant that showed signs of disease must not be shared. The volunteers can explain how to dispose of them, even when the seeds look healthy.",
    activities: ["packet labelling", "germination testing"], items: ["paper envelopes", "garden notebook"], rooms: ["garden shelter", "seed room"],
    outcome: "Contributors can label their packets accurately and leave with varieties that suit the space and sunlight available at home." },
  { title: "Reserving a local sound-history walk", topic: "Heritage and technology",
    opening: "I am booking a walk for visitors who enjoy local history. They are interested in the recording collection, although one member of the group does not use a smartphone.",
    purpose: "The walk connects short recordings with places in the neighbourhood. Participants hear how residents described the same streets at different points in their lives.",
    constraint: "The route includes a quiet residential lane. The leader asks everyone to use headphones there so that the recordings do not disturb people working at home.",
    activities: ["recorder demonstration", "route briefing"], items: ["walking shoes", "rain jacket"], rooms: ["archive entrance", "visitor room"],
    outcome: "The group can operate the borrowed players and understands which parts of the route have an alternative step-free entrance." },
];

const community: Situation[] = [
  { title: "A wetland centre prepares for visitors", topic: "Conservation and access",
    opening: "Welcome to the volunteer briefing for the new wetland visitor programme. The paths have been checked, but a good visit also depends on explaining why some areas remain quiet.",
    purpose: "Visitors should be able to watch wildlife without causing birds to abandon the sheltered edges of the pools.", constraint: "After heavy rain the lower boardwalk may close even when the car park remains open. The decision is based on the depth of water at the crossing, not on how clear the sky looks.",
    activities: ["bird counting", "pond observation"], items: ["binoculars", "waterproof boots"], rooms: ["reed hide", "visitor shelter"], outcome: "Volunteers can direct visitors towards an interesting route while keeping the nesting area undisturbed." },
  { title: "An evening repair market opens", topic: "Waste and local enterprise",
    opening: "Thank you for helping at the evening repair market. The event brings practical advice into the town centre at a time when people returning from work can stop and ask questions.",
    purpose: "The aim is to show residents whether an object can be repaired before they decide to replace it.", constraint: "Volunteers may examine a damaged appliance but must not connect it to the electricity supply until the qualified supervisor has completed the safety check.",
    activities: ["zip replacement", "lamp inspection"], items: ["repair ticket", "cloth bag"], rooms: ["covered arcade", "market workshop"], outcome: "Visitors leave with either a completed repair or a clear explanation of the next safe step." },
  { title: "The urban orchard welcomes school groups", topic: "Education and food",
    opening: "This briefing is for the teams meeting school groups at the urban orchard. Some children will know the names of common fruits without having seen the trees that produce them.",
    purpose: "We want the children to connect seasonal food with the work required to care for a growing place.", constraint: "Fruit must only be picked when the orchard guide gives permission. Different trees ripen at different times, and a soft-looking fruit is not always ready to eat.",
    activities: ["leaf comparison", "soil examination"], items: ["hand lens", "drawing board"], rooms: ["learning shelter", "orchard cabin"], outcome: "Each group can describe one seasonal change and understand why regular observation matters to the orchard team." },
  { title: "Residents discuss a night bus trial", topic: "Transport and planning",
    opening: "Good evening and welcome to the briefing about the night bus trial. The council is collecting evidence from people who travel late as well as residents who live beside the route.",
    purpose: "The trial will test whether a dependable late service can help people reach shift work without relying on an expensive private journey.", constraint: "The driver cannot stop between marked stops, even when the bus is quiet. Requests about new stopping points belong on the feedback form rather than being made during a journey.",
    activities: ["route comparison", "access review"], items: ["route leaflet", "feedback card"], rooms: ["transport hall", "council annexe"], outcome: "Residents can distinguish a temporary operating problem from a suggestion about the long-term design of the route." },
  { title: "A refill centre changes its layout", topic: "Sustainable shopping",
    opening: "Before the refill centre reopens, I will explain the new arrangement for customers bringing their own containers. Clear instructions are essential because different products use different dispensing systems.",
    purpose: "The revised layout should reduce packaging while making it easier for customers to buy only the amount they need.", constraint: "Containers that held cleaning products must not be used for food, even after washing. The team will provide suitable alternatives rather than taking a risk with an unidentified bottle.",
    activities: ["container weighing", "label checking"], items: ["clean jar", "cotton bag"], rooms: ["weighing area", "refill counter"], outcome: "Customers can calculate the amount purchased without including the weight of the container." },
  { title: "A street-art trail trains its guides", topic: "Culture and tourism",
    opening: "Welcome to the guide training for the street-art trail. Our visitors often arrive with a list of pictures they have seen online, but the walk is about the neighbourhood as well as the painted walls.",
    purpose: "The trail should help visitors understand how artists work with residents rather than treating local streets as a collection of photographic backgrounds.", constraint: "Some works can be viewed from the public pavement but stand on private buildings. The permission to discuss them does not give a group permission to enter a courtyard.",
    activities: ["image discussion", "route rehearsal"], items: ["route map", "visitor badge"], rooms: ["arts foyer", "guide office"], outcome: "Guides can explain the agreed viewing points and introduce the people who helped develop each work." },
  { title: "A food-rescue kitchen recruits volunteers", topic: "Health and social support",
    opening: "Thank you for attending the food-rescue kitchen induction. The ingredients change from day to day, so our systems must be clear even when the menu cannot be planned far in advance.",
    purpose: "The kitchen turns suitable surplus ingredients into meals while maintaining the same standards of safety expected of any food service.", constraint: "A donated product without the required ingredient information cannot be served. Being generous with food must never make it harder for a diner to avoid an allergen.",
    activities: ["temperature recording", "ingredient sorting"], items: ["cotton apron", "hair covering"], rooms: ["preparation kitchen", "volunteer room"], outcome: "Volunteers know when a donation is suitable and who must decide if the label is incomplete." },
  { title: "A local archive launches a memory afternoon", topic: "History and communication",
    opening: "This afternoon's briefing concerns our new memory sessions at the archive. Residents may bring an ordinary object that helps them describe a part of everyday life that is missing from the written records.",
    purpose: "The sessions preserve personal experiences alongside photographs and official documents, including experiences that different residents remember in different ways.", constraint: "An object remains the owner's property unless a separate donation agreement is completed. A conversation about its history does not transfer ownership to the archive.",
    activities: ["object recording", "photo scanning"], items: ["old photograph", "written note"], rooms: ["memory room", "archive lounge"], outcome: "Participants understand how their contribution will be stored and can choose whether their name appears in the catalogue." },
];

type Study = {
  title: string; topic: string; question: string; methods: [string, string]; groups: [string, string];
  materials: [string, string]; measures: [string, string]; obstacles: [string, string];
  setting: string; caution: string; application: string;
};
const projects: Study[] = [
  { title: "Studying shade on a campus walking route", topic: "Urban climate", question: "whether shade changes the route students choose during warm weather", methods: ["route diaries", "short interviews"], groups: ["first-year students", "evening students"], materials: ["shade map", "route cards"], measures: ["walking time", "surface temperature"], obstacles: ["missing entries", "uneven attendance"], setting: "Two routes connect the library and the science building, but one passes beneath trees and the other follows a wide paved square.", caution: "A shaded route may attract walkers because it is quieter, so temperature cannot be assumed to explain every choice.", application: "The final report should help the university decide where a small amount of additional shade would be most useful." },
  { title: "Investigating noise in shared study areas", topic: "Learning environments", question: "which sounds interrupt concentration in spaces advertised as quiet", methods: ["sound diaries", "observation sessions"], groups: ["postgraduate students", "distance learners"], materials: ["floor plan", "rating sheet"], measures: ["noise duration", "seat occupancy"], obstacles: ["overlapping sounds", "incomplete ratings"], setting: "The study areas differ in their distance from the entrance and in the amount of conversation allowed near the shared tables.", caution: "A low average noise level can conceal a small number of interruptions that students find particularly distracting.", application: "The team wants to recommend a clearer arrangement of quiet and collaborative areas without removing useful group spaces." },
  { title: "Comparing labels on takeaway food", topic: "Consumer information", question: "how the placement of ingredient information affects the speed of a food choice", methods: ["timed tasks", "follow-up interviews"], groups: ["local commuters", "mature students"], materials: ["sample labels", "menu cards"], measures: ["decision time", "recall accuracy"], obstacles: ["unfamiliar products", "unequal text"], setting: "The researchers are comparing equally sized labels displayed on the front and the side of reusable takeaway containers.", caution: "The sample products must have comparable ingredient lists, or differences in difficulty could be mistaken for an effect of label placement.", application: "Their findings should help a campus food outlet present essential information where customers can find it quickly." },
  { title: "Examining access to neighbourhood playgrounds", topic: "Inclusive design", question: "which features help adults support children with different mobility needs", methods: ["accompanied visits", "access checklists"], groups: ["family carers", "community volunteers"], materials: ["access map", "picture cards"], measures: ["resting distance", "gate width"], obstacles: ["wet surfaces", "restricted access"], setting: "The chosen sites include older playgrounds and a recently redesigned space with several routes between the entrance and the play equipment.", caution: "An accessible entrance does not establish that every activity inside the site is equally easy to reach.", application: "The report will identify small changes that can improve an entire visit rather than only the arrival at a gate." },
  { title: "Evaluating a shared bicycle station", topic: "Sustainable transport", question: "why some users return a shared bicycle to a more distant station", methods: ["journey logs", "station observations"], groups: ["hospital staff", "college students"], materials: ["station map", "journey slips"], measures: ["return distance", "available spaces"], obstacles: ["unrecorded trips", "station closures"], setting: "One station is next to a busy junction while another is farther from the main buildings but has a sheltered approach.", caution: "A full station can force a longer return journey, which should not be classified as a voluntary preference.", application: "The transport office needs evidence about both the position of stations and the reliability of available return spaces." },
  { title: "Recording experiences of workplace placements", topic: "Work and education", question: "which information helps students prepare for a short workplace placement", methods: ["experience interviews", "document comparisons"], groups: ["apprentice mechanics", "trainee designers"], materials: ["placement booklet", "question cards"], measures: ["preparation time", "task confidence"], obstacles: ["different schedules", "vague memories"], setting: "Participants attend different employers but receive the same introductory information from the college before their first visit.", caution: "A confident student may already have relevant experience, so the team must record that experience before comparing reactions to the booklet.", application: "The college hopes to replace general advice with a smaller set of practical questions that students can ask before they arrive." },
  { title: "Assessing a neighbourhood history display", topic: "Museums and interpretation", question: "how visitors connect a personal recording with an object in a small display", methods: ["visitor interviews", "viewing observations"], groups: ["weekend visitors", "school assistants"], materials: ["display plan", "story cards"], measures: ["viewing time", "story recall"], obstacles: ["crowded displays", "background music"], setting: "The display combines an everyday object, a short label and a recording supplied by a resident who once used a similar object.", caution: "A visitor may spend longer at a display because the recording is difficult to hear, rather than because the content is more engaging.", application: "The museum wants to balance personal stories with information visitors can understand without listening to every recording." },
  { title: "Following water use in student accommodation", topic: "Resource management", question: "whether practical reminders change the way residents report leaking taps", methods: ["maintenance diaries", "resident surveys"], groups: ["hall residents", "kitchen supervisors"], materials: ["reminder cards", "reporting guide"], measures: ["reporting delay", "repair frequency"], obstacles: ["shared bathrooms", "duplicate reports"], setting: "The buildings have similar plumbing, but residents receive maintenance information in different places around the shared facilities.", caution: "More reports can indicate better communication rather than an increase in the number of faults.", application: "The accommodation service needs a reporting system residents can use easily before a small leak continues for several weeks." },
];

const lectures: Study[] = [
  { title: "How city birds adapt their calls", topic: "Animal behaviour", question: "how urban birds adjust communication when traffic noise varies through the day", methods: ["audio surveys", "field observations"], groups: ["urban birds", "woodland birds"], materials: ["sound recorder", "wind shield"], measures: ["call frequency", "traffic intensity"], obstacles: ["strong winds", "overlapping calls"], setting: "A clear signal has to reach another bird, but roads add low-frequency sound and buildings reflect calls back towards the source.", caution: "A difference between two locations does not prove that a bird learned a new call after moving; different birds may have chosen those locations.", application: "The research helps planners consider quiet refuges as well as the total area of green space in a town." },
  { title: "Why permeable paving needs maintenance", topic: "Urban drainage", question: "how small particles change the movement of rainwater through porous surfaces", methods: ["rainfall trials", "surface sampling"], groups: ["new surfaces", "older surfaces"], materials: ["measuring cylinder", "filter cloth"], measures: ["infiltration rate", "sediment depth"], obstacles: ["uneven rainfall", "blocked channels"], setting: "Permeable paving creates spaces through which water can reach a supporting layer instead of travelling immediately into a street drain.", caution: "Rapid drainage during a single demonstration is not enough to establish long-term performance after dust and soil accumulate.", application: "The findings connect the choice of a surface with the cleaning plan needed to maintain its original function." },
  { title: "Storing energy in neighbourhood heating systems", topic: "Energy technology", question: "how stored heat can separate the time energy is produced from the time it is needed", methods: ["demand modelling", "temperature logging"], groups: ["connected homes", "public buildings"], materials: ["insulated tank", "control sensor"], measures: ["heat loss", "peak demand"], obstacles: ["sensor drift", "changing demand"], setting: "A local network may produce heat efficiently during one part of the day even though households require most of it at another time.", caution: "The size of a store cannot be judged from average demand alone, because several cold days can create a very different pattern.", application: "Designers can compare a larger store with a smaller system that uses more careful timing and clearer control information." },
  { title: "Interpreting a study of interrupted sleep", topic: "Health research", question: "why short interruptions can matter even when total recorded sleep changes very little", methods: ["sleep diaries", "laboratory recordings"], groups: ["shift workers", "daytime workers"], materials: ["activity monitor", "daily checklist"], measures: ["waking frequency", "reaction time"], obstacles: ["missed entries", "variable routines"], setting: "The number of hours spent in bed tells us something useful, but it does not describe how continuously a person slept during those hours.", caution: "A slow response on one morning may have several causes, so no single measurement should be treated as a diagnosis.", application: "The results encourage researchers to describe the pattern of sleep alongside its total duration." },
  { title: "Testing reusable food containers", topic: "Materials and waste", question: "how repeated cleaning affects a reusable container before it reaches the end of its service life", methods: ["washing trials", "material inspections"], groups: ["rigid containers", "flexible containers"], materials: ["reference sample", "inspection lamp"], measures: ["surface wear", "lid pressure"], obstacles: ["uneven loading", "temperature changes"], setting: "Replacing a disposable package is only part of the calculation; the reusable object must perform its task reliably through many separate uses.", caution: "A strong initial container can still fail at its fastening, so testing only the main material can produce an incomplete conclusion.", application: "The evidence can guide a return system towards containers that are easy to check as well as inexpensive to wash." },
  { title: "Keeping records in community water monitoring", topic: "Citizen science", question: "which recording practices allow volunteer measurements to be compared across several seasons", methods: ["paired sampling", "record audits"], groups: ["river volunteers", "school teams"], materials: ["sample bottle", "site checklist"], measures: ["water clarity", "sampling depth"], obstacles: ["missing dates", "inconsistent sites"], setting: "Volunteers can collect information from many more places than a small professional team, but a large collection of measurements is useful only when its context is known.", caution: "An unexpected result should prompt a check of the conditions and the method before it is discarded as an error.", application: "The project shows how ordinary field notes can determine whether later comparisons are meaningful." },
  { title: "Restoring soil on former industrial land", topic: "Ecological restoration", question: "how a site can support new vegetation while remaining subject to careful checks of its soil", methods: ["soil surveys", "planting trials"], groups: ["test plots", "reference plots"], materials: ["soil probe", "marker stakes"], measures: ["root growth", "moisture retention"], obstacles: ["compacted ground", "patchy drainage"], setting: "A former industrial site can look uniformly empty even though its soil contains a complicated pattern left by different activities.", caution: "The presence of healthy plants in one corner cannot establish that every part of the site is suitable for the same use.", application: "The work encourages a staged restoration plan in which new planting is matched to evidence about each part of the ground." },
  { title: "Preserving information in endangered-language recordings", topic: "Language and heritage", question: "how a sound archive can retain the context required to interpret a recording in the future", methods: ["archive interviews", "catalogue reviews"], groups: ["community speakers", "archive researchers"], materials: ["consent sheet", "recording log"], measures: ["context coverage", "catalogue accuracy"], obstacles: ["unclear permissions", "missing names"], setting: "A recording preserves a voice, but a later listener may also need to know who was speaking, why the recording was made and how it may be used.", caution: "An agreement to record a conversation does not automatically permit every possible public use of it.", application: "The archive therefore treats descriptive information and continuing community decisions as part of preservation rather than as an optional extra." },
];

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const surnames = ["Navarro", "Ishikawa", "Bennett", "Okafor", "Delgado", "Kowalski", "Chandra", "Larsen"];
const clocks = ["09:15", "10:30", "11:45", "13:15", "14:30", "15:45", "17:15", "18:30"];
const choose = <T>(items: readonly T[], serial: number): T => items[((serial % items.length) + items.length) % items.length]!;

function logisticsFacts(source: Situation, serial: number, isBooking: boolean): Fact[] {
  const activity = choose(source.activities, serial);
  const room = choose(source.rooms, Math.floor(serial / 2));
  const item = choose(source.items, Math.floor(serial / 3));
  const day = choose(weekdays, serial + 2);
  const clock = choose(clocks, Math.floor(serial / 7) + serial);
  const fee = String(14 + (serial * 7) % 43);
  const minutes = String(35 + (serial % 8) * 5);
  const capacity = String(8 + (serial % 9) * 2);
  const contact = choose(surnames, Math.floor(serial / 5) + serial);
  const followup = serial % 2 ? "confirmation email" : "printed checklist";
  return [
    { label: isBooking ? "Family name on the booking" : "Surname of the event coordinator", ask: isBooking ? "Whose surname should I put on the reservation?" : "Who is coordinating the event?", answer: contact,
      evidence: isBooking ? `Please make the booking under ${contact}.` : `Our event coordinator is ${contact}.`,
      detail: "The person named on the list will receive the practical information, so another member of the group should check with that person before arranging transport." },
    { label: "Day of the event", ask: "Which day is available for this particular event?", answer: day,
      evidence: `This event takes place on ${day}.`, detail: "That is the date for the event we are discussing, rather than the day on which the office happens to be open for enquiries. The dates on an older leaflet may differ." },
    { label: "Starting time", ask: "At what time does the event itself begin?", answer: clock,
      evidence: `The starting time is ${clock}.`, detail: "Please arrive a little beforehand so that the group can begin together. Arriving early does not mean that the first demonstration will start before its advertised time." },
    { label: "Meeting room", ask: "Where exactly should people meet?", answer: room,
      evidence: `Everyone should meet in the ${room}.`, detail: "Staff at the main entrance can show visitors the way, but waiting in the entrance hall would delay the rest of the group. The room name appears on the door." },
    { label: isBooking ? "Fee in pounds" : "Number of information packs", ask: isBooking ? "What is the charge in pounds for the booking?" : "How many information packs are available?", answer: fee,
      evidence: isBooking ? `The charge is ${fee} pounds.` : `There are ${fee} information packs available.`,
      detail: isBooking ? "That amount covers the activity described here. We will not add a separate administration fee when the booking is confirmed, and any optional purchase will be clearly identified." : "Please give one pack to each group rather than assuming that every individual needs a separate copy. The leader can explain the contents before visitors look for the relevant information." },
    { label: "Item to bring", ask: "Is there one item people should bring with them?", answer: item,
      evidence: `Please bring ${/(?:headphones|boots|shoes|envelopes|glasses)$/u.test(item) ? "" : /^[aeiou]/iu.test(item) ? "an " : "a "}${item}.`, detail: source.constraint },
    { label: "Length of the introductory activity in minutes", ask: "How many minutes does the introductory activity take?", answer: minutes,
      evidence: `The introductory activity lasts ${minutes} minutes.`, detail: "There is time for questions during that activity. People who need clarification should ask before the practical work starts, rather than trying to follow an instruction they have not understood." },
    { label: "Name of the introductory activity", ask: "What is the name of that introductory activity?", answer: activity,
      evidence: `The introductory activity is ${activity}.`, detail: `This is connected to the purpose of the event: ${source.purpose.charAt(0).toLowerCase() + source.purpose.slice(1)} It is not an unrelated extra activity.` },
    { label: "Maximum group size", ask: "How large can the group be?", answer: capacity,
      evidence: `We can take a maximum of ${capacity} people in this group.`, detail: "The limit allows the leader to check that everyone has understood the practical instructions. It should not be read as the total number of people the building can hold." },
    { label: "Document supplied after registration", ask: "What document will the group receive after registration?", answer: followup,
      evidence: `After registration, we provide a ${followup}.`, detail: `It summarises the arrangements that apply to this booking. ${source.outcome}` },
  ];
}

function studyFacts(source: Study, serial: number, lecture: boolean): Fact[] {
  const method = choose(source.methods, serial);
  const group = choose(source.groups, Math.floor(serial / 2));
  const material = choose(source.materials, Math.floor(serial / 3));
  const measure = choose(source.measures, Math.floor(serial / 5));
  const obstacle = choose(source.obstacles, serial + Math.floor(serial / 7));
  const sample = String(18 + (serial * 7) % 55);
  const weeks = String(3 + serial % 8);
  const surname = choose(surnames, serial + Math.floor(serial / 4));
  const record = serial % 2 ? "field notebook" : "digital register";
  const setting = lecture ? "reference group" : "pilot group";
  return [
    { label: "Surname of the project adviser", ask: "Who is advising this work?", answer: surname,
      evidence: `The adviser for this work is ${surname}.`, detail: "The adviser checks the connection between the research question and the method. That role is separate from collecting every observation personally." },
    { label: "Main method used", ask: "What is the main method for collecting evidence?", answer: method,
      evidence: `The main method is ${method}.`, detail: "The method must be explained in enough detail for someone else to understand what happened. Naming a method without describing how it was applied would leave too much uncertainty." },
    { label: "Group included in the study", ask: "Which group is included in this version of the study?", answer: group,
      evidence: `The study includes ${group}.`, detail: "The findings apply first to the group that actually supplied the evidence. A useful discussion will explain the limits before making a claim about a much wider population." },
    { label: "Number of cases in the sample", ask: "How many cases are included in the sample?", answer: sample,
      evidence: `There are ${sample} cases in the sample.`, detail: "That is the final sample after the initial checks, not the number of people or places first considered. The report must make that distinction clear." },
    { label: "Essential piece of equipment or material", ask: "Which item is essential to the data collection?", answer: material,
      evidence: `An essential item is the ${material}.`, detail: "The item should be checked before collection begins. Replacing it halfway through the study could affect whether the early and later observations can be compared." },
    { label: "Measurement that must be recorded", ask: "What measurement must be recorded each time?", answer: measure,
      evidence: `Each record must include ${measure}.`, detail: "A number needs a consistent unit and a clear description of the conditions. A result copied without that context may look precise while being impossible to interpret." },
    { label: "Length of the collection period in weeks", ask: "For how many weeks will the collection continue?", answer: weeks,
      evidence: `The collection period is ${weeks} weeks.`, detail: "The start and finish should be recorded as well as the total duration. A long gap in the middle must not be mistaken for continuous collection." },
    { label: "Main practical obstacle", ask: "What is the main practical obstacle identified so far?", answer: obstacle,
      evidence: `The main practical obstacle is ${obstacle}.`, detail: source.caution },
    { label: "Place where observations are recorded", ask: "Where will the original observations be recorded?", answer: record,
      evidence: `The original observations belong in a ${record}.`, detail: "Corrections must remain traceable. Keeping an original entry alongside an explanation is more useful than silently replacing a value because it looks unusual." },
    { label: "Group used to check the procedure", ask: "What group is used to check that the procedure works?", answer: setting,
      evidence: `The procedure is checked with a ${setting}.`, detail: `This check comes before the final interpretation. ${source.application}` },
  ];
}

function sectionFor(contentId: string, band: number, variant: number, part: number, mock: boolean): { section: ContentSection; questions: StoredQuestion[] } {
  // Format contributes to facts and scenario selection, not just record IDs.
  const serial = Math.round(band * 2) * 137 + variant * 43 + part * 19 + (mock ? 1009 : 0);
  const social = part <= 2;
  const situation = social ? choose(part === 1 ? bookings : community, serial + Math.round(band * 2)) : undefined;
  const study = social ? undefined : choose(part === 3 ? projects : lectures, serial + Math.round(band * 2));
  const facts = (situation ? logisticsFacts(situation, serial, part === 1) : studyFacts(study!, serial, part === 4)).slice(0, mock ? 10 : 8);
  const conversation = part === 1 || part === 3;
  const speaker = part === 1 ? "Coordinator" : part === 2 ? "Programme leader" : part === 3 ? "Research student" : "Lecturer";
  const other = part === 1 ? "Visitor" : "Project tutor";
  const dialogue: DialogueLine[] = [];
  const say = (text: string, second = false) => dialogue.push({ speaker: second ? other : speaker, accent: second ? "australian" : "british", text });
  if (situation) {
    say(situation.opening, part === 1);
    say(`${situation.purpose} I will explain the arrangements for this particular event in the order shown on the information sheet. Please use these current arrangements rather than a general notice about the service.`);
  } else {
    say(`${part === 3 ? "We are planning a study of " : "Today we are looking at "}${study!.question}. ${study!.setting}`);
    say(`${part === 3 ? "Before you begin, we should connect the practical decisions with the question you want to answer." : "The practical details of one study will help us understand how evidence supports the wider explanation."} ${study!.application}`, part === 3);
  }
  for (const fact of facts) {
    if (conversation) say(fact.ask, true);
    say(`${fact.evidence} ${fact.detail}`);
  }
  if (situation) {
    if (conversation) say("That gives me the practical information I needed. If one person cannot attend, should I change the list before the event?", true);
    say(`Please let the office know about a change before the group arrives. Staff can then update the list without delaying the opening activity. ${situation.outcome} If an arrangement is unclear, ask the team to explain it rather than making an assumption from a previous visit.`);
  } else {
    if (conversation) say("We will keep the original records and explain any changes to the plan. The conclusions should stay within what the observations can actually establish.");
    say(`${study!.caution} ${study!.application} The value of the work depends on a clear account of how the evidence was produced, not only on whether the final result agrees with the researchers' first expectation.`, part === 3);
  }
  const sectionId = `${contentId}-section-${part}`;
  const firstNumber = mock ? (part - 1) * 10 + 1 : 1;
  const completionFacts = mock ? facts.slice(0, 8) : facts;
  const blockId = `${sectionId}-notes`;
  const instructions = "Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.";
  const questions: StoredQuestion[] = completionFacts.map((fact, index) => ({
    id: `${contentId}-q-${firstNumber + index}`, number: firstNumber + index,
    type: "text", questionType: part === 1 ? "form-completion" : "note-completion",
    prompt: `${fact.label}. ${instructions}`, sectionIndex: mock ? part - 1 : 0,
    answer: fact.answer, wordLimit: 3, allowNumbers: true, blockId,
    subskill: part <= 2 ? "listening for practical details" : "following academic evidence",
    explanation: "Đối chiếu thông tin cụ thể trong lời nói; giữ đúng giới hạn từ và số của câu hỏi.", evidence: fact.evidence,
  }));
  if (mock) for (let offset = 8; offset < 10; offset++) {
    const fact = facts[offset]!;
    const correct = fact.answer;
    const alternatives = social
      ? offset === 8 ? [String(Number(fact.answer) + 6), String(Number(fact.answer) + 12)] : ["telephone recording", "travel voucher"]
      : offset === 8 ? ["publicity leaflet", "final presentation"] : ["publicity team", "payment office"];
    const options = serial % 2 ? [alternatives[0]!, correct, alternatives[1]!] : [correct, ...alternatives];
    questions.push({ id: `${contentId}-q-${firstNumber + offset}`, number: firstNumber + offset,
      type: "choice", questionType: "multiple-choice", prompt: fact.ask, options,
      sectionIndex: part - 1, answer: correct, subskill: "identifying a specific stated arrangement",
      explanation: "Chọn phương án được người nói xác nhận; không dùng thông tin giả định từ các lựa chọn khác.", evidence: fact.evidence });
  }
  return {
    section: { id: sectionId, title: `${mock ? `Part ${part}: ` : ""}${situation?.title ?? study!.title}`,
      text: dialogue.map(line => `${line.speaker}: ${line.text}`).join("\n"), dialogue,
      instructions: "Listen to the recording and answer the questions. The transcript opens after submission.",
      questionBlocks: [{ id: blockId, type: part === 1 ? "form" : "note", title: part === 1 ? "Event arrangements" : "Main points",
        instructions, questionNumbers: completionFacts.map((_fact, index) => firstNumber + index),
        text: completionFacts.map((fact, index) => `${fact.label}: {{${firstNumber + index}}}`).join("\n") }],
    }, questions,
  };
}

export function makeExclusiveListening(band: number, variant: number, format: "lesson" | "full-mock"): StoredContent {
  if (!Number.isFinite(band) || band < 3 || band > 8 || !Number.isInteger(band * 2) || !Number.isInteger(variant) || variant < 0 || variant >= (format === "lesson" ? 8 : 4))
    throw new Error("Invalid private Listening paper coordinates.");
  const id = `duo-private-listening-${format}-${Math.round(band * 10)}-${variant}`;
  const sections = (format === "full-mock" ? [1, 2, 3, 4] : [1]).map(part => sectionFor(id, band, variant, part, format === "full-mock"));
  const content: StoredContent = {
    id, skill: "listening", title: format === "full-mock" ? `Listening assessment: local services and research · ${variant + 1}` : sections[0]!.section.title,
    description: "Đề Listening riêng của lượt đánh giá Duo; nghe thông tin, xác định ý chính và đối chiếu các chi tiết cụ thể.",
    topic: format === "full-mock" ? "Community, education and research" : "Community services",
    band, cefr: band <= 4 ? "A2" : band <= 5.5 ? "B1" : band <= 7 ? "B2" : "C1", testType: "both",
    durationMinutes: format === "full-mock" ? 40 : 12, format,
    sections: sections.map(item => item.section), questions: sections.flatMap(item => item.questions),
    vocabularyIds: [], tags: ["duo-exclusive", "listening", format === "full-mock" ? "promotion-assessment" : "gate-assessment"],
    source: "authored", quality: "authored-unreviewed", createdAt: authoredAt,
    provenance: { method: "authored", version: "duo-exclusive-20261105-v1", generatedAt: authoredAt },
    review: { status: "structural-checks-passed", checks: ["numbered questions", "verbatim evidence", "speaker roles", "format isolation"], limitations: ["Chưa được giám khảo độc lập hiệu chuẩn độ khó hoặc band."] },
  };
  validateContentStructure(content);
  return content;
}
