import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { usePlanStore, type Store } from "./store.ts";
import { Canvas } from "./graph/Canvas.tsx";
import { autoLayout, surfaceFor, type XY } from "./graph/build.ts";
import { clusters } from "./graph/groups.ts";
import { Inspector } from "./ui/Inspector.tsx";
import { Sidebar, type Tab } from "./ui/Sidebar.tsx";
import { AddSurfaceDialog, DeleteDialog } from "./ui/Dialogs.tsx";
import { UIContext } from "./ui/context.ts";
import { TextField } from "./ui/fields.tsx";
import { ProposedItem } from "./ui/ProposalTab.tsx";
import { TraceBar } from "./graph/TraceBar.tsx";
import { stopSmoothWheel } from "./graph/smoothWheel.ts";
import { buildIndex, labelOf, slug, surfaceOf, uniqueId, userMeta, type Plan, type Ref } from "./model/plan.ts";

export function App() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}

/** Node positions: view state only (not part of the plan), persisted per plan file in localStorage. */
function usePositions(store: Store, plan: Plan | null) {
  // v2: grouped auto-layout. Positions saved by older versions are laid out again once.
  const key = store.loaded ? `plan-graph:pos:v2:${store.loaded.planPath}` : null;
  const [positions, setPositions] = useState<Record<string, XY> | null>(null);

  useEffect(() => {
    if (!key || positions) return;
    let stored: Record<string, XY> = {};
    try { stored = JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { /* private mode etc. */ }
    setPositions(stored);
  }, [key, positions]);

  // Give any surface without a position (first load, agent-added, previewed) one from auto-layout.
  useEffect(() => {
    if (!plan || !positions) return;
    const missing = plan.surfaces.filter((s) => !positions[s.id]);
    if (!missing.length) return;
    const auto = autoLayout(plan);
    setPositions((p) => {
      const n = { ...p };
      for (const s of missing) n[s.id] = auto[s.id];
      return n;
    });
  }, [plan, positions]);

  useEffect(() => {
    if (!key || !positions) return;
    try { localStorage.setItem(key, JSON.stringify(positions)); } catch { /* ignore */ }
  }, [key, positions]);

  return [positions, setPositions] as const;
}

function Workspace() {
  const store = usePlanStore();
  const rf = useReactFlow();
  const [selected, setSelected] = useState<Ref | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  const [showCalls, setShowCalls] = useState(true);
  const [deleting, setDeleting] = useState<Ref | null>(null);
  const [adding, setAdding] = useState(false);
  // While the agent's proposal is previewed, the canvas shows the plan with it applied (read-only).
  const previewing = store.previewing && !!store.preview;
  const shownPlan = previewing ? store.preview!.plan : store.plan;
  const shownIndex = previewing ? store.preview!.index : store.index;
  const [positions, setPositions] = usePositions(store, shownPlan);
  // Large grouped plans open on the group map, so people see the shape before the detail.
  const [overview, setOverview] = useState<boolean | null>(null);
  useEffect(() => {
    if (overview !== null || !store.plan) return;
    const big = store.plan.surfaces.length > 30 && clusters(store.plan).filter((c) => c.id !== "__ungrouped").length >= 3;
    setOverview(big);
    if (big) setTab("map");
  }, [overview, store.plan]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  if (import.meta.env.DEV) (window as any).__rf = rf; // debugging handle

  const select = useCallback((ref: Ref | null) => {
    setSelected(ref);
    if (ref) store.clearAgentChanged(ref);
  }, [store.clearAgentChanged]);

  /**
   * Glide the canvas to a surface: centred, with its header in view, at a readable zoom. Long
   * jumps zoom out a little on the way ("smooth" interpolation) so you see where you're going.
   */
  const glideTo = useCallback((sid: string) => {
    stopSmoothWheel(canvasRef.current?.querySelector(".react-flow") as HTMLElement | null);
    const go = () => {
      const n = rf.getInternalNode(sid);
      const box = canvasRef.current?.getBoundingClientRect();
      if (!n || !box) return;
      const w = n.measured?.width ?? n.width ?? n.initialWidth ?? 280;
      const h = n.measured?.height ?? n.height ?? n.initialHeight ?? 200;
      const zoom = Math.min(1.25, Math.max(0.75, rf.getZoom()));
      const visibleH = box.height / zoom;
      const { x, y } = n.internals.positionAbsolute;
      // Tall surfaces: centre their top part rather than their middle, so the name stays on screen.
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      rf.setCenter(x + w / 2, y + Math.min(h, visibleH * 0.8) / 2, { zoom, duration: still ? 0 : 650, interpolate: "smooth" });
    };
    if (overview) { setOverview(false); setTimeout(go, 60); } else go();
  }, [rf, overview]);

  /** Select and pan the canvas to the item (used from side panels). */
  const selectAndFocus = useCallback((ref: Ref | null) => {
    select(ref);
    if (!ref) return;
    const sid = surfaceFor(shownIndex, ref);
    if (sid) glideTo(sid);
  }, [select, shownIndex, glideTo]);

  // ── tracing: follow arrows hop by hop, with a trail to go back along ──
  const [trail, setTrail] = useState<Ref[]>([]);
  const follow = useCallback((ref: Ref) => {
    const loc = shownIndex.get(ref);
    if (!loc) return;
    // An outcome leads to its destination; anything else is selected where it is.
    const dest = loc.type === "outcome" ? loc.item.to ?? surfaceOf(loc.parent.from) : ref;
    const sid = surfaceFor(shownIndex, dest);
    if (selected && selected !== dest) setTrail((t) => [...t.slice(-49), selected]);
    select(dest);
    if (sid) glideTo(sid);
  }, [shownIndex, selected, select, glideTo]);
  const back = useCallback(() => {
    // Drop trail entries that no longer exist (deleted, or a proposal preview was closed).
    const t = [...trail];
    while (t.length && !shownIndex.has(t[t.length - 1])) t.pop();
    const prev = t.pop();
    setTrail(t);
    if (!prev) return;
    select(prev);
    const sid = surfaceFor(shownIndex, prev);
    if (sid) glideTo(sid);
  }, [trail, shownIndex, select, glideTo]);
  const backTo = [...trail].reverse().find((r) => shownIndex.has(r));

  // A new proposal from the agent: open its tab and frame what it touches.
  const proposalId = store.proposalOpen ? store.proposal!.id : null;
  useEffect(() => {
    if (!proposalId || !store.preview) return;
    setTab("proposal");
    const sids = [...new Set([...store.preview.marks.keys()].map((r) => surfaceFor(store.preview!.index, r)).filter((x): x is string => !!x))];
    if (!sids.length) return;
    setOverview(false);
    setTimeout(() => rf.fitView({ nodes: sids.map((id) => ({ id })), duration: 400, padding: 0.25, maxZoom: 1 }), 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId]);
  // The agent picked up the answer (proposal.json is gone): leave the tab.
  useEffect(() => {
    if (tab === "proposal" && !store.proposal) setTab("changes");
  }, [tab, store.proposal]);

  /** Zoom to a whole group's surfaces (leaving the group map if it's showing). */
  const openGroup = useCallback((gid: string) => {
    const c = store.plan ? clusters(store.plan).find((x) => x.id === gid) : undefined;
    if (!c) return;
    setOverview(false);
    // At least readable detail zoom: a big group is centred rather than squeezed into compact cards.
    setTimeout(() => rf.fitView({ nodes: c.surfaces.map((id) => ({ id })), duration: 400, padding: 0.12, minZoom: 0.6, maxZoom: 1 }), 60);
  }, [store.plan, rf]);

  // drop selection if the item disappears (undo, agent update)
  useEffect(() => {
    if (selected && !shownIndex.has(selected)) setSelected(null);
  }, [shownIndex, selected]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || document.querySelector(".modal")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selected && !previewing) { e.preventDefault(); setDeleting(selected); }
      else if (e.key === "Escape") select(null);
      else if (e.key === "]" && selected) { e.preventDefault(); follow(selected); }
      else if (e.key === "[") { e.preventDefault(); back(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store.undo, store.redo, selected, select, previewing, follow, back]);

  const onConnect = useCallback((source: string, handle: string, target: string) => {
    const idx = store.index;
    const tgt = idx.get(target);
    const tname = tgt?.type === "surface" ? tgt.item.name : target;
    const src = idx.get(source);
    const prof = src?.type === "surface" ? store.loaded?.profiles[src.item.profile] : undefined;
    if (handle === "__new") {
      const id = uniqueId(idx, `${source}.to-${slug(tname)}`);
      store.edit((p) => {
        p.interactions.push({
          id, from: source,
          trigger: { kind: prof?.triggerKinds[0] ?? "click", description: `Go to ${tname}` },
          outcomes: [{ id: `${id}.go`, when: "always", to: target, meta: userMeta() }],
          meta: userMeta("sketch"),
        });
      });
      select(id);
    } else {
      const id = uniqueId(idx, `${handle}.to-${slug(tname)}`);
      store.edit((p) => {
        const it = buildIndex(p).get(handle);
        if (it?.type === "interaction") it.item.outcomes.push({ id, when: "New condition", to: target, meta: userMeta() });
      });
      select(id);
    }
  }, [store, select]);

  const onRetarget = useCallback((outcomeId: string, target: string) => {
    store.edit((p) => {
      const l = buildIndex(p).get(outcomeId);
      if (l?.type !== "outcome") return;
      l.item.to = target;
      if (l.item.meta.status === "proposed") l.item.meta = { ...l.item.meta, status: "confirmed" };
    });
    select(outcomeId);
  }, [store, select]);

  const marks = previewing ? store.preview!.marks : undefined;
  const ui = useMemo(() => ({ selected, select, agentChanged: store.agentChanged, index: shownIndex, marks, follow, openGroup }), [selected, select, store.agentChanged, shownIndex, marks, follow, openGroup]);

  if (store.loadError) return <div className="fatal">Couldn't load the plan: {store.loadError}</div>;
  if (!store.plan || !shownPlan || !store.loaded || !positions || overview === null) return <div className="fatal muted">Loading plan…</div>;

  const plan = shownPlan;
  if (!mounted.current && plan.surfaces.every((s) => positions[s.id])) mounted.current = true;
  const sentClean = store.sent && store.unsentSinceSend === 0;

  return (
    <UIContext.Provider value={ui}>
      <div className="app">
        <header className="toolbar">
          <div className="brand">
            <span className="logo">◆</span> Plan Graph
            <span className="sep">/</span>
            <span className="project">{plan.project.name}</span>
            <span className="badge">{plan.mode}</span>
          </div>
          <div className="tools">
            <button className="btn ghost" onClick={store.undo} disabled={!store.canUndo} title="Undo (⌘Z)">↶</button>
            <button className="btn ghost" onClick={store.redo} disabled={!store.canRedo} title="Redo (⇧⌘Z)">↷</button>
            <span className="divider" />
            {clusters(plan).some((c) => c.id !== "__ungrouped") && (
              <div className="seg view-toggle" title="Group map: one card per group. All surfaces: the full graph.">
                <button className={overview ? "on" : ""} onClick={() => setOverview(true)}>Group map</button>
                <button className={!overview ? "on" : ""} onClick={() => { setOverview(false); setTimeout(() => rf.fitView({ padding: 0.15, duration: 300 }), 60); }}>All surfaces</button>
              </div>
            )}
            <span className="divider" />
            <button className="btn" onClick={() => setAdding(true)}>+ Surface</button>
            <button className="btn ghost" onClick={() => { setOverview(false); setPositions(autoLayout(plan)); setTimeout(() => rf.fitView({ padding: 0.15, duration: 300 }), 50); }}>Auto layout</button>
            <label className="check">
              <input type="checkbox" checked={showCalls} onChange={(e) => setShowCalls(e.target.checked)} /> Show calls
            </label>
          </div>
          <div className="send-area">
            {store.proposalOpen && (
              <button
                className={`btn proposal-pill${previewing ? " on" : ""}`}
                title={previewing ? "Showing the agent's proposal on the graph. Click to show your plan as it is." : "Show the agent's proposal on the graph"}
                onClick={() => { store.setPreviewing(!previewing); setTab("proposal"); }}
              >
                <span className="pm-swatch" /> {previewing ? "Previewing proposal" : "Preview proposal"}
              </button>
            )}
            {store.pending && <span className="pending" title="The agent has your changes and is working on them"><span className="pulse" /> waiting for agent</span>}
            <button
              className="btn primary"
              disabled={!store.sendable || !!store.blocking.length || sentClean}
              onClick={() => { setTab(store.proposalResponded ? "proposal" : "changes"); store.send(); }}
              title={store.blocking.length ? "Fix errors in Issues first" : store.proposalOpen ? "Accept or reject the agent's proposal in the Proposal tab to include your answer" : undefined}
            >
              {sentClean ? "Sent ✓" : store.proposalResponded && !store.changes.length ? "Send answer" : `Send changes${store.changes.length ? ` (${store.changes.length})` : ""}`}
            </button>
          </div>
        </header>

        <Sidebar store={store} tab={tab} setTab={setTab} selected={selected} select={selectAndFocus} openGroup={openGroup} />

        <main className="canvas" ref={canvasRef}>
          {store.banner && (
            <div className={`banner banner-${store.banner.tone}`}>
              <span>{store.banner.text}</span>
              <button className="btn ghost small" onClick={() => store.setBanner(null)}>✕</button>
            </div>
          )}
          {mounted.current && (
            <Canvas
              plan={plan}
              positions={positions}
              onMoved={(id, pos) => setPositions((p) => ({ ...p!, [id]: pos }))}
              showCalls={showCalls}
              onConnect={previewing ? () => {} : onConnect}
              onRetarget={previewing ? () => {} : onRetarget}
              overview={overview}
              issues={store.issues}
            />
          )}
          {mounted.current && !overview && (
            <TraceBar
              plan={plan}
              index={shownIndex}
              selected={selected}
              follow={follow}
              back={backTo ? back : null}
              backLabel={backTo ? labelOf(shownIndex, backTo) : undefined}
            />
          )}
        </main>

        <aside className="rightpane">
          {selected && previewing ? (
            <ProposedItem key={selected} store={store} selected={selected} />
          ) : selected ? (
            <Inspector key={selected} store={store} selected={selected} select={selectAndFocus} requestDelete={setDeleting} />
          ) : (
            <ProjectPanel store={store} />
          )}
        </aside>
      </div>

      {deleting && <DeleteDialog store={store} target={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); select(null); }} />}
      {adding && (
        <AddSurfaceDialog
          store={store}
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            const r = canvasRef.current?.getBoundingClientRect();
            const center = r ? rf.screenToFlowPosition({ x: r.left + r.width / 2 - 140, y: r.top + r.height / 2 - 60 }) : { x: 0, y: 0 };
            setPositions((p) => ({ ...p!, [id]: freeSpot(center, rf.getNodes()) }));
            setAdding(false);
            select(id);
          }}
        />
      )}
    </UIContext.Provider>
  );
}

