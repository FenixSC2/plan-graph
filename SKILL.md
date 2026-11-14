---
name: plan-graph
description: >-
  Plan software as an explicit, reviewable graph before code is written: every page, screen,
  modal, CLI command, API endpoint or bot command; every action on it and where each outcome
  leads; and every assumption the agent would otherwise make silently, recorded as decisions
  with alternatives. The user edits it in a local GUI and sends changes back; the plan then
  drives the build and one test per outcome. Use it whenever the user wants to plan, spec or
  design an app, CLI, API, bot, mobile app or sizeable feature before building it; asks what
  every screen, button, route, command or endpoint does and where it goes; wants the assumptions
  or edge cases behind a build written down for sign-off; or wants an existing project's routes,
  pages or commands mapped or audited (dead routes, missing error handling, inconsistent
  responses), even if they never say "graph" or "plan". Also use it when the user mentions the
  plan graph, the graph editor, hitting Send, or a plan-graph/plan.json or changeset.json.
---

# Plan Graph

When an agent builds an app it makes hundreds of small choices nobody asked for: where a
button goes after success, what an error looks like, which exit code a failure returns,
whether a redirect is 301 or 302. Most are fine, a few are wrong, and the user only finds
out by reading code. This skill makes those choices explicit up front.

- **The plan is a graph.** Surfaces (pages, modals, commands, endpoints) are nodes. An
  *interaction* is a trigger on a surface; each of its *outcomes* says, under one
  condition, where you end up and what you observe. Every outcome is a test case.
- **Assumptions are decisions.** Anything a reasonable developer could have chosen
  differently, and the user would notice, is recorded with its alternatives and impact.
- **The user edits, the agent elaborates.** The user reviews in a GUI, changes things,
  sketches new screens, and hits Send. You receive exact operations against stable IDs,
  not prose, so there is nothing to misinterpret.

This costs more planning up front, in exchange for builds that match what the user wanted
the first time. Say so if the user wants something quick and throwaway; for a one-file
script this skill is overkill.

## What's in this skill

Paths below are relative to this skill's directory, written `<skill>`.

| Path | Read it when |
|---|---|
| `schema/plan.ts` | Before writing or editing any plan. It is the format, with comments on every field. |
| `schema/changeset.ts` | If you need the exact shape of an op. |
| `profiles/{web,cli,api}.json` | When choosing profiles: allowed kinds, required states, the decision checklist. |
| `examples/link-shortener/plan.json` | Before drafting your first plan: a complete web + API + CLI plan. Match its style. |
| `references/authoring.md` | When drafting or elaborating: IDs, granularity, outcomes, decisions, impact. |
| `references/retroactive.md` | When documenting an existing codebase. |
| `scripts/plan.ts` | The CLI you run (below). |
| `scripts/build.ts` | Import it in a script to write or edit `plan.json`. Read its header comment for the API. |
| `gui/` | The review GUI. You start it with the CLI; you don't need to read its code. |
| `DESIGN.md` | Background on why the model is shaped this way. Optional. |

### The CLI

Run it as `node --experimental-strip-types <skill>/scripts/plan.ts <command> <plan.json>`
(Node 22.6+). Below, `pg` stands for that whole prefix; shell aliases don't persist
between commands, so write it out each time.

| Command | Does |
|---|---|
| `pg lint <plan>` | Errors (block review), warnings (likely gaps), info (unanswered checklist items, sketches). Exit 1 on errors. |
| `pg outline <plan>` | Compact text view of the whole graph. Use it instead of re-reading the JSON. |
| `pg serve <plan> [--port N]` | Starts the GUI (default port 5199). Run it in the background. |
| `pg wait <plan> [--timeout S]` | Blocks until the user sends, then prints the changeset. Exit 2 on timeout. |
| `pg show <plan>` | Prints the pending changeset, labelled, with your to-do list. |
| `pg apply <plan> [--rebase]` | Applies the changeset's ops to `plan.json`. The GUI shows "waiting for agent" and holds off until `done`. |
| `pg done <plan>` | Lints, then releases the plan to the GUI. Refuses if there are lint errors. |
| `pg tests <plan>` | The test matrix: one case per outcome, grouped by test target. |

The first `serve` on a machine needs the GUI's dependencies:
`npm install --prefix <skill>/gui`.

## Where the plan lives

In the user's project, at `plan-graph/plan.json`. It is a project artifact: commit it.
`changeset.json` and `changeset.applying.json` appear next to it during review and are
transient; suggest adding `plan-graph/changeset*.json` to `.gitignore`.

