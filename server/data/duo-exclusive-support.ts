import type { Cefr, ReferenceResponse, StoredContent, StoredQuestion } from "../../shared/types";

/** Reserved authored material. This module is deliberately not part of the
 * public content bank; only the Duo assessment repository may publish a paper. */
interface Scenario {
  key: string;
  title: string;
  topic: string;
  activity: string;
  personal: string;
  habit: string;
  preferences: [string, string];
  rows: [string, string, string];
  essay: string;
  letter: string;
  cue: string;
  detail: string;
}

const scenarios: Scenario[] = [
  { key: "evening-study", title: "Evening study for working adults", topic: "Education",
    activity: "evening education for adults", personal: "evening classes", habit: "study after a working day", preferences: ["short evening lessons", "longer weekend lessons"], rows: ["Language courses", "Practical workshops", "Examination courses"],
    essay: "Some adult education centres offer the same evening timetable throughout the year, while others change their schedules to match local working patterns. Which approach is more useful for adult learners? Give reasons for your answer and include relevant examples.",
    letter: "You joined an evening course, but a change in your working hours means that you can no longer arrive at the beginning of each lesson. Write to the course administrator.",
    cue: "Describe a study arrangement that helped someone continue learning while working.", detail: "how the arrangement fitted around other responsibilities" },
  { key: "school-workshop", title: "A practical workshop at school", topic: "Education",
    activity: "practical workshops in schools", personal: "school workshops", habit: "learn a skill by making something", preferences: ["a demonstration before trying", "learning through an initial attempt"], rows: ["Woodwork sessions", "Cooking sessions", "Repair sessions"],
    essay: "Schools sometimes invite local craftspeople to lead practical workshops instead of using the time for additional academic revision. Do the benefits of this arrangement outweigh the disadvantages? Give reasons and examples.",
    letter: "You offered to help organise a practical workshop at your former school, but the room allocated to the activity is unsuitable. Write to the teacher coordinating the event.",
    cue: "Describe something useful you learned by making an object yourself.", detail: "what you discovered while correcting an early mistake" },
  { key: "study-mentors", title: "Peer mentors for new students", topic: "Education",
    activity: "peer mentoring for new students", personal: "student support groups", habit: "ask another learner for advice", preferences: ["advice from a classmate", "advice from a teacher"], rows: ["Campus orientation", "Study planning", "Language exchange"],
    essay: "Universities increasingly ask experienced students to help new students settle in. Some people think this should be paid work, while others regard it as a voluntary responsibility. Discuss both views and give your opinion.",
    letter: "You are a volunteer mentor for new students. Several students you support cannot attend the introductory meeting at its scheduled time. Write to the student services officer.",
    cue: "Describe a helpful piece of advice you received when you were new to a place.", detail: "why that advice was useful at that particular moment" },
  { key: "field-notebooks", title: "Learning beyond the classroom", topic: "Education",
    activity: "local field visits for school students", personal: "educational visits", habit: "take notes while visiting a place", preferences: ["drawing observations", "writing short descriptions"], rows: ["River observations", "Street surveys", "Museum investigations"],
    essay: "Some schools require pupils to keep a personal observation notebook during local educational visits. Others provide a worksheet with fixed questions. Discuss the advantages of each method and give your opinion.",
    letter: "You accompanied a school group on an educational visit and found that the information supplied in advance did not match the activities available. Write to the education officer at the venue.",
    cue: "Describe a visit during which you noticed something you had previously overlooked.", detail: "how recording your observations affected what you remembered" },
  { key: "river-shade", title: "Shade along an urban river", topic: "Environment",
    activity: "tree planting along urban rivers", personal: "riverside paths", habit: "walk beside water", preferences: ["shaded natural paths", "open paved paths"], rows: ["Morning walkers", "Afternoon walkers", "Evening walkers"],
    essay: "A town has limited funds to improve a riverside path. Some residents favour planting trees, while others favour installing more lights. What factors should determine the decision? Explain your view with examples.",
    letter: "You regularly use a riverside path. A proposed maintenance schedule would close its only shaded section during the hottest part of the day. Write to the parks department.",
    cue: "Describe an outdoor place that became more comfortable after a small improvement.", detail: "who benefited most from the change" },
  { key: "refill-stations", title: "Refill points at public events", topic: "Environment",
    activity: "drinking-water refill points at public events", personal: "outdoor events", habit: "carry a reusable water bottle", preferences: ["bringing refreshments", "buying refreshments at the venue"], rows: ["Sports events", "Music events", "Community fairs"],
    essay: "Organisers of large outdoor events can reduce disposable bottle waste by providing water refill points. Who should meet the cost: ticket holders, local government or event sponsors? Give reasons for your choice.",
    letter: "You attended an outdoor event where the advertised drinking-water refill point was difficult to find. Write to the organiser about the problem and a practical improvement.",
    cue: "Describe an occasion when being prepared made an outdoor activity easier.", detail: "what you brought and how it helped" },
  { key: "nesting-season", title: "Sharing a park with wildlife", topic: "Environment",
    activity: "protecting wildlife in public parks", personal: "local wildlife areas", habit: "watch birds or other wild animals", preferences: ["observing from a distance", "joining a guided wildlife walk"], rows: ["Guided bird walks", "Independent visits", "School visits"],
    essay: "Public parks sometimes close small areas during the breeding season to protect wildlife. Some residents object because they pay for access to the whole park. How should park managers balance these interests?",
    letter: "You lead a walking group whose usual route passes through an area that will be temporarily closed to protect nesting birds. Write to the park manager to request help planning an alternative route.",
    cue: "Describe an occasion when you changed a plan to avoid disturbing nature.", detail: "how you decided what to do instead" },
  { key: "rain-gardens", title: "Rain gardens near homes", topic: "Environment",
    activity: "small rain gardens in residential streets", personal: "planted areas near homes", habit: "look after plants outside your home", preferences: ["flowering plants", "plants that need little maintenance"], rows: ["Front gardens", "Shared courtyards", "Street-corner gardens"],
    essay: "Some cities replace a few roadside parking spaces with planted areas that absorb rainwater. Is this a reasonable use of limited street space? Give reasons and consider the people affected.",
    letter: "Your neighbourhood association plans to create a rain garden, but the suggested volunteer times exclude many residents who would like to help. Write to the association secretary.",
    cue: "Describe a small shared space that people worked together to improve.", detail: "how the different jobs were divided" },
  { key: "station-lockers", title: "Storage at a railway station", topic: "Transport",
    activity: "secure storage at railway stations", personal: "railway stations", habit: "travel with a bag or suitcase", preferences: ["travelling with one small bag", "taking extra items for convenience"], rows: ["Short-term lockers", "Full-day lockers", "Staffed storage"],
    essay: "Busy railway stations must decide whether to use spare space for passenger luggage storage or additional shops. Which use would improve the passenger experience more? Explain your reasons.",
    letter: "You reserved luggage storage at a railway station, but the collection time printed on your receipt differs from the time shown on the station website. Write to the storage supervisor.",
    cue: "Describe a time when you had to organise your belongings during a journey.", detail: "how your choice affected the rest of the journey" },
  { key: "late-buses", title: "The last bus after evening activities", topic: "Transport",
    activity: "late-evening public transport", personal: "evening bus services", habit: "return home after an evening activity", preferences: ["an earlier reliable service", "a later service with fewer stops"], rows: ["Weekday passengers", "Friday passengers", "Saturday passengers"],
    essay: "Some towns run a late bus only when large events take place. Others provide a regular late service even when passenger numbers are low. Discuss the advantages of each approach and give your opinion.",
    letter: "Your community centre has moved an evening class to a later time, after the last direct bus to your neighbourhood. Write to the centre manager about the effect of this change.",
    cue: "Describe an occasion when transport arrangements influenced an activity you chose.", detail: "what alternatives you considered" },
  { key: "bicycle-checks", title: "Bicycle checks before commuting", topic: "Transport",
    activity: "basic bicycle maintenance for commuters", personal: "bicycle repair services", habit: "check equipment before a journey", preferences: ["fixing a small problem yourself", "asking a specialist to check it"], rows: ["Brake checks", "Tyre checks", "Lighting checks"],
    essay: "Employers sometimes offer free bicycle maintenance sessions to staff who cycle to work. Should employers support this kind of travel in preference to subsidising car parking? Discuss both options.",
    letter: "You booked a bicycle check at your workplace, but the appointment was cancelled without a replacement time. Write to the staff travel coordinator.",
    cue: "Describe a practical check that prevented a problem later.", detail: "how you recognised that the check was necessary" },
  { key: "ferry-notices", title: "Clear information at a ferry landing", topic: "Transport",
    activity: "passenger information for local ferries", personal: "travel notices", habit: "check travel information before leaving home", preferences: ["a printed timetable", "live updates on a screen"], rows: ["Printed timetable users", "Screen users", "Information desk users"],
    essay: "When public transport services are disrupted, operators must provide information quickly. Is it better to publish an early estimate that may change or to wait until the information is certain? Give your opinion.",
    letter: "You arrived for a ferry journey and found two notices giving different boarding locations. Write to the ferry operator to explain the confusion and request clearer information.",
    cue: "Describe an occasion when you had to check whether some information was current.", detail: "which source you decided to trust and why" },
  { key: "health-walks", title: "Walking groups for new residents", topic: "Health",
    activity: "community walking groups", personal: "organised walking activities", habit: "walk with other people for exercise", preferences: ["a familiar route", "a different route each week"], rows: ["Short walks", "Moderate walks", "Long walks"],
    essay: "Local health services sometimes recommend community walking groups instead of giving only written advice about exercise. What makes a group activity effective, and what limitations should be considered?",
    letter: "You joined a community walking group whose published route was much more demanding than described. Write to the group coordinator about making route information more useful.",
    cue: "Describe a physical activity that was easier to maintain with other people.", detail: "what the group did to keep people involved" },
  { key: "quiet-hours", title: "Quiet periods in shared accommodation", topic: "Health",
    activity: "quiet-hour agreements in shared accommodation", personal: "quiet places for resting", habit: "find a quiet place when you are tired", preferences: ["a completely silent room", "a room with gentle background sound"], rows: ["Students", "Day-shift workers", "Night-shift workers"],
    essay: "Shared accommodation often has fixed quiet hours, but residents may work or study at different times. Should rules be the same for everyone, or should residents negotiate individual arrangements? Discuss both views.",
    letter: "A repair project in your building has been scheduled during the daytime hours when you normally sleep after night work. Write to the building manager.",
    cue: "Describe a change to your surroundings that helped you rest or concentrate.", detail: "how you knew that the change made a difference" },
  { key: "meal-breaks", title: "Useful meal breaks at work", topic: "Health",
    activity: "protected meal breaks in workplaces", personal: "places to eat during a break", habit: "take a proper break during a busy day", preferences: ["eating with colleagues", "having a quiet break alone"], rows: ["Shared dining rooms", "Outdoor eating areas", "Desk-based meals"],
    essay: "Some employers provide a pleasant shared eating area, while others use the same funds to offer discounted meals. Which approach is more likely to improve employees' daily experience? Explain your view.",
    letter: "The shared eating area at your workplace is being used for storage, leaving staff without somewhere suitable to take a meal break. Write to the facilities manager.",
    cue: "Describe a daily routine that helped you manage a demanding period.", detail: "why you continued it even on busy days" },
  { key: "first-aid-confidence", title: "Confidence in basic first aid", topic: "Health",
    activity: "refresher training in basic first aid", personal: "practical safety courses", habit: "refresh a skill you learned some time ago", preferences: ["practising with an instructor", "reviewing a written guide"], rows: ["Workplace courses", "Community courses", "School courses"],
    essay: "People who have completed a basic first-aid course may forget skills they rarely use. Should refresher sessions be compulsory at regular intervals? Give reasons for your opinion.",
    letter: "You completed a first-aid course and would like your volunteer group to have a short refresher session before a large public event. Write to the training provider.",
    cue: "Describe a time when practising a skill again increased your confidence.", detail: "what you remembered and what you needed to relearn" },
  { key: "device-loans", title: "Short-term loans of digital devices", topic: "Technology",
    activity: "public lending schemes for digital devices", personal: "borrowed electronic devices", habit: "use a device that belongs to an organisation", preferences: ["borrowing equipment", "saving to buy your own equipment"], rows: ["Laptop loans", "Tablet loans", "Mobile hotspot loans"],
    essay: "Public libraries increasingly lend digital devices as well as books. Should limited library funds support such lending, or should they be reserved for reading materials? Discuss both views and give your opinion.",
    letter: "You borrowed a laptop from a local lending scheme, but the collection instructions did not explain that you needed a separate charging adapter. Write to the scheme coordinator.",
    cue: "Describe a situation in which access to a borrowed item was especially useful.", detail: "how you arranged to return it responsibly" },
  { key: "notification-settings", title: "Choosing useful digital notifications", topic: "Technology",
    activity: "notification policies for public-service apps", personal: "phone notifications", habit: "change the settings on a digital device", preferences: ["receiving every update", "checking information at a chosen time"], rows: ["Travel alerts", "Appointment reminders", "Local-event alerts"],
    essay: "Public-service apps can send frequent reminders and alerts. Should these notifications be switched on automatically, or should users actively choose them? Explain the advantages and disadvantages of your preferred approach.",
    letter: "An app used by your local sports centre has begun sending repeated reminders for a booking you cancelled. Write to the centre administrator.",
    cue: "Describe a digital setting you changed to make a device more useful.", detail: "how the previous setting affected your day" },
  { key: "repair-records", title: "Digital records for repaired equipment", topic: "Technology",
    activity: "shared digital maintenance records", personal: "repair records and receipts", habit: "keep a record of a repair or purchase", preferences: ["paper records", "searchable electronic records"], rows: ["Paper-only records", "Digital-only records", "Combined records"],
    essay: "Organisations often replace paper maintenance records with shared digital systems. What practical problems can this change solve, and what new difficulties might it create? Give relevant examples.",
    letter: "You collected a repaired appliance, but the online repair record describes a different item. Write to the repair service to request an accurate record.",
    cue: "Describe a time when a well-kept record helped you solve a problem.", detail: "which detail in the record was most important" },
  { key: "accessible-kiosks", title: "Using self-service information kiosks", topic: "Technology",
    activity: "accessible self-service information systems", personal: "self-service machines", habit: "use a machine to obtain a ticket or information", preferences: ["asking a staff member", "using a clear self-service screen"], rows: ["Touchscreen terminals", "Audio-assisted terminals", "Staff-assisted terminals"],
    essay: "Public venues increasingly use self-service information kiosks. Should a staffed alternative always be available, even when most visitors prefer the machines? Discuss the reasons for your answer.",
    letter: "A newly installed information kiosk at a public venue is positioned where wheelchair users cannot comfortably reach the screen. Write to the venue manager.",
    cue: "Describe a time when a small design feature made something easier to use.", detail: "who else might benefit from the same feature" },
  { key: "local-voices", title: "Recording the voices of a neighbourhood", topic: "Culture",
    activity: "neighbourhood oral-history projects", personal: "recorded personal stories", habit: "listen to someone describe an earlier time", preferences: ["a recorded interview", "a written personal account"], rows: ["Home interviews", "Group recording sessions", "Telephone interviews"],
    essay: "Local museums collect recordings of residents' memories. Is it more important to include as many voices as possible or to investigate a smaller number of accounts in depth? Give reasons for your opinion.",
    letter: "You agreed to record an interview for a neighbourhood history project, but the proposed location is too noisy for a clear recording. Write to the project organiser.",
    cue: "Describe a personal story that changed how you viewed a familiar place.", detail: "which detail made the story memorable" },
  { key: "festival-maps", title: "Helping visitors explore a local festival", topic: "Culture",
    activity: "visitor guidance at cultural festivals", personal: "local festivals", habit: "explore activities at a public celebration", preferences: ["following a planned route", "discovering activities as you go"], rows: ["Printed maps", "Volunteer directions", "Mobile maps"],
    essay: "Large cultural festivals may place all popular activities in one central area or distribute them across different neighbourhoods. Discuss the advantages of both arrangements and give your opinion.",
    letter: "You helped at a local festival and noticed that the visitor map did not show the entrance to a free activity. Write to the festival planning team.",
    cue: "Describe an event at which good organisation helped you enjoy an unfamiliar activity.", detail: "what made it easy to take part" },
  { key: "community-costumes", title: "Sharing costumes for local performances", topic: "Culture",
    activity: "shared costume collections for amateur performers", personal: "live performances", habit: "attend a performance by local people", preferences: ["a small informal performance", "a large professionally staged show"], rows: ["School productions", "Neighbourhood theatre", "Dance groups"],
    essay: "Community arts groups sometimes share costumes and equipment instead of buying their own. What are the main benefits and difficulties of this arrangement, and how could the difficulties be reduced?",
    letter: "Your amateur performance group has borrowed costumes from a shared collection, but the return date conflicts with your final performance. Write to the collection organiser.",
    cue: "Describe an occasion when people combined their resources to create something.", detail: "how sharing changed the final result" },
  { key: "translation-signs", title: "Explaining a local landmark to visitors", topic: "Culture",
    activity: "multilingual signs at local landmarks", personal: "signs at visitor attractions", habit: "read information about a place you are visiting", preferences: ["a short written explanation", "a guide's spoken explanation"], rows: ["Single-language signs", "Bilingual signs", "Multilingual audio points"],
    essay: "At local heritage sites, information can be translated into several languages or presented using images and simple wording. Which approach best serves a varied audience? Give reasons and examples.",
    letter: "You noticed that a translated sign at a local landmark gives visitors a different opening time from the original-language sign. Write to the organisation responsible for the site.",
    cue: "Describe information that helped you understand a place with an unfamiliar history.", detail: "how the information was presented" },
  { key: "job-shadowing", title: "Observing a working day", topic: "Work",
    activity: "short job-shadowing visits", personal: "opportunities to learn about jobs", habit: "ask someone about their daily work", preferences: ["watching a task being done", "hearing a detailed explanation"], rows: ["Office visits", "Workshop visits", "Outdoor-work visits"],
    essay: "Some employers let young people observe a normal working day without carrying out tasks themselves. How useful is this experience compared with a practical work placement? Explain your answer.",
    letter: "You arranged a job-shadowing visit, but the confirmation email does not say what clothing or safety equipment you should bring. Write to the contact person at the workplace.",
    cue: "Describe a time when observing someone helped you understand their work.", detail: "what surprised you about an ordinary task" },
  { key: "handover-notes", title: "Clear handovers between work shifts", topic: "Work",
    activity: "communication between different work shifts", personal: "written instructions", habit: "leave a useful note for another person", preferences: ["a short checklist", "a longer explanation"], rows: ["Written logbooks", "Face-to-face handovers", "Shared digital notes"],
    essay: "In workplaces with several shifts, should staff rely mainly on written handover notes or allow paid time for direct discussion? Discuss both methods and give your opinion.",
    letter: "You have started a different shift at work and the handover notes do not explain who is responsible for an important daily task. Write to your supervisor.",
    cue: "Describe a time when a clear explanation prevented a misunderstanding.", detail: "what information needed to be made explicit" },
  { key: "flexible-desks", title: "Booking a shared workspace", topic: "Work",
    activity: "shared workspaces for independent workers", personal: "places to work outside the home", habit: "work on a task away from home", preferences: ["a fixed personal desk", "a flexible shared desk"], rows: ["Full-day desks", "Half-day desks", "Meeting booths"],
    essay: "Shared workspaces can offer either flexible daily bookings or cheaper long-term memberships. Which model better supports people whose working hours are uncertain? Give reasons and consider possible disadvantages.",
    letter: "You booked a quiet desk in a shared workspace, but a noisy event has been scheduled beside it at the same time. Write to the workspace coordinator.",
    cue: "Describe a place where you were able to complete an important task.", detail: "which feature of the place helped most" },
  { key: "skill-exchanges", title: "Exchanging useful professional skills", topic: "Work",
    activity: "professional skill-exchange schemes", personal: "informal learning networks", habit: "exchange advice with someone who has a different skill", preferences: ["learning from a peer", "attending a formal training session"], rows: ["Design advice", "Language support", "Bookkeeping support"],
    essay: "Small businesses sometimes exchange professional services without paying each other. What advantages can this bring, and what rules are needed to keep the exchange fair?",
    letter: "Your small organisation joined a skill-exchange scheme, but the service offered in return differs from the original agreement. Write to the scheme coordinator.",
    cue: "Describe a time when two people helped each other using different abilities.", detail: "why the exchange worked well" },
  { key: "welcome-packs", title: "Useful information for new neighbours", topic: "Community",
    activity: "welcome information for new residents", personal: "neighbourhood information sources", habit: "find out about services near a new home", preferences: ["a printed welcome pack", "a conversation with a neighbour"], rows: ["Printed packs", "Welcome meetings", "Online welcome pages"],
    essay: "Neighbourhood associations sometimes prepare information packs for new residents. Is this the best way to help people settle in, or are personal introductions more valuable? Discuss both approaches.",
    letter: "You recently moved into an area and found that several contact details in the neighbourhood welcome pack are no longer correct. Write to the association secretary.",
    cue: "Describe a time when somebody helped you feel welcome in an unfamiliar place.", detail: "which small action mattered most" },
  { key: "shared-storage", title: "Keeping equipment in a shared building", topic: "Community",
    activity: "communal storage in residential buildings", personal: "shared facilities", habit: "share a useful facility with neighbours", preferences: ["a booking system", "an informal agreement"], rows: ["Bicycle storage", "Pushchair storage", "Seasonal equipment storage"],
    essay: "In apartment buildings, residents may disagree about how communal storage space should be allocated. Should space be divided equally or according to need? Explain your opinion with examples.",
    letter: "Your building has introduced a communal storage room, but its access hours do not fit your work schedule. Write to the residents' committee.",
    cue: "Describe an arrangement that made sharing a space easier.", detail: "how people agreed on a fair rule" },
  { key: "volunteer-tasks", title: "Matching volunteers with suitable tasks", topic: "Community",
    activity: "matching community volunteers with suitable responsibilities", personal: "local volunteering opportunities", habit: "help with a community activity", preferences: ["a regular small responsibility", "a short intensive project"], rows: ["Regular weekly roles", "One-day projects", "Remote support roles"],
    essay: "Volunteer organisations can ask people to commit to a regular role or let them choose tasks whenever they are available. Which arrangement is more effective? Discuss the needs of both volunteers and organisers.",
    letter: "You signed up for a volunteer project, but the assigned task requires a qualification you do not have. Write to the volunteer coordinator.",
    cue: "Describe a time when choosing the right task helped a group succeed.", detail: "how the different strengths of the group were considered" },
  { key: "noticeboards", title: "Keeping a public noticeboard useful", topic: "Community",
    activity: "community noticeboards", personal: "local announcements", habit: "check what is happening in your area", preferences: ["a notice in a familiar place", "an online announcement"], rows: ["Printed notices", "Email bulletins", "Neighbourhood message groups"],
    essay: "Community noticeboards often contain expired advertisements and repeated messages. Should a paid coordinator manage them, or should users take responsibility for their own notices? Discuss both views.",
    letter: "Your local community noticeboard still displays an old timetable for an activity you organise, and people have arrived at the wrong time. Write to the person responsible for the board.",
    cue: "Describe a useful announcement that you almost missed.", detail: "how you eventually found out about it" },
  { key: "weather-backups", title: "A backup plan for outdoor recreation", topic: "Leisure",
    activity: "indoor alternatives for outdoor community activities", personal: "outdoor leisure activities", habit: "plan an activity that depends on the weather", preferences: ["making a backup plan", "deciding on the day"], rows: ["Activities moved indoors", "Activities rescheduled", "Activities cancelled"],
    essay: "Community organisations must decide whether to reserve an indoor venue as a backup for outdoor events. Is the extra expense justified when it may not be needed? Give reasons for your answer.",
    letter: "You booked an outdoor group activity that was cancelled because of bad weather, but no alternative date or refund information was provided. Write to the activity organiser.",
    cue: "Describe an enjoyable activity that continued successfully after a change of plan.", detail: "what made the alternative work" },
  { key: "beginner-sessions", title: "Making a leisure activity welcoming", topic: "Leisure",
    activity: "introductory sessions at leisure clubs", personal: "local clubs", habit: "try an activity you have not done before", preferences: ["a separate beginners' session", "joining a mixed-ability group"], rows: ["Introductory sessions", "Mixed-ability sessions", "Individual coaching"],
    essay: "Leisure clubs can create separate sessions for beginners or encourage beginners to join experienced members immediately. Discuss the advantages of each approach and give your opinion.",
    letter: "You attended an activity advertised as suitable for beginners, but it assumed knowledge you did not have. Write to the club organiser about improving the introduction.",
    cue: "Describe a time when someone made it easier for you to try something new.", detail: "what they did during the first part of the activity" },
  { key: "equipment-bookings", title: "Fair access to popular sports equipment", topic: "Leisure",
    activity: "shared sports-equipment bookings", personal: "sports facilities", habit: "reserve something before a leisure activity", preferences: ["booking well in advance", "keeping plans flexible"], rows: ["Advance bookings", "Same-day bookings", "Group bookings"],
    essay: "At busy public sports facilities, some equipment is booked long before it is used. Should all bookings be made in advance, or should some availability be reserved for people who arrive without a booking?",
    letter: "You reserved sports equipment for a group, but the booking system allowed another group to reserve the same items at the same time. Write to the facility manager.",
    cue: "Describe an occasion when a reservation helped you organise a group activity.", detail: "how you made sure the arrangement was understood" },
  { key: "hobby-libraries", title: "Borrowing materials for a new hobby", topic: "Leisure",
    activity: "lending materials for hobby projects", personal: "creative hobbies", habit: "begin a small creative project", preferences: ["trying borrowed materials first", "buying a complete set of materials"], rows: ["Textile kits", "Art kits", "Model-making kits"],
    essay: "Libraries sometimes lend kits that allow people to try a hobby before buying equipment. Should users pay a small fee for these kits, or should this be part of the free library service? Discuss both views.",
    letter: "You borrowed a hobby kit from a library and discovered that an essential tool is missing. Write to the librarian responsible for the lending collection.",
    cue: "Describe a small project that encouraged you to become interested in a hobby.", detail: "what you learned from the first attempt" },
  { key: "covered-seating", title: "Seating that works in different weather", topic: "Urban planning",
    activity: "covered seating in public squares", personal: "public seating areas", habit: "take a short rest while out in town", preferences: ["a seat near busy activity", "a seat in a quieter corner"], rows: ["Covered benches", "Open benches", "Indoor public seating"],
    essay: "Some town centres provide covered seating that people can use without making a purchase. Should such facilities receive public funding when nearby cafés already provide seats? Give your opinion.",
    letter: "The covered seating near your local bus stop has been removed temporarily, but no date has been given for its return. Write to the council's public-space team.",
    cue: "Describe a public facility that was particularly useful during a journey on foot.", detail: "why it mattered at that moment" },
  { key: "school-crossings", title: "A safer route near a school", topic: "Urban planning",
    activity: "safe pedestrian routes near schools", personal: "pedestrian crossings", habit: "choose a safe walking route", preferences: ["a shorter busy route", "a longer quieter route"], rows: ["Signal-controlled crossings", "Staffed crossings", "Raised crossing points"],
    essay: "A council can improve safety near a school by changing road design or by increasing supervision at busy times. Which approach should take priority? Explain your reasons.",
    letter: "Roadworks have temporarily removed the pedestrian crossing used by children attending your local school. Write to the roadworks coordinator to request a safe temporary route.",
    cue: "Describe a time when you chose a less direct route for a good reason.", detail: "how you weighed convenience against another concern" },
  { key: "mixed-housing", title: "Everyday services in a new neighbourhood", topic: "Urban planning",
    activity: "everyday services in new residential areas", personal: "shops and services near home", habit: "complete everyday tasks in your neighbourhood", preferences: ["several small local shops", "one large shopping centre"], rows: ["Food shops", "Childcare services", "Health services"],
    essay: "New residential areas sometimes gain houses long before shops and basic services. Should developers be required to provide essential local facilities before residents move in? Discuss your view.",
    letter: "You have moved into a new residential area where the promised temporary grocery service has not started. Write to the development company's resident liaison officer.",
    cue: "Describe a local service that made everyday life more convenient.", detail: "what you previously had to do without that service" },
  { key: "street-markets", title: "Space for a weekly street market", topic: "Urban planning",
    activity: "weekly markets in residential streets", personal: "street markets", habit: "buy something from a market stall", preferences: ["a familiar regular stall", "trying a new seller"], rows: ["Food stalls", "Household stalls", "Craft stalls"],
    essay: "Weekly street markets can bring visitors and support small traders, but they can also inconvenience nearby residents. What arrangements can allow both groups to benefit? Give reasons and examples.",
    letter: "A weekly market has changed its delivery arrangements, and delivery vehicles now block the entrance to your building early in the morning. Write to the market manager.",
    cue: "Describe an occasion when a temporary activity changed the atmosphere of a familiar place.", detail: "what you enjoyed and what you found less convenient" },
  { key: "repair-guarantees", title: "Understanding a repair guarantee", topic: "Consumer choices",
    activity: "clear guarantees for repaired household items", personal: "repair services", habit: "compare repairing an item with replacing it", preferences: ["a detailed written guarantee", "a clear explanation from a specialist"], rows: ["Small appliances", "Furniture", "Electronic accessories"],
    essay: "Customers are often encouraged to repair household items rather than replace them. How important are clear repair guarantees in making this choice attractive? Discuss other factors as well.",
    letter: "You paid for a household item to be repaired, but the guarantee document does not identify which parts are covered. Write to the repair company.",
    cue: "Describe a time when you asked for more information before making a decision.", detail: "which answer was most useful to you" },
  { key: "shared-deliveries", title: "Collecting parcels without repeated journeys", topic: "Consumer choices",
    activity: "shared parcel-collection facilities", personal: "delivery and collection services", habit: "arrange to receive an item when you are away from home", preferences: ["home delivery", "collection at a convenient location"], rows: ["Home deliveries", "Collection lockers", "Staffed collection points"],
    essay: "Some residential buildings provide a shared parcel-collection point. Should access to this service be included in the general building fee or charged only to users? Discuss both views.",
    letter: "A parcel collection point in your building has changed its access procedure, but residents were not told how to collect items already delivered there. Write to the building manager.",
    cue: "Describe a service that saved you an unnecessary journey.", detail: "how you found out how to use it" },
  { key: "product-instructions", title: "Instructions that help people use a product", topic: "Consumer choices",
    activity: "understandable instructions for household products", personal: "product instructions", habit: "read instructions before using something unfamiliar", preferences: ["a short illustrated guide", "a detailed written explanation"], rows: ["Printed guides", "Instruction videos", "Telephone assistance"],
    essay: "Manufacturers increasingly replace printed instructions with online videos. Do the advantages of this change outweigh the disadvantages for ordinary users? Support your view with examples.",
    letter: "You bought a household product whose online instructions show a different model. Write to the manufacturer's customer service team to request suitable guidance.",
    cue: "Describe a time when a set of instructions helped you complete an unfamiliar task.", detail: "what made the instructions easy to follow" },
  { key: "reusable-packaging", title: "Returning packaging after shopping", topic: "Consumer choices",
    activity: "returnable packaging schemes in local shops", personal: "reusable shopping containers", habit: "return or reuse packaging after a purchase", preferences: ["paying a refundable deposit", "bringing your own container"], rows: ["Deposit containers", "Customer-owned containers", "Disposable containers"],
    essay: "Shops may reduce packaging waste by asking customers to bring containers or by lending containers for a refundable deposit. Which system is more practical for most shoppers? Discuss the reasons for your answer.",
    letter: "You paid a deposit for returnable food containers, but your local branch has stopped accepting returns without explaining another option. Write to the shop manager.",
    cue: "Describe a small change that made one of your regular habits more convenient.", detail: "why you were willing to keep the new habit" },
];

