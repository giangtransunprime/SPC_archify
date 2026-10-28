import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import {
  animateAttr,
  focusEdgeAttrs,
  focusNodeAttrs,
  focusNodeTitle,
  svgAccessibleText,
  svgRootAttrs,
} from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { legendFootprint, resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { nodeTextFit } from '../shared/text-fit.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray, arrowClassMap, componentFill, edgeLabelAccent } from '../shared/geometry.mjs';

// Pure layout and SVG for a swimlane diagram. The CLI wraps it with file I/O and the
// browser editor bundles it unchanged, so both draw exactly the same picture.
export function renderSwimlane(sl) {
  const locale = sl.meta.locale;
  const ADVANCE = nodeTextFit.widthFactor;

  const layout = {
    margin: 28,
    top: 20,
    headerH: 42,
    laneW: sl.layout?.laneWidth ?? 148,
    descW: sl.layout?.descriptionWidth ?? 380,
    descGap: 18,
    minRowH: 92,
    labelFont: 12,
    tagFont: 10,
    descFont: 12,
    systemFont: 11,
    edgeFont: 10,
    lineH: 15,
  };
  layout.nodeW = layout.laneW - 34;

  // ---- Validation ----------------------------------------------------------------
  // Every check names the JSON pointer and the supported fix, like the other
  // typed renderers. The layout never invents placement: a step in a lane and
  // row that another step already holds, or an edge that no route can reach
  // without crossing a step, is reported instead of drawn.
  const problems = [];
  const details = [];
  function fail(code, message, subject, evidence, supportedFixes) {
    problems.push(message);
    details.push({ code, severity: 'error', message, subject: { diagramType: 'swimlane', ...subject }, evidence, supportedFixes });
  }
  const lanes = asArray(sl.lanes);
  const laneIndex = new Map();
  for (const [index, lane] of lanes.entries()) {
    if (laneIndex.has(lane.id)) fail('swimlane/duplicate-lane', `Lane id "${lane.id}" is declared twice.`, { path: `/lanes/${index}/id` }, { id: lane.id }, ['Give every lane a unique id.']);
    laneIndex.set(lane.id, index);
  }
  const rawSteps = asArray(sl.steps);
  const stepById = new Map();
  let rowCursor = 0;
  const steps = rawSteps.map((step, index) => {
    if (stepById.has(step.id)) fail('swimlane/duplicate-id', `Step id "${step.id}" is declared twice.`, { path: `/steps/${index}/id` }, { id: step.id }, ['Give every step a unique id.']);
    if (!laneIndex.has(step.lane)) {
      fail('swimlane/unknown-lane', `Step "${step.id}" names lane "${step.lane}", which is not declared.`, { path: `/steps/${index}/lane`, nodeId: step.id }, { lane: step.lane }, ['Declare the lane in lanes[].', 'Point the step at a declared lane.']);
    }
    rowCursor = step.row ?? rowCursor + 1;
    const shape = step.shape || 'step';
    const placed = { ...step, index, shape, type: step.type || (shape === 'decision' ? 'security' : 'backend'), row: rowCursor, lane: laneIndex.get(step.lane) ?? 0 };
    stepById.set(step.id, placed);
    return placed;
  });
  {
    const cells = new Map();
    for (const step of steps) {
      const key = `${step.lane}:${step.row}`;
      if (cells.has(key)) {
        fail('swimlane/cell-conflict', `Steps "${cells.get(key)}" and "${step.id}" share lane "${lanes[step.lane]?.id}" and row ${step.row}.`,
          { path: `/steps/${step.index}/row`, nodeId: step.id }, { lane: lanes[step.lane]?.id, row: step.row }, ['Give one step another row.', 'Move one step to another lane.']);
      }
      cells.set(key, step.id);
    }
  }
  const edges = asArray(sl.edges).map((edge, index) => ({ ...edge, index }));
  for (const edge of edges) {
    for (const end of ['from', 'to']) {
      if (!stepById.has(edge[end])) fail('swimlane/unknown-step', `Edge ${edge.index} ${end} "${edge[end]}" is not a declared step.`, { path: `/edges/${edge.index}/${end}` }, { id: edge[end] }, ['Declare the step in steps[].', 'Correct the step id.']);
    }
    if (edge.from === edge.to) fail('swimlane/self-edge', `Edge ${edge.index} connects step "${edge.from}" to itself.`, { path: `/edges/${edge.index}` }, { id: edge.from }, ['Describe a retry or loop in the step description instead.']);
  }
  if (problems.length) throwDiagnosticProblems('Swimlane validation failed', problems, { code: 'swimlane/input', subject: { diagramType: 'swimlane' }, diagnostics: details });

  // ---- Text measurement ----------------------------------------------------------
  const textWidth = (text, font, weight = 400) => textUnits(text) * font * ADVANCE * (weight >= 600 ? 1.06 : 1);
  function wrap(text, maxWidth, font, weight = 400) {
    const lines = [];
    let current = '';
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      const next = current ? `${current} ${word}` : word;
      if (!current || textWidth(next, font, weight) <= maxWidth) current = next;
      else { lines.push(current); current = word; }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  }

  // ---- Geometry ------------------------------------------------------------------
  const stepNumber = (step) => step.number ?? step.label.match(/^\s*([0-9]+[A-Za-z]?\.?)(?=\s)/)?.[1] ?? '';
  for (const step of steps) {
    const decision = step.shape === 'decision';
    const innerW = decision ? layout.nodeW * 0.64 : layout.nodeW - 14;
    step.labelLines = wrap(step.label, innerW, layout.labelFont, 700);
    step.tagLines = step.tag ? wrap(step.tag, decision ? layout.nodeW * 0.7 : layout.nodeW - 12, layout.tagFont) : [];
    const textH = step.labelLines.length * layout.lineH + step.tagLines.length * 13;
    step.w = layout.nodeW;
    step.h = Math.max(decision ? 66 : 48, textH + (decision ? 30 : 16));
    const descWidth = layout.descW - 30;
    const paragraphs = [];
    if (step.description) {
      const prefix = stepNumber(step);
      const lines = wrap(step.description, descWidth - (prefix ? textWidth(`${prefix} `, layout.descFont, 700) : 0), layout.descFont);
      paragraphs.push({ prefix, lines, system: step.system ? wrap(step.system, descWidth, layout.systemFont) : [], stepId: step.id });
    } else if (step.system) {
      paragraphs.push({ prefix: stepNumber(step), lines: [], system: wrap(step.system, descWidth, layout.systemFont), stepId: step.id });
    }
    step.paragraphs = paragraphs;
  }
  const rowNumbers = [...new Set(steps.map((step) => step.row))].sort((a, b) => a - b);
  const maxRow = rowNumbers.at(-1);
  const rowH = new Map();
  for (let row = 1; row <= maxRow; row += 1) {
    const here = steps.filter((step) => step.row === row);
    const nodeH = Math.max(0, ...here.map((step) => step.h));
    const descH = here.reduce((sum, step) => sum + step.paragraphs.reduce((inner, p) => inner + p.lines.length * 16.5 + p.system.length * 14.5 + 8, 0), 0);
    rowH.set(row, Math.ceil(Math.max(layout.minRowH, nodeH + 38, descH + 20)));
  }
  const rowTop = new Map();
  {
    let y = layout.top + layout.headerH;
    for (let row = 1; row <= maxRow; row += 1) { rowTop.set(row, y); y += rowH.get(row); }
  }
  const bodyTop = layout.top + layout.headerH;
  const bodyBottom = bodyTop + [...rowH.values()].reduce((a, b) => a + b, 0);
  const lanesRight = layout.margin + lanes.length * layout.laneW;
  const descX = lanesRight + layout.descGap;
  for (const step of steps) {
    step.cx = layout.margin + step.lane * layout.laneW + layout.laneW / 2;
    step.cy = rowTop.get(step.row) + rowH.get(step.row) / 2;
    step.x = step.cx - step.w / 2;
    step.y = step.cy - step.h / 2;
  }

  // ---- Routing -------------------------------------------------------------------
  // Each edge tries a short list of orthogonal routes, simplest first, and takes
  // the first that crosses no step. `route` / `fromSide` / `toSide` narrow the
  // list. If every candidate is blocked the edge is reported, not drawn through.
  const PAD = 5;
  const rectOf = (step) => ({ x0: step.x - PAD, y0: step.y - PAD, x1: step.x + step.w + PAD, y1: step.y + step.h + PAD });
  function anchor(step, side) {
    const extra = step.shape === 'decision' ? 0 : 0;
    return { top: [step.cx, step.y - extra], bottom: [step.cx, step.y + step.h + extra], left: [step.x - extra, step.cy], right: [step.x + step.w + extra, step.cy] }[side];
  }
  function segmentHits(a, b, rect) {
    const [x0, x1] = a[0] <= b[0] ? [a[0], b[0]] : [b[0], a[0]];
    const [y0, y1] = a[1] <= b[1] ? [a[1], b[1]] : [b[1], a[1]];
    return x1 > rect.x0 && x0 < rect.x1 && y1 > rect.y0 && y0 < rect.y1;
  }
  function collisions(points, from, to) {
    let count = 0;
    for (const step of steps) {
      const rect = rectOf(step);
      for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1];
        const b = points[index];
        // A segment may touch its own endpoints' boxes only at the anchor.
        if (step === from || step === to) {
          const own = { x0: rect.x0 + PAD, y0: rect.y0 + PAD, x1: rect.x1 - PAD, y1: rect.y1 - PAD };
          if (segmentHits(a, b, { x0: own.x0 + 0.5, y0: own.y0 + 0.5, x1: own.x1 - 0.5, y1: own.y1 - 0.5 })) count += 1;
        } else if (segmentHits(a, b, rect)) count += 1;
      }
    }
    return count;
  }
  function simplify(points) {
    const out = [];
    for (const point of points) {
      const last = out.at(-1);
      if (last && Math.abs(last[0] - point[0]) < 0.01 && Math.abs(last[1] - point[1]) < 0.01) continue;
      out.push(point);
    }
    return out.filter((point, index) => {
      if (index === 0 || index === out.length - 1) return true;
      const a = out[index - 1];
      const b = out[index + 1];
      return !((Math.abs(a[0] - point[0]) < 0.01 && Math.abs(b[0] - point[0]) < 0.01) || (Math.abs(a[1] - point[1]) < 0.01 && Math.abs(b[1] - point[1]) < 0.01));
    });
  }
  function candidates(from, to) {
    const down = to.row > from.row;
    const sameRow = to.row === from.row;
    const right = to.cx > from.cx;
    const sameLane = to.lane === from.lane;
    const out = [];
    const add = (name, fs, ts, via = []) => out.push({ name, fs, ts, points: simplify([anchor(from, fs), ...via, anchor(to, ts)]) });
    const vSide = down ? 'bottom' : 'top';
    const vOpp = down ? 'top' : 'bottom';
    const hSide = right ? 'right' : 'left';
    const hOpp = right ? 'left' : 'right';
    const gutterL = layout.margin - 14;
    const gutterR = lanesRight + 8;
    if (sameLane) {
      add('straight', vSide, vOpp);
      const xl = Math.min(from.x, to.x) - 10;
      add('detour-left', 'left', 'left', [[xl, from.cy], [xl, to.cy]]);
      const xr = Math.max(from.x + from.w, to.x + to.w) + 10;
      add('detour-right', 'right', 'right', [[xr, from.cy], [xr, to.cy]]);
    } else if (sameRow) {
      add('straight', hSide, hOpp);
      const yb = from.y + from.h + 16;
      add('detour-below', 'bottom', 'bottom', [[from.cx, yb], [to.cx, yb]]);
    } else {
      add('side-first', hSide, vOpp, [[to.cx, from.cy]]);
      add('down-first', vSide, hOpp, [[from.cx, to.cy]]);
      add('side-first-far', hSide, vOpp, [[to.cx, from.cy]]);
      add('gutter-left', 'left', 'left', [[gutterL, from.cy], [gutterL, to.cy]]);
      add('gutter-right', 'right', 'right', [[gutterR, from.cy], [gutterR, to.cy]]);
    }
    return out;
  }
  const routed = edges.map((edge) => {
    const from = stepById.get(edge.from);
    const to = stepById.get(edge.to);
    let list = candidates(from, to);
    if (edge.route === 'side-first') list = list.filter((c) => c.name.startsWith('side-first'));
    if (edge.route === 'down-first') list = list.filter((c) => c.name === 'down-first');
    if (edge.fromSide) list = list.filter((c) => c.fs === edge.fromSide);
    if (edge.toSide) list = list.filter((c) => c.ts === edge.toSide);
    if (!list.length) {
      fail('swimlane/route-unsupported', `Edge ${edge.index} ("${from.id}" to "${to.id}") asks for a route or sides that no candidate route offers.`,
        { path: `/edges/${edge.index}` }, { route: edge.route ?? null, fromSide: edge.fromSide ?? null, toSide: edge.toSide ?? null },
        ['Remove route, fromSide and toSide to let the renderer choose.', 'Pick sides that match the steps\' relative position.']);
      return { edge, from, to, name: 'none', points: [anchor(from, 'bottom'), anchor(to, 'top')], hits: 0 };
    }
    let best = null;
    for (const candidate of list) {
      const hits = collisions(candidate.points, from, to);
      if (hits === 0) { best = { ...candidate, hits }; break; }
      if (!best || hits < best.hits) best = { ...candidate, hits };
    }
    return { edge, from, to, ...best };
  });
  for (const route of routed) {
    if (route.hits > 0) {
      fail('swimlane/route-blocked', `Edge ${route.edge.index} ("${route.from.id}" to "${route.to.id}") cannot avoid crossing a step.`,
        { path: `/edges/${route.edge.index}` }, { from: route.from.id, to: route.to.id, crossings: route.hits },
        ['Move a step to another lane or row so the route is clear.', 'Set route to "side-first" or "down-first", or fromSide and toSide.']);
    }
  }
  if (problems.length) throwDiagnosticProblems('Swimlane validation failed', problems, { code: 'swimlane/route', subject: { diagramType: 'swimlane' }, diagnostics: details });

  // ---- Edge labels ---------------------------------------------------------------
  const labelRects = [];
  const labelW = (text) => Math.ceil(textWidth(text, layout.edgeFont) + 12);
  const stepRects = steps.map(rectOf);
  const rectHitsRect = (a, b) => a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1;
  for (const route of routed) {
    if (!route.edge.label) continue;
    const width = labelW(route.edge.label);
    const segments = route.points.slice(1).map((p, i) => ({ a: route.points[i], b: p, length: Math.hypot(p[0] - route.points[i][0], p[1] - route.points[i][1]) }));
    const ordered = segments.map((s, i) => ({ ...s, i })).sort((x, y) => y.length - x.length);
    let chosen = null;
    for (const segment of ordered) {
      const horizontal = Math.abs(segment.a[1] - segment.b[1]) < 0.01;
      for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) {
        const cx = segment.a[0] + (segment.b[0] - segment.a[0]) * t;
        const cy = segment.a[1] + (segment.b[1] - segment.a[1]) * t;
        const rect = { x0: cx - width / 2, x1: cx + width / 2, y0: cy - 9, y1: cy + 9 };
        void horizontal;
        if (segment.length < (horizontal ? width + 8 : 26) && !chosen) continue;
        if (stepRects.some((r) => rectHitsRect(rect, { x0: r.x0 + PAD, y0: r.y0 + PAD, x1: r.x1 - PAD, y1: r.y1 - PAD }))) continue;
        if (labelRects.some((r) => rectHitsRect(rect, r))) continue;
        const clear = { x0: rect.x0 - 6, x1: rect.x1 + 6, y0: rect.y0 - 6, y1: rect.y1 + 6 };
        if (routed.some((other) => other !== route && other.points.slice(1).some((p, i) => segmentHits(other.points[i], p, clear)))) continue;
        chosen = { cx, cy, rect };
        break;
      }
      if (chosen) break;
    }
    if (!chosen) {
      const s = ordered[0];
      const cx = (s.a[0] + s.b[0]) / 2;
      const cy = (s.a[1] + s.b[1]) / 2;
      chosen = { cx, cy, rect: { x0: cx - width / 2, x1: cx + width / 2, y0: cy - 9, y1: cy + 9 } };
    }
    labelRects.push(chosen.rect);
    route.label = { ...chosen, width };
  }

  // ---- Legend & canvas -----------------------------------------------------------
  const TYPE_ORDER = ['frontend', 'backend', 'security', 'database', 'cloud', 'messagebus', 'external'];
  const presentTypes = new Set(steps.map((step) => step.type));
  const legendEntries = resolveLegend(sl.meta.legend, TYPE_ORDER.map((kind) => ({ kind, label: i18nText(locale, `legend.swimlane.${kind}`), tone: kind, interactive: false })), presentTypes);
  const width = Math.ceil(descX + layout.descW + layout.margin);
  const footprint = legendFootprint(legendEntries, { width: width - layout.margin * 2, fontSize: 11 });
  const height = Math.ceil(bodyBottom + layout.margin + (legendEntries.length ? 34 + footprint.extraHeight : 0));

  // ---- Rendering -----------------------------------------------------------------
  const f = (n) => Math.round(n * 100) / 100;
  function roundedPath(points, radius = 8) {
    let r = radius;
    for (let i = 1; i < points.length; i += 1) {
      const len = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      const corners = (i > 1 ? 1 : 0) + (i < points.length - 1 ? 1 : 0);
      if (corners) r = Math.min(r, Math.max(0, (len - 8) / corners));
    }
    if (points.length < 3 || r < 1) return points.map((p, i) => `${i ? 'L' : 'M'} ${f(p[0])} ${f(p[1])}`).join(' ');
    let d = `M ${f(points[0][0])} ${f(points[0][1])}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const [px, py] = points[i - 1];
      const [cx, cy] = points[i];
      const [nx, ny] = points[i + 1];
      const l1 = Math.hypot(cx - px, cy - py);
      const l2 = Math.hypot(nx - cx, ny - cy);
      const a = [cx - ((cx - px) / l1) * r, cy - ((cy - py) / l1) * r];
      const b = [cx + ((nx - cx) / l2) * r, cy + ((ny - cy) / l2) * r];
      d += ` L ${f(a[0])} ${f(a[1])} Q ${f(cx)} ${f(cy)} ${f(b[0])} ${f(b[1])}`;
    }
    const last = points.at(-1);
    return `${d} L ${f(last[0])} ${f(last[1])}`;
  }

  function renderLanes() {
    const out = [];
    for (const [index, lane] of lanes.entries()) {
      const x = layout.margin + index * layout.laneW;
      const exception = lane.variant === 'exception';
      out.push(`        <rect x="${x}" y="${layout.top}" width="${layout.laneW}" height="${bodyBottom - layout.top}" class="sl-lane sl-lane-${index % 2}${exception ? ' sl-lane-exception' : ''}"/>`);
      const lines = wrap(lane.label, layout.laneW - 14, 12.5, 700).slice(0, 2);
      out.push(`        <text x="${x + layout.laneW / 2}" y="${layout.top + (lines.length > 1 ? 18 : 25)}" class="${exception ? 't-security' : 't-primary'}" font-size="12.5" font-weight="700" text-anchor="middle" data-swimlane-lane="${esc(lane.id)}">${lines.map((line, i) => `<tspan x="${x + layout.laneW / 2}" dy="${i ? 15 : 0}">${esc(line)}</tspan>`).join('')}</text>`);
    }
    out.push(`        <line x1="${layout.margin}" x2="${lanesRight}" y1="${bodyTop}" y2="${bodyTop}" class="sl-rule"/>`);
    return out.join('\n');
  }
  function renderRowGrid() {
    const out = [];
    for (let row = 1; row < maxRow; row += 1) {
      const y = rowTop.get(row + 1);
      out.push(`        <line x1="${layout.margin}" x2="${descX + layout.descW}" y1="${y}" y2="${y}" class="sl-row-rule"/>`);
    }
    return out.join('\n');
  }
  const descBoxes = [];
  function renderDescriptions() {
    const title = sl.layout?.descriptionTitle ?? i18nText(locale, 'swimlane.description');
    const out = [`        <line x1="${descX - 8}" x2="${descX - 8}" y1="${layout.top}" y2="${bodyBottom}" class="sl-rule"/>`,
      `        <text x="${descX}" y="${layout.top + 25}" class="t-primary" font-size="12.5" font-weight="700">${esc(title)}</text>`];
    for (let row = 1; row <= maxRow; row += 1) {
      let y = rowTop.get(row) + 18;
      const blockH = steps.filter((s) => s.row === row).reduce((sum, s) => sum + s.paragraphs.reduce((i, p) => i + p.lines.length * 16.5 + p.system.length * 14.5 + 8, 0), 0);
      y = rowTop.get(row) + Math.max(14, (rowH.get(row) - blockH) / 2 + 12);
      for (const step of steps.filter((s) => s.row === row)) {
        for (const p of step.paragraphs) {
          const prefixW = p.prefix ? textWidth(`${p.prefix} `, layout.descFont, 700) : 0;
          const lines = p.lines.length ? p.lines : [''];
          const boxTop = y - layout.descFont;
          out.push(`        <g data-swimlane-description="${esc(p.stepId)}">`);
          lines.forEach((line, i) => {
            const first = i === 0 && p.prefix ? `<tspan font-weight="700">${esc(p.prefix)}</tspan><tspan dx="4">${esc(line)}</tspan>` : esc(line);
            out.push(`          <text x="${f(descX + (i === 0 ? 0 : prefixW))}" y="${f(y + i * 16.5)}" class="t-primary" font-size="${layout.descFont}">${first}</text>`);
          });
          y += lines.length * 16.5;
          p.system.forEach((line, i) => out.push(`          <text x="${f(descX + prefixW)}" y="${f(y + i * 14.5 - 1)}" class="t-muted" font-size="${layout.systemFont}">${esc(line)}</text>`));
          y += p.system.length * 14.5 + 8;
          descBoxes.push({ id: p.stepId, x: f(descX), y: f(boxTop), width: layout.descW - 30, height: f(y - 8 - boxTop + 4) });
          out.push('        </g>');
        }
      }
    }
    return out.join('\n');
  }
  function renderEdge(route, order) {
    const { edge } = route;
    const [cls, marker] = arrowClassMap[edge.variant || 'default'] || arrowClassMap.default;
    const strokeWidth = edge.variant === 'emphasis' ? 1.8 : 1.4;
    return `        <path ${focusEdgeAttrs(edge.from, edge.to, edge.label, edge.index, edge.id)} data-swimlane-route="${route.name}" d="${roundedPath(route.points)}" class="${cls}"${animateAttr(sl.meta, 'edge', order)} stroke-width="${strokeWidth}" fill="none" marker-end="url(#${marker})"/>`;
  }
  function renderEdgeLabel(route) {
    const { edge, label } = route;
    if (!edge.label || !label) return '';
    return `        <g data-detail="context" ${focusEdgeAttrs(edge.from, edge.to, edge.label, edge.index, edge.id)}>
            <rect x="${f(label.cx - label.width / 2)}" y="${f(label.cy - 9)}" width="${label.width}" height="16" rx="4" class="c-mask"/>
            <text x="${f(label.cx)}" y="${f(label.cy + 3.5)}" class="${!edge.variant || edge.variant === 'default' ? 't-muted' : edgeLabelAccent(edge.variant)}" font-size="${layout.edgeFont}" text-anchor="middle">${esc(edge.label)}</text>
          </g>`;
  }
  function renderStep(step, order) {
    const fill = componentFill[step.type] || 'c-external';
    const lanesLabel = lanes[step.lane].label;
    const passport = { kind: step.type, sublabel: step.system || undefined, tag: step.tag, context: lanesLabel };
    const shape = step.shape === 'decision'
      ? `<polygon points="${f(step.cx)},${f(step.y)} ${f(step.x + step.w)},${f(step.cy)} ${f(step.cx)},${f(step.y + step.h)} ${f(step.x)},${f(step.cy)}" class="${fill}"${animateAttr(sl.meta, 'node', order)} stroke-width="1.5" stroke-linejoin="round"/>`
      : `<rect x="${f(step.x)}" y="${f(step.y)}" width="${step.w}" height="${step.h}" rx="9" class="${fill}"${animateAttr(sl.meta, 'node', order)} stroke-width="1.5"/>`;
    const mask = step.shape === 'decision'
      ? `<polygon points="${f(step.cx)},${f(step.y)} ${f(step.x + step.w)},${f(step.cy)} ${f(step.cx)},${f(step.y + step.h)} ${f(step.x)},${f(step.cy)}" class="c-mask"/>`
      : `<rect x="${f(step.x)}" y="${f(step.y)}" width="${step.w}" height="${step.h}" rx="9" class="c-mask"/>`;
    const rows = step.labelLines.length + step.tagLines.length;
    const textH = step.labelLines.length * layout.lineH + step.tagLines.length * 13;
    let y = step.cy - textH / 2 + layout.labelFont;
    const accent = { frontend: 't-frontend', backend: 't-backend', database: 't-database', cloud: 't-cloud', security: 't-security', messagebus: 't-messagebus', external: 't-muted' }[step.type] || 't-muted';
    const label = step.labelLines.map((line, i) => `<text ${i === 0 ? 'data-node-label="" ' : ''}x="${f(step.cx)}" y="${f(y + i * layout.lineH - 1)}" class="t-primary" font-size="${layout.labelFont}" font-weight="700" text-anchor="middle">${esc(line)}</text>`).join('\n          ');
    y += step.labelLines.length * layout.lineH - 2;
    const tag = step.tagLines.map((line, i) => `<text data-detail="fine" x="${f(step.cx)}" y="${f(y + 2 + i * 13)}" class="${accent}" font-size="${layout.tagFont}" text-anchor="middle">${esc(line)}</text>`).join('\n          ');
    void rows;
    return `        <g ${focusNodeAttrs(step.id, step.label, passport, locale)} data-swimlane-lane="${esc(lanes[step.lane].id)}" data-swimlane-row="${step.row}" data-swimlane-shape="${step.shape}">
            ${focusNodeTitle(step.label, passport)}
            ${mask}
            ${shape}
            ${label}${tag ? `\n          ${tag}` : ''}
          </g>`;
  }
  function legendSwatch(entry) {
    return `<rect x="${entry.x}" y="${entry.baseline - 9}" width="14" height="10" rx="2.5" class="${componentFill[entry.kind] || 'c-external'}" stroke-width="1.2"/>`;
  }

  function renderSvg() {
    return `      <svg viewBox="0 0 ${width} ${height}" ${svgRootAttrs(sl.meta)} data-motion-choreography="replay" data-swimlane-ui="" data-reader-fit="width-first" data-reader-min-text="7.5">
  ${svgAccessibleText(sl.meta, 'swimlane')}
  ${renderDefinitions()}
          <style>
            svg[data-swimlane-ui] .sl-lane { fill: var(--lane-fill); stroke: var(--lane-stroke); stroke-width: 1; }
            svg[data-swimlane-ui] .sl-lane-0 { fill-opacity: .55; }
            svg[data-swimlane-ui] .sl-lane-1 { fill-opacity: .95; }
            svg[data-swimlane-ui] .sl-lane-exception { stroke: var(--security-stroke); stroke-dasharray: 5 4; }
            svg[data-swimlane-ui] .sl-rule { stroke: var(--lane-stroke); stroke-width: 1; }
            svg[data-swimlane-ui] .sl-row-rule { stroke: var(--lane-stroke); stroke-width: 1; stroke-dasharray: 2 5; opacity: .75; }
            svg[data-swimlane-ui] [data-node-id] > rect, svg[data-swimlane-ui] [data-node-id] > polygon { filter: none; }
          </style>

          <!-- Background Grid -->
          <rect width="100%" height="100%" fill="url(#grid)" />

          <!-- Lanes: one column per role -->
  ${renderLanes()}
  ${renderRowGrid()}

          <!-- Relationships -->
  ${routed.map(renderEdge).join('\n')}
  ${routed.map(renderEdgeLabel).filter(Boolean).join('\n')}

          <!-- Steps, top to bottom -->
  ${steps.map(renderStep).join('\n')}

          <!-- Step descriptions, aligned to their rows -->
  ${renderDescriptions()}

          <!-- Legend -->
  ${legendEntries.length ? renderResolvedLegend({ entries: legendEntries, locale, layout: { x: layout.margin, baselineY: height - 16, width: width - layout.margin * 2, fontSize: 11, minTitleY: bodyBottom + 8, diagramType: 'swimlane' }, renderSwatch: legendSwatch }) : ''}
        </svg>`;
  }

  function buildLayoutReport() {
    return {
      diagram_type: 'swimlane',
      viewBox: [width, height],
      lanes: lanes.map((lane, index) => ({ id: lane.id, x: layout.margin + index * layout.laneW, width: layout.laneW })),
      rows: [...rowH].map(([row, h]) => ({ row, top: rowTop.get(row), height: h })),
      top: layout.top,
    headerBottom: bodyTop,
    bodyBottom,
    lanesRight,
    descriptionX: descX,
    descriptions: descBoxes,
    steps: steps.map((s) => ({ id: s.id, lane: lanes[s.lane].id, row: s.row, shape: s.shape, x: s.x, y: s.y, width: s.w, height: s.h })),
      edges: routed.map((r) => ({ index: r.edge.index, from: r.from.id, to: r.to.id, route: r.name, points: r.points })),
    };
  }
  return { svg: renderSvg(), report: buildLayoutReport(), width, height };
}
