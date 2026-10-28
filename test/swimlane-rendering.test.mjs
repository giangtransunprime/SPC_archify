import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../archify/', import.meta.url));
const renderer = path.join(root, 'renderers/swimlane/render-swimlane.mjs');
const example = JSON.parse(fs.readFileSync(path.join(root, 'examples/order-fulfilment.swimlane.json'), 'utf8'));

function run(diagram, extra = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-swimlane-'));
  const input = path.join(directory, 'input.json');
  const output = path.join(directory, 'out.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [renderer, input, output, ...extra], { encoding: 'utf8' });
  return { result, output, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
const clone = () => JSON.parse(JSON.stringify(example));

test('swimlane: the shipped example renders vertical lanes with step descriptions', (t) => {
  const { result, output, cleanup } = run(clone());
  t.after(cleanup);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /data-swimlane-ui/);
  assert.equal((html.match(/data-swimlane-description="/g) || []).length, example.steps.length);
  assert.match(html, /data-swimlane-shape="decision"/);
});

test('swimlane: layout report places each lane in its own column and each step in its own row', (t) => {
  const { result, cleanup } = run(clone(), ['--layout-json']);
  t.after(cleanup);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.diagram_type, 'swimlane');
  const laneX = new Map(report.lanes.map((lane) => [lane.id, lane.x]));
  for (const step of report.steps) {
    const lane = report.lanes.find((candidate) => candidate.id === step.lane);
    assert.ok(step.x >= laneX.get(step.lane) && step.x + step.width <= lane.x + lane.width, `${step.id} stays inside its lane`);
  }
  const rows = report.steps.map((step) => step.row);
  assert.deepEqual(rows, [...rows].sort((a, b) => a - b), 'rows follow step order');
  for (const edge of report.edges) assert.ok(edge.points.length >= 2);
});

test('swimlane: a step in an undeclared lane and a cell conflict are refused with named codes', (t) => {
  const bad = clone();
  bad.steps[1].lane = 'nowhere';
  const first = run(bad);
  t.after(first.cleanup);
  assert.notEqual(first.result.status, 0);
  assert.match(first.result.stderr, /swimlane\/unknown-lane|not declared/);

  const clash = clone();
  clash.steps[1].lane = clash.steps[0].lane;
  clash.steps[1].row = 1;
  const second = run(clash);
  t.after(second.cleanup);
  assert.notEqual(second.result.status, 0);
  assert.match(second.result.stderr, /share lane/);
});

test('swimlane: an edge that cannot avoid a step is refused instead of drawn through it', (t) => {
  const blocked = {
    schema_version: 1, diagram_type: 'swimlane',
    meta: { title: 'Blocked', output: 'blocked.html' },
    lanes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    steps: [
      { id: 's1', lane: 'a', label: 'One' },
      { id: 's2', lane: 'a', label: 'Two' },
      { id: 's3', lane: 'a', label: 'Three' },
    ],
    edges: [{ from: 's1', to: 's3', fromSide: 'bottom', toSide: 'top' }],
  };
  const { result, cleanup } = run(blocked);
  t.after(cleanup);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /swimlane\/route-blocked|cannot avoid crossing/);
});