interface WritingPlan {
  position: string;
  reason: string;
  caution: string;
  example: string;
  expected: string;
  impact: string;
  remedy: string;
}

/** Original illustrative arguments, not claims about real studies or events. */
const writingPlans: Record<string, WritingPlan> = {
  "evening-study": {
    position: "Centres should adjust some lesson times to local working patterns while retaining a stable core timetable.",
    reason: "A course offers little practical opportunity if a learner's shift regularly ends after the lesson begins.",
    caution: "Frequent timetable changes can create another barrier for people who have already arranged childcare or shared transport.",
    example: "A centre could keep one evening group unchanged for a full term and offer a second group whose starting time reflects the main local shift pattern. Workers would gain a realistic choice without every existing learner having to reorganise their week.",
    expected: "I enrolled in the evening course because its original starting time allowed me to attend after work.",
    impact: "My employer has now moved the end of my shift, so I would miss the opening explanation of each lesson. I would rather make a suitable arrangement than repeatedly interrupt the class.",
    remedy: "Please let me know whether I could transfer to a later group or receive the introductory materials before the lesson. I would be happy to discuss either option before the next session.",
  },
  "school-workshop": {
    position: "Occasional workshops led by local craftspeople are worthwhile, provided they complement rather than routinely displace essential academic learning.",
    reason: "Making an object requires pupils to apply measurement, planning and communication to a result they can examine directly.",
    caution: "A workshop can waste valuable lesson time if its purpose is unclear or the visiting instructor cannot manage a school group safely.",
    example: "During a simple repair workshop, pupils could measure a loose wooden panel, compare possible fixes and explain their choice. A teacher could connect the activity with a later mathematics lesson, making the practical session part of learning rather than an isolated entertainment.",
    expected: "I volunteered to help with the practical workshop and understood that we would have a room with sturdy tables and enough space to work safely.",
    impact: "The room now allocated has tightly arranged desks and very little clear floor space. This would make demonstrations difficult and prevent pupils from moving safely between the workstations.",
    remedy: "Could we use the larger activity room or divide the group into smaller sessions? I can help move the necessary tables if a suitable room becomes available.",
  },
  "study-mentors": {
    position: "A modest payment is justified for mentors with regular, defined responsibilities, although informal help between students should remain voluntary.",
    reason: "Reliable mentoring takes preparation and scheduled time, and unpaid duties may exclude experienced students who need paid employment.",
    caution: "Turning every friendly interaction into paid work could make a welcoming relationship feel unnecessarily formal.",
    example: "A university could pay mentors for scheduled orientation meetings and training while leaving ordinary social activities voluntary. A new student would then know when reliable help was available, and a mentor would not be expected to provide unlimited support at personal expense.",
    expected: "I agreed to mentor a small group of new students and expected the introductory meeting to be accessible to everyone assigned to me.",
    impact: "Several students have compulsory classes at the scheduled time. They would miss the explanation of how to contact their mentor and may feel excluded at the start of the programme.",
    remedy: "Please consider a second meeting or a short alternative session later in the week. I am willing to lead it and share the same materials so that all students receive consistent information.",
  },
  "field-notebooks": {
    position: "A short worksheet can establish essential tasks, but pupils should also have space for their own observations.",
    reason: "A personal notebook encourages learners to notice unexpected details instead of searching only for answers an adult has already selected.",
    caution: "A completely open task may leave inexperienced pupils unsure what to observe, while a rigid worksheet can turn a visit into a race to fill boxes.",
    example: "On a river visit, a teacher could ask everyone to record the water level and one sign of human activity. Pupils could then choose a further feature to describe, such as shade or wildlife, and compare their observations back in class.",
    expected: "I helped accompany the school group and planned the visit around the activities described in the information supplied beforehand.",
    impact: "Several advertised activities were unavailable, leaving pupils unable to complete the tasks their teacher had prepared. Staff at the venue could not suggest an equivalent activity immediately.",
    remedy: "Please update the advance information and let schools know about unavailable activities before they travel. A short list of alternatives would also help teachers adapt their plans without losing valuable learning time.",
  },
  "river-shade": {
    position: "The council should identify the greatest current barrier to safe use, while recognising that trees and lighting serve different needs.",
    reason: "Trees can make a hot path usable during the day, particularly for older walkers and people who cannot avoid afternoon journeys.",
    caution: "Lighting may deserve priority where poor evening visibility creates a clear safety problem, but it cannot solve excessive daytime heat.",
    example: "A council could examine when the path becomes difficult to use and consult both daytime walkers and evening commuters. If heat is the main problem, a phased tree-planting scheme could begin first while essential repairs to existing lights continue.",
    expected: "I use the riverside path regularly and expected its shaded section to remain available during the hottest hours whenever possible.",
    impact: "The proposed closure would force walkers onto the exposed part of the route in the early afternoon. Some older residents would have to abandon their usual walk rather than use that uncomfortable alternative.",
    remedy: "Could the work on the shaded section take place early in the morning, or could a short shaded alternative remain open? Advance notices explaining the revised arrangement would help residents plan safely.",
  },
  "refill-stations": {
    position: "Refill points should normally be included in the event's operating budget, with sponsorship reducing the cost where appropriate.",
    reason: "Drinking water is a basic part of making a crowded outdoor event usable, and convenient refill points can reduce unnecessary bottle purchases.",
    caution: "A small local event may struggle with installation costs, while sponsorship should not give a company control over essential access to water.",
    example: "An organiser could include a small share of the refill cost in the ticket price and accept clearly identified equipment sponsorship. Water would remain available to every attendee, without people having to buy a sponsor's product before using the facility.",
    expected: "I attended the event expecting to find the drinking-water refill point shown in the visitor information.",
    impact: "The map gave only a general location, and signs at the venue did not direct visitors to the tap. Several people, including me, spent unnecessary time searching in the heat.",
    remedy: "Please mark the exact position on the map and place clear directional signs at the main routes. Staff and volunteers should also be told where the refill point is before the event begins.",
  },
  "nesting-season": {
    position: "Short, well-explained closures are reasonable when they protect a vulnerable breeding area and leave useful alternatives open.",
    reason: "A small disturbance at the wrong time can undermine the wildlife that makes a park attractive in the first place.",
    caution: "Residents are more likely to object when an area is closed indefinitely or when managers do not explain why that particular boundary is necessary.",
    example: "A park could close one narrow path for the nesting period, publish the expected reopening date and signpost another loop of similar length. Visitors would still enjoy a walk while understanding the limited purpose of the restriction.",
    expected: "Our walking group planned to follow its usual route through the park during the coming month.",
    impact: "Part of that route will now be closed to protect nesting birds. We support the protection, but some members cannot comfortably manage the much longer alternative shown on the general park map.",
    remedy: "Could you recommend an accessible route of similar length that avoids the nesting area? A simple temporary map and information about the expected reopening date would help us organise our walks responsibly.",
  },
  "rain-gardens": {
    position: "Replacing a limited number of parking spaces with rain gardens can be justified where runoff creates a clear local problem.",
    reason: "Planted areas can absorb some rainwater close to where it falls and make a hard-surfaced street more pleasant.",
    caution: "Removing parking without considering deliveries, disabled access and maintenance responsibilities can transfer difficulties to other residents.",
    example: "A neighbourhood could test one rain garden at a corner where water repeatedly collects, while retaining a nearby accessible parking space. Residents could review how the area performs after wet weather before deciding whether more spaces should be converted.",
    expected: "I was pleased to see the proposal for a neighbourhood rain garden and hoped to take part in the volunteer work.",
    impact: "All the suggested sessions take place during normal working hours. Several interested residents would therefore be unable to help, even though they could contribute at the weekend.",
    remedy: "Please add an evening or weekend session and offer smaller tasks that residents can complete at different times. This would spread the work fairly and allow more neighbours to support the project.",
  },
  "station-lockers": {
    position: "Secure luggage storage should have priority where passengers need it to use the station comfortably, although a small amount of retail space remains useful.",
    reason: "Passengers carrying heavy bags may be unable to explore the area or wait comfortably, and another shop does not remove that obstacle.",
    caution: "Storage requires supervision and safe access, so an unsuitable corner should not be converted merely because it is currently empty.",
    example: "A station could provide lockers close to the main concourse while keeping the entrance and escape routes clear. Travellers changing trains could leave their bags for a few hours, and shops would still benefit from passengers who were freer to move around.",
    expected: "I reserved luggage storage for my journey and planned my return around the collection time shown on the station website.",
    impact: "The receipt gives an earlier collection deadline. If that deadline is correct, I cannot complete my planned visit and return to the station in time to collect my bag.",
    remedy: "Please confirm which time applies to my booking and correct whichever information is inaccurate. If the earlier time must be used, I would appreciate advice about another suitable storage arrangement.",
  },
  "late-buses": {
    position: "A modest regular late service is preferable where there is continuing local demand, with extra buses added for major events.",
    reason: "People who work late or attend ordinary evening classes need a dependable way home, not only transport on festival nights.",
    caution: "Running a large, nearly empty bus every night may be an inefficient use of funds that could support other essential routes.",
    example: "A town could publish a regular final departure using a smaller vehicle and add capacity after major concerts. Residents would know that a basic service existed, while the operator could match additional spending to predictable peaks in demand.",
    expected: "I enrolled in the evening class because its original finishing time allowed me to catch the last direct bus home.",
    impact: "The later timetable means that I would now miss that bus. The alternative involves a long walk and would make it difficult for me to continue attending regularly.",
    remedy: "Could the class finish slightly earlier, or could the centre offer an earlier group? Please also consider checking transport connections before confirming future changes to evening activities.",
  },
  "bicycle-checks": {
    position: "Employers should support safe cycling where it is a realistic option, rather than automatically directing all travel support towards car parking.",
    reason: "A basic maintenance session can remove a practical concern for an employee who wants to cycle but is unsure whether a bicycle is safe.",
    caution: "Some staff cannot cycle because of distance, disability or family responsibilities, so support should not assume that one travel method suits everyone.",
    example: "A workplace could offer periodic bicycle checks alongside help finding public-transport routes. A limited number of accessible parking spaces could remain available for staff who need them, creating a broader travel policy instead of replacing one rigid preference with another.",
    expected: "I booked a bicycle maintenance check through the workplace travel scheme and arranged to bring my bicycle on the confirmed day.",
    impact: "The appointment was cancelled, but no alternative time was offered. I am uncertain whether to keep using the bicycle for work before the safety check has taken place.",
    remedy: "Please let me know the next available appointment and whether an alternative provider can help sooner. A clear update would allow me to plan my journeys without repeatedly contacting the travel team.",
  },
  "ferry-notices": {
    position: "Operators should publish an early, clearly labelled estimate and update it, rather than remaining silent until every detail is certain.",
    reason: "Passengers may need to arrange childcare, change another connection or decide whether to travel at all while disruption is still developing.",
    caution: "An estimate presented as a promise can mislead people and damage trust when the situation changes.",
    example: "A ferry operator could announce that a delay is expected to last at least half an hour, state that the estimate is provisional and give a definite time for the next update. Passengers would gain useful information without being told that an uncertain departure was guaranteed.",
    expected: "I arrived for the ferry journey expecting the notices at the landing to direct passengers to one clearly identified boarding point.",
    impact: "Two notices gave different locations. Passengers moved between them, and some people were worried that they would miss the departure while waiting in the wrong place.",
    remedy: "Please remove outdated notices and place one clear instruction at each approach to the landing. When the boarding point changes, an announcement and a member of staff directing passengers would also help.",
  },
  "health-walks": {
    position: "Walking groups can turn general advice into a manageable routine, but they must offer suitable routes and remain only one part of health support.",
    reason: "A regular meeting gives participants company, encouragement and a clear opportunity to exercise instead of an intention they repeatedly postpone.",
    caution: "A single pace or route may exclude people with different fitness levels, and a group leader should not replace individual medical advice.",
    example: "A community organiser could offer a short level walk and a longer optional extension. New participants could begin with the easier route, while anyone with a health concern would be encouraged to seek appropriate advice before increasing activity.",
    expected: "I joined the walking group after reading that the advertised route was suitable for people seeking a gentle walk.",
    impact: "The actual route included a steep section and was substantially longer than described. Some participants struggled, and there was no clear point at which they could safely choose a shorter option.",
    remedy: "Please include distance, surface and gradient information in future descriptions. Offering a short alternative or identifying a suitable turning point would help participants choose an activity that matches their abilities.",
  },
  "quiet-hours": {
    position: "Shared housing needs a clear minimum quiet period, with additional arrangements negotiated for residents whose schedules differ.",
    reason: "A common rule gives everyone a reliable expectation and prevents each disagreement from starting without any agreed standard.",
    caution: "An identical rule cannot meet every need when one resident works overnight and another must study or care for a child during the day.",
    example: "Residents could agree on a nightly quiet period and ask that particularly noisy daytime work be announced in advance. A night-shift worker could then request a limited adjustment for urgent repairs without expecting the whole building to remain silent throughout every day.",
    expected: "I understood that residents would be told in advance about noisy repair work so that we could plan around it.",
    impact: "The proposed work falls during the hours when I sleep after a night shift. Several days of drilling at that time would make it difficult for me to rest before returning to work.",
    remedy: "Could the loudest tasks be scheduled later in the day, or could a quieter room be made available temporarily? Please let me know the likely timetable so that I can make realistic arrangements.",
  },
  "meal-breaks": {
    position: "A suitable shared eating area usually provides a more lasting improvement than a meal discount on its own.",
    reason: "Employees need somewhere clean and comfortable to pause, regardless of whether they bring food from home or buy it nearby.",
    caution: "A pleasant room will achieve little if workloads prevent staff from taking a break, while a food discount may still help people with limited budgets.",
    example: "An employer could protect a modest dining area and arrange shifts so that staff can use it. A smaller discount scheme could then support those who buy meals, rather than consuming the whole budget while employees continue eating hurriedly at their desks.",
    expected: "Staff understood that the shared eating area would remain available for meal breaks during the working day.",
    impact: "It is currently filled with stored materials, so people are eating at their desks or standing in a corridor. Neither option provides a clean, comfortable place to take a proper break.",
    remedy: "Please arrange another storage location and restore the eating area. If that cannot happen immediately, could you identify a suitable temporary space and tell staff when the normal facility will reopen?",
  },
  "first-aid-confidence": {
    position: "Regular refresher sessions should be required for designated first-aiders, while other learners should be encouraged to refresh their skills without an excessive burden.",
    reason: "A person with a formal safety responsibility needs to remember a practical response that may be required unexpectedly.",
    caution: "The same compulsory schedule for every former learner could discourage participation and consume time without considering how the training will be used.",
    example: "An organisation could arrange a short practical refresher for its designated first-aiders before a busy event. Other volunteers could be offered an introductory reminder and told clearly when to call for qualified help rather than attempting a task beyond their training.",
    expected: "Our volunteer group completed a basic first-aid course and would like to refresh the relevant skills before our next large public event.",
    impact: "Some members have not practised recently and are unsure which actions they can confidently carry out. We do not want uncertainty about responsibilities to create confusion during the event.",
    remedy: "Could you provide a short practical refresher and confirm the appropriate group size? Please also explain any equipment or prior preparation we should arrange before the session.",
  },
  "device-loans": {
    position: "Lending a limited range of digital devices can support a library's educational purpose, provided it does not undermine access to reading materials.",
    reason: "A person may need temporary access to a laptop to study, complete an application or use a digital publication without being able to buy one immediately.",
    caution: "Devices require maintenance, secure handling and staff support, so a lending scheme costs more than the initial purchase price.",
    example: "A library could begin with a small set of laptops for short loans, publish clear return rules and review actual demand. This would reveal whether the scheme met a local need before a large share of the book budget was committed to equipment.",
    expected: "I borrowed a laptop from the lending scheme expecting the collection instructions to list everything needed to use it.",
    impact: "The instructions did not explain that a separate charging adapter was required. I discovered the omission only after taking the laptop home, so I could not use it for the work I had planned.",
    remedy: "Please arrange for me to collect the correct adapter and update the instructions for future borrowers. A simple equipment checklist at collection would help prevent the same difficulty from recurring.",
  },
  "notification-settings": {
    position: "Users should actively choose most notifications, with only genuinely essential service messages treated differently.",
    reason: "Repeated, unwanted alerts can make people ignore the app altogether, including information that might actually be useful.",
    caution: "Some users may miss an important change if the choices are hidden or if the app gives no explanation of what each notification does.",
    example: "A booking app could explain appointment reminders, cancellation notices and promotional messages separately when a person first signs in. The user could then select useful reminders without also accepting frequent advertising or unrelated local updates.",
    expected: "I cancelled my sports-centre booking through the app and expected the related reminders to stop once the cancellation was confirmed.",
    impact: "The app continues to send repeated reminders for that booking. This is confusing and makes it harder to distinguish genuine messages about other activities I still plan to attend.",
    remedy: "Please check that the cancellation has been recorded and remove the outdated reminders. It would also help if the app displayed a clear cancellation status beside the original booking.",
  },
  "repair-records": {
    position: "Shared digital records can improve maintenance coordination, but a change should include reliable access, training and a way to correct errors.",
    reason: "Staff can check an item's repair history without searching for a paper folder held by someone working on another shift.",
    caution: "An incorrect entry can spread quickly across a shared system, while a technical failure may leave staff without information they previously kept on paper.",
    example: "A workshop could introduce the system with a simple item-identification check and keep an accessible backup of essential instructions. A technician would then be less likely to repeat a repair or rely on a record belonging to a different appliance.",
    expected: "When I collected my repaired appliance, I expected the online record to identify my item and describe the work carried out on it.",
    impact: "The record appears to refer to a different model. I therefore cannot confirm which parts were repaired or use the document as an accurate record if another problem develops.",
    remedy: "Please check the item details against your workshop records and issue a corrected document. I would appreciate confirmation that the inaccurate entry has also been removed from my customer account.",
  },
  "accessible-kiosks": {
    position: "A staffed alternative should remain available because an efficient self-service system must still serve people who cannot use it independently.",
    reason: "Visitors may face a physical access barrier, a visual difficulty or an unfamiliar procedure that a standard touchscreen does not resolve.",
    caution: "Maintaining two full services at all times can be costly, particularly at small venues with limited staff.",
    example: "A venue could use kiosks for routine enquiries while making it easy to request assistance from a nearby staff member. An accessible screen and clear instructions would reduce routine demand, leaving staff free to help people whose needs require a conversation.",
    expected: "The new information kiosk was intended to give visitors an independent way to obtain information about the venue.",
    impact: "Its screen is positioned too high for a wheelchair user to reach comfortably. This makes a supposedly convenient self-service option inaccessible to some of the visitors who would benefit from it.",
    remedy: "Please review the height and approach space of the kiosk with accessibility in mind. Until it is adjusted, a clear sign explaining how to obtain staff assistance would provide a useful alternative.",
  },
  "local-voices": {
    position: "An oral-history collection should include a broad range of voices, supported by deeper investigation of selected accounts.",
    reason: "A neighbourhood's history can look very different if only its most confident or easily contacted residents are recorded.",
    caution: "Collecting many short recordings without checking context or preserving them properly may create an impressive total but a weak historical resource.",
    example: "A museum could begin with brief interviews across different streets and age groups, then invite some contributors for longer conversations. This would widen participation while allowing individual stories to be understood in enough detail to be useful.",
    expected: "I agreed to contribute an interview to the neighbourhood history project and expected to record it in a reasonably quiet setting.",
    impact: "The proposed location is beside a busy activity room. Background conversation would make the recording difficult to hear and might cause important parts of the interview to be lost.",
    remedy: "Could we use a quiet room at another time or record at an alternative location? I am flexible about the appointment and would rather make a clear recording than rush the interview in unsuitable conditions.",
  },
  "festival-maps": {
    position: "Distributing some festival activities across neighbourhoods can share benefits, but a clear central meeting point remains valuable.",
    reason: "Smaller local venues can involve residents who would not travel to a crowded central site and can introduce visitors to different parts of town.",
    caution: "Widely scattered activities can confuse visitors, increase travel demands and make accessibility harder to coordinate.",
    example: "A festival could keep its information desk and major performance in one central location while organising a few clearly signposted neighbourhood workshops. A simple map and realistic travel times would help visitors choose a manageable route rather than trying to reach every event.",
    expected: "As a festival volunteer, I expected the visitor map to show a usable entrance to each advertised free activity.",
    impact: "The entrance to one activity was missing from the map. Visitors repeatedly asked for directions, and some assumed that the activity was not available to the public.",
    remedy: "Please add the entrance to the next map version and place a temporary sign on the main approach. Volunteers should also receive the corrected map so that they give visitors consistent directions.",
  },
  "community-costumes": {
    position: "Sharing costumes and equipment is a sensible way to support amateur performances when booking, care and return responsibilities are clear.",
    reason: "An item used briefly for one production can become available to several groups instead of sitting unused in separate cupboards.",
    caution: "Two groups may need the same costume at the same time, and unclear responsibility for cleaning or damage can lead to disputes.",
    example: "A shared collection could publish a booking calendar and record the condition of each item when it is borrowed. A group planning a long run would then know whether its preferred costumes were available before committing to a design.",
    expected: "Our amateur performance group borrowed costumes on the understanding that they would be available throughout the production.",
    impact: "The stated return date falls before our final performance. Returning the costumes then would leave us without the items needed for the last show, but we do not want to disrupt another group's plans.",
    remedy: "Could the loan be extended until the morning after our final performance? If the costumes are already reserved, please let us know whether suitable alternatives are available for the remaining show.",
  },
  "translation-signs": {
    position: "Simple wording and images should provide the essential information, with selected translations or audio adding depth where demand justifies them.",
    reason: "Visitors need to identify basic directions and rules quickly, even if their language is not one of those chosen for a full translation.",
    caution: "Images alone cannot explain every historical idea, and a badly simplified account may remove the very detail that makes a site interesting.",
    example: "A heritage site could display clear opening information and a simple route diagram, then offer a longer account in several languages through an audio point. Visitors would gain immediate practical guidance without being limited to a few unexplained symbols.",
    expected: "I expected the translated and original-language signs at the landmark to give visitors the same practical information.",
    impact: "They show different opening times. A visitor relying on the translated sign could arrive after entry has closed, despite having checked the information carefully.",
    remedy: "Please confirm the correct time and update both signs together. It would be helpful to check translated information whenever opening arrangements change, rather than treating the translations as separate documents.",
  },
  "job-shadowing": {
    position: "Job shadowing is a useful introduction, but it should lead to discussion or practical experience rather than being treated as a complete substitute for a placement.",
    reason: "Observation can reveal the pace, responsibilities and ordinary decisions of a job before a young person is ready to perform its tasks.",
    caution: "A visitor who watches without explanation may misunderstand why a routine matters or assume that one working day represents the whole profession.",
    example: "A workplace could let a visitor observe a morning's work, discuss the tasks with an employee and try a small, safe activity afterwards. That combination would connect observation with understanding without asking an inexperienced person to perform unsupervised work.",
    expected: "I arranged a job-shadowing visit and expected the confirmation to explain any clothing or equipment requirements.",
    impact: "The email confirms the date but does not say whether ordinary clothes are suitable or whether protective items are needed. I do not want to arrive unprepared and be unable to take part safely.",
    remedy: "Please tell me what I should wear and whether safety equipment will be provided. Information about where to report on arrival would also help me make the most of the visit.",
  },
  "handover-notes": {
    position: "A short paid discussion should accompany a concise written record when shifts share important responsibilities.",
    reason: "A direct conversation lets the incoming worker ask about an unusual event instead of guessing what a brief note means.",
    caution: "Verbal information can be forgotten or missed, especially if a person is absent, so discussion alone is not a reliable record.",
    example: "A shift team could use a common checklist for routine tasks and reserve a few minutes to discuss exceptions. The written record would remain available later, while the conversation would clarify what required immediate attention.",
    expected: "When I moved to the new shift, I expected the handover notes to identify who was responsible for each essential daily task.",
    impact: "One important responsibility is not assigned clearly. People on different shifts have made different assumptions, creating a risk that the task will be missed or unnecessarily repeated.",
    remedy: "Please confirm the responsible role and add it to the shared checklist. A brief handover discussion would also allow staff to ask questions before the revised arrangement becomes routine.",
  },
  "flexible-desks": {
    position: "Flexible daily booking better supports unpredictable working hours, although regular users should have a fairly priced longer-term option.",
    reason: "An independent worker may need a desk only when a particular project requires quiet space or a reliable connection.",
    caution: "A workspace that depends entirely on occasional bookings may struggle to cover fixed costs and cannot guarantee unlimited availability at short notice.",
    example: "A provider could offer daily desks alongside a small number of monthly memberships, with clear limits on reservations. Someone whose workload changes each week would avoid paying for unused days, while regular income would help keep the space open.",
    expected: "I booked a quiet desk in the shared workspace so that I could complete a task requiring sustained concentration.",
    impact: "A noisy event has now been scheduled beside that desk during the same period. The location would no longer provide the working conditions advertised when I made the booking.",
    remedy: "Could you move my reservation to another quiet area or offer a suitable alternative time? Please make event information visible during booking so that users can choose a desk with accurate expectations.",
  },
  "skill-exchanges": {
    position: "Service exchanges can help small businesses obtain useful expertise, but the value, scope and timing of each contribution need to be agreed first.",
    reason: "A business with limited cash may have a valuable skill that another organisation needs, making a direct exchange practical.",
    caution: "Problems arise if one side provides an open-ended service while the other offers a narrowly limited task that appears similar only in name.",
    example: "A designer and a language tutor could record the number of lessons and the design work to be supplied before either begins. They would also agree how to handle extra requests, so that a cooperative arrangement did not become an unspoken obligation.",
    expected: "Our organisation joined the skill-exchange scheme after agreeing on a specific service to receive in return for our contribution.",
    impact: "The service now being offered is different from the original agreement and would not meet the need we discussed. We are uncertain whether the change is temporary or represents a new arrangement.",
    remedy: "Please review the agreement with both organisations and confirm a fair way forward. A written description of the tasks and expected delivery dates would help prevent further misunderstandings.",
  },
  "welcome-packs": {
    position: "A concise, accurate information pack and a personal introduction work best together because they meet different needs.",
    reason: "A written pack gives new residents contact details and practical information they can return to when a question arises later.",
    caution: "A pack can become outdated or feel impersonal, while a friendly introduction may omit information that a newcomer is not yet confident enough to request.",
    example: "A neighbourhood association could provide a short pack of checked contacts and invite newcomers to an informal welcome meeting. Someone would then have both a reliable reference and a familiar person to ask about less obvious local arrangements.",
    expected: "After moving into the neighbourhood, I used the welcome pack as a reference for local contacts and services.",
    impact: "Several telephone numbers and opening details are no longer correct. I spent time trying to reach services through the listed contacts and was unsure which other information remained reliable.",
    remedy: "Please review the contact list and provide a corrected version to recent arrivals. Adding a review date and a contact for reporting changes would make the pack easier to maintain.",
  },
  "shared-storage": {
    position: "Every household should have a reasonable basic allocation, with additional space assigned through transparent consideration of need.",
    reason: "An equal amount for everyone is easy to understand and prevents a few residents from treating communal space as their private property.",
    caution: "Identical allocations can still be unfair when a household needs space for an essential mobility item while another wants to store rarely used possessions.",
    example: "A building committee could guarantee a modest storage allowance and consider requests for larger essential items separately. A published review process would be better than asking residents to compete informally for whichever corner became free.",
    expected: "I understood that the new communal storage room would be available for residents to use alongside their normal daily routines.",
    impact: "Its current access hours fall entirely within my working day. I cannot collect or return items when I need them, so the shared facility is effectively unavailable to me.",
    remedy: "Could you extend access for part of the evening or introduce a secure resident-access arrangement? Please consult residents about practical hours before treating the present schedule as permanent.",
  },
  "volunteer-tasks": {
    position: "A combination of regular roles and flexible tasks is more effective than requiring every volunteer to follow the same pattern.",
    reason: "Some responsibilities depend on continuity, and organisers need to know that a trained person will be available at an agreed time.",
    caution: "People with changing work or caring commitments may still contribute valuable skills even when they cannot promise a weekly attendance slot.",
    example: "A community project could appoint regular volunteers for opening and safety duties while offering one-day preparation tasks to occasional helpers. Organisers would retain reliable coverage without excluding people whose availability was less predictable.",
    expected: "I registered for the volunteer project expecting to be assigned a task suitable for the skills and experience I supplied.",
    impact: "The task allocated to me requires a qualification I do not hold. Attempting it would be inappropriate, but I would still like to contribute rather than withdraw from the project altogether.",
    remedy: "Please assign me a suitable alternative and check the qualification requirements against other volunteers' records. A short description of each role before assignment would make the process clearer for everyone.",
  },
  "noticeboards": {
    position: "Users should be responsible for the accuracy of their notices, with light coordination to maintain a useful shared space.",
    reason: "A person organising an activity is usually best placed to know when its time or contact details have changed.",
    caution: "Relying entirely on voluntary removal can leave expired notices in place, while employing a coordinator solely for a small board may be disproportionate.",
    example: "A community centre could require an expiry date on each notice and include a quick weekly check in an existing staff role. Users would remain responsible for updates, but the board would not depend on every advertiser remembering to return.",
    expected: "I supplied the current timetable for the activity I organise and expected the earlier version to be removed from the community board.",
    impact: "The old timetable is still displayed. Several people have arrived at the wrong time and have understandably questioned whether the activity is being organised reliably.",
    remedy: "Please replace the old notice with the attached current version and confirm when this has been done. A visible review or expiry date would help avoid similar confusion with other announcements.",
  },
  "weather-backups": {
    position: "An indoor backup is justified for events where cancellation would have substantial consequences, but not every small outdoor activity needs an expensive second venue.",
    reason: "Participants may have made travel arrangements or committed time that cannot easily be moved when weather changes.",
    caution: "Paying for two venues can make an otherwise affordable activity too expensive, particularly when a simple postponement would be acceptable.",
    example: "A large community workshop could reserve a modest indoor space with a clear decision deadline, while a small informal walk could publish a rescheduling policy instead. The response would reflect the consequences of cancellation rather than a rule that every event must duplicate its facilities.",
    expected: "I booked the outdoor activity expecting to receive clear information about what would happen if the weather made it unsafe.",
    impact: "The activity was cancelled, but no alternative date or refund details were provided. Our group cannot make new plans until we know whether the booking will be transferred or the payment returned.",
    remedy: "Please confirm the available options and the date by which we need to choose. Including a clear cancellation policy in future booking confirmations would help participants plan with confidence.",
  },
  "beginner-sessions": {
    position: "A brief beginners' introduction followed by supported access to the wider group offers a good balance.",
    reason: "Newcomers need a chance to learn essential techniques and ask basic questions without feeling that they are delaying experienced members.",
    caution: "Keeping beginners separate for too long can limit encouragement, create an unnecessary barrier and prevent the club from feeling like one community.",
    example: "A club could run a short introductory session before its regular meeting and then pair newcomers with willing experienced members. Participants would enter the main activity with useful preparation rather than being left to guess its rules.",
    expected: "I attended the session because it was advertised as suitable for people with no previous experience.",
    impact: "The activity began with instructions that assumed knowledge of basic techniques and terms. I could not take part confidently and felt reluctant to interrupt repeatedly while others continued.",
    remedy: "Please add a short introduction or identify a volunteer who can support new participants. The advertisement should also describe any skills that people are expected to have before attending.",
  },
  "equipment-bookings": {
    position: "Most equipment should be bookable in advance, with a small, clearly identified share available for same-day use.",
    reason: "Advance reservations allow groups to coordinate their time and avoid travelling to a facility without knowing whether essential equipment is available.",
    caution: "If every item is reserved far ahead, residents with uncertain schedules may never gain access, especially when unused bookings are not released.",
    example: "A sports centre could reserve most items through its normal booking system and hold a few for same-day requests. It could also release uncollected reservations after a published grace period, giving both planners and spontaneous visitors a fair opportunity.",
    expected: "I reserved the sports equipment for our group and received confirmation that the required items would be available during our session.",
    impact: "Another group was allowed to book the same equipment at the same time. This leaves both groups with a confirmed arrangement that the centre cannot fulfil as promised.",
    remedy: "Please contact both groups promptly and offer a practical alternative rather than leaving us to resolve the conflict ourselves. Checking the booking system for overlapping reservations would help prevent further problems.",
  },
  "hobby-libraries": {
    position: "Basic hobby-kit lending can be part of the free library service, while refundable deposits may protect costly or easily lost items.",
    reason: "The purpose of a trial kit is to let people explore an interest before making a purchase, including those who cannot risk paying for unsuitable equipment.",
    caution: "Kits require checking and replacement, so a scheme that ignores running costs may become unreliable or disappear after a short period.",
    example: "A library could offer a limited set of introductory kits with clear return checklists and seek a refundable deposit for expensive tools. A new hobbyist would still be able to try an activity without paying an ongoing rental charge.",
    expected: "I borrowed the hobby kit expecting it to contain the essential tools listed in the library's description.",
    impact: "One necessary tool is missing, which prevents me from completing the introductory project. I would prefer to resolve this through the lending service rather than buy an item that should already be included.",
    remedy: "Please let me know whether a replacement tool is available or whether I can exchange the kit. A contents check when kits are returned would help the next borrower avoid the same difficulty.",
  },
  "covered-seating": {
    position: "Publicly funded covered seating is justified because access to a place to rest should not always depend on making a purchase.",
    reason: "Older people, families and visitors with limited budgets may need a short rest during an ordinary journey through town.",
    caution: "Seating still requires cleaning and sensible placement, and a poorly maintained shelter may be unattractive or difficult to use.",
    example: "A council could place a modest covered bench near a transport stop while keeping pedestrian routes clear. A resident could rest without entering a café, and nearby businesses would not be expected to provide a free public facility from their own seating capacity.",
    expected: "Residents understood that the covered seating near the bus stop was being removed only temporarily and would return after the work.",
    impact: "No return date has been provided. People waiting for the bus now have nowhere sheltered to sit, which is particularly difficult for those who cannot stand comfortably for long periods.",
    remedy: "Please confirm when the seating will be restored and provide a temporary alternative if the delay will continue. A short notice at the stop would keep regular users informed.",
  },
  "school-crossings": {
    position: "Permanent road-design improvements should usually have priority, with supervision supporting children during the busiest periods.",
    reason: "A well-designed crossing or lower-speed approach continues to influence driver behaviour when a supervisor is not present.",
    caution: "Physical changes can take time, and some children need immediate guidance while a safer route is being planned or constructed.",
    example: "A council could introduce a clearly marked temporary crossing with supervised access while preparing a raised permanent crossing. This would address the current problem without treating short-term staffing as a substitute for a safer street design.",
    expected: "Families expected a safe way to cross the road to remain available while the roadworks near the school were carried out.",
    impact: "The usual pedestrian crossing has been removed without a clearly marked alternative. Children and accompanying adults are unsure where they should cross during the busy arrival period.",
    remedy: "Please provide and signpost a suitable temporary crossing route before the next school day. Coordination with the school would help ensure that families receive the same clear advice.",
  },
  "mixed-housing": {
    position: "Essential services should be available through permanent or credible temporary provision before large numbers of residents move in.",
    reason: "A neighbourhood is not fully usable if residents must make long journeys for basic food, childcare or health needs.",
    caution: "Requiring every possible facility before the first home is occupied may delay development or create shops without enough customers to survive.",
    example: "A developer could provide a temporary grocery service and clear transport links during the first phase, with permanent facilities tied to published occupancy milestones. Residents would gain a workable starting arrangement rather than a vague promise that services would eventually arrive.",
    expected: "When I moved into the development, I understood that the promised temporary grocery service would operate while permanent shops were being prepared.",
    impact: "That service has not started. Residents without easy access to a car now face an inconvenient journey for basic supplies, and no clear explanation or starting date has been provided.",
    remedy: "Please confirm when the service will begin and arrange an interim option if there will be a further delay. Regular updates would help residents make realistic plans instead of relying on an uncertain promise.",
  },
  "street-markets": {
    position: "Markets can benefit both traders and residents when access, delivery times and cleaning responsibilities are agreed in advance.",
    reason: "A regular market can support small businesses and make a familiar street more lively without requiring permanent retail premises.",
    caution: "Noise, blocked entrances and unmanaged waste can make the benefits feel distant to people whose homes are directly affected.",
    example: "A market manager could limit delivery vehicles to a clear time window and keep a marked access route to residential entrances. A named contact and a reliable cleanup schedule would allow residents to raise specific problems without having to oppose the market as a whole.",
    expected: "Residents expected market deliveries to be organised so that building entrances remained accessible in the early morning.",
    impact: "The revised delivery arrangement now leaves vehicles blocking our entrance. People are delayed when leaving for work, and access is especially difficult for anyone carrying equipment or using a mobility aid.",
    remedy: "Please revise the unloading point or delivery sequence so that the entrance remains clear. A brief discussion with affected residents would help identify a practical arrangement before the next market day.",
  },
  "repair-guarantees": {
    position: "A clear guarantee makes repair more attractive, but price, expected reliability and convenient service are equally important.",
    reason: "Customers need to understand which work is covered before deciding whether a repair offers a reasonable alternative to buying a replacement.",
    caution: "A long guarantee with narrow exclusions may provide less practical reassurance than a shorter, clearly explained commitment backed by reliable service.",
    example: "A repair shop could explain the parts replaced, the work covered and the process for returning a faulty item on one simple document. A customer could then compare a known repair cost with a replacement instead of trying to interpret an unclear promise.",
    expected: "After paying for the repair, I expected the guarantee to identify which parts and work were covered.",
    impact: "The document refers only to a general guarantee and does not specify its scope. I therefore cannot tell what assistance would be available if the same fault returned.",
    remedy: "Please provide a clear statement of the covered parts, the time period and the procedure for requesting help. This would allow me to keep an accurate record without having to make assumptions about the terms.",
  },
  "shared-deliveries": {
    position: "A modest basic facility can be included in the building fee, with exceptional or high-volume use charged separately.",
    reason: "A shared collection point can reduce missed deliveries and repeated visits that affect the building as a whole.",
    caution: "Residents who receive few parcels may reasonably object to subsidising unlimited storage or additional handling for frequent commercial use.",
    example: "A building could include access to a small secure collection area in its normal fee but set limits on storage time and unusually large items. Residents would share a useful basic service without accepting open-ended costs for every type of delivery.",
    expected: "Residents expected to be told how to collect parcels already delivered before the new access procedure came into effect.",
    impact: "The procedure has changed without instructions for items waiting in the collection area. I cannot retrieve my parcel and do not know whether my earlier collection code remains valid.",
    remedy: "Please explain the current collection steps and provide a way to recover items delivered under the previous system. Future procedure changes should include clear notice before existing access arrangements are withdrawn.",
  },
  "product-instructions": {
    position: "Online videos are a useful addition, but removing all printed guidance creates avoidable difficulties for some users.",
    reason: "A video can demonstrate a movement or sequence that is difficult to explain in writing and can be replayed when needed.",
    caution: "Users may lack a suitable connection, need to search for one detail quickly or receive a link that no longer matches their product model.",
    example: "A manufacturer could include a short printed setup and safety guide, with an exact model-specific link to longer videos. People would have the essential information immediately and could choose a demonstration when it genuinely helped them understand the task.",
    expected: "I expected the instructions linked to my new household product to describe the model I had purchased.",
    impact: "The online video shows a different model with controls in different positions. Following it could lead to a mistake, so I have not attempted the unfamiliar setup steps.",
    remedy: "Please send the correct guide or a direct link for this model and check the link supplied with the product. A short printed version of the essential setup instructions would also be helpful.",
  },
  "reusable-packaging": {
    position: "A refundable-deposit system is more practical for occasional shoppers, while people with a regular routine may prefer their own containers.",
    reason: "Borrowed containers remain available when a person has not planned a visit, reducing dependence on remembering to carry equipment every time.",
    caution: "A deposit scheme becomes inconvenient if returns are accepted at too few places or if the rules change without notice.",
    example: "Several branches of a shop could accept the same deposit containers and clearly explain how refunds are obtained. A customer making an unplanned purchase would have a reusable option, while regular customers could continue bringing suitable containers of their own.",
    expected: "I paid a deposit for returnable containers expecting to return them through the local branch that supplied them.",
    impact: "The branch has stopped accepting returns without explaining another option. I am left holding containers and cannot recover the deposit through the arrangement advertised when I bought the food.",
    remedy: "Please confirm an accessible return point or arrange a refund through the original branch. Customers should receive clear instructions before an established part of the return scheme is withdrawn.",
  },
};

