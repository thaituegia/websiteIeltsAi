import type { SpatialVisual, StoredContent } from '../../../shared/types.js';
import { validateContentStructure } from '../../../shared/content-visuals.js';
import { buildFreshListeningContent } from '../fresh/listening.js';
import { transactionScenarios } from './listening-transactions.js';
import { orientationScenarios } from './listening-orientations.js';
import { discussionScenarios } from './listening-discussions.js';
import { lectureScenarios } from './listening-lectures.js';
import { assertSource, transaction, orientationTalk, discussion, lecture, type ExpandedSource } from './listening-model.js';

const choose = <T>(values: T[], excluded: number[]): T[] => values.filter((_, index) => !excluded.includes(index));
const scenarios = [choose(transactionScenarios, [19, 20, 21]), orientationScenarios,
  choose(discussionScenarios, [28, 32]), choose(lectureScenarios, [12])];
const makers = [transaction, orientationTalk, discussion, lecture];
export const expandedListeningSources: ExpandedSource[][] = scenarios.map((sources, part) => sources.map((source, index) => {
  const built = makers[part]!(source, index >= 12);
  assertSource(built, index >= 12);
  return built;
}));
if (expandedListeningSources.some(sources => sources.length !== 32)) throw new Error('Expanded Listening requires 32 independent sources per Part.');

function spatialAssets(item: StoredContent, sources: ExpandedSource[], serial: number): void {
  for (const [sectionIndex, source] of sources.entries()) {
    const section = item.sections[sectionIndex]!;
    if (source.part === 2) {
      const original = section.visuals![0] as SpatialVisual;
      const width = 724 + serial * 3, height = 462 + serial * 2;
      const cx = width / 2 + serial % 3 * 4, cy = height / 2;
      const inset = 52 + serial % 5 * 3;
      const gap = 36 + serial % 4 * 3;
      const areas = [
        { id: `${original.id}-nw-room`, x: inset, y: 62, width: cx - inset - gap, height: cy - 62 - gap, fill: '#e1ecd9' },
        { id: `${original.id}-ne-room`, x: cx + gap, y: 62 + serial % 4 * 3, width: width - cx - gap - inset, height: cy - 62 - gap - serial % 4 * 3, fill: '#eee4cd' },
        { id: `${original.id}-sw-room`, x: inset + serial % 6 * 3, y: cy + gap, width: cx - inset - gap - serial % 6 * 3, height: height - cy - gap - 62, fill: '#eadbd0' },
        { id: `${original.id}-se-room`, x: cx + gap, y: cy + gap + serial % 3 * 3, width: width - cx - gap - inset, height: height - cy - gap - 62 - serial % 3 * 3, fill: '#dbe7ee' },
      ];
      const numbers = item.questions.filter(question => question.visualId === original.id).map(question => question.number);
      section.visuals = [{ ...original, title: `${source.title}: four activity areas`, description: `Enter from the south and follow the central route to the ${source.centerLabel}. North is at the top. Four distinct numbered activity areas lie in the stated compass directions. The illustration gives positions, not names or answer text.`, width, height, areas,
        paths: [{ id: `${original.id}-main-route`, points: [[cx, height - 24], [cx, 44]], style: 'path' },
          ...areas.map((area, index) => ({ id: `${original.id}-access-${index}`, points: [[cx, cy], [area.x + area.width / 2, area.y + area.height / 2]] as [number, number][], style: 'path' as const }))],
        labels: [{ id: `${original.id}-north`, x: width - 32, y: 28, text: 'N ↑' }, { id: `${original.id}-entry`, x: cx, y: height - 8, text: 'Entrance' },
          { id: `${original.id}-landmark`, x: cx, y: cy - 12, text: source.centerLabel },
          ...areas.map((area, index) => ({ id: `${original.id}-area-${index}`, x: area.x + area.width / 2, y: area.y + area.height / 2, questionNumber: numbers[index]! }))] }];
    }
    if (source.part === 4 && source.style === 'flow') {
      const original = section.visuals![0] as SpatialVisual;
      const numbers = (original.nodes ?? []).map(node => node.questionNumber!);
      const width = 770 + serial * 5, height = 516 + serial * 3;
      const left = 54, right = width - 250, middle = width / 2 - 98;
      const positions: [number, number][] = serial % 2
        ? [[left, 48], [right, 48], [right, 205], [left, 205], [left, 364], [right, 364]]
        : [[left, 58], [middle, 58], [right, 58], [right, 328], [middle, 328], [left, 328]];
      const nodes = positions.map(([x, y], index) => ({ id: `${original.id}-stage-${index}`, x, y, width: 196, height: 88, questionNumber: numbers[index]! }));
      section.visuals = [{ id: original.id, type: 'process', title: 'Six main operating stages', description: 'Follow the arrows from the upper-left numbered stage. The recording gives the first three main stages, two supporting conditions in the notes, then the final three stages. Separate closing notes cover quality or limits.', width, height, labels: [], nodes, connections: nodes.slice(1).map((node, index) => ({ from: nodes[index]!.id, to: node.id })) }];
    }
    if (source.part === 4 && source.style === 'diagram') {
      const original = section.visuals![0] as SpatialVisual;
      const questions = item.questions.filter(question => question.visualId === original.id).map(question => question.number);
      const width = 618 + serial * 2;
      const midpoint = width / 2;
      const common = { ...original, title: 'Mounted field instrument: component positions', description: 'Use the recording to identify the numbered upper operating part and lower support. The schematic includes placement and outline but no component names.', width, height: 384,
        labels: [{ id: `${original.id}-upper-number`, x: midpoint, y: 124, questionNumber: questions[0]! },
          { id: `${original.id}-lower-number`, x: midpoint, y: 270, questionNumber: questions[1]! }] };
      const treeCore = source.title.includes('tree-ring');
      const solar = source.title.includes('solar');
      const humidity = source.title.includes('humidity');
      const upperWidth = treeCore ? 86 : solar ? 268 : humidity ? 74 : 112;
      const upperHeight = treeCore ? 86 : solar ? 86 : humidity ? 94 : 98;
      const top = { id: `${original.id}-operating-outline`, x: midpoint - upperWidth / 2, y: 78, width: upperWidth, height: upperHeight, fill: solar ? '#dce6ef' : '#e1e8d4' };
      const support = treeCore ? { id: `${original.id}-tray-outline`, x: midpoint - 175, y: 244, width: 350, height: 44, fill: '#dfd5bf' } : humidity ? { id: `${original.id}-bracket-outline`, x: midpoint - 104, y: 198, width: 35, height: 108, fill: '#e4dbc9' } : { id: `${original.id}-post-outline`, x: midpoint - 21, y: 164, width: 42, height: 142, fill: '#e3d8c7' };
      const paths: NonNullable<SpatialVisual['paths']> = treeCore ? [{ id: `${original.id}-optical-stand`, points: [[midpoint + 44, 120], [midpoint + 140, 120], [midpoint + 140, 244]], style: 'path' }] : humidity ? [{ id: `${original.id}-bracket-arm`, points: [[midpoint - 88, 198], [midpoint - 88, 170], [midpoint, 170], [midpoint, 164]], style: 'path' }] : [{ id: `${original.id}-base`, points: [[midpoint - 100, 310], [midpoint + 100, 310]], style: 'path' }];
      if (solar) for (let i = 1; i < 5; i++) paths.push({ id: `${original.id}-panel-grid-${i}`, points: [[top.x + i * top.width / 5, top.y], [top.x + i * top.width / 5, top.y + top.height]], style: 'path' });
      if (humidity) common.labels[1]!.x = midpoint - 88;
      if (treeCore) common.labels[1]!.y = 276;
      section.visuals = [{ ...common, areas: [top, support], paths }];
    }
  }
}

