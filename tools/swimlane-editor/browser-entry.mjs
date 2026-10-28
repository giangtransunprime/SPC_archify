// Browser entry for the swimlane editor. It bundles the real swimlane renderer and the
// Archify viewer template, so the editor previews exactly what `archify finalize` produces.
import template from '../../archify/assets/template.html';
import { softwareNoticesHtml } from '../../archify/renderers/shared/software-notices.mjs';
import { applyTemplate, renderCards } from '../../archify/renderers/shared/utils.mjs';
import { renderSwimlane } from '../../archify/renderers/swimlane/swimlane-core.mjs';

const page = template.replace('</head>', `${softwareNoticesHtml}\n</head>`);

export function buildPage(diagram) {
  const { svg, report } = renderSwimlane(diagram);
  const meta = diagram.meta || {};
  const html = applyTemplate(page, {
    title: meta.title,
    subtitle: meta.subtitle,
    svg,
    cards: renderCards(diagram.cards),
    locale: meta.locale,
    visualPreset: meta.visual_preset || 'classic',
    sourceEvidence: null,
  });
  return { html, report };
}

export function diagnosticsOf(error) {
  const list = error?.archifyDiagnostics || error?.diagnostics;
  if (Array.isArray(list) && list.length) return list.map((d) => d.message || String(d));
  return [String(error?.message || error)];
}
