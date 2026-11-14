// Regenerates files/plan-graph/plan.json for the implements-from-plan case:
//   node --experimental-strip-types evals/implements-from-plan/fixture.build.ts
// A small CLI the user has fully reviewed: everything is confirmed, nothing is built.
import path from "node:path";
import { create } from "../../scripts/build.ts";

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), "files/plan-graph/plan.json");

const p = create({
  name: "kv",
  summary: "A tiny key-value store on the command line. Values live in one JSON file (KV_FILE, default ./kv.json). Plain Node, no dependencies.",
  profiles: ["cli"],
});
p.defaults({ origin: "agent", status: "confirmed" });

const KEY_ERR = "stderr: kv: invalid key '<key>' (use a-z, 0-9, '.', '_', '-'; max 64 chars)";

p.group("g.commands", "Commands");

p.surface({
  id: "cli.root", profile: "cli", kind: "command", name: "kv", address: "kv [--help] <command>", group: "g.commands",
  description: "Entry point. Prints usage, or dispatches to a subcommand.",
  elements: [
    ["cli.root.help-flag", "flag", "--help / help", {}],
    ["cli.root.kv-file", "env-var", "KV_FILE", { default: "./kv.json", description: "Path of the store file" }],
  ],
});
p.interaction("cli.root.invoke", "cli.root", ["invoke", "Run kv with no command, --help, help, or an unknown command"], [
  ["help", "No arguments, `--help`, or `help`", null, "Usage text listing set, get, list, rm to stdout; exit 0"],
  ["unknown", "First argument is not a known command, e.g. `kv frob`", null, "stderr: kv: unknown command 'frob'. Run 'kv --help'.; nothing on stdout; exit 2"],
]);

p.surface({
  id: "cli.set", profile: "cli", kind: "subcommand", name: "kv set", address: "kv set <key> <value>", group: "g.commands",
  elements: [["cli.set.key", "arg", "key", { pattern: "^[a-z0-9][a-z0-9._-]{0,63}$" }], ["cli.set.value", "arg", "value", { type: "string" }]],
});
p.interaction("cli.set.invoke", "cli.set", ["invoke", "Store a value under a key"], [
  ["ok", "Key is valid and not yet in the store", null, "Value saved to the store file; nothing on stdout; exit 0"],
  ["overwrite", "Key already exists", null, "Old value replaced without asking; nothing on stdout; exit 0"],
  ["invalid-key", "Key fails the key pattern, e.g. `Bad Key`", null, `${KEY_ERR}; store unchanged; exit 2`],
  ["usage", "Key or value missing", null, "stderr: usage: kv set <key> <value>; exit 2"],
  ["write-failed", "The store file cannot be written (e.g. its directory does not exist)", null, "stderr: kv: cannot write <path>: <reason>; exit 1"],
], { effects: [{ kind: "writes", target: "store file" }] });

p.surface({
  id: "cli.get", profile: "cli", kind: "subcommand", name: "kv get", address: "kv get <key>", group: "g.commands",
  elements: [["cli.get.key", "arg", "key", {}]],
});
p.interaction("cli.get.invoke", "cli.get", ["invoke", "Print the value for a key"], [
  ["ok", "Key exists", null, "stdout: the value followed by a newline; exit 0"],
  ["missing", "Key is not in the store (or the store file does not exist)", null, "stderr: kv: no such key '<key>'; nothing on stdout; exit 1"],
  ["usage", "Key missing", null, "stderr: usage: kv get <key>; exit 2"],
  ["corrupt", "The store file exists but is not valid JSON", null, "stderr: kv: store file <path> is not valid JSON; exit 1"],
], { effects: [{ kind: "reads", target: "store file" }] });

p.surface({
  id: "cli.list", profile: "cli", kind: "subcommand", name: "kv list", address: "kv list [--json]", group: "g.commands",
  elements: [["cli.list.json-flag", "flag", "--json", {}]],
});
p.interaction("cli.list.invoke", "cli.list", ["invoke", "List every key and value"], [
  ["ok", "Store has entries, no --json", null, "stdout: one `key=value` line per entry, sorted by key; exit 0"],
  ["empty", "Store is empty or the file does not exist, no --json", null, "Nothing on stdout or stderr; exit 0"],
  ["json", "--json given", null, "stdout: a JSON object of all entries with keys sorted (`{}` when empty), followed by a newline; exit 0"],
  ["corrupt", "The store file exists but is not valid JSON", null, "stderr: kv: store file <path> is not valid JSON; exit 1"],
], { effects: [{ kind: "reads", target: "store file" }] });