function content(id: string, sources: ExpandedSource[], format: StoredContent['format'], serial: number): StoredContent {
  const band = format === 'lesson' ? sources[0]!.band : Math.round(sources.reduce((total, source) => total + source.band, 0) / sources.length * 2) / 2;
  const item = buildFreshListeningContent(id, sources, band, format, 300 + serial);
  item.title = format === 'lesson' ? sources[0]!.title : `Listening simulation ${String(serial + 1).padStart(2, '0')}: ${sources[0]!.topic}, ${sources[2]!.topic.toLowerCase()} and ${sources[3]!.topic.toLowerCase()}`;
  item.tags = item.tags.filter(tag => tag !== 'fresh-bank-v6').concat(['fresh-bank-x3', 'independent-original-contexts', 'post-completion-answer-evidence']);
  item.provenance = { method: 'ai-assisted', version: 'fresh-bank-x3-2026-10-11', generatedAt: '2026-10-11T00:00:00.000Z' };
  item.review = { status: 'unreviewed', checks: ['structured-four-parts', 'ten-chronologically-ordered-evidence-per-part', 'answer-limits-and-accepted-variants', 'independent-lesson-and-mock-recordings', 'topic-specific-worked-examples', 'numbered-spatial-asset-grounding'], limitations: ['Chưa được chuyên gia IELTS thẩm định độc lập; band/CEFR là ước tính luyện tập, chưa hiệu chuẩn.', 'Bản nghe dùng transcript và TTS khi nhà cung cấp âm thanh được cấu hình; accent metadata không thay thế thu âm có người đọc.'] };
  spatialAssets(item, sources, serial);
  validateContentStructure(item);
  return item;
}
export const expandedListeningLessons: StoredContent[] = expandedListeningSources.flatMap((sources, part) => sources.slice(0, 12).map((source, index) => content(`fresh-x3-l-lesson-${String(part * 12 + index + 1).padStart(3, '0')}`, [source], 'lesson', part * 12 + index)));
export const expandedListeningMocks: StoredContent[] = Array.from({length: 20}, (_, index) => content(`fresh-x3-l-mock-${String(index + 1).padStart(3, '0')}`, expandedListeningSources.map(sources => sources[index + 12]!), 'full-mock', index));
