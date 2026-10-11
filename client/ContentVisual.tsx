import { useId, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Modal } from "./components";
import type { ContentSection, VisualAsset, SpatialVisual as SpatialAsset } from "../shared/types";

const palette = ["#527d6d", "#c29452", "#6389b1", "#9b70aa", "#d07870", "#6c9a9f", "#85835a"];
const number = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
const safeFill = (value?: string) => value && /^#[\da-f]{3,8}$/iu.test(value) ? value : "#e7eee2";
function wrappedLabel(text: string, max = 21) {
  const words = text.split(/\s+/u), lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && `${last} ${word}`.length <= max) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}
function SvgLabel({ text, x, y, max, anchor = "middle" }: { text: string; x: number; y: number; max?: number; anchor?: "start" | "middle" | "end" }) {
  return <text x={x} y={y} textAnchor={anchor} className="visual-label">{wrappedLabel(text, max).map((line, index) => <tspan key={index} x={x} dy={index ? 15 : 0}>{line}</tspan>)}</text>;
}

export function SectionVisuals({ section }: { section: ContentSection }) {
  const visuals = section.visuals?.length ? section.visuals : section.chart?.length ? [{
    id: `${section.id}-chart`, type: section.chartType || "bar", title: section.title,
    rows: section.chart, series: section.chartSeries || ["Value"], unit: section.chartUnit || "",
  } as VisualAsset] : [];
  if (!visuals.length) return null;
  return <div className={`section-visuals ${visuals.length > 1 ? "mixed-visuals" : ""}`}>{visuals.map(visual => <ContentVisual key={visual.id} visual={visual} />)}</div>;
}

