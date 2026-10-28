import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiagram, writeDiagram } from '../shared/cli.mjs';
import { renderSwimlane } from './swimlane-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: sl, template, outPath, sourceEvidence } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'swimlane',
  defaultExample: 'order-fulfilment.swimlane.json',
  argv: cliArgs,
});
const { svg, report } = renderSwimlane(sl);

if (layoutJsonMode) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
writeDiagram({
  outPath,
  template,
  diagramType: 'swimlane',
  meta: sl.meta,
  svg,
  cards: sl.cards,
  sourceEvidence,
});