## Workflow

```
forward:     request  → draft plan.json (all agent/proposed) ─┐
retroactive: codebase → extract plan.json (code, built, sources)┤
                                                              ▼
                            lint → GUI review → apply changeset → elaborate → lint ─┐
                                      ▲                                             │
                                      └──────────── until the user is satisfied ────┘
                                                              ▼
                                   implement → one test per outcome → keep plan in sync
```

### 1. Draft the plan (forward mode)

Read `references/authoring.md` and the example plan first. Then:

1. **Pick profiles.** One per platform in the project (`web`, `api`, `cli`). A full-stack
   app uses several in one graph, linked by `calls` effects (a web form calls an API
   interaction) and by outcomes that cross over (an API redirect miss lands on a web page).
2. **List every surface**, including the unglamorous ones: not-found pages, confirmation
   modals, error toasts, `--help` output, webhooks. Set `entryPoints`.
3. **Add interactions and outcomes.** Anything that can fail needs at least two outcomes;
   most need three or four (validation, conflict, network/server error, permission).
   Write `when` as a test precondition and `result` as what a test would assert.
4. **Answer the decision checklist** of every profile you use, each as a decision with
   `checklistKey`. Then record every other assumption you made along the way. Give
   each one alternatives, a one-line rationale and an impact.
5. Mark everything `{ "origin": "agent", "status": "proposed" }`, write
   `plan-graph/plan.json`, and run `pg lint` until there are no errors. Fix warnings or
   accept them deliberately (mark a surface `terminal` when a dead end is intended).