function coordinates(band: number, variant: number, maximum: number): { bandIndex: number; variant: number } {
  const bandIndex = Math.round((band - 3) * 2);
  if (!Number.isFinite(band) || bandIndex < 0 || bandIndex > 10 || Math.abs(3 + bandIndex / 2 - band) > 1e-8 ||
      !Number.isInteger(variant) || variant < 0 || variant >= maximum)
    throw new Error("Invalid reserved Duo paper coordinates.");
  return { bandIndex, variant };
}
function pickScenario(bandIndex: number, variant: number): Scenario {
  return scenarios[((bandIndex * 4 + variant) * 13) % scenarios.length];
}
const cefr = (band: number): Cefr => band < 4 ? "A2" : band < 5.5 ? "B1" : band < 7 ? "B2" : "C1";
function base(id: string, band: number, scenario: Scenario, skill: StoredContent["skill"], format: StoredContent["format"]): StoredContent {
  return {
    id, skill, format, title: scenario.title, topic: scenario.topic,
    description: "Đề đánh giá riêng của hành trình Duo; mức độ là ước lượng biên soạn, chưa được hiệu chuẩn từ dữ liệu thi.",
    band, cefr: cefr(band), testType: "both", durationMinutes: 15,
    sections: [], questions: [], vocabularyIds: [], tags: ["duo-exclusive", "reserved-assessment"],
    source: "authored", quality: "authored-unreviewed", createdAt: "2026-11-05T00:00:00.000Z",
    estimatedDifficulty: { band, cefr: cefr(band), basis: "Mức mục tiêu ước lượng theo nội dung; không phải kết quả hiệu chuẩn." },
    provenance: { method: "authored", version: "duo-exclusive-20261105-v1", sourceDocument: `reserved-support/${scenario.key}` },
  };
}

