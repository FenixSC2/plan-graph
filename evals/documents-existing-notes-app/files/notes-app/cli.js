#!/usr/bin/env node
const { program } = require("commander");

const API = process.env.NOTES_API || "http://localhost:3000";

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    console.log("Error: " + (data.error || data.message || res.status));
    process.exit(1);
  }
  return res.status === 204 ? null : res.json();
}

program.name("notes").description("Manage notes from the terminal");

program
  .command("list")
  .option("--json", "print raw JSON")
  .action(async (opts) => {
    const notes = await call("GET", "/api/notes");
    if (opts.json) return console.log(JSON.stringify(notes));
    if (notes.length === 0) return console.log("No notes yet.");
    for (const n of notes) console.log(`${n.id}\t${n.title}`);
  });

program
  .command("add <title>")
  .option("-b, --body <text>", "note body")
  .action(async (title, opts) => {
    const note = await call("POST", "/api/notes", { title, body: opts.body });
    console.log(`Created note ${note.id}`);
  });

program
  .command("rm <id>")
  .action(async (id) => {
    await call("DELETE", `/api/notes/${id}`);
    console.log(`Deleted note ${id}`);
  });

program.parseAsync().catch((e) => {
  console.log("Error: " + e.message);
  process.exit(1);
});