export function ContentVisual({ visual }: { visual: VisualAsset }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="visual-frame">
    <VisualDrawing visual={visual} />
    <button type="button" className="visual-expand-button" onClick={() => setExpanded(true)} aria-label={`Phóng to: ${visual.title}`}><Maximize2 size={14} />Phóng to hình</button>
    {expanded && <Modal title={visual.title} onClose={() => setExpanded(false)}><p className="muted tiny visual-pan-hint">Kéo ngang để xem toàn bộ hình trên màn hình nhỏ.</p><div className="visual-expanded"><VisualDrawing visual={visual} /></div></Modal>}
  </div>;
}
function VisualDrawing({ visual }: { visual: VisualAsset }) {
  const id = useId().replaceAll(":", "");
  if (visual.type === "table") return <figure className="content-visual visual-table" data-visual-type="table">
    <figcaption><strong>{visual.title}</strong>{visual.unit && <span>{visual.unit}</span>}</figcaption>
    <div className="visual-table-scroll"><table><thead><tr><th scope="col">{visual.xLabel || "Category"}</th>{visual.series.map(series => <th key={series} scope="col">{series}</th>)}</tr></thead><tbody>{visual.rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((value, index) => <td key={index}>{number(value)}</td>)}</tr>)}</tbody></table></div>
  </figure>;
  if (visual.type === "bar" || visual.type === "line") {
    const rows = visual.rows, count = Math.max(visual.series.length, ...rows.map(row => row.values.length), 1);
    const values = rows.flatMap(row => row.values), minimum = Math.min(...values, 0), rawMaximum = Math.max(...values, 1);
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawMaximum - minimum, 1)));
    const step = Math.ceil((rawMaximum - minimum) / 5 / magnitude * 10) / 10 * magnitude;
    const low = Math.floor(minimum / step) * step, high = Math.ceil(rawMaximum / step) * step, range = high - low || 1;
    const left = 65, right = 595, top = 44, height = 228, groupWidth = (right - left) / Math.max(rows.length, 1);
    const x = (index: number) => visual.type === "line" ? left + (right - left) * (rows.length === 1 ? .5 : index / (rows.length - 1)) : left + groupWidth * (index + .5);
    const y = (value: number) => top + height * (1 - (value - low) / range), zero = y(0);
    return <figure className="content-visual" data-visual-type={visual.type}>
      <figcaption><strong>{visual.title}</strong>{visual.unit && <span>{visual.unit}</span>}</figcaption>
      <svg viewBox="0 0 640 340" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>{visual.title}</title><desc id={`${id}-desc`}>{visual.description || ""} {visual.rows.map(row => `${row.label}: ${row.values.map((value, i) => `${visual.series[i] || `Series ${i + 1}`} ${number(value)}`).join(", ")}`).join("; ")}. {visual.unit}</desc>
        {Array.from({ length: 6 }, (_, index) => { const tick = low + range * index / 5; return <g key={index}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="#dce5d5" /><text x={left - 9} y={y(tick) + 4} textAnchor="end" className="visual-tick">{number(tick)}</text></g>; })}
        <line x1={left} x2={left} y1={top} y2={top + height} stroke="#80907a" />
        <line x1={left} x2={right} y1={zero} y2={zero} stroke="#80907a" />
        {visual.yLabel && <text x={left} y={22} className="visual-tick">{visual.yLabel}</text>}
        {visual.type === "line" ? Array.from({ length: count }, (_, series) => <g key={series}>
          <polyline points={rows.flatMap((row, index) => row.values[series] == null ? [] : [`${x(index)},${y(row.values[series])}`]).join(" ")} fill="none" stroke={palette[series % palette.length]} strokeWidth={3} />
          {rows.map((row, index) => row.values[series] == null ? null : <circle key={index} cx={x(index)} cy={y(row.values[series])} r={4} fill={palette[series % palette.length]} />)}
        </g>) : rows.map((row, index) => <g key={row.label}>{row.values.map((value, series) => <rect key={series} x={left + index * groupWidth + groupWidth * .13 + series * groupWidth * .74 / count} y={Math.min(zero, y(value))} width={groupWidth * .68 / count} height={Math.abs(y(value) - zero)} fill={palette[series % palette.length]} />)}</g>)}
        {rows.map((row, index) => <SvgLabel key={row.label} x={x(index)} y={top + height + 21} text={row.label} max={Math.max(8, Math.floor(groupWidth / 6))} />)}
        {visual.xLabel && <text x={(left + right) / 2} y={330} textAnchor="middle" className="visual-tick">{visual.xLabel}</text>}
      </svg>
      <VisualLegend labels={visual.series} />
    </figure>;
  }
  if (visual.type === "pie") return <figure className="content-visual" data-visual-type="pie">
    <figcaption><strong>{visual.title}</strong>{visual.unit && <span>{visual.unit}</span>}</figcaption>
    <div className="pie-chart-grid">{Array.from({ length: Math.max(visual.series.length, 1) }, (_, series) => {
      const total = visual.rows.reduce((sum, row) => sum + (row.values[series] || 0), 0), radius = 105;
      let start = -.25;
      const description = visual.rows.map(row => `${row.label}: ${number(row.values[series] || 0)}${visual.unit === "%" ? "%" : ""}`).join("; ");
      return <div className="pie-chart-panel" key={series}><h4>{visual.series[series] || visual.title}</h4><svg viewBox="0 0 290 270" role="img" aria-label={`${visual.title}, ${visual.series[series] || ""}. ${description}`}>
        <title>{visual.series[series] || visual.title}</title>
        {visual.rows.map((row, index) => {
          const value = Math.max(0, row.values[series] || 0), fraction = total ? value / total : 0, end = start + fraction;
          const sx = 145 + radius * Math.cos(start * Math.PI * 2), sy = 125 + radius * Math.sin(start * Math.PI * 2), ex = 145 + radius * Math.cos(end * Math.PI * 2), ey = 125 + radius * Math.sin(end * Math.PI * 2);
          const midpoint = (start + end) / 2, tx = 145 + radius * .67 * Math.cos(midpoint * Math.PI * 2), ty = 125 + radius * .67 * Math.sin(midpoint * Math.PI * 2); start = end;
          return <g key={row.label}>{fraction >= .999 ? <circle cx={145} cy={125} r={radius} fill={palette[index % palette.length]} /> : fraction > 0 ? <path d={`M145,125 L${sx},${sy} A${radius},${radius} 0 ${fraction > .5 ? 1 : 0},1 ${ex},${ey} Z`} fill={palette[index % palette.length]} stroke="#fff" strokeWidth={2} /> : null}{fraction >= .06 && <text x={tx} y={ty + 4} textAnchor="middle" fill="#fff" fontSize={14} fontWeight={600}>{number(value)}{visual.unit === "%" ? "%" : ""}</text>}</g>;
        })}
      </svg></div>;
    })}</div><VisualLegend labels={visual.rows.map(row => row.label)} />
  </figure>;
  return <SpatialVisual visual={visual as SpatialAsset} id={id} />;
}
function VisualLegend({ labels }: { labels: string[] }) {
  return <ul className="visual-legend" aria-label="Legend">{labels.map((label, index) => <li key={label}><i style={{ backgroundColor: palette[index % palette.length] }} /><span>{label}</span></li>)}</ul>;
}
function SpatialVisual({ visual, id }: { visual: SpatialAsset; id: string }) {
  const map = visual.type === "map" || visual.type === "plan";
  const nodes = visual.nodes || [], labels = visual.labels || [];
  const accessibleLabels = [...labels, ...nodes].map(label => label.questionNumber != null ? `Blank for question ${label.questionNumber}` : label.text || "").filter(Boolean);
  const styles = [...new Set((visual.paths || []).map(path => path.style || "path"))];
  return <figure className={`content-visual spatial-visual ${map ? "map-visual" : "process-visual"}`} data-visual-type={visual.type}>
    <figcaption><strong>{visual.title}</strong></figcaption>
    <svg viewBox={`0 0 ${visual.width} ${visual.height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>{visual.title}</title><desc id={`${id}-desc`}>{visual.description || ""} {accessibleLabels.join("; ")}. {map ? "North is at the top of the map." : visual.type === "process" ? "Arrows indicate the direction between stages." : "Schematic diagram with numbered labels."}</desc>
      <defs><marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#657f66" /></marker></defs>
      <rect x={2} y={2} width={visual.width - 4} height={visual.height - 4} rx={map ? 8 : 0} fill={map ? "#f7f7ed" : "#fff"} stroke={map ? "#c7d4c0" : "none"} />
      {(visual.areas || []).map(area => <rect key={area.id} x={area.x} y={area.y} width={area.width} height={area.height} rx={6} fill={safeFill(area.fill)} stroke="#bac9b3" strokeWidth={1.5} />)}
      {(visual.paths || []).map(path => <polyline key={path.id} points={path.points.map(point => point.join(",")).join(" ")} stroke={path.style === "river" ? "#89b7d4" : path.style === "road" ? "#d2bea1" : "#9aab91"} strokeWidth={path.style === "road" ? 18 : path.style === "river" ? 22 : 5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={path.style === "path" ? "8 5" : undefined} fill="none" />)}
      {(visual.connections || []).map((connection, index) => {
        const from = nodes.find(node => node.id === connection.from), to = nodes.find(node => node.id === connection.to);
        if (!from || !to) return null;
        const fx = from.x + from.width / 2, fy = from.y + from.height / 2, tx = to.x + to.width / 2, ty = to.y + to.height / 2, dx = tx - fx, dy = ty - fy;
        const startScale = 1 / Math.max(Math.abs(dx) / (from.width / 2), Math.abs(dy) / (from.height / 2), 1), endScale = 1 / Math.max(Math.abs(dx) / (to.width / 2), Math.abs(dy) / (to.height / 2), 1);
        const x1 = fx + dx * startScale, y1 = fy + dy * startScale, x2 = tx - dx * endScale, y2 = ty - dy * endScale;
        return <g key={`${connection.from}-${connection.to}-${index}`}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#657f66" strokeWidth={2.5} markerEnd={`url(#${id}-arrow)`} />{connection.label && <SvgLabel x={(x1 + x2) / 2 + 8} y={(y1 + y2) / 2 - 8} text={connection.label} />}</g>;
      })}
      {nodes.map(node => <g key={node.id}><rect x={node.x} y={node.y} width={node.width} height={node.height} rx={8} fill="#eef3e7" stroke="#a5b99b" strokeWidth={1.7} />{node.questionNumber != null ? <BlankMarker number={node.questionNumber} x={node.x + node.width / 2} y={node.y + node.height / 2} /> : <SvgLabel x={node.x + node.width / 2} y={node.y + node.height / 2 - 7.5 * (wrappedLabel(node.text || "", Math.floor(node.width / 7)).length - 1) + 4} text={node.text || ""} max={Math.max(8, Math.floor(node.width / 7))} />}</g>)}
      {labels.map(label => {
        if (label.questionNumber != null) return <BlankMarker key={label.id} number={label.questionNumber} x={label.x} y={label.y} />;
        const area = map && label.id.includes("-label-") ? visual.areas?.find(candidate => candidate.id === label.id.replace("-label-", "-area-")) : undefined;
        // Older map captions used a top-left inset despite the centred SVG
        // anchor. Correct their display without changing the stored stimulus.
        const legacyInset = area && label.x === area.x + 10 && label.y === area.y + 30;
        const x = legacyInset ? area.x + area.width / 2 : label.x;
        const centreY = legacyInset ? area.y + area.height / 2 : label.y;
        const max = area ? Math.max(8, Math.floor(area.width / 7)) : 23;
        const text = label.text || "";
        const y = area ? centreY + 4 - 7.5 * (wrappedLabel(text, max).length - 1) : centreY;
        return <g key={label.id}><SvgLabel x={x} y={y} text={text} max={max} /></g>;
      })}
      {map && <g transform={`translate(${visual.width - 35}, 39)`} aria-hidden="true"><path d="M0,-15 L-6,5 L0,0 L6,5 Z" fill="#526e54" /><text x={0} y={-21} textAnchor="middle" fontSize={13} fontWeight={700} fill="#526e54">N</text></g>}
    </svg>
    {map && styles.length > 0 && <ul className="visual-legend spatial-legend" aria-label="Map legend">{styles.map(style => <li key={style}><i className={`map-key ${style}`} /><span>{style === "road" ? "Road" : style === "river" ? "River" : "Footpath"}</span></li>)}</ul>}
  </figure>;
}
function BlankMarker({ number: questionNumber, x, y }: { number: number; x: number; y: number }) {
  return <g><rect x={x - 29} y={y - 13} width={58} height={27} rx={4} fill="#fff" stroke="#6d8868" strokeWidth={1.5} strokeDasharray="4 3" /><text x={x} y={y + 5} textAnchor="middle" fontSize={14} fill="#496547" fontWeight={700}>{questionNumber} ……</text></g>;
}
