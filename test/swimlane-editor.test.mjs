import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../archify/renderers/swimlane/editor/swimlane-editor.html', import.meta.url), 'utf8');

test('swimlane editor is one self-contained file with a seed slot', () => {
  assert.match(html, /<script id="seed" type="application\/json">__SEED__<\/script>/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+href=/);
});

test('swimlane editor script parses', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0]));
});
