---
name: plan-graph
description: >-
  Plan or map software as a graph people can read: every page, screen, modal, CLI command, API
  endpoint or bot command; every action on it and where each outcome leads; and every assumption
  the agent would make silently, recorded as decisions with alternatives. A local GUI shows it
  grouped by area, with a group map for big projects; the user edits it and sends changes back,
  and the plan drives the build and one test per outcome. Use it whenever the user wants to plan,
  spec or design an app, CLI, API, bot, mobile app or sizeable feature before building it; asks
  what every screen, button, route, command or endpoint does and where it goes; wants assumptions
  or edge cases written down for sign-off; or wants a large, complex or unfamiliar codebase made
  easy to see and navigate, mapped or audited (dead routes, missing error handling), even if they
  never say "graph" or "plan". Also use it when the user mentions the plan graph, the graph
  editor, hitting Send, the Focus tab, or a JSON file in plan-graph/.
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
- **Changes asked for in chat are proposed, not just made.** You load them into the GUI
  as a proposal: a diff the user can see on the graph, with the decisions it changes and
  the questions it raises, to accept in whole or in part.
- **Questions go in Focus, not at the end of a chat reply.** When you need the user to
  choose, or want them to see something, you put it in the GUI's Focus tab with the
  breakdown: what is true now, the options with pros, cons and what each changes, and your
  pick. They answer there and press Send; you reply in the same item. The review pile holds
  everything unreviewed; Focus holds the few things you and the user are working through.

This costs more planning up front, in exchange for builds that match what the user wanted
the first time. Say so if the user wants something quick and throwaway; for a one-file
script this skill is overkill.

## What's in this skill

Paths below are relative to this skill's directory, written `<skill>`.

| Path | Read it when |
|---|---|
| `schema/plan.ts` | Before writing or editing any plan. It is the format, with comments on every field. |
| `schema/changeset.ts` | If you need the exact shape of an op. |
| `schema/proposal.ts` | If you need the exact shape of a proposal or the user's response to one. |
| `schema/focus.ts` | If you need the exact shape of a focus item or the user's answer to one. |
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
(Node 22.12+). Below, `pg` stands for that whole prefix; shell aliases don't persist
between commands, so write it out each time.

| Command | Does |
|---|---|
| `pg lint <plan>` | Errors (block review), warnings (likely gaps), info (unanswered checklist items, sketches). Exit 1 on errors. |
| `pg outline <plan>` | Compact text view of the whole graph. Use it instead of re-reading the JSON. |
| `pg serve <plan> [--port N]` | Starts the GUI in the background and prints its URL. It reuses an editor already serving this plan, and skips ports held by another plan's editor. |
| `pg wait <plan> [--timeout S]` | Blocks until the user sends, then prints the changeset. Exit 2 on timeout. |
| `pg show <plan>` | Prints the pending changeset, labelled, with your to-do list. |
| `pg apply <plan> [--rebase]` | Applies the changeset's ops to `plan.json`. The GUI shows "waiting for agent" and holds off until `done`. |
| `pg done <plan>` | Lints, then releases the plan to the GUI. Refuses if there are lint errors. |
| `pg proposal <plan> [--withdraw]` | Shows your pending proposal as the GUI sees it, or withdraws it. |
| `pg focus <plan>` | Lists what's in focus: open items first, whose turn each is, the options and the thread. |
| `pg tests <plan>` | The test matrix: one case per outcome, grouped by test target. |

The first `serve` on a machine needs the GUI's dependencies:
`npm install --prefix <skill>/gui`.

## Where the plan lives

In the user's project, at `plan-graph/plan.json`. It is a project artifact: commit it.
`changeset.json`, `changeset.applying.json`, `proposal.json` and `focus.json` appear next
to it during review and are transient; suggest adding `plan-graph/changeset*.json`,
`plan-graph/proposal.json` and `plan-graph/focus.json` to `.gitignore`.

## Workflow