Don't hand-write the JSON or a generator from scratch: a plan has hundreds of items, each
with meta. Write a short script that imports `<skill>/scripts/build.ts` (see "Writing and
editing plan.json" below).

When the user asked for a feature in an existing codebase, extract the area it touches
first (step 1 of retroactive mode, scoped), then plan the feature on top with
`built: "no"`.

### 1′. Extract the plan (retroactive mode)

Read `references/retroactive.md`. In short: detect profiles from the stack, extract what
exists with `origin: "code"`, `built: "yes"` and `sources`, record the decisions the code
made implicitly, lint, and report lint warnings to the user as findings about their code.
Don't fix them.

### 2. Review in the GUI

1. Start the GUI in the background: `pg serve <abs path to plan.json>`. Before starting
   another, check whether one is already running for this plan
   (`curl -s localhost:5199/api/status`). Leave it running between rounds.
2. Tell the user it's at http://localhost:5199 and where to start. Name the three to six
   highest-impact proposed decisions in a sentence each, so they aren't facing 150 items
   cold. Mention that they can click anything to edit it. They can drag arrows to
   retarget them, add surfaces or actions (ticking "needs detail" when they want you to
   fill it in), leave a note on any item, and press **Send** when done.
3. Wait for the send: run `pg wait <plan>` in the background, so you're notified when it
   exits, and end your turn. If you can't run background commands, ask the user to tell
   you once they've sent, then run `pg show`.

If the user answers in chat instead of in the GUI, apply what they say to `plan.json`
directly (user-requested changes are `origin: "user", status: "confirmed"`). The GUI
reloads the plan and keeps their unsent edits.

### 3. Apply the changeset

Run `pg apply <plan>`. It applies the structural ops (the GUI already removed dangling
references) and prints every op with readable labels, plus a to-do list. The ops are what
the user decided; your job is what follows from them:

- **Notes** on ops explain intent. Act on the intent, not just the literal change.
  "Drop aliases for v1" on removing an input means the alias-taken outcome, the 409
  response and the CLI flag should go too.
- **Semantic fallout of removals and updates.** Make the follow-on changes and mark them
  `agent/proposed` with a `meta.note` saying why ("removed: only reachable via the alias
  input you deleted"). Don't leave the user's change half-done, and don't make the
  follow-on changes silently confirmed.
- **Sketches** (`status: "sketch"`) are placeholders. Elaborate them: states, elements,
  interactions, outcomes, decisions, inbound links. Everything you add is
  `agent/proposed`; set the sketch item itself to `proposed`, keeping `origin: "user"`.
- **Comments** are notes on items the user didn't change. Tell a question from a request.
  - A **question** ("should stats be private?") gets an answer in chat: what the plan
    does now, the trade-off, and the option you'd pick. Don't redesign the plan to answer
    it. At most, record the answer where the user will see it: add the option as an
    alternative on the relevant decision, or put a one-line `meta.note` on it. Offer the
    bigger change ("Want me to plan secret stats links? It adds a route and a key per
    link.") and make it next round if they say yes. A question is the user thinking out
    loud; new surfaces and decisions they didn't ask for are more to review, not less.
  - A **request** ("add a dark mode toggle here", "this should go to the dashboard")
    is an edit: make it, as `agent/proposed`, with its fallout.
- **Confirmed items** are the user's. `apply` marks every item the user edited as
  confirmed, since they chose that value. Don't change one silently. If something the user
  asked for forces it, change it, set its status back to `proposed`, explain in
  `meta.note`, and point it out in your reply.
- **IDs never change.** Renaming changes `name` or `label`, not `id`.

If `apply` reports a base mismatch, you edited `plan.json` after the user loaded it. Use
`pg apply <plan> --rebase` and tell the user which ops no longer applied.

Then run `pg done <plan>`. The GUI reloads, marks what you changed with a blue dot, and
reapplies anything the user edited meanwhile. In chat, summarize what you did beyond
their literal edits, answer their comments, and list anything you need them to decide.
Then go back to waiting (step 2.3).

### 4. Know when planning is done

The plan is ready when there are no sketches, no high-impact `proposed` decisions, and no
lint errors, and the user agrees. Low-impact proposals don't need individual review; the
user can confirm them in bulk with "Confirm all shown" in the Review tab. Ask before
moving on. Don't decide on your own that planning is over.

### 5. Implement from the plan

- Build surface by surface. As items are built, set `meta.built` (`partial` or `yes`) and
  add `meta.sources` (`{ "file": "src/routes/home.tsx", "line": 12 }`).
- **Tests come from outcomes.** `pg tests <plan>` lists one case per outcome with
  given/when/then, grouped by test target (Playwright for web, subprocess for CLI, HTTP
  for API). Put the outcome ID in each test's name (`web.home.shorten.invalid: …`) so
  coverage is traceable. The work is done when every outcome has a passing test.
- **Keep the plan true.** If implementation forces a change (a library can't do what the
  plan says, an edge case nobody modeled), update `plan.json` in the same step as the
  code, as `agent/proposed` with a note. If the change is significant (new surfaces,
  changed destinations, a different decision), stop and run another review round.
  Don't let the code quietly diverge from what the user approved.

## Writing and editing plan.json

`<skill>/scripts/build.ts` does the bookkeeping: outcome IDs from the interaction ID,
meta on every item, `calls` effects, cascading removals, and a lint on save. Write a
script in your scratch space (not the user's source tree), import the module by absolute
path, and run it with `node --experimental-strip-types`:

```ts
import { create, open, src } from "/abs/path/to/skill/scripts/build.ts";

const p = create({ name: "shorty", summary: "Link shortener", profiles: ["web", "api"] });
p.surface({ id: "web.home", profile: "web", kind: "page", name: "Home", address: "/",
  states: ["idle", "submitting", ["error", "Message under the input"]],
  elements: [["web.home.url", "input", "Long URL", { type: "url", required: true }]] });
p.interaction("web.home.shorten", "web.home", ["submit", "Submit the URL", "web.home.url"], [
  ["ok", "API returns 201", "web.result", "Short URL shown and focused"],
  ["invalid", "URL fails validation", "web.home#error", "“Enter a full URL”"],
], { calls: ["api.create-link.request"] });
p.decision({ id: "d.redirect-status", attachedTo: [], question: "…", value: "302",
  alternatives: ["301"], rationale: "…", impact: "high" });
p.entry("web.home");
p.save("plan-graph/plan.json");
```

For follow-on changes after `pg apply`, `open(file)` the plan, then
`p.remove(ref, why)` (cascades like the GUI does) and `p.update(ref, fields, note)` (sets
the item back to `proposed` with your note), then `p.save()`. For extraction, call
`p.defaults({ origin: "code", status: "confirmed", built: "yes" })` and pass
`sources: [src("server.js", 42)]` on each item.

On large plans:

- Use `pg outline` and targeted reads (`jq`, or `open(file).get(ref)`) instead of
  loading the whole JSON repeatedly.
- Never hand-renumber or re-ID items.
- Use `groups` to cluster related surfaces ("Auth", "Checkout", "admin commands").

## Adding a platform

A profile is a JSON file in `<skill>/profiles/`: surface, element and trigger kinds,
`requiredStates`, a `decisionChecklist`, and a `testTarget`. For a platform the existing
profiles don't cover (mobile, desktop, a chat bot, a game menu), write a new profile
modeled on `web.json` and tell the user you did. The checklist is where consistency
comes from, so make it the eight or so questions every project on that platform has to
answer.
