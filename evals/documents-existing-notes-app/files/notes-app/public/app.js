const list = document.getElementById("notes");
const form = document.getElementById("new-note");

async function load() {
  const res = await fetch("/api/notes");
  const notes = await res.json();
  list.innerHTML = "";
  for (const n of notes) {
    const li = document.createElement("li");
    li.textContent = n.title + " ";
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.onclick = async () => {
      await fetch(`/api/notes/${n.id}`, { method: "DELETE" });
      load();
    };
    li.appendChild(del);
    list.appendChild(li);
  }
}

form.onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const res = await fetch("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    alert(err.error);
    return;
  }
  form.reset();
  load();
};

load();