function academicTaskOneReference(content: StoredContent, scenario: Scenario): ReferenceResponse {
  const section = content.sections[0];
  const table = section.visuals?.[0];
  if (!table || !("rows" in table) || table.rows.length !== 3) throw new Error("Reserved Writing table is missing.");
  const [first, second, third] = table.rows;
  const sample = [
    `The table presents weekly figures, measured in numbers of people, for ${first.label.toLowerCase()}, ${second.label.toLowerCase()} and ${third.label.toLowerCase()}. The information comes from a town's study of ${scenario.activity} and covers three separate years: 2014, 2019 and 2024.`,
    `Overall, the first category increased throughout the period, whereas the second followed a downward trend. The third category rose initially and then fell, although its final figure remained above its starting point. The largest overall change was the decline in the second category.`,
    `Looking first at ${first.label.toLowerCase()}, the weekly figure was ${first.values[0]} in 2014. It increased to ${first.values[1]} in 2019 and reached ${first.values[2]} by 2024. This represents an overall rise of ${first.values[2] - first.values[0]} people per week, with growth in both intervals rather than an increase confined to one part of the period.`,
    `By contrast, ${second.label.toLowerCase()} fell from ${second.values[0]} to ${second.values[1]} and then to ${second.values[2]}. Its total reduction of ${second.values[0] - second.values[2]} was larger than the increase in the first category. Finally, ${third.label.toLowerCase()} climbed from ${third.values[0]} in 2014 to a peak of ${third.values[1]} in 2019, before declining to ${third.values[2]} in 2024. Despite that later fall, the figure ended ${third.values[2] - third.values[0]} above its initial level.`,
  ].join("\n\n");
  return {
    sectionId: section.id, title: "Bài mẫu minh họa Task 1 · Báo cáo bảng", sampleAnswer: sample,
    explanation: "Bài mẫu chỉ mô tả số liệu trong bảng của đề này: mở bài diễn đạt lại yêu cầu, overview nêu hai xu hướng tăng/giảm và một xu hướng tăng rồi giảm, sau đó so sánh bằng số liệu cụ thể. Không suy diễn nguyên nhân từ bảng. Đây là đáp án tham khảo, không phải bài đã được giám khảo chấm band.",
    keyPoints: [
      `Đơn vị là số người mỗi tuần, các mốc là ${table.series.join(", ")}.`,
      `${first.label}: ${first.values.join(" → ")}; tăng tổng cộng ${first.values[2] - first.values[0]}.`,
      `${second.label}: ${second.values.join(" → ")}; giảm tổng cộng ${second.values[0] - second.values[2]}.`,
      `${third.label}: ${third.values.join(" → ")}; đỉnh ở năm 2019, cuối kỳ vẫn cao hơn đầu kỳ.`,
    ],
  };
}

