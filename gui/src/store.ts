// App state: the loaded plan (base), the edited plan (present) with undo/redo, notes,
// and the send/poll/rebase loop with the agent.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildIndex, clone, type Plan, type PlanIndex, type Ref } from "./model/plan.ts";
import { applyOps, changedRefs, diffPlans, toChangeset, type Change, type Changeset } from "./model/diff.ts";
import { lint, type Issue, type Profile } from "./model/lint.ts";

interface Loaded {
  base: Plan;
  hash: string;
  profiles: Record<string, Profile>;
  planPath: string;
}

interface History {
  past: Plan[];
  present: Plan;
  future: Plan[];
}

export type Banner = { tone: "info" | "success" | "warn"; text: string } | null;

const POLL_MS = 1500;

interface Draft {
  hash: string;
  ops: Changeset["ops"];
  notes?: Record<Ref, string>;
  globalNote?: string;
}
const draftKey = (planPath: string) => `plan-graph:draft:${planPath}`;
function readDraft(planPath: string): Draft | null {
  try { return JSON.parse(localStorage.getItem(draftKey(planPath)) ?? "null"); } catch { return null; }
}
function writeDraft(planPath: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(draftKey(planPath), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(planPath));
  } catch { /* storage unavailable: drafts just won't survive reloads */ }
}

