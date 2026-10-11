import type { ChartVisual, ContentSection } from "../../../shared/types.js";

const overviews: Record<string, string> = {
"fresh-w-lesson-001-task1": "Overall, Central recorded the most borrowing in both years despite a decline, whereas Harbour experienced the largest increase. West changed very little, and North grew more moderately than Harbour.",
"fresh-w-lesson-002-task1": "Overall, drip irrigation used less water than sprinklers for every crop. Melons required the most water under both systems, while beans used the least; the largest absolute saving was also for melons.",
"fresh-w-lesson-003-task1": "Overall, the capital remained the leading destination, but the coastal resort and mountain town grew sharply. Lake City and the northern port were the only routes to experience a decline between quarters.",
"fresh-w-lesson-004-task1": "Overall, digital security had the highest completion rate in both companies, while public speaking had the lowest. Company B led in first aid and public speaking, whereas Company A was ahead in the other two courses.",
"fresh-w-lesson-005-task1": "Overall, use in Hill district declined throughout, while the other districts initially rose and subsequently fell. The substantial gap between districts at the start had almost disappeared by the end.",
"fresh-w-lesson-006-task1": "Overall, Riverside overtook Grand and became the most visited cinema, while Community grew continuously from a much smaller base. Grand declined for most of the period before recovering partially in its final years.",
"fresh-w-lesson-007-task1": "Overall, participation increased in all three age groups. The youngest pupils initially had the highest rate, but the middle group finished first, while older pupils substantially narrowed the initial gap.",
"fresh-w-lesson-008-task1": "Overall, trips increased strongly in the university area and outer suburbs. The centre remained the largest contributor, although its figure fell slightly at the end and its lead over the university area narrowed.",
"fresh-w-lesson-009-task1": "Overall, roads retained the largest budget share, but buildings and drainage gained importance. Because the total budget rose from 20 to 30 million, the falling road share still represented an increase in spending, from 9 to 9.6 million.",
"fresh-w-lesson-010-task1": "Overall, routine tasks and training took smaller shares in the third employment year, while projects, meetings and supervision increased. Independent projects replaced routine work as the largest category. The charts do not specify total working hours.",
"fresh-w-lesson-011-task1": "Overall, manufactured goods became the largest cargo category as total incoming weight increased from 8 to 12 million tonnes. Grain slipped from 2.8 to 2.76 million tonnes, whereas fuel rose from 2.4 to 2.52 million despite its lower share.",
"fresh-w-lesson-012-task1": "Overall, housing became more dominant and healthcare accounted for a larger share of expenditure. Food and transport lost share, while leisure rose slightly. The figures describe expenditure proportions, rather than actual amounts of money.",
"fresh-w-lesson-013-task1": "Overall, Sandy Point had the most rooms but the lowest occupancy rate. Cliffhaven led in occupancy and room price, while Estuary Bay had both the smallest room supply and the lowest price.",
"fresh-w-lesson-014-task1": "Overall, French was the most popular course but had the lowest completion rate. Home repairs showed the reverse pattern, with the highest completion and the shortest course. Bookkeeping was the longest option.",
"fresh-w-lesson-015-task1": "Overall, cars were the main mode for younger children, whereas school buses were most common among older pupils. Older children used cycling, buses and public transport more, but relied less on cars and walking.",
"fresh-w-lesson-016-task1": "Overall, discarded food declined in every type of institution. Schools had the least waste both before and after the programme and the highest training participation; hospitals remained the largest source per meal. The figures alone do not establish what caused the reductions.",
"fresh-w-lesson-025-task1": "Overall, rooftop-solar capacity rose throughout the period, reaching more than eleven times its initial level. Homes greatly outnumbered other building types in installation counts, although those counts do not indicate each type's share of generating capacity.",
"fresh-w-lesson-026-task1": "Overall, annual visits by people with access requirements increased markedly. In the final year, private cars were the most common travel mode, followed by accessible buses; these two modes together accounted for 70% of visits.",
"fresh-w-lesson-027-task1": "Overall, admissions increased between the two years. Staff remained the largest expenditure category but lost share, while animal care and energy gained share. No expenditure totals are given, so changes in cash spending cannot be inferred.",
"fresh-w-lesson-028-task1": "Overall, Ridge held the most printed books, Harbour provided the most digital titles, and Elm opened for the longest period each week. Thus, no school led on all three indicators, and print holdings alone did not reflect overall access.",
"fresh-w-mock-01-task1": "Overall, fixed broadband became more widespread in every settlement type. Large cities remained ahead, but small towns nearly caught up. Rural areas experienced strong growth while retaining the lowest household coverage at the end.",
"fresh-w-mock-02-task1": "Overall, annual purchases increased in every age group except the youngest. The youngest group still bought relatively many items, but the 30–44 group became the largest purchaser, and the gap between age groups narrowed.",
"fresh-w-mock-03-task1": "Overall, teacher training replaced materials as the largest spending category. Total expenditure rose from 6 to 10 million, so every category received more money despite several declining shares; materials increased from 2.4 to 3.1 million.",
"fresh-w-mock-04-task1": "Overall, Brookfield led in annual visits, weekly opening hours and membership price. Oak Lane had the lowest figure on all three measures, while West Point consistently ranked above Northgate but below Brookfield.",
"fresh-w-mock-07-task1": "Overall, annual ferry journeys doubled over the period. Work was the main purpose in the final-year survey, while leisure was slightly more common than education. Journey totals and survey percentages are different measures and are reported separately.",
"fresh-w-exam-transport-01-task1": "Overall, electric buses accounted for an increasing share in every city. Ashford overtook Bellmere and ended with the highest electric share, but Bellmere still had more public charging points and more total daily bus journeys. Cresswick remained lowest on all final indicators.",
};

