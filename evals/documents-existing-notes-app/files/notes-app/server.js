const express = require("express");
const store = require("./store");

const app = express();
app.use(express.json());
app.use(express.static("public"));

app.get("/api/notes", (req, res) => {
  res.json(store.all());
});

app.post("/api/notes", (req, res) => {
  const { title, body } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: "title required" });
  }
  if (title.length > 200) {
    return res.status(400).json({ error: "title too long" });
  }
  res.status(201).json(store.add(title.trim(), body));
});

app.get("/api/notes/:id", (req, res) => {
  const note = store.get(Number(req.params.id));
  if (!note) return res.status(404).json({ message: "Not found" });
  res.json(note);
});

app.delete("/api/notes/:id", (req, res) => {
  store.remove(Number(req.params.id));
  res.status(204).end();
});

// Download all notes as CSV
app.get("/api/notes/export", (req, res) => {
  const rows = store.all().map((n) => `${n.id},"${n.title.replace(/"/g, '""')}",${n.createdAt}`);
  res.type("text/csv").send(["id,title,createdAt", ...rows].join("\n"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`notes-app listening on ${port}`));