```
forward:     request  → draft plan.json (all agent/proposed) ─┐
retroactive: codebase → extract plan.json (code, built, sources)┤
                                                              ▼
                            lint → GUI review → apply changeset → elaborate → lint ─┐
                                      ▲    ▲                                        │
       chat request → propose ────────┤    └──────── until the user is satisfied ───┘
       your question → focus ─────────┘
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
   **Group them** once there are more than about 15: every surface in exactly one group,
   one group per area a person would name ("Auth", "Checkout", "Admin API"), each with a
   one-line `description`. Groups are how people read a big plan: the GUI draws them as
   labelled regions and opens large plans on a group map. Aim for 5 to 12 groups.
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

1. Start the GUI in the background: `pg serve <abs path to plan.json>`, and read the URL
   it prints. It reuses an editor already serving this plan. If 5199 belongs to another
   project, it moves to the next free port, so don't assume 5199. Leave it running
   between rounds.
2. Tell the user the URL `serve` printed and where to start. Put the three to six
   highest-impact proposed decisions in focus (step 2″) and name them in a sentence each,
   so they aren't facing 150 items cold. On a large plan it opens on the group map: one card per group with what still
   needs review. Point them to the group that matters most, and mention the Map tab. Mention that they can click anything to edit it. They can drag arrows to
   retarget them, add surfaces or actions (ticking "needs detail" when they want you to
   fill it in), leave a note on any item, and press **Send** when done.
3. Wait for the send: run `pg wait <plan>` in the background, so you're notified when it
   exits, and end your turn. If you can't run background commands, ask the user to tell
   you once they've sent, then run `pg show`.

If the user asks for changes in chat instead of in the GUI, propose them (step 2′) rather
than writing them into `plan.json`. Write directly only for a small, unambiguous edit with
no fallout and no decisions involved ("rename Home to Dashboard"), or when the user says
to just do it; mark those `origin: "user", status: "confirmed"`. The GUI reloads the plan
and keeps their unsent edits.

### 2″. Put what needs the user in focus

The Review tab lists every unreviewed item; on a real plan that is hundreds. **Focus** is
the short list you and the user are working through right now, each item with everything
needed to answer it in place. Use it whenever you would otherwise end a chat reply with a
question that needs a breakdown, or bury a finding in a paragraph.

1. `open()` the plan and call `p.focus({...})` per topic. It writes `plan-graph/focus.json`
   straight away (no `save()`); the GUI opens on the Focus tab when something waits there.

   ```ts
   p.focus({
     id: "f.session-storage", kind: "question", impact: "high",
     title: "Which secure storage should the session use?",
     summary: "<why it's in focus and what's at stake, 1–3 sentences>",
     context: ["<what the code or plan does today>", "<a fact that bears on the choice>"],
     refs: ["d.auth.session-storage", "mobile.launch.open"],
     options: [
       { id: "adapter", label: "Encrypted adapter", detail: "<what it means concretely>",
         pros: ["…"], cons: ["…"], changes: "<what it changes in the plan or code>" },
       { id: "keychain", label: "SecureStore with chunking", pros: ["…"], cons: ["…"] },
     ],
     recommended: "adapter", rationale: "<one sentence on why it wins>",
   });
   ```

   - `kind`: `question` (they need to choose), `change` (you suggest something; the options
     are how to go about it, including "not now"), `finding` (they should know; "Got it" is
     an answer).
   - Options are the real alternatives, each with what it means and costs. Don't pad to
     three; two honest options beat a strawman. Put your recommendation in `recommended`
     and say why in `rationale`.
   - Keep it short: about three to six open items, highest impact first. A decision with
     alternatives already lets the user switch in one click, so focus it only when the
     choice needs more than its one-line rationale.
2. Tell the user in a line or two what's in Focus and which item matters most. Then wait
   for the send (step 2.3).
3. When they send, `pg apply` prints each answer (the option they picked, their text,
   and whether they marked it settled) and records it in the item's thread. Then, per item:
   - Act on the answer like a note: make the change it asks for in the plan, with fallout.
   - `p.resolveFocus(id, "<what was decided and where it landed>")` when that settles it.
   - `p.followUp(id, "<your reply>", { options, recommended, rationale })` when the answer
     opens a new question or you need a detail. The user sees your reply under theirs.
   - An answer the user marked settled is never followed up; resolve it.

   Don't leave an answered item open with no reply: the GUI shows it as waiting for you.

A proposal's own questions (step 2′) stay with the proposal; Focus is for topics that
outlive one change, and for questions with no change attached yet.

### 2′. Propose a change the user asked for in chat

The user describes a change in chat ("drop custom aliases", "add team invites", "make
errors toasts"). Instead of editing the plan and summarizing in prose, load it into the
GUI as a **proposal**. They see the diff on the graph, the decisions it changes or puts
in question, and your open questions in one place, and they accept all of it, part of it
or none of it.

1. Write a script: `open()` the plan and make the edits with the usual `PlanBuilder`
   calls, including the fallout (removed outcomes, flags, API fields, other profiles).
   Record what the change implies as decisions: changed answers via `p.update(decision,
   { value })`, new ones via `p.decision(...)`, each with a note. Then call
   `p.propose({...})` **instead of** `p.save()`:

   ```ts
   p.propose({
     title: "Drop custom aliases",                 // short name for the change
     request: "<what the user asked, in their words>",
     summary: "<what it changes and why, 1–3 sentences>",
     questions: [{ id: "q.legacy", question: "What happens to links already created with an alias?",
       options: ["Keep working", "Stop resolving"], recommended: "Keep working",
       why: "<one line on what each answer changes>", refs: ["api.redirect"] }],
   });
   ```

   `propose` leaves `plan.json` alone and writes `plan-graph/proposal.json`. It refuses if
   the result has lint errors, if `plan.json` changed since you opened it, or if the user
   has sent edits you haven't applied yet. It prints the decisions the GUI will list with
   the proposal: the ones it adds, changes or removes, and the ones attached to what it
   touches ("recheck").
2. **Questions** are for what you can't settle without the user and what would change
   the proposal. Give options and a recommendation when there are obvious answers. Don't
   ask what a decision with alternatives already covers; the user can switch those in one
   click. A proposal can be questions only, with no edits.
3. Run `pg serve` (step 2.1) to get this plan's editor URL, then tell the user in one or
   two lines that the proposal is in the **Proposal** tab at that URL, previewed on the
   graph (green = added, pink = changed, struck through = removed), and name the decision
   or question that matters most. Then wait for the send (step 2.3).
4. When they send, `pg show` and `pg apply` print their response first: ops accepted and
   rejected, answers, and their reply. Accepted ops arrive in the changeset as the user's
   own edits, marked confirmed, and `apply` removes `proposal.json`. Leave rejected ops
   out and don't re-propose them unasked. Act on answers and the reply like notes.
   Unanswered questions: ask in chat, or take your recommendation and say so.

Only one proposal is pending at a time. Proposing again replaces it, which is how you
revise one after feedback in chat. `pg proposal <plan> --withdraw` drops it.

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
their literal edits and answer their comments. Anything you need them to decide goes in
focus (step 2″), with a line in chat pointing at it.
Then go back to waiting (step 2.3).

### 4. Know when planning is done

The plan is ready when there are no sketches, no high-impact `proposed` decisions, nothing
open in focus, and no lint errors, and the user agrees. Low-impact proposals don't need individual review; the
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
- Group every surface (see step 1.2). `pg lint` warns when a plan of more than 15
  surfaces has ungrouped ones. Keep groups to areas of the product, not file layout.

## Adding a platform

A profile is a JSON file in `<skill>/profiles/`: surface, element and trigger kinds,
`requiredStates`, a `decisionChecklist`, and a `testTarget`. For a platform the existing
profiles don't cover (mobile, desktop, a chat bot, a game menu), write a new profile
modeled on `web.json` and tell the user you did. The checklist is where consistency
comes from, so make it the eight or so questions every project on that platform has to
answer.