const n = (value: number) => Number.isInteger(value) ? value.toLocaleString("en-US") : String(value);
const additionalComparisons: Record<string, string> = {
"fresh-w-lesson-001-task1": "Harbour's increase amounted to 44 thousand loans, whereas Central fell by 27 thousand. North's gain was 24 thousand, and the change at West was only one thousand loans over the same period.",
"fresh-w-lesson-004-task1": "The difference between companies was particularly marked in public speaking, where Company B was 17 percentage points ahead. Its advantage in first aid was smaller, at 14 points, while the other course differences were much narrower.",
"fresh-w-lesson-006-task1": "Riverside gained 68 thousand admissions across the decade, compared with 58 thousand at Community. Grand's final total was eight thousand below its initial figure, despite its recovery after the low point in 2021.",
"fresh-w-lesson-007-task1": "The oldest group's gain of 29 percentage points was greater than the youngest group's 17-point increase. Consequently, the gap between these two groups narrowed from fourteen percentage points at the start to just two at the end.",
"fresh-w-lesson-008-task1": "The centre's lead over the university area narrowed from 2,500 daily trips to just 800. Over the final year, the centre lost 200 trips, while the university and suburban areas each added another 500 or more.",
"fresh-w-lesson-009-task1": "Buildings and drainage together accounted for 27% of the initial budget, rising to 42% in 2025. Street lighting retained an unchanged 8% share, but the larger budget raised its amount from 1.6 to 2.4 million currency units.",
"fresh-w-lesson-010-task1": "Routine work and training together fell from 68% to 38% of paid time. In contrast, independent projects and supervision together rose from 20% to 44%, demonstrating a substantial redistribution of the working week.",
"fresh-w-lesson-011-task1": "Manufactured goods increased from 1.6 to 4.68 million tonnes, much more than doubling in weight. Timber also rose in weight, from 0.8 to 1.08 million tonnes, despite its one-point decline in share.",
"fresh-w-lesson-012-task1": "Housing and food were almost equal initially, at 28% and 27%, but their shares were fifteen percentage points apart by 2025. Healthcare's five-point increase was smaller than housing's seven-point rise over the same period.",
"fresh-w-lesson-013-task1": "Cliffhaven's standard room cost 58 currency units more than Estuary Bay's. Sandy Point supplied over twice as many rooms as Estuary Bay, but its occupancy rate was three percentage points lower.",
"fresh-w-lesson-014-task1": "The French course attracted more than twice as many learners as woodwork, at 410 compared with 180. Home repairs required only 30 hours, less than half the 72 hours scheduled for bookkeeping.",
"fresh-w-lesson-015-task1": "The car share differed by sixteen percentage points between the age groups, compared with a ten-point difference for cycling. Public transport remained the least common mode in both columns, despite its higher share among older children.",
"fresh-w-lesson-025-task1": "The three non-residential categories together contained 331 installations, far fewer than the 1,840 homes. Capacity rose by 3.5 megawatts between 2023 and 2025, compared with a smaller increase of 1.3 megawatts between 2015 and 2017.",
"fresh-w-lesson-026-task1": "The final annual visit total was more than twice the initial 18 thousand, an increase of 26 thousand visits. Accessible buses alone accounted for a slightly larger share than trains and taxis combined, at 32% compared with 30%.",
"fresh-w-mock-01-task1": "The gap between large cities and small towns contracted from twelve percentage points to three. The city–rural gap also narrowed, from 29 points initially to sixteen at the end, despite remaining considerably larger.",
"fresh-w-mock-03-task1": "Teacher training rose from 1.5 to 3.4 million currency units, whereas building expenditure increased from 1.08 to 1.6 million. Fundraising had the smallest share in both years, although its amount grew from 0.3 to 0.8 million.",
"fresh-w-mock-04-task1": "Brookfield received 52 thousand more annual visits than Oak Lane and charged 17 currency units more per month. Its weekly opening time exceeded Oak Lane's by 23 hours, so the differences extended across all three indicators.",
"fresh-w-mock-07-task1": "Growth was greatest in the final five-year interval, when journeys rose by 1.3 million. The preceding intervals added 0.7 million and 0.4 million respectively. Work represented the largest individual purpose, but all other purposes together accounted for the remaining 57%.",
};
function measured(value: number, chart: ChartVisual): string {
  if (chart.unit.startsWith("%")) return `${n(value)}%`;
  return `${n(value)} ${chart.unit}`;
}
function seriesContext(series: string): string {
  return /^\d{4}$/.test(series) ? `in ${series}` : `for ${series}`;
}
function tableValue(value: number, column: string, chart: ChartVisual): string {
  const valueText = n(value);
  const columns: Record<string, string> = {
    "Rooms available": `${valueText} available rooms`,
    "Occupancy (%)": `${valueText}% occupancy`,
    "Price per night (currency units)": `a standard-room price of ${valueText} currency units per night`,
    "Enrolled learners": `${valueText} enrolled learners`,
    "Completion (%)": `a completion rate of ${valueText}%`,
    "Course hours": `${valueText} course hours`,
    "Before (grams/meal)": `${valueText} grams of waste per meal before the programme`,
    "After (grams/meal)": `${valueText} grams per meal afterwards`,
    "Staff trained (%)": `${valueText}% of staff trained`,
    "Opening hours/week": `${valueText} opening hours per week`,
    "Digital titles available": `${valueText} digital titles available`,
    "Annual visits (thousands)": `${valueText} thousand annual visits`,
    "Monthly fee (currency units)": `a monthly fee of ${valueText} currency units`,
    "Public charging points": `${valueText} public charging points`,
    "Average daily bus journeys (thousands)": `${valueText} thousand bus journeys per day`,
  };
  if (columns[column]) return columns[column]!;
  if (chart.unit.startsWith("%") && column.startsWith("Ages ")) return `${valueText}% among children aged ${column.slice(5)}`;
  return `${valueText} for ${column}`;
}
function chartDetails(chart: ChartVisual): string {
  if (chart.type === "line") {
    const first = chart.rows[0]!; const last = chart.rows.at(-1)!;
    return chart.series.map((series, i) => {
      const start = first.values[i]!; const finish = last.values[i]!;
      const change = Number((finish - start).toFixed(3));
      const changeUnit = chart.unit.startsWith("%") ? "percentage points" : chart.unit;
      const points = chart.rows.map(row => ({ label: row.label, value: row.values[i]! }));
      const peak = points.reduce((a, b) => b.value > a.value ? b : a);
      const low = points.reduce((a, b) => b.value < a.value ? b : a);
      const middle = points[Math.floor(points.length / 2)]!;
      const subject = series.startsWith("Ages ") ? `Participation among pupils aged ${series.slice(5)}` : series;
      const opening = `${subject} began at ${measured(start, chart)} in ${first.label} and ended at ${measured(finish, chart)} in ${last.label}, an overall ${change >= 0 ? "increase" : "decrease"} of ${n(Math.abs(change))} ${changeUnit}.`;
      const intermediate = peak.label !== last.label && peak.label !== first.label
        ? ` Its highest value was ${measured(peak.value, chart)} in ${peak.label}, before it fell to the final level.`
        : low.label !== first.label && low.label !== last.label
          ? ` The series reached a low of ${measured(low.value, chart)} in ${low.label}, before recovering.`
          : ` At the intermediate point of ${middle.label}, the figure was ${measured(middle.value, chart)}.`;
      return opening + intermediate;
    }).join(" ");
  }
  if (chart.type === "table") {
    return `The table gives the following comparisons. ${chart.rows.map(row => `${row.label} had ${row.values.map((value, i) => tableValue(value, chart.series[i]!, chart)).join(", ")}.`).join(" ")} ${chart.unit.startsWith("%") ? "The percentages describe the separate age groups, with each column accounting for all children in that group." : "These indicators have the separate units stated in their column headings and should be compared within each column."}`;
  }
  if (chart.type === "pie") {
    const sorted = [...chart.rows].sort((a, b) => b.values[0]! - a.values[0]!);
    return `In the chart titled “${chart.title}”, ${chart.rows.map(row => `${row.label.toLowerCase()} accounted for ${measured(row.values[0]!, chart)}`).join(", ")}. The largest category was ${sorted[0]!.label.toLowerCase()}, while ${sorted.at(-1)!.label.toLowerCase()} represented the smallest proportion in this distribution.`;
  }
  const details = chart.rows.map(row => {
    if (chart.series.length === 1) return /^\d{4}$/.test(row.label)
      ? `in ${row.label}, the figure was ${measured(row.values[0]!, chart)}`
      : `${row.label} recorded ${measured(row.values[0]!, chart)}`;
    return `${row.label} recorded ${chart.series.map((series, i) => `${measured(row.values[i]!, chart)} ${seriesContext(series)}`).join(", compared with ")}`;
  }).join("; ");
  const comparisons = chart.series.map((series, i) => {
    const ranked = [...chart.rows].sort((a, b) => b.values[i]! - a.values[i]!);
    const highest = ranked[0]!; const lowest = ranked.at(-1)!;
    if (series === "Share") return `The largest share was ${measured(highest.values[i]!, chart)} for ${highest.label.toLowerCase()}, compared with ${measured(lowest.values[i]!, chart)} for ${lowest.label.toLowerCase()}, the smallest category.`;
    if (/^\d{4}$/.test(series)) return `In ${series}, ${highest.label} recorded the highest figure, at ${measured(highest.values[i]!, chart)}, while ${lowest.label} had the lowest, at ${measured(lowest.values[i]!, chart)}.`;
    if (chart.series.length === 1 && /^\d{4}$/.test(highest.label)) return `The highest total was ${measured(highest.values[i]!, chart)} in ${highest.label}, compared with the lowest figure of ${measured(lowest.values[i]!, chart)} in ${lowest.label}.`;
    const context = chart.series.length > 1 ? `For ${series}, ` : "";
    return `${context}${context ? "the" : "The"} highest figure was recorded for ${highest.label}, at ${measured(highest.values[i]!, chart)}, compared with ${measured(lowest.values[i]!, chart)} for ${lowest.label}, the lowest.`;
  }).join(" ");
  return `${details.charAt(0).toUpperCase()}${details.slice(1)}. ${comparisons}`;
}

