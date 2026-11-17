// App state: the loaded plan (base), the edited plan (present) with undo/redo, notes,
// and the send/poll/rebase loop with the agent.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildIndex, clone, type Plan, type PlanIndex, type Ref } from "./model/plan.ts";
import { applyOps, changedRefs, diffPlans, toChangeset, type Change, type Changeset } from "./model/diff.ts";
import { lint, type Issue, type Profile } from "./model/lint.ts";
import { applyProposal, decisionImpacts, makeResponse, proposalMarks, proposalRequires, proposalSig, toggleOp, type Proposal } from "./model/proposal.ts";
import { focusSig, sortFocus, turnOf, type FocusFile, type FocusItem, type FocusResponse } from "./model/focus.ts";

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

/** The user's in-progress answer to the agent's proposal. */
export interface ProposalUI {
  id: string;
  /** Content fingerprint: a revised proposal that reuses the id still counts as new. */
  sig: string;
  /** Op indices ticked for acceptance (all, initially). */
  included: number[];
  answers: Record<string, string>;
  reply: string;
  /** Set once the user accepts (some or none of) the ops: the indices that were applied. */
  accepted: number[] | null;
}
const proposalKey = (planPath: string) => `plan-graph:proposal:${planPath}`;
function readProposalUI(planPath: string, p: Proposal): ProposalUI {
  const fresh: ProposalUI = { id: p.id, sig: proposalSig(p), included: p.ops.map((_, i) => i), answers: {}, reply: "", accepted: null };
  try {
    const s = JSON.parse(localStorage.getItem(proposalKey(planPath)) ?? "null");
    return s?.id === p.id && s?.sig === fresh.sig ? { ...fresh, ...s } : fresh;
  } catch { return fresh; }
}
/** The user's draft answer to one focus item. `sig` is the item version it answers. */
export interface FocusAnswer {
  sig: string;
  choice?: string;
  text: string;
  done?: boolean;
  /** Sent and not yet picked up: shown as sent, not sent again unless edited. */
  sent?: boolean;
}
const focusKey = (planPath: string) => `plan-graph:focus:${planPath}`;
function readFocusUI(planPath: string): Record<string, FocusAnswer> {
  try { return JSON.parse(localStorage.getItem(focusKey(planPath)) ?? "{}") ?? {}; } catch { return {}; }
}
const hasContent = (a?: FocusAnswer) => !!a && (!!a.choice || !!a.text.trim() || !!a.done);

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
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [pui, setPui] = useState<ProposalUI | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [focus, setFocus] = useState<FocusFile | null>(null);
  const [focusUI, setFocusUI] = useState<Record<string, FocusAnswer>>({});
  // "unset" until the first poll: the initial load already fetched focus.json, so that poll only records the fingerprint.
  const focusFileSig = useRef<string | null>("unset");
  /** Whether the last poll saw a changeset pending: when it clears, the agent has picked up the send. */
  const wasPending = useRef(false);
  /** Plan before / after the last accept (and what was accepted), for Reopen and undo/redo. */
  const acceptSnap = useRef<{ before: Plan; after: Plan; accepted: number[] } | null>(null);

  const latest = useRef({ loaded, hist, sent, notes, proposal, pui, focus, focusUI });
  latest.current = { loaded, hist, sent, notes, proposal, pui, focus, focusUI };

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
        setFocusUI(readFocusUI(d.planPath));
        return Promise.all([loadProposal(d.planPath, true), loadFocus(true)]);
      })
      .catch((e) => setLoadError(String(e)));
  }, [fetchPlan]);

  /** Fetch proposal.json (or its absence) and reset the review state when it's a new one. */
  const loadProposal = useCallback(async (planPath: string, initial = false) => {
    const r = await fetch("/api/proposal");
    const { proposal: p } = (await r.json()) as { proposal: Proposal | null };
    const prev = latest.current;
    // An accepted answer that was never sent is lost when the proposal goes away or is replaced:
    // say so (the accepted changes themselves stay, as the user's own edits).
    const unsentAnswer = !!prev.pui && prev.pui.accepted !== null && !prev.sent;
    if (!p || !Array.isArray(p.ops)) {
      if (prev.proposal && unsentAnswer) setBanner({ tone: "warn", text: `The agent withdrew “${prev.proposal.title}” before your answer was sent. Changes you accepted stay in Changes.` });
      setProposal(null); setPui(null); setPreviewing(false);
      acceptSnap.current = null;
      return;
    }
    if (prev.proposal?.id === p.id && proposalSig(prev.proposal) === proposalSig(p)) return;
    acceptSnap.current = null;
    const ui = readProposalUI(planPath, p);
    setProposal(p);
    setPui(ui);
    setPreviewing(ui.accepted === null);
    if (prev.proposal && unsentAnswer) {
      setBanner({ tone: "warn", text: `The agent replaced “${prev.proposal.title}” with “${p.title}” before your answer was sent. Changes you accepted stay in Changes; review the new proposal in the Proposal tab.` });
    } else if (!initial || ui.accepted === null) {
      setBanner({ tone: "info", text: `The agent proposed a change: “${p.title}”. It's previewed on the graph; review it in the Proposal tab.` });
    }
  }, []);

  /** Fetch focus.json. Answers to an item the agent has since changed are dropped; say what's new. */
  const loadFocus = useCallback(async (initial = false) => {
    const r = await fetch("/api/focus");
    const { focus: f, sig } = (await r.json()) as { focus: FocusFile | null; sig?: string | null };
    // The baseline is what was loaded, not what the next poll sees: a change written in
    // between would otherwise be taken as already shown.
    focusFileSig.current = sig ?? null;
    const file = f && Array.isArray(f.items) ? f : null;
    const prev = latest.current.focus;
    setFocus(file);
    setFocusUI((ui) => {
      const keep: Record<string, FocusAnswer> = {};
      for (const it of file?.items ?? []) {
        const a = ui[it.id];
        if (a && a.sig === focusSig(it) && it.status === "open") keep[it.id] = a;
      }
      return keep;
    });
    if (initial || !file) return;
    const before = new Map((prev?.items ?? []).map((i) => [i.id, focusSig(i)]));
    const fresh = file.items.filter((i) => turnOf(i) === "user" && before.get(i.id) !== focusSig(i));
    const settled = file.items.filter((i) => i.status === "resolved" && prev?.items.some((p) => p.id === i.id && p.status === "open"));
    const parts = [];
    if (fresh.length) parts.push(`${fresh.length} item${fresh.length === 1 ? "" : "s"} in Focus need${fresh.length === 1 ? "s" : ""} you`);
    if (settled.length) parts.push(`${settled.length} settled`);
    if (parts.length) setBanner({ tone: "info", text: `The agent updated Focus: ${parts.join(", ")}.` });
  }, []);

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
        const s = (await r.json()) as { hash: string; changesetPending: boolean; agentWorking?: boolean; proposalId?: string | null; focusSig?: string | null };
        if (stop) return;
        setPending(s.changesetPending);
        // Answers-only rounds leave plan.json as it was, so adoptNewBase never runs: release the send here.
        const finished = wasPending.current && !s.changesetPending;
        wasPending.current = s.changesetPending;
        if (finished && s.hash === latest.current.loaded?.hash && latest.current.sent) setSent(null);
        // "unset" until the first loadFocus() returns; it then holds the sig of what was loaded.
        if (focusFileSig.current !== "unset" && (s.focusSig ?? null) !== focusFileSig.current) await loadFocus();
        if ((s.proposalId ?? null) !== (latest.current.proposal?.id ?? null)) await loadProposal(latest.current.loaded!.planPath);
        // While the agent is mid-apply, plan.json is half-finished: wait for it to finish.
        if (s.hash !== latest.current.loaded?.hash && !s.agentWorking) await adoptNewBase();
      } catch {
        /* server down; keep trying */
      }
    };
    const t = setInterval(tick, POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [loaded, adoptNewBase, loadProposal, loadFocus]);

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

  // ── proposal ──
  const proposalOpen = !!proposal && !!pui && pui.accepted === null;
  /** The working plan with the ticked ops applied; removed items are kept so they can be shown struck through. */
  const preview = useMemo(() => {
    if (!proposal || !pui || !plan || !proposalOpen) return null;
    const p = applyProposal(plan, proposal.ops, pui.included, { keepRemovals: true }).plan;
    return { plan: p, index: buildIndex(p), marks: proposalMarks(proposal.ops, pui.included) };
  }, [proposal, pui, plan, proposalOpen]);
  /** Ops that no longer apply to the working plan (their target is gone or their id is taken). */
  const proposalFailed = useMemo(
    () => (proposal && plan && proposalOpen ? new Set(applyProposal(plan, proposal.ops).failed) : new Set<number>()),
    [proposal, plan, proposalOpen],
  );
  const impacts = useMemo(
    // Once accepted, the working plan already contains the ops: measure against plan.json instead.
    () => (proposal && plan && pui && loaded ? decisionImpacts(pui.accepted ? loaded.base : plan, proposal, pui.accepted ?? pui.included) : []),
    [proposal, plan, pui, loaded],
  );
  const proposalResponded = !!pui && pui.accepted !== null;
  /** Which ops need which (see proposalRequires), measured against plan.json. */
  const requires = useMemo(() => (proposal && loaded ? proposalRequires(loaded.base, proposal.ops) : new Map<number, Set<number>>()), [proposal, loaded]);

  // Undo past an accept reopens the proposal; redo re-accepts it. Keeps the Proposal tab and
  // what Send reports in step with the plan.
  useEffect(() => {
    const snap = acceptSnap.current;
    if (!snap || !hist || !pui) return;
    if (hist.present === snap.before && pui.accepted !== null) { setPui({ ...pui, accepted: null }); setPreviewing(true); }
    else if (hist.present === snap.after && pui.accepted === null) { setPui({ ...pui, accepted: snap.accepted }); setPreviewing(false); }
  }, [hist, pui]);

  useEffect(() => {
    if (!loaded || !pui) return;
    try { localStorage.setItem(proposalKey(loaded.planPath), JSON.stringify(pui)); } catch { /* ignore */ }
  }, [loaded, pui]);

  const updatePui = useCallback((fn: (u: ProposalUI) => ProposalUI) => setPui((u) => (u ? fn(u) : u)), []);
  const toggleProposalOp = useCallback((i: number) => updatePui((u) => ({ ...u, included: toggleOp(u.included, i, requires) })), [updatePui, requires]);
  const setProposalOps = useCallback((included: number[]) => updatePui((u) => ({ ...u, included })), [updatePui]);
  const setAnswer = useCallback((qid: string, text: string) => updatePui((u) => ({ ...u, answers: { ...u.answers, [qid]: text } })), [updatePui]);
  const setReply = useCallback((reply: string) => updatePui((u) => ({ ...u, reply })), [updatePui]);

  /** Apply the ticked ops to the working plan as the user's own (confirmed) edits. */
  const acceptProposal = useCallback(() => {
    const { proposal: P, pui: U, hist: H } = latest.current;
    if (!P || !U || !H) return;
    const { plan: next, failed } = applyProposal(H.present, P.ops, U.included, { confirm: true });
    const accepted = U.included.filter((i) => !failed.includes(i));
    if (accepted.length) {
      acceptSnap.current = { before: H.present, after: next, accepted };
      setHist({ past: [...H.past.slice(-99), H.present], present: next, future: [] });
    }
    setPui({ ...U, accepted });
    setPreviewing(false);
    const rejected = P.ops.length - accepted.length;
    setBanner({
      tone: failed.length ? "warn" : "success",
      text: (P.ops.length === 0 ? "Answers ready." : `Accepted ${accepted.length} of ${P.ops.length} proposed change(s)${rejected ? `; ${rejected} rejected` : ""}.`) +
        (failed.length ? ` ${failed.length} no longer applied to your plan.` : "") +
        " Press Send to hand your answer to the agent.",
    });
  }, []);
  const rejectProposal = useCallback(() => {
    updatePui((u) => ({ ...u, accepted: [] }));
    setPreviewing(false);
    setBanner({ tone: "info", text: "Proposal rejected. Add a reply if you like, then press Send so the agent knows." });
  }, [updatePui]);
  /** Go back to reviewing the proposal; undoes the accept if nothing was edited since. */
  const reopenProposal = useCallback(() => {
    const { hist: H } = latest.current;
    const snap = acceptSnap.current;
    if (H && snap && H.present === snap.after) {
      // Step back to before the accept. The snapshot stays, so undoing this re-accepts.
      setHist({ past: [...H.past.slice(-99), H.present], present: snap.before, future: [] });
    } else {
      if (latest.current.pui?.accepted?.length) setBanner({ tone: "warn", text: "You've edited since accepting, so the accepted changes stay in Changes. Revert them there if you don't want them." });
      acceptSnap.current = null;
    }
    updatePui((u) => ({ ...u, accepted: null }));
    setPreviewing(true);
  }, [updatePui]);

  // ── focus ──
  const focusItems: FocusItem[] = useMemo(() => sortFocus(focus?.items ?? []), [focus]);
  /**
   * Every answer the agent hasn't picked up yet (drafted, and still answering the current
   * version of its item). A send carries all of them: a second send before the agent applies
   * the first replaces changeset.json, so answers already sent must ride along again.
   */
  const focusPayload: FocusResponse[] = useMemo(() => focusItems.flatMap((it) => {
    const a = focusUI[it.id];
    if (it.status !== "open" || !hasContent(a) || a.sig !== focusSig(it)) return [];
    return [{ id: it.id, title: it.title, sig: a.sig, ...(a.choice ? { choice: a.choice } : {}), ...(a.text.trim() ? { text: a.text.trim() } : {}), ...(a.done ? { done: true } : {}) }];
  }), [focusItems, focusUI]);
  /** Of those, the ones not sent yet: what Send would add. */
  const focusResponses = useMemo(() => focusPayload.filter((r) => !focusUI[r.id]?.sent), [focusPayload, focusUI]);
  /** Open items waiting on the user with nothing drafted yet: the Focus tab's count. */
  const focusWaiting = focusItems.filter((it) => turnOf(it) === "user" && !hasContent(focusUI[it.id])).length;
  const updateFocusAnswer = useCallback((item: FocusItem, fn: (a: FocusAnswer) => FocusAnswer) => {
    setFocusUI((ui) => {
      const sig = focusSig(item);
      const cur = ui[item.id]?.sig === sig ? ui[item.id] : { sig, text: "" };
      return { ...ui, [item.id]: { ...fn(cur), sig, sent: false } };
    });
  }, []);
  const setFocusChoice = useCallback((item: FocusItem, choice: string | undefined) => updateFocusAnswer(item, (a) => ({ ...a, choice })), [updateFocusAnswer]);
  const setFocusText = useCallback((item: FocusItem, text: string) => updateFocusAnswer(item, (a) => ({ ...a, text })), [updateFocusAnswer]);
  const setFocusDone = useCallback((item: FocusItem, done: boolean) => updateFocusAnswer(item, (a) => ({ ...a, done })), [updateFocusAnswer]);
  const clearFocusAnswer = useCallback((id: string) => setFocusUI((ui) => { const n = { ...ui }; delete n[id]; return n; }), []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(focusKey(loaded.planPath), JSON.stringify(focusUI)); } catch { /* ignore */ }
  }, [loaded, focusUI]);

  // keep the draft in localStorage so a reload or closed tab doesn't lose review work
  useEffect(() => {
    if (!loaded) return;
    writeDraft(loaded.planPath, changes.length || globalNote.trim()
      ? { hash: loaded.hash, ops: toChangeset(changes, loaded.hash).ops, notes, globalNote }
      : null);
  }, [loaded, changes, notes, globalNote]);

  const send = useCallback(async () => {
    const { loaded: L, hist: H } = latest.current;
    const { proposal: P, pui: U } = latest.current;
    const response = P && U && U.accepted !== null ? makeResponse(P, U.accepted, U.answers, U.reply) : undefined;
    const fr = focusPayload;
    if (!L || !H || (!changes.length && !response && !focusResponses.length) || blocking.length) return;
    const changeset = { ...toChangeset(changes, L.hash, globalNote), ...(response ? { proposal: response } : {}), ...(fr.length ? { focus: fr } : {}) };
    const r = await fetch("/api/changeset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changeset) });
    if (r.ok) {
      setSent(clone(H.present));
      setPending(true);
      if (fr.length) setFocusUI((ui) => Object.fromEntries(Object.entries(ui).map(([id, a]) => [id, fr.some((x) => x.id === id) ? { ...a, sent: true } : a])));
      const what = [
        ...(changeset.ops.length || (!response && !focusResponses.length) ? [`${changeset.ops.length} change(s)`] : []),
        ...(response ? ["your answer to the proposal"] : []),
        ...(focusResponses.length ? [`${focusResponses.length} focus answer${focusResponses.length === 1 ? "" : "s"}`] : []),
      ];
      setBanner({ tone: "info", text: `Sent ${what.join(", ").replace(/, ([^,]*)$/, " and $1")}. Waiting for the agent…` });
    } else if (r.status === 409) {
      setBanner({ tone: "warn", text: "plan.json changed since you loaded it. Reloading and reapplying your edits; review, then send again." });
      await adoptNewBase();
    } else if (r.status === 423) {
      setBanner({ tone: "info", text: (await r.json()).error });
    } else {
      setBanner({ tone: "warn", text: `Send failed: ${(await r.json()).error ?? r.statusText}` });
    }
  }, [changes, blocking.length, globalNote, adoptNewBase, focusPayload, focusResponses]);
  /** Something to send: edits, an answered proposal, or focus answers. */
  const sendable = changes.length + (proposalResponded ? 1 : 0) + focusResponses.length;

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
    send, sendable, sent: !!sent, unsentSinceSend, pending,
    proposal, pui, proposalOpen, proposalResponded, preview, previewing: previewing && !!preview, setPreviewing,
    proposalFailed, impacts, toggleProposalOp, setProposalOps, setAnswer, setReply,
    acceptProposal, rejectProposal, reopenProposal,
    focus, focusItems, focusUI, focusResponses, focusWaiting, setFocusChoice, setFocusText, setFocusDone, clearFocusAnswer,
    agentChanged, clearAgentChanged, banner, setBanner,
  };
}

export type Store = ReturnType<typeof usePlanStore>;
