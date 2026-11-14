import { useEffect, useMemo, useState } from "react";
import { clone, deleteWithCascade, inboundOutcomes, labelOf, slug, uniqueId, userMeta, type Ref } from "../model/plan.ts";
import type { Store } from "../store.ts";

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** Delete with an exact preview of the structural fallout (computed on a copy). */
export function DeleteDialog({ store, target, onClose, onDone }: { store: Store; target: Ref; onClose: () => void; onDone: () => void }) {
  const plan = store.plan!;
  const loc = store.index.get(target);
  const [retarget, setRetarget] = useState("");
  const inbound = loc?.type === "surface" ? inboundOutcomes(plan, target) : [];
  const preview = useMemo(() => deleteWithCascade(clone(plan), target, retarget || undefined), [plan, target, retarget]);
  if (!loc) return null;

  return (
    <Modal title={`Delete ${loc.type} “${labelOf(store.index, target)}”?`} onClose={onClose}>
      {inbound.length > 0 && (
        <label className="field">
          <span className="field-label">{inbound.length} outcome(s) lead here. Send them to:</span>
          <select value={retarget} onChange={(e) => setRetarget(e.target.value)}>
            <option value="">— remove those outcomes —</option>
            {plan.surfaces.filter((s) => s.id !== target).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.profile})</option>)}
          </select>
        </label>
      )}
      {preview.lines.length > 0 ? (
        <>
          <p className="muted">This will also:</p>
          <ul className="cascade">{preview.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </>
      ) : (
        <p className="muted">Nothing else references it.</p>
      )}
      <p className="hint">Knock-on effects that depend on meaning (related error codes, flags, copy) are left for the agent to propose.</p>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn danger"
          autoFocus
          onClick={() => { store.edit((p) => { deleteWithCascade(p, target, retarget || undefined); }); onDone(); }}
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}

export function AddSurfaceDialog({ store, onClose, onAdded }: { store: Store; onClose: () => void; onAdded: (id: string) => void }) {
  const plan = store.plan!;
  const profiles = store.loaded!.profiles;
  const [profile, setProfile] = useState(plan.profiles[0]);
  const prof = profiles[profile];
  const [kind, setKind] = useState(prof?.surfaceKinds[0] ?? "page");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [sketch, setSketch] = useState(true);
  const [note, setNote] = useState("");

  useEffect(() => setKind(profiles[profile]?.surfaceKinds[0] ?? ""), [profile, profiles]);

  const submit = () => {
    if (!name.trim()) return;
    const id = uniqueId(store.index, `${profile}.${slug(name)}`);
    store.edit((p) => {
      p.surfaces.push({
        id, profile, kind, name: name.trim(),
        ...(address.trim() ? { address: address.trim() } : {}),
        meta: userMeta(sketch ? "sketch" : "confirmed"),
      });
    });
    if (note.trim()) store.setNote(id, note.trim());
    onAdded(id);
  };

  return (
    <Modal title="Add surface" onClose={onClose}>
      <div className="grid2">
        <label className="field">
          <span className="field-label">Platform</span>
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            {plan.profiles.map((p) => <option key={p} value={p}>{profiles[p]?.name ?? p}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {prof?.surfaceKinds.map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="field-label">Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="e.g. QR code" />
      </label>
      <label className="field">
        <span className="field-label">Address (optional)</span>
        <input className="mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={prof?.addressFormat} />
      </label>
      <label className="field">
        <span className="field-label">What should it do? (note to agent)</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shows a QR for the short URL, with a download button." />
      </label>
      <label className="check">
        <input type="checkbox" checked={sketch} onChange={(e) => setSketch(e.target.checked)} />
        Needs detail: let the agent fill in states, elements and outcomes
      </label>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!name.trim()} onClick={submit}>Add surface</button>
      </div>
    </Modal>
  );
}