function generalTaskOneReference(content: StoredContent, scenario: Scenario, plan: WritingPlan): ReferenceResponse {
  return {
    sectionId: content.sections[0].id, title: "Bài mẫu minh họa Task 1 · Thư trang trọng",
    sampleAnswer: [
      "Dear Sir or Madam,",
      `I am writing about the arrangements described in your information concerning ${scenario.activity}. I would like to explain a difficulty and ask whether a practical solution can be agreed.`,
      `${plan.expected} I used that information when making my plans, so it was important that the actual arrangement matched what had been explained. I appreciate that circumstances sometimes change, but a clear update would have allowed me to respond before the difficulty arose.`,
      `${plan.impact} My concern is the practical effect of the situation rather than a wish to create unnecessary work for your staff. I would welcome an explanation of the current position so that I can decide what to do next.`,
      `${plan.remedy} Please let me know which option is possible and whether you need any further details from me. I am willing to cooperate with a reasonable arrangement, provided I receive enough information to plan reliably.`,
      "Thank you for considering my request. I look forward to your response and hope we can resolve the matter without further inconvenience.",
      "Yours faithfully,\nAlex Morgan",
    ].join("\n\n"),
    explanation: "Thư dùng giọng trang trọng, nêu rõ mục đích, trình bày điều đã mong đợi, ảnh hưởng thực tế và đề nghị cụ thể đúng ba gạch đầu dòng. Lời chào Dear Sir or Madam đi với Yours faithfully. Tên người viết trong bài chỉ là tên minh họa; người học có thể dùng cách diễn đạt khác nếu đáp ứng đầy đủ tình huống.",
    keyPoints: ["Mở thư bằng mục đích liên hệ, không chép nguyên câu lệnh của đề.", "Tách điều đã mong đợi và khó khăn hiện tại thành các đoạn rõ ràng.", "Đề xuất cách xử lý có thể thực hiện và giữ giọng lịch sự, hợp tác."],
  };
}

