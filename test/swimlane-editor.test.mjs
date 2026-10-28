import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const dir = new URL('../tools/swimlane-editor/', import.meta.url);
const built = fs.readFileSync(new URL('swimlane-editor.html', dir), 'utf8');
const source = fs.readFileSync(new URL('swimlane-editor.src.html', dir), 'utf8');

test('swimlane editor source keeps its seed and bundle slots', () => {
  assert.match(source, /<script id="seed" type="application\/json">__SEED__<\/script>/);
  assert.match(source, /\/\*__ARCHIFY_BUNDLE__\*\//);
});

test('built swimlane editor is one offline file whose scripts parse', () => {
  assert.doesNotMatch(built, /<script[^>]+src=/);
  assert.doesNotMatch(built, /__SEED__|__ARCHIFY_BUNDLE__/);
  const scripts = [...built.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
});

test('built swimlane editor bundles the shared renderer', () => {
  const [bundle] = [...built.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const sandbox = { URL, URLSearchParams, TextEncoder, TextDecoder, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${bundle}\nglobalThis.ArchifyBrowser = ArchifyBrowser;`, sandbox);
  const diagram = JSON.parse(fs.readFileSync(new URL('../../archify/examples/order-fulfilment.swimlane.json', dir), 'utf8'));
  const { html, report } = sandbox.ArchifyBrowser.buildPage(diagram);
  assert.match(html, /^<!DOCTYPE html>/i);
  assert.equal(report.steps.length, diagram.steps.length);
  assert.equal(report.descriptions.length, diagram.steps.length);
});
