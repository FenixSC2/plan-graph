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

`npm run dev` is for working on the editor itself. Agents start it with `plan.ts serve`, which
builds the production bundle (only when the sources changed) and serves that instead: React's
development build is several times slower, which large plans feel. `serve` gives each plan one
editor. It reuses the editor already serving that plan (`/api/status` reports `planPath`), and
skips ports held by another plan's editor.

## Large plans

- **Groups.** Surfaces in the same group are laid out together and drawn inside a labelled
  region; the label stays readable at any zoom and zooms to the group when clicked.
- **Group map.** Plans with more than 30 surfaces and at least 3 groups open on the group map:
  one card per group (surfaces by platform, actions, outcomes, open decisions, issues, review
  progress), arranged in flow order, with arrows counting the paths and calls between groups.
  Click a card to open that group. The toolbar switches between the map and all surfaces.
- **Map tab.** The sidebar lists groups and their surfaces with what still needs review.

- Zoomed out below 55% on a plan with more than 30 surfaces, nodes draw as compact cards
  (name, kind, action and outcome counts). Edges drop their labels, and edges between the same
  two surfaces are drawn once. Zoom in to see and edit details.
- Only the nodes in view are rendered (`onlyRenderVisibleElements`).
- On a 91-surface, 668-outcome plan this took first render from 1.65 s to 0.42 s and the page
  from about 7,600 DOM elements to about 3,100 (about 1,200 zoomed in), with 202 edge
  elements instead of 373.

## What you can do

- **Navigate**: scroll or swipe to pan, pinch or ⌘/Ctrl-scroll to zoom (both eased; reduced
  motion is respected). Double-click doesn't zoom.
- **Trace**: select an arrow for a trace bar (source ⟵ condition ⟶ destination; click an end to
  glide there), or a surface to list everything leading in and out, with unrelated edges dimmed.
  `]` follows the selected arrow, `[` walks back along the trail; double-click an arrow to
  follow it.
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
- **Proposals**: when the agent proposes a change, the Proposal tab shows it with a preview on
  the graph. Changes that depend on each other tick and untick together; undoing an accept
  reopens the proposal.

## Agent protocol (file-based)

The dev server is the bridge. It exposes `GET /api/plan`, `GET /api/status`,
`GET /api/proposal` and `POST /api/changeset`. Agents drive it with `scripts/plan.ts` (see `SKILL.md`).

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

**Proposals** go the other way. The agent writes `proposal.json` (schema:
`schema/proposal.ts`, via `PlanBuilder.propose()`) without touching `plan.json`. The GUI
opens a Proposal tab and previews the ops on the canvas. It lists the decisions the proposal
changes or touches and shows the agent's questions. Accepting applies the ticked ops to the
working copy as confirmed user edits. The next Send carries them as normal ops, plus a
`proposal` response (accepted and rejected indices, answers, reply). `plan.ts apply` deletes
`proposal.json`.

## Layout

| Path | What |
|---|---|
| `planApi.ts` | dev-server API (the agent bridge) |
| `src/model/plan.ts` | indexing, refs, structural cascades |
| `src/model/diff.ts` | changeset = diff(base, edited); `applyOps` (rebase / agent side); per-change revert |
| `src/model/lint.ts` | lint rules from `DESIGN.md` |
| `src/model/proposal.ts` | proposal preview / accept, canvas marks, decisions a proposal changes or touches |
| `src/store.ts` | state, undo, drafts, send / poll / rebase loop |
| `src/graph/` | React Flow canvas, surface nodes, dagre layout |
| `src/graph/groups.ts` | group membership, per-group stats, links between groups, grouped layout |
| `src/ui/` | sidebar tabs, inspector, dialogs, proposal tab (`ProposalTab.tsx`) |
| `scripts/model-test.ts` | `npm test`: diff → apply round-trip, revert, cascade checks |

## Not done yet

- **MCP `review_plan()` tool**: the agent currently waits with `plan.ts wait` in the
  background. A blocking MCP tool would make "Send" return directly into the agent's turn.
- Groups are shown as a label in the inspector, not as collapsible containers on the canvas.
- Node positions are view state kept in the browser (localStorage), not in the plan.