function taskTwoReference(content: StoredContent, scenario: Scenario, plan: WritingPlan): ReferenceResponse {
  const general = content.testType === "general";
  const paragraphs = general ? [
    `Decisions about ${scenario.activity} can affect people's everyday routines as well as the responsibilities of the organisations providing them. Residents and professional staff bring different kinds of knowledge to these decisions. In my view, professionals should take responsibility for technical standards, but residents should have a meaningful opportunity to influence priorities and explain practical needs.`,
    `On the one hand, residents understand how an arrangement works in ordinary life. A technically tidy plan may still be inconvenient for the people expected to use it. For this topic, one important consideration is that ${plan.reason[0].toLowerCase()}${plan.reason.slice(1)} Local users can explain which obstacles matter to them, which alternatives they could actually use and which changes would make the greatest difference. Their involvement can therefore reveal issues that a planning document alone does not show.`,
    `On the other hand, professional experience is needed to assess costs, safety and the consequences of competing requests. ${plan.caution} Specialists should explain these limits clearly rather than accepting every suggestion or dismissing local concerns without an answer. Consultation is not a demand that every resident should control every technical detail; it is a way to make informed decisions more closely connected to the people they affect.`,
    `A reasonable process would first gather residents' experiences, then ask the responsible staff to explain the feasible options. In the case of ${scenario.activity}, a small trial and a published review date could show whether the chosen approach removed the intended difficulty. Residents could comment on its everyday effects, while staff checked that it remained safe, affordable and manageable. Neither side's knowledge would need to replace the other's.`,
    "In conclusion, leaving the whole decision to either residents or specialists would waste useful information. I support a shared process in which residents influence the needs and priorities, while qualified staff remain accountable for implementing a workable final arrangement.",
  ] : [
    `A decision about ${scenario.activity} affects both the people using an arrangement and those responsible for providing it. It should therefore be judged by its practical consequences rather than by an attractive description alone. ${plan.position}`,
    `The strongest reason for this view is practical rather than symbolic. ${plan.reason} The relevant policy should therefore be judged by the obstacle it removes, not simply by whether it appears modern or generous. An arrangement that looks attractive on paper can still fail if the people expected to use it cannot do so. Its value becomes clearer when it improves an ordinary situation that would otherwise remain difficult.`,
    `However, a workable approach must also recognise its limits. ${plan.caution} Costs, access and responsibility need to be made explicit before a policy is introduced. The answer is not to ignore these difficulties, but to set clear boundaries and review whether the arrangement continues to meet the need it was designed to address. This is more useful than assuming that one rule must suit every setting.`,
    `For example, ${plan.example[0].toLowerCase()}${plan.example.slice(1)} The practical advantage is that the decision can be tested in a limited setting before wider commitments are made. The important point is to connect a clear need with a realistic arrangement and a way to notice problems early.`,
    `For these reasons, the most convincing approach combines a clear priority with proportionate safeguards. ${plan.position} What matters is a reliable improvement in everyday experience, supported by decisions that can be explained to the people affected and adjusted when there is a good reason.`,
  ];
  return {
    sectionId: content.sections[1].id, title: "Bài mẫu minh họa Task 2 · Bài luận", sampleAnswer: paragraphs.join("\n\n"),
    explanation: general
      ? "Bài mẫu thảo luận đủ hai phía theo yêu cầu: cư dân biết nhu cầu sử dụng thực tế, còn người có chuyên môn đánh giá tiêu chuẩn, chi phí và tính khả thi. Lập trường là phối hợp hai nguồn thông tin; mỗi đoạn giải thích vai trò thay vì chỉ liệt kê ưu điểm. Đây là một hướng lập luận minh họa, không phải đáp án duy nhất hoặc band đã được chấm."
      : "Bài mẫu nêu lập trường ngay ở mở bài, phát triển một lý do sát tình huống, xem xét hạn chế và dùng ví dụ giả định để làm rõ cách áp dụng. Ví dụ không được trình bày như số liệu nghiên cứu thật. Người học có thể chọn quan điểm khác nếu trả lời đúng câu hỏi và giải thích nhất quán; bài này không được gắn band chính thức.",
    keyPoints: [
      `Bám đúng chủ đề của đề: ${scenario.title}.`,
      general ? "Trình bày cả ý kiến để cư dân tham gia và ý kiến giao cho người có chuyên môn, rồi nêu lựa chọn của mình." : `Lập trường minh họa: ${plan.position}`,
      "Mỗi đoạn có ý chính, giải thích và liên hệ cụ thể; kết bài trả lời lại vấn đề đã nêu.",
      "Không cần bịa nghiên cứu hoặc phần trăm để làm ví dụ có vẻ thuyết phục.",
    ],
  };
}

