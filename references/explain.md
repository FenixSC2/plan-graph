# Explaining and simplifying an existing codebase

Read `retroactive.md` first; this builds on it. Retroactive mode maps what an app does from
the outside: every page, command and endpoint, and where each outcome leads. That explains
a small app. In a medium or large codebase most of the complexity is inside it: services
calling services, data written in one place and read in another, work handed to a queue and
finished later. This reference adds four things:

1. **Internals on the graph**, with the `internals` profile, so the paths behind a request
   are visible and not just its entry and exit.
2. **Walkthroughs**: the few "what happens when…" paths that explain the codebase, each
   one a Focus item the user can step through.
3. **Answers** to the user's questions, kept with the items they're about.
4. **Simplification behind tests**: what to cut or merge, proposed on the graph and done
   only after tests pin today's behaviour.

Use it when the user wants to understand how a codebase works ("explain this repo", "I
just inherited this", "how does X work", onboarding someone), or wants it simplified,
cleaned up or refactored without changing what it does.

## 1. Scope: skeleton first

A codebase with more than a few dozen surfaces' worth of code, or several services, is
too big to extract in full before the user sees anything. Work in two passes:

1. **Skeleton.** Read entry points, the router, the module layout and the data layer.
   Write the groups, every surface you can see (name, kind, address, a one-line
   `description`, a source), and the main interactions that connect them, with the
   outcome that matters most. Mark surfaces you haven't read in depth `status: "sketch"`
   with `meta.note: "Not read in depth yet"`. Write the walkthroughs (section 3) for what
   you did read. Show the user.
2. **Depth, one group at a time**, starting where the user points or with the group the
   most important walkthrough passes through: every outcome, states, decisions, as
   `retroactive.md` describes. Clear `sketch` as you go.

Tell the user which groups are skeleton only. Lint warnings in those groups (unreachable,
dead end) say "not read yet", not "this is broken", so don't report them as findings
until the group is done.

On a large codebase, read groups in parallel with subagents if you have them: give each
one a group, the files it covers and the IDs it should use, and have it return what it
found (items, outcomes, sources, surprises) as text. Write the plan yourself, in one
script, so IDs and groups stay consistent. Wait for every report before you write the plan
or reply. Run them in the foreground, or keep working until all have come back. A reply
that says "I'll write the map once they're in" is all a user running you
non-interactively will ever see.

## 2. Map the internals

Add the `internals` profile next to the outside-in ones (`web`, `api`, `cli`, `mobile`).
The outside-in surfaces stay the entry points; internals hang off them through `calls`
effects, so following a request from the endpoint to the database is following arrows.

**What earns a node.** The test is whether a reader needs it to follow a walkthrough
without opening the code. Make a surface for:

- a module or service that is called from more than one place or from another group;
- anything that holds state: a table, cache, store or directory of files (`table`,
  `cache`, `file-store`);
- anything that runs later or elsewhere: a job, worker, scheduled task, queue or topic;
- every external service it talks to (`external`: payment provider, email, another
  team's API).

Don't make nodes for helpers, utilities, types, constants or one-caller functions, even
when they have a file of their own. A validator, parser or formatter called from one place
is part of its caller: its failures are the caller's outcomes ("body fails validation →
400"), and a `description` can name the file. A node that exists only because a file
exists is noise: it makes the graph look like a file tree, which the user already has.
Before saving, list the internals surfaces that have exactly one caller and hold no state,
and fold each into its caller unless it is external or runs asynchronously.

**Interactions are the public operations.** For a module, its exported functions or
methods other code calls (`invoke`). For a job, what starts it (`message`, `schedule`,
`event`). For a table, cache or queue, the reads and writes other code does ("insert order",
"mark paid", "look up stock", "enqueue email"), with `read` or `write` triggers; callers
reach them with `calls`. Lint doesn't expect a failure outcome on `read` and `write`,
because what matters is how the caller handles a failed write. Put that outcome on the
caller's `invoke` interaction, where a missing one is flagged. Data flow then shows on
the graph, and lint's reachability check means something: a table nothing writes, or a
job nothing enqueues, is a finding.

**Outcomes are the ways it returns.** A value, a thrown error, an error returned as a
value, a swallowed failure. `when` is the condition; `result` is what the caller sees
("throws OutOfStockError", "returns null", "logs and returns undefined"). `to` is usually
`null`. Set it when control passes somewhere else: a queue delivering to a job lands on
the job.

**Async.** The producer `calls` the queue's enqueue interaction (`write`). The queue's
`deliver` interaction (`message`, or `schedule` for a worker that polls) `calls` the consumer's handler, with an outcome for each
way delivery can fail: retried, dead-lettered, dropped. Dropped work with no outcome
saying so is the most common thing people don't know about their own code.

**Addresses** say where it lives: `src/orders/service.ts#placeOrder`, `table:orders`,
`queue:emails`, `https://api.payments.example`.

**Groups.** An internal surface goes in the group of the product area that owns it.
Shared infrastructure (the database, a queue used everywhere, external services) gets its
own group ("Data", "Background jobs", "External services").

Answer the `internals` decision checklist like any other. Its questions (boundaries,
where state lives, how errors travel, what happens when async work fails) are the ones a
newcomer can't answer from any single file.

## 3. Walkthroughs: "what happens when…"

A graph shows everything at once; people learn a codebase one path at a time. Pick the
three to six paths that explain this one:

- the main thing users do (placing an order, sending a message);
- the path money or important data takes;
- the asynchronous path (what runs after the response is sent);
- the riskiest path (auth, payments, deletes);
- any path the user asked about.

Write each as a Focus `finding` with the steps in order:

```ts
p.focus({
  id: "f.walk.place-order", kind: "finding", impact: "high",
  title: "What happens when someone places an order",
  summary: "POST /orders reserves stock, charges the card, saves the order and queues the confirmation email. The email is sent later by a worker.",
  context: [
    "1. POST /orders (src/server.js:24) validates the body and calls placeOrder.",
    "2. placeOrder (src/orders/service.js:12) reserves stock first: inventory.reserve decrements each item.",
    "3. It charges the card through the payments client (src/payments/client.js:8). If the charge is declined it throws PaymentDeclined. ⚠ The stock reserved in step 2 is never released.",
    "4. …",
  ],
  refs: ["api.orders.create", "int.orders.place", "int.inventory.reserve", "int.payments.charge", "int.db.orders.insert", "int.queue.enqueue", "int.jobs.confirm"],
});
```

- **`refs` in path order**, so the user can click through the path step by step.
- **One step per hop**, naming the item and its `file:line`. Say what is passed or written
  when it matters.
- **Surprises in the step where they happen**, marked ⚠: a failure that isn't handled, a
  write that isn't undone, a config value that silently falls back. If it's a defect,
  also record it where it belongs (a single outcome lint will flag, a decision with
  "Not handled") and list it in your findings.

Walkthroughs are findings, so the user acknowledges them; they don't answer them. When
the user replies with a question, answer in the thread (`p.followUp`).

## 4. Answer questions

The user will ask "why does this call inventory twice?" or "where does the session come
from?", either in chat or as a note on an item in the editor.

- A question is not a change request. Read the code, answer it, and cite `file:line`.
- Answer where the user asked. A note on an item gets a reply in chat, plus a one-line
  `meta.note` on the item when the answer is worth keeping. A question about a path gets
  a new walkthrough, or a step added to an existing one.
- If answering it shows the plan was wrong or incomplete, fix the plan: you misread the
  code. If it shows the code is wrong, that's a finding.

## 5. Hand off: where to start reading

When you show the user the result (step 2 of SKILL.md), give a reading order: the group
map for the shape of the system, then the walkthroughs in Focus (name the one to read
first), then the group that walkthrough runs through. Name the two or three findings that
matter most, in a sentence each. Don't summarize the whole codebase in chat; the plan is
the explanation, and chat points into it.

## 6. Simplify, behind tests

Simplifying changes code, so the user decides what changes. The plan gives you two things
for this: the list of candidates, and a test for every behaviour you must keep.

### Find candidates

- **Lint findings:** unreachable surfaces, interactions nothing calls, jobs nothing
  enqueues, tables nothing reads. Usually dead code.
- **Duplicates:** two interactions with the same outcomes (same conditions, same results),
  such as two handlers with copy-pasted bodies. Merge them into one.
- **Pass-throughs:** an internal surface whose every interaction just calls one other
  interaction and returns its outcomes unchanged. Inline it.
- **Inconsistencies** you recorded as decisions ("two endpoints return `{error}`, three
  return `{message}`"). Unifying them changes behaviour that callers see: it's a change
  for the user to approve, not a cleanup.
- **Tangles:** two groups calling each other in both directions, or one group carrying
  most of the cross-group arrows on the group map. Fixing a boundary is a bigger change;
  propose it, don't do it as part of a cleanup.

For each candidate: what goes, what it saves (files, lines, a concept the reader no longer
needs), and what could break.

### Propose, unless told to go ahead

Put the candidates in Focus as `change` items (options: do it, do part of it, leave it),
with `refs`, or as one proposal (SKILL.md step 2′) when they're a single change best
reviewed on the graph, where removed items show struck through. Wait for the user.

If the user already told you to go ahead ("simplify it, I'll review the diff"), skip the
wait, but only for changes that keep behaviour the same. Anything that changes what a
caller sees (an error shape, a status code, a fixed bug) still goes to the user first.

### Pin behaviour first

Before you change a line of code, write characterization tests:

- One test per outcome of every item you will touch, and of everything that calls it.
  Each one asserts what the code does today.
- Test through the outermost surface that reaches the behaviour: HTTP for an endpoint, the
  binary for a CLI command. Tests written against internal functions break when you merge
  or inline those functions, and then they prove nothing.
- Pin quirks as they are, including bugs you are not fixing, and name them as such in the
  test ("returns 500 for a non-numeric id (bug, kept)").
- Run them against the unchanged code. They must all pass. A failure means the plan
  misreads the code: fix the plan, not the code.

Use the project's test runner if it has one. If it has none, use the language's built-in
one (`node --test`, `pytest`, `go test`) and add nothing to install.

### Simplify, then prove it

- Change the code in small steps. Run the tests after each.
- Delete a test only together with an item the user agreed to remove. Every other test
  passes **unchanged**. If you had to edit a test to make it pass, behaviour changed:
  undo the change, or stop and ask the user.
- Update the plan in the same step: `p.remove(ref, why)` for what you merged or deleted,
  new `sources` for what moved, `syncedAt` set to the new commit if you committed.
  `pg lint` must still pass.

Report: what you removed or merged, roughly how much smaller it is (files, lines), how
many tests pin the behaviour and that they pass on both the old and the new code, and
what you left alone and why (behaviour changes waiting for the user, tangles that need a
decision).
