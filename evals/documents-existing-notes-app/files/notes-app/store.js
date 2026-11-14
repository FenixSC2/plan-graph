// In-memory store, persisted to notes.json on every write.
const fs = require("fs");
const FILE = process.env.NOTES_FILE || "notes.json";

let notes = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : [];
let nextId = notes.reduce((m, n) => Math.max(m, n.id), 0) + 1;

const save = () => fs.writeFileSync(FILE, JSON.stringify(notes, null, 2));

module.exports = {
  all: () => notes,
  get: (id) => notes.find((n) => n.id === id),
  add(title, body) {
    const note = { id: nextId++, title, body: body || "", createdAt: new Date().toISOString() };
    notes.push(note);
    save();
    return note;
  },
  remove(id) {
    notes = notes.filter((n) => n.id !== id);
    save();
  },
};
