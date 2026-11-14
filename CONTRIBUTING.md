# Contributing

Thanks for taking a look. Bug reports, new platform profiles and editor improvements are all welcome.

## Setup

```bash
git clone https://github.com/FenixSC2/plan-graph
```

```bash
cd plan-graph && npm install --prefix gui
```

To use your working copy as your installed skill, symlink it into your skills folder:

```bash
ln -s "$PWD" ~/.claude/skills/plan-graph
```

## Checks

These are the same checks CI runs:

```bash
npm --prefix gui test
```

```bash
npm --prefix gui run build
```

```bash
node --experimental-strip-types scripts/plan.ts lint examples/link-shortener/plan.json
```

To try the editor against the example plan, run `npm --prefix gui run dev` and open
<http://localhost:5199>.

## Where things live

| Change | Files |
|---|---|
| What the agent does | `SKILL.md` and `references/` |
| Plan or changeset format | `schema/`, then `gui/src/model/` (shared by the editor and the CLI) |
| Lint rules | `gui/src/model/lint.ts` |
| A new platform | a new file in `profiles/`, modeled on `profiles/web.json` |
| The editor | `gui/src/` (see `gui/README.md`) |
| Test cases for the skill | `evals/<case>/` (prompt, fixture files, one grader file per check) |

## Pull requests

- Keep IDs in the example plans stable, because test names and changesets refer to them.
- If you change agent behavior in `SKILL.md`, say in the PR what problem you saw and, ideally, which
  eval case shows it.
- If you change the format, update `schema/`, the example plan and the editor together.