p.surface({
  id: "cli.rm", profile: "cli", kind: "subcommand", name: "kv rm", address: "kv rm <key>", group: "g.commands",
  elements: [["cli.rm.key", "arg", "key", {}]],
});
p.interaction("cli.rm.invoke", "cli.rm", ["invoke", "Delete a key"], [
  ["ok", "Key exists", null, "Key removed from the store file without asking; nothing on stdout; exit 0"],
  ["missing", "Key is not in the store", null, "stderr: kv: no such key '<key>'; store unchanged; exit 1"],
  ["usage", "Key missing", null, "stderr: usage: kv rm <key>; exit 2"],
], { effects: [{ kind: "writes", target: "store file" }] });

p.entry("cli.root", "cli.set", "cli.get", "cli.list", "cli.rm");

const D = (id: string, attachedTo: string[], question: string, value: string, alternatives: string[], rationale: string, impact: "low" | "medium" | "high", checklistKey?: string) =>
  p.decision({ id, attachedTo, question, value, alternatives, rationale, impact, ...(checklistKey ? { checklistKey } : {}) });

D("d.exit-codes", [], "Which exit code does each failure class return?", "0 success; 1 runtime failure (missing key, unreadable or unwritable store); 2 usage error (bad or missing arguments, invalid key, unknown command)", ["1 for every failure"], "Scripts can tell 'not found' from 'called it wrong'.", "medium", "exit-codes");
D("d.streams", [], "What goes to stdout vs stderr?", "Data (values, list output, usage on --help) to stdout. Every error and usage-on-error to stderr, prefixed `kv: ` except usage lines.", ["Everything to stdout"], "`$(kv get k)` must never capture an error message.", "medium", "streams");
D("d.machine-output", ["cli.list.json-flag"], "Is there a machine-readable mode, and what is its shape?", "Only `kv list --json`: a flat JSON object of key to value, keys sorted.", ["--json on every command", "JSON lines"], "get already prints the raw value, which is machine-readable.", "low", "machine-output");
D("d.tty", [], "Behavior differences when not a TTY?", "None: no color, no progress output, identical output either way.", ["Color errors when stderr is a TTY"], "Nothing here benefits from color.", "low", "tty");
D("d.interactive", [], "Does any command prompt for input?", "No command ever prompts.", ["Confirm before overwrite or rm"], "Keeps every command scriptable.", "low", "interactive");
D("d.config", ["cli.root.kv-file"], "Config precedence?", "Only the KV_FILE environment variable; default ./kv.json relative to the working directory. No flags, no config file.", ["--file flag that overrides KV_FILE", "~/.kv.json default"], "One knob is enough for v1.", "medium", "config");
D("d.destructive", ["cli.rm.invoke", "cli.set.invoke.overwrite"], "Which commands are destructive, and do they confirm?", "rm and overwriting set are destructive; neither confirms or needs --force.", ["rm requires --force", "set refuses to overwrite without --force"], "It is a scratch store; confirmation would break scripts.", "medium", "destructive");
D("d.help", ["cli.root.invoke"], "Help format and behavior on unknown args?", "`kv`, `kv --help` and `kv help` print a short usage block to stdout and exit 0. An unknown command prints an error to stderr and exits 2. Extra arguments are ignored.", ["Unknown command prints full usage too"], "Short error, pointer to --help.", "low", "help");
D("d.key-format", ["cli.set.key"], "What is a valid key?", "Lowercase letters, digits, '.', '_' and '-'; must start with a letter or digit; 1 to 64 characters. Only set validates; get and rm just look the key up.", ["Any non-empty string"], "Keeps list output unambiguous (no '=' or newlines in keys).", "medium");
D("d.store-format", [], "How is the store file written?", "Pretty-printed JSON object (2-space indent), written to a temp file next to it and renamed into place. A missing file means an empty store and is created on first write; its directory is not created.", ["Write in place", "One line per entry"], "Rename is atomic, so a crash never leaves half a file.", "medium");
D("d.values", ["cli.set.value"], "What can a value contain?", "Any string given as one argument, stored exactly; get prints it followed by a single newline.", ["Read the value from stdin when it is '-'"], "Simplest thing that works.", "low");

p.save(OUT);