/** Academic and General versions have distinct IDs and Task 1 requirements. */
export function makeExclusiveWriting(band: number, variant: number, testType: "academic" | "general" = "academic"): StoredContent {
  const { bandIndex } = coordinates(band, variant, 4);
  const scenario = pickScenario(bandIndex, variant);
  const id = `duo-private-writing-full-mock-${Math.round(band * 10)}-${variant}-${testType}`;
  const result = base(id, band, scenario, "writing", "full-mock");
  result.title = `${testType === "academic" ? "Academic" : "General Training"} Writing · ${scenario.title}`;
  result.testType = testType;
  result.durationMinutes = 60;
  const firstId = `${id}-task-1`;
  const instructions1 = "You should spend about 20 minutes on this task. Write at least 150 words.";
  const instructions2 = "You should spend about 40 minutes on this task. Write at least 250 words. Give reasons for your answer and include any relevant examples from your own knowledge or experience.";
  if (testType === "academic") {
    const offset = bandIndex * 4 + variant;
    const rows = scenario.rows.map((label, row) => ({ label,
      values: row === 0 ? [31 + offset, 38 + offset, 49 + offset] : row === 1 ? [91 - offset, 82 - offset, 70 - offset] : [24 + offset, 39 + offset, 34 + offset],
    }));
    const visualId = `${id}-table`;
    result.sections.push({ id: firstId, title: "Task 1 · Table report", task: 1,
      text: `The table below compares weekly figures for three categories in a town's study of ${scenario.activity} in 2014, 2019 and 2024. Figures represent numbers of people. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.`,
      instructions: instructions1,
      visuals: [{ id: visualId, type: "table", title: `Weekly figures: ${scenario.title}`, unit: "people per week", series: ["2014", "2019", "2024"], rows }],
    });
  } else {
    result.sections.push({ id: firstId, title: "Task 1 · Letter", task: 1,
      text: `${scenario.letter}\n\nIn your letter:\n• explain the arrangement you expected\n• describe the practical difficulty it has caused\n• suggest a reasonable way to resolve the situation.`,
      instructions: `${instructions1} You do not need to write any addresses. Begin your letter with: Dear Sir or Madam,`,
      cuePoints: ["explain the arrangement you expected", "describe the practical difficulty it has caused", "suggest a reasonable way to resolve the situation"],
    });
  }
  result.sections.push({ id: `${id}-task-2`, title: "Task 2 · Essay", task: 2,
    text: testType === "academic" ? scenario.essay : `Some people think that residents should help decide how to organise ${scenario.activity}. Others believe these decisions should be left to people with professional experience. Discuss both views and give your own opinion.`,
    instructions: instructions2,
  });
  const plan = writingPlans[scenario.key];
  if (!plan) throw new Error("Reserved Writing reference plan is missing.");
  result.referenceAnswers = [
    testType === "academic" ? academicTaskOneReference(result, scenario) : generalTaskOneReference(result, scenario, plan),
    taskTwoReference(result, scenario, plan),
  ];
  return result;
}

export function makeExclusiveSpeaking(band: number, variant: number): StoredContent {
  const { bandIndex } = coordinates(band, variant, 4);
  const scenario = pickScenario(bandIndex, variant);
  const id = `duo-private-speaking-full-mock-${Math.round(band * 10)}-${variant}`;
  const result = base(id, band, scenario, "speaking", "full-mock");
  result.title = `Speaking · ${scenario.title}`;
  result.durationMinutes = 14;
  const part1 = [
    `How often do you ${scenario.habit}?`,
    `What first interested you in ${scenario.personal}?`,
    `Do you prefer ${scenario.preferences[0]} or ${scenario.preferences[1]}? Why?`,
    `Has your use of ${scenario.personal} changed since you were younger?`,
    `Who do you usually talk to about ${scenario.personal}?`,
    `Would you like to spend more time learning about ${scenario.personal}?`,
  ];
  const part3 = [
    `Why might different groups of people have different expectations about ${scenario.activity}?`,
    `What would help a local organisation make good decisions about ${scenario.activity}?`,
    `How could schools help young people understand the issues involved in ${scenario.activity}?`,
    `What evidence would show whether spending money on ${scenario.activity} was worthwhile?`,
    `When planning ${scenario.activity}, how should organisers balance convenience and fairness?`,
    `Do you think public interest in ${scenario.activity} is likely to change in the future? Why?`,
  ];
  result.sections = [
    { id: `${id}-part-1`, title: "Part 1 · Introduction and interview", text: part1.map((question, index) => `${index + 1}. ${question}`).join("\n\n"),
      instructions: "Answer the examiner's questions naturally. Part 1 lasts about 4–5 minutes; extend each answer with a reason or a brief example where appropriate." },
    { id: `${id}-part-2`, title: "Part 2 · Long turn", text: scenario.cue,
      cuePoints: ["when and where it happened", "who was involved", scenario.detail, "and explain what you learned from the experience"],
      instructions: "You have one minute to prepare. You may make notes. Then speak for one to two minutes. Do not read a prepared script." },
    { id: `${id}-part-3`, title: "Part 3 · Discussion", text: part3.map((question, index) => `${index + 1}. ${question}`).join("\n\n"),
      instructions: "Discuss the examiner's questions in more depth. Give reasons, compare alternatives and use examples where useful. This part lasts about 4–5 minutes." },
  ];
  return result;
}

