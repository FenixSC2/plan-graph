# Writing a good plan

How to draft and elaborate `plan.json` so the user can review it quickly and the build can
be tested from it. The format itself is in `schema/plan.ts`; this is about judgment.

## Contents

- IDs
- Surfaces and states
- Elements: how fine-grained
- Interactions and outcomes
- Effects: linking platforms
- Decisions: what counts, impact, alternatives
- Meta: origin, status, notes
- Common mistakes

## IDs

IDs are dotted, lowercase, human-readable, globally unique, and **permanent**. They are
how changesets and tests refer to things, so renaming something changes its `name` or
`label`, never its `id`.

| Item | Pattern | Example |
|---|---|---|
| Surface | `<profile>.<surface>` | `web.home`, `api.create-link`, `cli.stats` |
| State | `<surface>#<state>`, the state's own `id` being local | `web.stats#loading` |
| Element | `<surface>.<element>` | `web.home.url-input`, `cli.create.json-flag` |
| Interaction | `<surface>.<action>` | `web.home.shorten`, `api.create-link.request` |
| Outcome | `<interaction>.<case>` | `web.home.shorten.ok`, `.invalid`, `.failed` |
| Decision | `d.<topic>` | `d.redirect-status` |
| Group | `g.<name>` | `g.checkout` |

An API endpoint usually has one interaction, `<surface>.request`. A CLI command usually
has one, `<surface>.invoke`, unless it prompts (each answer is another interaction).

## Surfaces and states

A surface is a place a user or caller can *be*: something with its own address, or
something that takes over the screen or terminal (a modal, a prompt). Use a **state**
instead when the address stays the same and only part of the content changes: loading,
empty, error, submitting, a selected tab.

Model the states that change what the user can do or see. The `web` profile lists
required ones: a page that loads data needs `loading`, `ready`, `empty`, `error`, and a
form needs `idle`, `submitting`, `error`. Don't invent states that don't change behavior.

Mark a surface `terminal: true` when having no way onward is deliberate (a "link not
found" page whose only move is the browser's back button, an API endpoint with no
follow-up). Otherwise lint reports it as a dead end, which is usually a real gap.

Give each surface an `address` in the profile's format: a route, a command signature,
`METHOD /path`.

## Elements: how fine-grained

Add an element when an interaction is triggered by it, a decision is attached to it, or
it carries validation or defaults worth reviewing (`spec`). A page's decorative text or
an endpoint's every response field doesn't need one. The user can add elements in the
GUI if they want more detail. Too many elements bury the ones that matter.

Put validation, defaults and constraints in `spec`, e.g.
`{ "type": "url", "required": true }` or `{ "pattern": "^[a-z0-9-]{3,32}$" }`.

## Interactions and outcomes

An interaction is **one trigger**: a click, a form submit, arriving on a page
(`on-enter`), a timer, invoking a command, an HTTP request. Its outcomes are the
**mutually exclusive branches** of what happens next.

- **Enumerate failure.** For anything that does I/O or validates input, the usual set is:
  success, invalid input, conflict or not-found, permission or auth failure, and
  network or server error. Combine branches that the user sees identically ("Network
  error, 429 or 5xx" → same message). Split them when the user sees something different.
- **`when` is a precondition** a test can set up: "URL fails validation", "code does
  not exist", "not signed in". Use `always` only when there is truly one branch.
- **`to`** is a surface or `surface#state`, or `null` when the user stays where they
  are (copying to the clipboard, a toast).
- **`result`** is what a test asserts beyond where you land: the status code and body
  shape, the exit code and what goes to which stream, the exact message, a toast, a
  focus change. Prefer concrete text (`"That alias is taken"`) to vague
  ("shows an error"). The message wording is itself a reviewable decision.
- An interaction from a state (`from: "web.stats#error"`) only exists in that state,
  e.g. a Retry button.

## Effects: linking platforms

When a web form or CLI command uses the API, give its interaction a
`{ "kind": "calls", "target": "api.create-link.request" }` effect, and make its outcomes
mirror the API's outcomes (201 → result page, 409 → "alias taken" error, 5xx → generic
error). Keeping the two in step is what makes the full-stack graph consistent. `writes`,
`reads` and `emits` name resources or events (`"links table"`, `"link.created"`) without
needing a surface.

## Decisions

### What counts

Record a decision when **a reasonable developer could have chosen differently and the
user would notice the difference**: in behavior, wording, data kept, cost, or how hard it
is to change later. Examples: session length, 301 vs 302, whether duplicate URLs get the
same code, default output format, whether delete asks for confirmation, rate limits,
pagination style, what is public.

Don't record what follows directly from something already decided, pure implementation
detail the user can't observe (a variable name, which internal helper to use), or
choices with no real alternative.

Every item in each profile's `decisionChecklist` gets a decision with that
`checklistKey`, even when the answer is "not applicable" (say why). The checklist is
what makes every project on a platform surface the same categories of assumptions.

Non-interactive concerns (data storage, hosting, framework choice) are project-wide
decisions: `attachedTo: []`. Attach a decision to the items it affects when there are
any, so it shows next to them in the GUI.

### Impact

The GUI sorts review by impact, so this is how you direct the user's limited attention.

| Impact | Meaning | Examples |
|---|---|---|
| high | Changes the graph's shape, the data kept, security or privacy, or is expensive to reverse after launch | accounts or not; who can see what; 301 vs 302; deleting vs archiving |
| medium | Clearly user-visible, cheap to change later | code length; default page size; error wording strategy |
| low | Conventional choice that rarely matters | copy-button feedback duration; help text format |

Aim for no more than 10 to 15 high-impact decisions. If you have more, some are probably
medium.

### Alternatives and rationale

Give one to three real alternatives, the ones a thoughtful person would actually
consider, so the GUI can swap one in with a click. `rationale` is one sentence on why
your choice wins, ideally naming the consequence ("browsers cache 301s, so click stats
would undercount"). That is what lets the user overrule you confidently.

## Meta

- Everything you draft is `{ "origin": "agent", "status": "proposed" }`.
- Items the user adds arrive as `origin: "user"`, either `confirmed` or `sketch`.
- Extracted items are `origin: "code"`: `confirmed` when the code is unambiguous,
  `proposed` when you're inferring.
- `meta.note` carries reasoning the user should see while reviewing: why a follow-on
  change was made, what was uncertain in the code, what you assumed while elaborating a
  sketch. Keep it to one or two sentences.
- `built` and `sources` track implementation and are independent of review status.

## Common mistakes

- **Happy path only.** One outcome on a submit or a request. Lint warns about it; fix it
  rather than ignoring it.
- **Vague outcomes.** "Error is shown" can't be tested and hides a decision about where
  and how.
- **Burying assumptions in descriptions.** "Requires login" in a surface's description
  is a decision the user can't see or swap. Make it a decision.
- **Everything high impact.** Then the review order means nothing.
- **Over-modeling.** Every label, every response field, every CSS state. The plan should
  fit in a reviewer's head per surface.
- **Orphans.** Surfaces nothing leads to, API endpoints nothing calls. Either connect
  them, make them entry points, or ask whether they're needed.
