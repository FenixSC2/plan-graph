# Plan Graph GUI

A local graph editor for `plan.json`. You review and edit the agent's plan visually; your
edits are sent back to the agent as a structured changeset.

## Run

```bash
cd gui
npm install
npm run dev                                  # opens the example plan on http://localhost:5199
PLAN=path/to/plan.json npm run dev           # any plan (path relative to the repo root, or absolute)
```

`PROFILES` overrides the profiles directory (default `profiles/`), `PORT` the port.

## What you can do

- **Review**: the Review tab lists unreviewed items, high-impact decisions and sketches
  first. Confirm items one at a time; editing an item also marks it reviewed.
- **Edit**: click any surface, state, element, interaction row, outcome, arrow or decision
  to edit it in the inspector. Decisions let you swap in an alternative with one click.
- **Retarget**: drag an arrow's head onto a different surface.
- **Add**: `+ Surface` (tick "needs detail" to let the agent fill it in), drag from
  "drag to connect" onto a surface to add an interaction, drag from an interaction row's
  handle to add an outcome, add states/elements/interactions from the inspector, or answer
  unanswered profile checklist items from the Decisions tab.
- **Delete**: select something and press Delete. The dialog previews exactly what else
  changes (retarget or remove arrows that led there, detach decisions, …).
- **Comment**: the "Note to agent" box works on any item, changed or not. Unchanged
  items with a note are sent as `comment` ops ("should stats be private?").
- **Send**: everything collects in the Changes tab (each change can be reverted
  individually). Undo/redo with ⌘Z / ⇧⌘Z. Unsent work survives reloads.

## Agent protocol (file-based)

The dev server is the bridge. It exposes `GET /api/plan`, `GET /api/status` and
`POST /api/changeset`. Agents drive it with `scripts/plan.ts` (see `SKILL.md`).

1. **Send** writes `changeset.json` next to `plan.json` (schema: `schema/changeset.ts`).
   Its `base` is the hash of the plan the user edited; the server refuses the send if
   `plan.json` changed in the meantime.
2. `plan.ts apply` renames it to `changeset.applying.json` and applies the ops (same
   `applyOps` as the GUI). While that file exists the GUI shows "waiting for agent", doesn't
   load the half-finished `plan.json`, and refuses new sends; the user can keep editing.
3. The agent handles semantic fallout, elaborates sketches (new items are
   `origin: agent, status: proposed`), and runs `plan.ts done`, which lints and deletes the
   marker.
4. The GUI loads the new plan, marks what the agent changed with a blue dot, and reapplies
   any edits the user made after sending.

Sending again before the agent picks the changeset up overwrites `changeset.json` with a
superset (it's always the full diff from the last plan the agent wrote).

## Layout

| Path | What |
|---|---|
| `planApi.ts` | dev-server API (the agent bridge) |
| `src/model/plan.ts` | indexing, refs, structural cascades |
| `src/model/diff.ts` | changeset = diff(base, edited); `applyOps` (rebase / agent side); per-change revert |
| `src/model/lint.ts` | lint rules from `DESIGN.md` |
| `src/store.ts` | state, undo, drafts, send / poll / rebase loop |
| `src/graph/` | React Flow canvas, surface nodes, dagre layout |
| `src/ui/` | sidebar tabs, inspector, dialogs |
| `scripts/model-test.ts` | `npm test`: diff → apply round-trip, revert, cascade checks |

## Not done yet

- **MCP `review_plan()` tool**: the agent currently waits with `plan.ts wait` in the
  background. A blocking MCP tool would make "Send" return directly into the agent's turn.
- Groups are shown as a label in the inspector, not as collapsible containers on the canvas.
- Node positions are view state kept in the browser (localStorage), not in the plan.
