import type { StoredContent } from '../../../shared/types.js';
import { buildFreshListeningContent } from '../fresh/listening.js';
import { listeningExamOne, listeningExamTwo, listeningExamThree, listeningExamFour } from './listening-sources.js';

const recordings = [listeningExamOne, listeningExamTwo, listeningExamThree, listeningExamFour];
const estimatedBands = [6, 7, 7.5, 8];

/** Four wholly new recordings per mock: 160 original questions and sixteen independent transcripts. */
export const newListeningMocks: StoredContent[] = recordings.map((sources, index) => {
  const band = estimatedBands[index]!;
  const content = buildFreshListeningContent(`fresh-exam-l-${String(index + 1).padStart(2, '0')}`, sources, band, 'full-mock', 20 + index);
  if (index === 2) {
    // The original scenario describes a submerged recorder tethered to a seabed weight.
    // Use its actual geometry rather than the generic land-based apparatus schematic.
    const section = content.sections[3]!;
    section.visuals = section.visuals?.map(visual => visual.type === 'diagram' ? {
      id: visual.id, type: 'diagram' as const, title: 'Underwater monitoring apparatus',
      description: 'A suspended upper recording component is linked by a short tether to a broad lower weight resting on the seabed. Identify the two numbered components from the lecture. The diagram is schematic and not to scale.',
      width: 560, height: 360,
      areas: [
        { id: `${visual.id}-water`, x: 35, y: 30, width: 490, height: 282, fill: '#e1edf2' },
        { id: `${visual.id}-upper`, x: 240, y: 74, width: 80, height: 64, fill: '#dae1e6' },
        { id: `${visual.id}-lower`, x: 180, y: 268, width: 200, height: 44, fill: '#dacbbb' },
        { id: `${visual.id}-bed`, x: 35, y: 312, width: 490, height: 24, fill: '#e0d9c2' },
      ],
      paths: [{ id: `${visual.id}-tether`, points: [[280, 138], [280, 268]] as [number, number][], style: 'path' as const }],
      labels: [
        { id: `${visual.id}-q37`, x: 280, y: 112, questionNumber: 37 },
        { id: `${visual.id}-q38`, x: 280, y: 294, questionNumber: 38 },
        { id: `${visual.id}-seabed`, x: 95, y: 330, text: 'Seabed' },
      ],
    } : visual);
  }
  if (index === 3) {
    const section = content.sections[3]!;
    section.visuals = section.visuals?.map(visual => {
      if (visual.type !== 'process') return visual;
      const positions: [number, number][] = [[60, 44], [460, 44], [460, 216], [60, 216], [60, 388], [460, 388]];
      const nodes = [31, 32, 33, 36, 37, 38].map((questionNumber, stage) => ({
        id: `${visual.id}-stage-${stage + 1}`, x: positions[stage]![0], y: positions[stage]![1], width: 220, height: 74, questionNumber,
      }));
      return {
        id: visual.id, type: 'process' as const, title: 'Selected-textile recovery pilot: six processing stages',
        description: 'Follow the arrows: across the top row, down on the right, across the middle row to the left, then down and across the bottom row. The input fibre and operating temperature are given in the separate notes. The diagram describes the pilot in the lecture, not a universal recycling method.',
        width: 780, height: 510, labels: [], nodes,
        connections: nodes.slice(1).map((node, stage) => ({ from: nodes[stage]!.id, to: node.id })),
      };
    });
  }
  return {
    ...content,
    createdAt: '2026-10-11T07:00:00.000Z',
    title: `Listening mới ${index + 1}: ${['Du lịch, sức khỏe và môi trường', 'Học tập, giao thông và thực phẩm', 'Cộng đồng, văn hóa và khoa học biển', 'Nhà ở, việc làm và công nghệ bền vững'][index]}`,
    description: 'Bốn bản nghe nguyên bản, 40 câu và 30 phút theo cấu trúc IELTS Listening. Chủ đề thuộc các nhóm thường gặp trong IELTS; đáp án có bằng chứng chính xác trong transcript. Đây là học liệu do AI tạo, chưa được chuyên gia thẩm định.',
    tags: [...content.tags.filter(tag => tag !== 'fresh-bank-v6'), 'new-exams-20261011', 'original-exam-recordings'],
    provenance: { ...content.provenance!, version: 'new-exams-2026-10-11', generatedAt: '2026-10-11T07:00:00.000Z' },
  };
});
