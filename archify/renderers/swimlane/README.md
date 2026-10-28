# Vertical Swimlane Renderer

Render `diagram_type: "swimlane"` JSON files into the standard Archify HTML template.
Use it for business and operating procedures: one vertical lane per role, steps
numbered from top to bottom, decision diamonds, and a description column beside
each row.

```bash
node archify/renderers/swimlane/render-swimlane.mjs input.swimlane.json output.html
```

`--layout-json` prints lane, row, step and route geometry instead of HTML.

## Input

```json
{
  "schema_version": 1,
  "diagram_type": "swimlane",
  "meta": { "title": "Order fulfilment", "output": "order.html" },
  "lanes": [{ "id": "sales", "label": "Sales" }, { "id": "wh", "label": "Warehouse" }],
  "steps": [
    { "id": "check", "lane": "sales", "shape": "decision", "label": "1. In stock?", "description": "Sales checks stock." },
    { "id": "ship", "lane": "wh", "label": "2. Ship", "description": "Pick, pack and ship.", "system": "Delivery note" }
  ],
  "edges": [{ "from": "check", "to": "ship", "label": "yes" }]
}
```

Steps take the row below the previous step unless `row` is set. A step has a
`type` (the same component tones as other modes; decisions default to
`security`), optional `tag`, `description`, `system` and `number` (read from a
leading `1.` in the label when omitted). A lane with `variant: "exception"` is
drawn with a dashed border for returns and failure paths.

`layout.laneWidth`, `layout.descriptionWidth` and `layout.descriptionTitle` tune
the columns.

## Routing

Edges try orthogonal routes from simplest to most detoured: straight, side-first,
down-first, then detours or outer gutters. The first route that crosses no step
wins. `route` (`side-first`, `down-first`), `fromSide` and `toSide` narrow the
choices. Edge labels are placed on a segment clear of steps, other labels and
other routes.

| Code | Refused input |
| --- | --- |
| `swimlane/duplicate-id` / `swimlane/duplicate-lane` | an id declared twice |
| `swimlane/unknown-lane` / `swimlane/unknown-step` | a lane or step that is not declared |
| `swimlane/cell-conflict` | two steps in the same lane and row |
| `swimlane/self-edge` | an edge from a step to itself |
| `swimlane/route-blocked` | no route avoids crossing a step |
| `swimlane/route-unsupported` | `route`, `fromSide` or `toSide` that no candidate route offers |

## Visual editor

`editor/swimlane-editor.html` is a single-file, offline editor for the same JSON
(`__SEED__` in the file is replaced with the diagram). Open it in a browser to:

- drag a step to another lane or row (Shift inserts a new row; a occupied cell swaps);
- add steps and decision diamonds below the selected step, optionally auto-linked;
- drag the blue handle under a step onto another step to draw an arrow, or use the
  link mode button; double-click edits labels;
- select an arrow and drag either end onto a step (or a side of it) to re-route it;
- drag a lane header to reorder lanes, use the + and x on a header to add or delete a lane;
- double-click a description to edit it in place; the side panel edits description,
  system, tag, shape, colour and lane;
- undo/redo, renumber labels, export JSON, SVG, or a working copy of the editor
  that opens with the current process.

Export the JSON and run `archify finalize swimlane` for the checked showcase HTML.
The editor's own routing is a lightweight preview and may stack parallel lines.