export function usePlanStore() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [hist, setHist] = useState<History | null>(null);
  const [notes, setNotes] = useState<Record<Ref, string>>({});
  const [globalNote, setGlobalNote] = useState("");
  const [sent, setSent] = useState<Plan | null>(null);
  const [pending, setPending] = useState(false);
  const [agentChanged, setAgentChanged] = useState<Set<Ref>>(new Set());
  const [banner, setBanner] = useState<Banner>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const latest = useRef({ loaded, hist, sent, notes });
  latest.current = { loaded, hist, sent, notes };

  const fetchPlan = useCallback(async () => {
    const r = await fetch("/api/plan");
    if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
    return (await r.json()) as Loaded & { plan: Plan };
  }, []);

  // initial load, restoring any unsent draft from a previous visit
  useEffect(() => {
    fetchPlan()
      .then((d) => {
        let present = clone(d.plan);
        const draft = readDraft(d.planPath);
        if (draft?.ops.length || draft?.notes) {
          const { plan: restored, failed } = applyOps(d.plan, draft.ops);
          present = restored;
          setNotes(draft.notes ?? {});
          setGlobalNote(draft.globalNote ?? "");
          const n = draft.ops.length;
          setBanner({
            tone: failed.length ? "warn" : "info",
            text: `Restored ${n} unsent change(s) from your last session` +
              (draft.hash !== d.hash ? " (plan.json changed since; reapplied on top)" : "") +
              (failed.length ? `. ${failed.length} no longer apply and were dropped.` : "."),
          });
        }
        setLoaded({ base: d.plan, hash: d.hash, profiles: d.profiles, planPath: d.planPath });
        setHist({ past: [], present, future: [] });
      })
      .catch((e) => setLoadError(String(e)));
  }, [fetchPlan]);

  /** plan.json changed on disk: adopt it as the new base and reapply unsent local edits. */
  const adoptNewBase = useCallback(async () => {
    const { loaded: L, hist: H, sent: S } = latest.current;
    if (!L || !H) return;
    const d = await fetchPlan();
    const reference = S ?? L.base;
    // Notes aren't plan edits (comments apply as no-ops), so leave them out of the rebase.
    const localChanges = diffPlans(reference, H.present);
    const { plan: rebased, failed } = applyOps(d.plan, toChangeset(localChanges, "").ops);
    const touched = changedRefs(L.base, d.plan);

    setLoaded({ base: d.plan, hash: d.hash, profiles: d.profiles, planPath: d.planPath });
    setHist({ past: [], present: rebased, future: [] });
    setAgentChanged(touched);
    setSent(null);
    // Sent notes are done once the agent has responded; unsent ones stay (if their item still exists).
    const stillPending = new Set(diffPlans(d.plan, rebased).map((c) => c.ref));
    const exists = buildIndex(rebased);
    setNotes((n) => Object.fromEntries(Object.entries(n).filter(([r]) => (S ? stillPending.has(r) : exists.has(r)))));
    if (!localChanges.length) setGlobalNote("");

    const parts = [S ? `The agent updated the plan (${touched.size} items changed).` : `plan.json changed on disk (${touched.size} items).`];
    if (localChanges.length) parts.push(`Your ${localChanges.length} unsent edit(s) were reapplied.`);
    if (failed.length) parts.push(`${failed.length} edit(s) no longer apply and were dropped.`);
    setBanner({ tone: failed.length ? "warn" : S ? "success" : "info", text: parts.join(" ") });
  }, [fetchPlan]);

  // poll for agent pickup / plan changes
  useEffect(() => {
    if (!loaded) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/status");
        const s = (await r.json()) as { hash: string; changesetPending: boolean; agentWorking?: boolean };
        if (stop) return;
        setPending(s.changesetPending);
        // While the agent is mid-apply, plan.json is half-finished: wait for it to finish.
        if (s.hash !== latest.current.loaded?.hash && !s.agentWorking) await adoptNewBase();
      } catch {
        /* server down; keep trying */
      }
    };
    const t = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [loaded, adoptNewBase]);

  const plan = hist?.present ?? null;
  const index: PlanIndex = useMemo(() => (plan ? buildIndex(plan) : new Map()), [plan]);

  /** Apply a mutation to a copy of the plan and push it onto history. */
  const edit = useCallback((fn: (draft: Plan) => void) => {
    setHist((h) => {
      if (!h) return h;
      const next = clone(h.present);
      fn(next);
      return { past: [...h.past.slice(-99), h.present], present: next, future: [] };
    });
  }, []);

  const replace = useCallback((next: Plan) => {
    setHist((h) => (h ? { past: [...h.past.slice(-99), h.present], present: next, future: [] } : h));
  }, []);

  const undo = useCallback(() => {
    setHist((h) => (h && h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h));
  }, []);
  const redo = useCallback(() => {
    setHist((h) => (h && h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));
  }, []);

  const changes: Change[] = useMemo(() => (loaded && plan ? diffPlans(loaded.base, plan, notes) : []), [loaded, plan, notes]);
  const issues: Issue[] = useMemo(() => (plan && loaded ? lint(plan, loaded.profiles) : []), [plan, loaded]);
  const blocking = issues.filter((i) => i.severity === "error");
  const unsentSinceSend = useMemo(() => (sent && plan ? diffPlans(sent, plan).length : null), [sent, plan]);

  // keep the draft in localStorage so a reload or closed tab doesn't lose review work
  useEffect(() => {
    if (!loaded) return;
    writeDraft(loaded.planPath, changes.length || globalNote.trim()
      ? { hash: loaded.hash, ops: toChangeset(changes, loaded.hash).ops, notes, globalNote }
      : null);
  }, [loaded, changes, notes, globalNote]);

  const send = useCallback(async () => {
    const { loaded: L, hist: H } = latest.current;
    if (!L || !H || !changes.length || blocking.length) return;
    const changeset = toChangeset(changes, L.hash, globalNote);
    const r = await fetch("/api/changeset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changeset) });
    if (r.ok) {
      setSent(clone(H.present));
      setPending(true);
      setBanner({ tone: "info", text: `Sent ${changeset.ops.length} change(s). Waiting for the agent to apply them…` });
    } else if (r.status === 409) {
      setBanner({ tone: "warn", text: "plan.json changed since you loaded it. Reloading and reapplying your edits; review, then send again." });
      await adoptNewBase();
    } else if (r.status === 423) {
      setBanner({ tone: "info", text: (await r.json()).error });
    } else {
      setBanner({ tone: "warn", text: `Send failed: ${(await r.json()).error ?? r.statusText}` });
    }
  }, [changes, blocking.length, globalNote, adoptNewBase]);

  const setNote = useCallback((ref: Ref, text: string) => setNotes((n) => ({ ...n, [ref]: text })), []);
  const clearAgentChanged = useCallback((ref: Ref) => {
    setAgentChanged((s) => {
      if (!s.has(ref)) return s;
      const n = new Set(s); n.delete(ref); return n;
    });
  }, []);

  return {
    loadError, loaded, plan, index, changes, issues, blocking,
    notes, setNote, globalNote, setGlobalNote,
    edit, replace, undo, redo,
    canUndo: !!hist?.past.length, canRedo: !!hist?.future.length,
    send, sent: !!sent, unsentSinceSend, pending,
    agentChanged, clearAgentChanged, banner, setBanner,
  };
}

export type Store = ReturnType<typeof usePlanStore>;