/** Nearest spot to `start` (spiralling outward) where a new 280×120 node won't overlap existing nodes. */
function freeSpot(start: XY, nodes: { position: XY; measured?: { width?: number; height?: number } }[]): XY {
  const W = 280, H = 120, GAP = 30;
  const hits = (x: number, y: number) =>
    nodes.some((n) => {
      const w = n.measured?.width ?? 280, h = n.measured?.height ?? 200;
      return x < n.position.x + w + GAP && x + W + GAP > n.position.x && y < n.position.y + h + GAP && y + H + GAP > n.position.y;
    });
  for (let ring = 0; ring < 12; ring++) {
    for (let i = 0; i < Math.max(1, ring * 8); i++) {
      const a = (i / Math.max(1, ring * 8)) * Math.PI * 2;
      const x = start.x + Math.cos(a) * ring * 160, y = start.y + Math.sin(a) * ring * 110;
      if (!hits(x, y)) return { x, y };
    }
  }
  return start;
}

function ProjectPanel({ store }: { store: Store }) {
  const plan = store.plan!;
  const outcomes = plan.interactions.reduce((n, it) => n + it.outcomes.length, 0);
  const setProject = (k: "name" | "summary") => (v: string) => store.edit((p) => { p.project = { ...p.project, [k]: v }; });
  return (
    <div className="inspector project">
      <div className="insp-head">
        <div className="insp-type">project</div>
      </div>
      <TextField label="Name" value={plan.project.name} onCommit={setProject("name")} />
      <TextField label="Summary" multiline value={plan.project.summary} onCommit={setProject("summary")} />
      <div className="stats">
        <div><b>{plan.surfaces.length}</b><span>surfaces</span></div>
        <div><b>{plan.interactions.length}</b><span>interactions</span></div>
        <div><b>{outcomes}</b><span>outcomes = tests</span></div>
        <div><b>{plan.decisions.length}</b><span>decisions</span></div>
      </div>
      <p className="muted small">Platforms: {plan.profiles.join(", ")}<br />File: <code>{store.loaded!.planPath}</code></p>

      <h4 className="subhead">Legend</h4>
      <ul className="legend">
        <li><span className="lg lg-proposed" /> Proposed by the agent, not yet reviewed</li>
        <li><span className="lg lg-confirmed" /> Confirmed</li>
        <li><span className="lg lg-sketch" /> Needs detail: the agent will fill it in</li>
        <li><span className="lg lg-call" /> Calls another surface (cross-platform)</li>
        <li><span className="agent-dot" /> Updated by the agent since you last looked</li>
        <li><span className="lg lg-pm-add" /> Added by the agent's proposal (preview)</li>
        <li><span className="lg lg-pm-update" /> Changed by the proposal</li>
        <li><span className="lg lg-pm-remove" /> Removed by the proposal</li>
      </ul>

      <h4 className="subhead">How to edit</h4>
      <ul className="howto">
        <li>Scroll to pan; pinch or ⌘-scroll to zoom.</li>
        <li>Select an arrow or surface to trace where it comes from and leads to. <b>]</b> follows the selected arrow, <b>[</b> goes back.</li>
        <li>Click anything to inspect and edit it. Editing an item marks it reviewed.</li>
        <li>Drag an arrow's head onto another surface to change where it goes.</li>
        <li>Drag from a row's handle to add an outcome, or from “drag to connect” to add an interaction.</li>
        <li>Select something and press Delete to remove it; you'll see exactly what else changes.</li>
        <li>Everything you do collects in <b>Changes</b>. Hit <b>Send</b> to hand it to the agent.</li>
      </ul>
    </div>
  );
}
