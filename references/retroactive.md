# Retroactive mode: documenting an existing codebase

The same plan and GUI, filled in from code instead of from a request. The result shows
the user what their app actually does, which decisions it embodies without anyone having
written them down, and where the gaps are. From then on it works like forward mode.

## 1. Scope and detect profiles

Ask yourself what the user wants documented: the whole project, or the area a feature
will touch. For a large codebase, start with one area, show it, and expand. A partial
plan the user has reviewed beats a complete one they haven't.

Detect profiles from the stack:

| Evidence | Profile |
|---|---|
| A router (file-based `app/` or `pages/`, React Router, Vue Router, SvelteKit routes), HTML templates | `web` |
| Route handlers (Express, Fastify, FastAPI, Flask, Django views, Rails controllers, Go `http.HandleFunc`), OpenAPI specs | `api` |
| CLI frameworks (commander, yargs, click, typer, argparse, cobra, clap), a `bin` entry in package.json | `cli` |

If none fits (a mobile app, a desktop app, a bot), write a profile first; see "Adding a
platform" in SKILL.md.

Set `"mode": "retroactive"` and `syncedAt` to the current commit
(`git rev-parse HEAD`), if the project is a git repository.

## 2. Extract surfaces, interactions, outcomes

Work from the entry points outward: routes, commands, endpoints. For each surface, read
the handler or component and record:

- **Surface**: kind, name, `address` (the actual route or signature).
- **States** the code actually renders (`if (loading)`, empty-list branches, error
  boundaries).
- **Elements** that trigger something or carry validation.
- **Interactions** with an **outcome per branch the code takes**: every `return
  res.status(…)`, `process.exit(…)`, `navigate(…)`, `redirect(…)`, thrown error caught
  somewhere observable. `result` records what the code really returns or prints,
  including exact messages.
- **Effects**: which API calls a page or command makes (`fetch`, a client SDK), and
  which tables or queues an endpoint touches.

With `scripts/build.ts`, set this once with `p.defaults(...)` and pass `sources` per item.
Every extracted item gets
`{ "origin": "code", "status": "confirmed", "built": "yes", "sources": [{ "file": "src/routes/links.ts", "line": 42 }] }`.
Use `status: "proposed"` instead, with a `meta.note`, when you're inferring rather than
reading: a dynamic route, a feature flag, a branch you can't tell is reachable,
behavior that depends on configuration.

Unhandled failures matter. If an endpoint has no error branch for a database failure,
don't invent one; lint will flag the single outcome, and that is a finding.

## 3. Record implicit decisions

This is the most valuable part of extraction. Go through each profile's
`decisionChecklist` and look for what the code actually does: how errors are presented,
which exit codes are used, what the error body looks like, whether there is rate
limiting, pagination, auth on each endpoint. Record each as a decision with:

- `value`: what the code does today, stated plainly ("Errors are shown as toasts; form
  fields are not highlighted").
- `origin: "code"`, `status: "proposed"`. Even if the code is clear, nobody has
  *chosen* this yet, so the user should review it.
- `sources` pointing at the code that embodies it.
- `alternatives`: what else it could be, so the user can change it in the GUI.

Also record inconsistencies as decisions: "Two endpoints return `{error}` and three
return `{message}`" is exactly what the user wants to see and settle.

If the code doesn't address a checklist item at all, the value is "Not handled" with an
impact that reflects the risk.

## 4. Lint and report findings

Run `pg lint`. On existing code, warnings are findings about the code, not mistakes in
your extraction:

- Unreachable surfaces: dead pages, orphaned routes.
- Endpoints nothing calls: dead code, or a missing client.
- Dead ends: pages with no way onward.
- Single-outcome fallible interactions: missing error handling.
- Unanswered checklist items: concerns the code ignores.

Report them to the user grouped by severity. Don't fix them in the plan or the code
unless asked; whether a finding matters is the user's call.

## 5. Hand off to the review loop

Start the GUI and review as in forward mode. When the user edits an item that is built,
its code no longer matches the plan: set `built` to `"partial"` (or `"no"` for a new
destination or behavior). Those items are the work queue for implementation.

## Re-syncing later

To bring an existing plan up to date with code that changed, diff from `syncedAt`
(`git diff --name-only <syncedAt>..HEAD`), re-read only those files, and update the
items whose `sources` point into them. New code becomes new `origin: "code"` items.
Where the code now disagrees with a confirmed plan item, don't overwrite the plan:
record the difference as a `proposed` change with a note and show it to the user. That
is drift, and the user decides which side is right.