type GrammarItem = [stem: string, answer: string, distractor1: string, distractor2: string, distractor3: string, reason: string];
const grammarPacks: GrammarItem[][] = [
  [
    ["Every Monday, the coordinator ___ the attendance list.", "checks", "check", "checking", "checked", "Chủ ngữ ngôi ba số ít đi với động từ thêm -s ở hiện tại đơn."],
    ["Last Tuesday, three new volunteers ___ before the doors opened.", "arrived", "arrive", "arriving", "arrives", "Mốc thời gian đã kết thúc cần thì quá khứ đơn."],
    ["The group needs ___ additional hour to finish the task.", "an", "a", "some", "many", "Hour bắt đầu bằng âm nguyên âm và là danh từ đếm được số ít."],
    ["Two ___ were reserved for the introductory activity.", "rooms", "room", "room's", "rooms'", "Sau two cần danh từ số nhiều, không dùng sở hữu cách."],
    ["The short briefing starts ___ 8:45 each morning.", "at", "in", "on", "to", "At dùng trước một giờ bắt đầu cụ thể."],
    ["This route is shorter ___ the route used last month.", "than", "as", "that", "from", "Tính từ so sánh hơn dùng than để nối đối tượng so sánh."],
    ["The guides brought ___ own maps to the meeting.", "their", "theirs", "them", "they", "Trước own maps cần tính từ sở hữu their."],
    ["Where ___ the visitors wait yesterday?", "did", "do", "does", "are", "Câu hỏi về yesterday dùng did và động từ nguyên mẫu wait."],
    ["A trained volunteer can ___ a newcomer through the first task.", "help", "helps", "helped", "helping", "Sau động từ khuyết thiếu can dùng động từ nguyên mẫu không to."],
    ["At present, there ___ only one entrance in use.", "is", "are", "be", "being", "One entrance là danh từ số ít nên dùng there is."],
  ],
  [
    ["The team ___ this timetable since January.", "has used", "uses", "use", "is used", "Since chỉ điểm bắt đầu của khoảng kéo dài đến hiện tại, nên dùng hiện tại hoàn thành."],
    ["Right now, the visitors ___ for the afternoon session.", "are waiting", "waits", "waited", "was waiting", "Right now chỉ hành động đang diễn ra; chủ ngữ số nhiều đi với are waiting."],
    ["The office ___ at six yesterday evening.", "closed", "closes", "closing", "has close", "Yesterday evening yêu cầu quá khứ đơn, closed."],
    ["While the guide was speaking, a technician ___ the microphone.", "was adjusting", "adjust", "has adjust", "were adjusting", "Một hành động đang diễn ra trong quá khứ cần was adjusting với chủ ngữ số ít."],
    ["By the time the guests arrived, the organisers ___ all the chairs.", "had arranged", "arranges", "have arranging", "were arrange", "Việc xếp ghế hoàn tất trước một mốc quá khứ khác cần quá khứ hoàn thành."],
    ["Look at those clouds. It ___ rain soon.", "is going to", "has", "was", "does", "Dự đoán dựa trên dấu hiệu hiện tại dùng be going to."],
    ["The supervisor usually ___ the equipment before anyone uses it.", "tests", "test", "testing", "have tested", "Thói quen với chủ ngữ số ít dùng hiện tại đơn tests."],
    ["We ___ the booking before we sent the confirmation yesterday.", "checked", "checking", "checks", "have check", "Chuỗi sự việc ở quá khứ dùng động từ quá khứ checked."],
    ["The doorbell rang while I ___ the instructions.", "was reading", "readed", "am read", "have reading", "Hành động nền đang tiếp diễn lúc chuông reo dùng was reading."],
    ["They have already ___ the revised map.", "sent", "send", "sending", "sends", "Sau have already cần quá khứ phân từ sent."],
  ],
  [
    ["There is not ___ space for another large table.", "enough", "many", "few", "several", "Enough bổ nghĩa space; many, few, several cần danh từ đếm được số nhiều."],
    ["Only ___ participants asked for a printed copy: two out of forty.", "a few", "a little", "much", "any", "Participants là danh từ đếm được số nhiều; a few diễn tả số ít người."],
    ["The instructions contain very ___ technical information.", "little", "few", "many", "several", "Information không đếm được nên dùng little."],
    ["Each of the three volunteers ___ a separate task.", "has", "have", "having", "are", "Chủ ngữ each là số ít, dù phía sau có of the volunteers."],
    ["The planner provided ___ useful advice about the route.", "some", "a", "an", "many", "Advice không đếm được; some advice là cụm đúng."],
    ["There are fewer chairs ___ people in the waiting area.", "than", "as", "that", "from", "Fewer là dạng so sánh, nên theo sau bằng than."],
    ["Neither of the two entrances ___ open at the moment.", "is", "are being", "have", "were", "Neither of the two được dùng với động từ số ít ở hiện tại trong câu này."],
    ["A pair of spare gloves ___ kept in the cupboard.", "is", "are", "have", "being", "Danh từ trung tâm là a pair số ít nên dùng is."],
    ["How ___ time should we allow for the introduction?", "much", "many", "few", "several", "Time chỉ thời lượng là không đếm được, hỏi how much time."],
    ["Everyone ___ asked to sign the attendance sheet today.", "is", "are", "have", "being", "Everyone có nghĩa nhiều người nhưng đi với động từ số ít."],
  ],
  [
    ["The volunteer ___ designed the poster will explain it.", "who", "which", "where", "when", "Đại từ quan hệ chỉ người làm chủ ngữ là who."],
    ["This is the cupboard ___ the spare materials are stored.", "where", "who", "whose", "when", "Where thay cho cụm chỉ nơi chốn trong mệnh đề quan hệ."],
    ["The participant ___ bag was left behind has returned.", "whose", "who", "which", "where", "Whose biểu thị quan hệ sở hữu với bag."],
    ["The checklist ___ we received yesterday has been updated.", "that", "where", "whose", "when", "That làm tân ngữ thay cho checklist; các lựa chọn còn lại không đúng chức năng."],
    ["The assistant to ___ I spoke was very helpful.", "whom", "who", "whose", "which", "Sau giới từ to dùng whom khi nói về người trong văn viết trang trọng."],
    ["The room, ___ was recently repainted, is now ready.", "which", "that", "what", "where", "Mệnh đề quan hệ không xác định sau dấu phẩy dùng which cho vật."],
    ["We need someone ___ can explain the route clearly.", "who", "whom", "where", "whose", "Someone chỉ người và đại từ quan hệ làm chủ ngữ, nên chọn who."],
    ["The year ___ the project began is printed on the display.", "when", "where", "which", "whose", "When nối mệnh đề quan hệ chỉ thời gian; began ở đây không có tân ngữ là year."],
    ["The equipment ___ by the group is checked regularly.", "used", "using", "uses", "use", "Mệnh đề rút gọn bị động the equipment used by the group dùng quá khứ phân từ."],
    ["The people ___ outside are waiting for the first session.", "standing", "stood", "stands", "stand", "Mệnh đề rút gọn chủ động dùng standing để bổ nghĩa people."],
  ],
  [
    ["You must ___ your visitor pass at the entrance.", "show", "shows", "showed", "showing", "Sau must dùng động từ nguyên mẫu không to."],
    ["We decided ___ the meeting to a quieter room.", "to move", "moving", "move", "moved", "Decide đi với to-infinitive."],
    ["The group enjoyed ___ ideas after the presentation.", "sharing", "to share", "share", "shared", "Enjoy đi với động từ dạng -ing."],
    ["Please avoid ___ the entrance while you wait.", "blocking", "to block", "block", "blocked", "Avoid đi với dạng -ing."],
    ["The organiser let us ___ a different starting time.", "choose", "to choose", "choosing", "chosen", "Let + tân ngữ + động từ nguyên mẫu không to."],
    ["The guide reminded us ___ the equipment after use.", "to return", "returning", "return", "returned", "Remind someone to do something là cấu trúc đúng."],
    ["This cupboard is for ___ small items safely.", "storing", "to store", "store", "stored", "Sau giới từ for dùng danh động từ storing."],
    ["You should ___ the updated notice before leaving.", "read", "reads", "reading", "to read", "Sau should dùng động từ nguyên mẫu không to."],
    ["The coordinator suggested ___ the final task in pairs.", "doing", "to do", "do", "done", "Suggest có thể đi với danh động từ doing."],
    ["They hope ___ the new service next month.", "to introduce", "introducing", "introduce", "introduced", "Hope đi với to-infinitive."],
  ],
  [
    ["The booking form ___ by the administrator every morning.", "is checked", "checks", "is checking", "has check", "Booking form nhận hành động kiểm tra nên cần bị động hiện tại đơn."],
    ["The damaged sign ___ last Friday.", "was replaced", "replaces", "is replacing", "has replace", "Last Friday cần quá khứ; sign nhận hành động nên dùng was replaced."],
    ["The visitors ___ to arrive ten minutes early.", "were asked", "was asked", "asking", "have ask", "Visitors số nhiều nhận yêu cầu trong quá khứ nên dùng were asked."],
    ["A new map is ___ printed for tomorrow's session.", "being", "been", "be", "to", "Bị động tiếp diễn có cấu trúc is being printed."],
    ["The spare chairs have already been ___ to the other room.", "moved", "move", "moving", "moves", "Bị động hoàn thành dùng have been + quá khứ phân từ."],
    ["The final arrangements will ___ confirmed by email.", "be", "been", "being", "are", "Bị động tương lai dùng will be + quá khứ phân từ."],
    ["The instructions ___ clearly on the noticeboard at present.", "are displayed", "is displayed", "displaying", "have display", "Instructions số nhiều nhận hành động trưng bày, nên chọn are displayed."],
    ["This equipment must be ___ after each session.", "cleaned", "clean", "cleaning", "cleans", "Sau must be trong cấu trúc bị động cần quá khứ phân từ."],
    ["The updated list was prepared ___ the morning supervisor.", "by", "from", "with", "at", "By giới thiệu tác nhân của hành động bị động."],
    ["Only registered visitors are ___ to enter this room.", "allowed", "allowing", "allow", "allows", "Are allowed to là cấu trúc bị động diễn tả được phép."],
  ],
  [
    ["If the weather improves tomorrow, we ___ the activity outside.", "will hold", "would held", "held", "holding", "Điều kiện có thể xảy ra ở tương lai dùng if + hiện tại đơn, will + nguyên mẫu."],
    ["If we had a larger room, we ___ more participants.", "could invite", "can invited", "will inviting", "invite", "Điều kiện giả định hiện tại dùng if + quá khứ, could + nguyên mẫu."],
    ["The guide will wait until everyone ___ ready.", "is", "will be", "were", "be", "Mệnh đề thời gian sau until dùng hiện tại đơn để chỉ tương lai."],
    ["We stayed indoors ___ the heavy rain.", "because of", "because", "although", "despite of", "Because of đi với cụm danh từ the heavy rain."],
    ["The route was short, ___ it took longer than expected.", "but", "because", "so that", "unless", "But nối hai ý tương phản trong hai mệnh đề độc lập."],
    ["___ the instructions were clear, one detail was missing.", "Although", "Despite", "Because of", "During", "Although đi với một mệnh đề đầy đủ để diễn tả tương phản."],
    ["Entry is possible only with a valid pass. You cannot enter ___ you show one.", "unless", "because", "although", "despite", "Unless nghĩa là nếu không và giữ đúng điều kiện chỉ được vào khi có pass hợp lệ."],
    ["The organiser spoke slowly ___ everyone could follow.", "so that", "because of", "despite", "unless", "So that đi với mệnh đề chỉ mục đích."],
    ["As soon as the room is ready, we ___ the visitors in.", "will invite", "invited", "would inviting", "invites", "Mệnh đề chính nói việc tương lai dùng will invite; mệnh đề as soon as dùng hiện tại."],
    ["If they had checked the map, they ___ the wrong entrance.", "would not have used", "will not using", "would not use yesterday", "do not use", "Điều kiện không có thật trong quá khứ dùng would not have + quá khứ phân từ."],
  ],
  [
    ["The new instructions are ___ than the earlier version.", "clearer", "clearest", "more clear than", "as clear", "Câu đã có than nên cần dạng so sánh hơn clearer."],
    ["Of all the entrances in the building, this is the ___ convenient one for wheelchair users.", "most", "more", "much", "many", "Of all yêu cầu so sánh nhất, the most convenient."],
    ["The supervisor explained the task very ___.", "clearly", "clear", "clearness", "clearing", "Cần trạng từ clearly bổ nghĩa explained."],
    ["It was a useful ___ of how the equipment works.", "demonstration", "demonstrate", "demonstratingly", "demonstrative", "Sau a useful cần danh từ demonstration."],
    ["The checklist makes the procedure easier ___ follow.", "to", "for", "at", "by", "Easier to follow là cấu trúc tính từ + to-infinitive."],
    ["We need a ___ solution rather than a perfect one.", "practical", "practically", "practice", "practise", "Trước danh từ solution cần tính từ practical."],
    ["The extra signs reduced ___ at the entrance.", "confusion", "confuse", "confusingly", "confusedly", "Động từ reduced cần tân ngữ là danh từ confusion."],
    ["The room was not as crowded ___ we expected.", "as", "than", "that", "from", "So sánh ngang bằng dùng not as ... as."],
    ["The explanation was short enough ___ remember.", "to", "for", "by", "of", "Tính từ + enough + to-infinitive là cấu trúc đúng."],
    ["Of the three options, this one costs the ___.", "least", "less", "little", "fewest", "So sánh ba phương án dùng least để chỉ mức chi phí nhỏ nhất."],
  ],
];

export function makeExclusiveGrammar(band: number, variant: number): StoredContent {
  const { bandIndex } = coordinates(band, variant, 8);
  const scenario = scenarios[((bandIndex * 8 + variant) * 13) % scenarios.length];
  const id = `duo-private-grammar-lesson-${Math.round(band * 10)}-${variant}`;
  const result = base(id, band, scenario, "grammar", "lesson");
  result.title = `Grammar in context · ${scenario.title}`;
  result.durationMinutes = 15;
  const focus = [
    "The notes describe regular routines, simple past events and the basic details needed by first-time visitors.",
    "The team is comparing activities already completed with tasks in progress and arrangements planned for later.",
    "The planning discussion concerns available space, numbers of participants and supplies for different groups.",
    "The editor is connecting information about people, places and equipment without losing important details.",
    "Staff are preparing polite reminders, useful recommendations and descriptions of what visitors may do.",
    "The report explains which jobs have been completed, who carried them out and what remains to be checked.",
    "The coordinator is explaining alternative plans, conditions for entry and the reasons behind recent decisions.",
    "The review compares possible arrangements and describes how clearly each option can be explained to visitors.",
  ][variant];
  result.sections = [{ id: `${id}-context`, title: scenario.title,
    text: `A local organisation is reviewing its arrangements for ${scenario.activity}. ${focus} The coordinator needs accurate notes, clear messages and reliable instructions. Complete each separate sentence so that its grammar fits the situation and its time reference.`,
    instructions: "Choose the one option that correctly completes each sentence. Each question has one answer." }];
  result.questions = grammarPacks[variant].map(([stem, answer, d1, d2, d3, reason], index): StoredQuestion => {
    const options = [answer, d1, d2, d3];
    const rotation = (bandIndex + variant + index) % options.length;
    return { id: `${id}-q-${index + 1}`, number: index + 1, sectionIndex: 0, type: "choice", questionType: "multiple-choice",
      prompt: `${scenario.title}: ${stem}`, options: [...options.slice(rotation), ...options.slice(0, rotation)], answer,
      explanation: reason, evidence: stem.replace("___", answer), subskill: "grammar-in-context" };
  });
  return result;
}
