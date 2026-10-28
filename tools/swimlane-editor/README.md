# Swimlane editor

`swimlane-editor.html` is one offline file: open it in a browser to edit a `swimlane` diagram.

- The preview is the real Archify page, drawn by the same `renderSwimlane` function the CLI uses.
  Editing handles are an overlay on that page; "Đang: Xem" switches to the plain Archify viewer.
- Drag a step to another lane or row (Shift inserts a row; an occupied cell swaps). Drag the blue
  handles around a selected step to draw an arrow, or select an arrow and drag either end to re-route it.
- Drag a lane header to reorder lanes; use × and + on a header to delete or add a lane.
- Double-click a step, arrow, lane or description to edit it in place. The side panel edits the rest.
- A change Archify cannot draw (for example a blocked route) is rolled back with the reason.
- Export JSON (for `archify finalize swimlane`), the Archify page as HTML, or a working copy of the
  editor that opens with the current process.

## Rebuild

```bash
npm i --no-save esbuild
node tools/swimlane-editor/build.mjs
```

`browser-entry.mjs` and `swimlane-editor.src.html` are the sources; the built HTML is committed so the
editor works without a build. Rebuild after changing `archify/renderers/swimlane/swimlane-core.mjs`
or `archify/assets/template.html`. The showcase quality gates (crossing edges, label clearance) still
run only in `archify finalize`.