/** Every overview is authored for the particular task. Detail paragraphs are
 * calculated directly from its visual values, so changes cannot leave stale
 * numbers in a report. No report is part of the pre-submission stimulus. */
export function numericReport(section: ContentSection): string {
  const overview = overviews[section.id];
  if (!overview) throw new Error(`Missing Writing chart overview for ${section.id}`);
  const charts = (section.visuals ?? []).filter((asset): asset is ChartVisual => ["line", "bar", "pie", "table"].includes(asset.type));
  const intro = section.text.replace(/\s*Summarise the information[\s\S]*$/, "").trim();
  return [intro, overview, ...charts.map(chartDetails), ...(additionalComparisons[section.id] ? [additionalComparisons[section.id]!] : [])].join("\n\n");
}

export const spatialReports: Record<string, string> = {
"fresh-w-lesson-017-task1": `The maps compare the entrance area of a wetland reserve in 2000 and 2025. Overall, a relatively simple entrance was developed into an area offering a wider range of visitor facilities. The site boundary and the access road along the south remained unchanged.

In 2000, reed beds occupied much of the north-western part of the site. A small car park lay to the north-east, while a ticket hut stood in the south-west. Most of the remaining southern area was grassland.

By 2025, the reed beds were still present but occupied a smaller area. A boardwalk had been added across the northern section to their east, and a bus stop was shown below its eastern end. The former car park was no longer labelled. In the south-west, the small ticket hut had given way to a larger visitor centre.

The grassland was replaced by two distinct facilities: an accessible garden near the middle and cycle parking further east. These changes introduced visitor services across the southern section while retaining wetland vegetation in the north-west. The maps therefore show a more varied entrance arrangement rather than an expansion of the site's external boundaries.`,
"fresh-w-lesson-018-task1": `The plans show a small river island before and after improvements intended for public recreation. Overall, the island retained woodland but acquired several leisure facilities, with previously unused or agricultural areas put to new purposes. The bridge on the south remained the sole road access.

Before the work, woodland covered the north-western section. An unused shed stood in the north-east, while an open meadow occupied the south-west. An orchard was located to the south-east. A short access road extended northwards from the southern bridge into the island.

After redevelopment, the woodland was still in the same general position but covered a smaller area. A picnic shelter was added to its east, and a canoe landing appeared further east near the river. The old shed was no longer shown. In the southern half, the open meadow became a wildflower meadow, while the orchard was replaced by a play area.

The access road and bridge remained in their previous positions, so the improvements did not create another road entrance. Taken together, the changes diversified the island's use by combining retained vegetation with places for picnics, play and access to the water. Nothing in the plans indicates that the island itself became larger.`,
"fresh-w-lesson-019-task1": `The plans illustrate the redevelopment of a primary-school courtyard between 2005 and 2025. Overall, a largely concrete space was converted into several areas for play and outdoor learning. The classroom block on the north side and the gate in the south remained in the same positions.

In 2005, the largest courtyard feature was a concrete court occupying much of the western and central area. A storage shed stood on the eastern side, with a narrow grass strip immediately below it. The classroom block extended across the northern edge of the courtyard.

By 2025, the concrete court had been divided into a soft-surface play area in the west and a vegetable garden closer to the centre. The storage shed was removed, and an outdoor classroom occupied the eastern section. A water tank appeared to the south of this new teaching space, where the grass strip had previously been shown.

These changes created a more varied layout without moving the principal indoor building or the entrance. Play remained concentrated towards the west, while gardening and outdoor instruction became distinct uses of the central and eastern areas. The plans show a redistribution of courtyard functions rather than the addition of another classroom block.`,
"fresh-w-lesson-020-task1": `The maps compare a disused railway freight yard in 1995 with the neighbourhood square developed on the same land in 2025. Overall, railway and storage functions were replaced by spaces for community work, refreshments and public gathering. The eastern street remained unchanged.

In the original layout, a warehouse stood in the north-west, and a loading platform occupied the northern area further east. Rail sidings extended across much of the southern half. The road ran along the eastern side of the site, providing a clear reference point for the later development.

By 2025, the warehouse had been converted into a community workshop, retaining its original footprint in the north-west. A café replaced the loading-platform function to the east, although its position and shape were not identical to those of the platform. The rail sidings were no longer present.

The southern half now contained a tree grove towards the west and a market square nearer the middle and east. These additions transformed former railway space into areas intended for everyday public use. Since the workshop occupied the old warehouse location, not every earlier structure was demolished; the redevelopment combined reuse of a building with the removal of railway facilities.`,
"fresh-w-mock-05-task1": `The maps show the changes to a town quay between 1980 and 2025. Overall, the site shifted from storage and boat maintenance towards cultural, dining and leisure uses. The northern access street remained in place, and the river continued to lie along the southern edge.

In 1980, a fish warehouse occupied the north-western section below the street. A boat-repair shed stood in the north-east. The southern area contained a loading yard in the west and a smaller fuel store towards the east, reflecting the quay's working-waterfront function.

By 2025, the north-western building was labelled as a marine museum, while restaurants occupied the position of the former boat-repair shed. The loading yard and fuel store were no longer shown. A long public promenade extended across most of the southern section beside the river.

A small garden was also introduced between the northern facilities and the promenade, towards the eastern half of the site. Thus, storage and servicing areas gave way to places that visitors could use for exhibitions, meals and walking. The plans retain the same main geographical orientation, with road access from the north and the waterfront to the south, rather than showing a new access street or an enlarged quay.`,
"fresh-w-exam-health-02-task1": `The plans compare a neighbourhood clinic in 2008 with the community health centre occupying the same site in 2025. Overall, the main clinic and car park were retained, while the eastern side gained facilities for treatment and physical activity. The boundaries and South Road remained unchanged.

In 2008, the car park occupied the north-western part of the site, with the main clinic directly to its south. A separate storage building stood in the north-east. The south-eastern section was unused ground, leaving the two principal functions concentrated towards the west.

By 2025, physiotherapy rooms had replaced the storage building in the north-east and extended further west than its former footprint. The unused ground below was divided into an exercise garden and a covered walking path, with the garden to the north of the path. Cycle parking was added in the narrow space between the main clinic and the new outdoor facilities.

The unchanged car park and clinic provide clear reference points for these additions. The development therefore expanded the range of services within the existing site, rather than moving the clinic or altering road access. Its most substantial changes were the replacement of storage and the use of previously empty eastern land.`,
"fresh-w-lesson-021-task1": `The diagram shows how paper sheets are manufactured from harvested reeds. Overall, it is a linear process with nine stages, beginning with cutting the raw material and ending with the trimming and packing of dried sheets. Preparation of the fibres is followed by sheet formation and finishing.

First, mature reeds are cut and then chopped into short pieces. These pieces are cooked with water to soften the fibres. The softened material is subsequently washed, and the fibres are separated. They are then mixed with clean water, producing the mixture used to form the paper.

In the next stage, this mixture is spread onto a screen. Excess water is pressed out before the resulting sheet is dried. Pressing and drying are therefore separate steps: the former removes water mechanically, while the latter occurs afterwards. Once the sheet has dried, it is trimmed and packed.

The sequence does not include a return loop or an alternative route. All of the material passes through preparation, spreading, water removal and finishing in that order. The diagram provides no quantities or processing times, so the description follows the stages rather than assigning measurements to them.`,
"fresh-w-lesson-022-task1": `The diagram illustrates one operating cycle of a tidal-lagoon power station. Overall, the cycle repeats as the tide rises and falls, and electricity is produced when water flows out of the lagoon through a turbine. Filling the lagoon is a separate stage from generation.

At the beginning, the rising tide enters the lagoon through open gates. When high tide is reached, the gates are closed. The sea level outside then falls, leaving a difference between the water levels inside and outside the lagoon.

Next, the turbine passage is opened. Water flows outward through the turbine, after which the generator supplies electricity to the grid. This is the generating portion of the cycle; the diagram does not show electricity being produced while water is entering through the filling gates.

As the water levels equalise, the turbine passage closes. On the next rising tide, the filling gates are reopened, and the sequence returns to its first stage. Thus, the station alternates between allowing incoming water, retaining it and releasing it through the generating passage. The final stage leads back to the beginning rather than to a finished product or permanent shutdown.`,
"fresh-w-lesson-023-task1": `The diagram outlines the manufacture and checking of household ceramic water filters. Overall, the process has nine stages, beginning with preparation of clay and ending with the packing of approved filters. Forming and firing are followed by inspection, coating and a final flow-rate test.

Initially, dry clay is sieved. It is then mixed with sawdust and water, and the mixture is pressed into a pot mould. The shaped pot is allowed to air-dry before it is fired in a kiln. These stages turn the prepared material into the filter's formed ceramic body.

After firing, the pot is cooled and inspected for cracks. A silver-based coating is subsequently applied. The next stage measures the water-flow rate, after which approved filters are packed for distribution. The sequence therefore includes both a physical inspection and a performance-related measurement before packing.

No numerical standard for the flow test is supplied, and the diagram does not specify what happens to filters that are not approved. It is consequently possible to describe the testing stage without inventing a threshold or a rejection route. Overall, the manufacturing steps proceed from raw-material preparation to a shaped product, followed by finishing and checks before distribution.`,
"fresh-w-lesson-024-task1": `The flow chart explains how a community sound archive prepares recordings for online publication. Overall, the workflow combines technical preparation with permission checks. It ends with a compressed copy for public listening and a separate preservation-quality copy, which serve different purposes.

First, a contributor supplies a recording together with a consent form. An archivist checks ownership and consent before creating a preservation-quality digital copy. Personally sensitive segments are then removed, and information about the date, location and speaker is added as metadata.

The contributor reviews the edited version before public-access permission is approved. This creates a second permission-related stage later in the process, rather than treating the initial consent form as the only check. A compressed listening copy is subsequently published online. The preservation copy is stored separately at the final stage.

The public file is therefore not the same version as the copy kept for long-term preservation. The sequence also places the contributor's review before publication, so the recording is not made publicly available immediately after submission. No timing or file-size requirements are given; the main features are the ordered preparation stages and the distinction between controlled preservation and public listening access.`,
"fresh-w-mock-06-task1": `The diagram shows how apple vinegar is produced for sale. Overall, there are nine stages, beginning with washing apples and ending with bottling and labelling. The process includes extraction of juice followed by two successive biological transformations and final preparation for sale.

Initially, harvested apples are washed and crushed into pulp. The pulp is pressed to extract its juice. Yeast is then added to the juice, allowing the sugars to ferment into alcohol. These steps produce an alcoholic liquid rather than finished vinegar.

In the next stage, vinegar bacteria and air are introduced. The alcohol is then allowed to become vinegar. This conversion follows the earlier fermentation and should be distinguished from it: the first changes sugars into alcohol, whereas the later stage produces vinegar from that alcohol.

The resulting liquid is filtered and pasteurised before being bottled and labelled. These finishing steps come after vinegar formation rather than before it. The diagram shows a linear sequence, with no return loop or alternative branch. It does not provide quantities, temperatures or waiting periods, so the report describes the order and purpose of the labelled stages without adding unshown measurements.`,
};
