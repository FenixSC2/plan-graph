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
import { buildIndex, slug, uniqueId, userMeta, type Ref } from "./model/plan.ts";

export function App() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}

/** Node positions: view state only (not part of the plan), persisted per plan file in localStorage. */
function usePositions(store: Store) {
  // v2: grouped auto-layout. Positions saved by older versions are laid out again once.
  const key = store.loaded ? `plan-graph:pos:v2:${store.loaded.planPath}` : null;
  const [positions, setPositions] = useState<Record<string, XY> | null>(null);

  useEffect(() => {
    if (!key || positions) return;
    let stored: Record<string, XY> = {};
    try { stored = JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { /* private mode etc. */ }
    setPositions(stored);
  }, [key, positions]);

  // Give any surface without a position (first load, agent-added) one from auto-layout.
  useEffect(() => {
    if (!store.plan || !positions) return;
    const missing = store.plan.surfaces.filter((s) => !positions[s.id]);
    if (!missing.length) return;
    const auto = autoLayout(store.plan);
    setPositions((p) => {
      const n = { ...p };
      for (const s of missing) n[s.id] = auto[s.id];
      return n;
    });
  }, [store.plan, positions]);

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
  const [positions, setPositions] = usePositions(store);
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

  /** Select and pan the canvas to the item (used from side panels). */
  const selectAndFocus = useCallback((ref: Ref | null) => {
    select(ref);
    if (!ref) return;
    const sid = surfaceFor(store.index, ref);
    if (!sid) return;
    if (overview) setOverview(false);
    setTimeout(() => rf.fitView({ nodes: [{ id: sid }], duration: 350, maxZoom: 1.1, padding: 0.8 }), overview ? 60 : 0);
  }, [select, store.index, rf, overview]);

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
    if (selected && !store.index.has(selected)) setSelected(null);
  }, [store.index, selected]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || document.querySelector(".modal")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); setDeleting(selected); }
      else if (e.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store.undo, store.redo, selected, select]);

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

  const ui = useMemo(() => ({ selected, select, agentChanged: store.agentChanged, index: store.index, openGroup }), [selected, select, store.agentChanged, store.index, openGroup]);

  if (store.loadError) return <div className="fatal">Couldn't load the plan: {store.loadError}</div>;
  if (!store.plan || !store.loaded || !positions || overview === null) return <div className="fatal muted">Loading plan…</div>;

  const plan = store.plan;
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
            {store.pending && <span className="pending" title="The agent has your changes and is working on them"><span className="pulse" /> waiting for agent</span>}
            <button
              className="btn primary"
              disabled={!store.changes.length || !!store.blocking.length || sentClean}
              onClick={() => { setTab("changes"); store.send(); }}
              title={store.blocking.length ? "Fix errors in Issues first" : undefined}
            >
              {sentClean ? "Sent ✓" : `Send changes${store.changes.length ? ` (${store.changes.length})` : ""}`}
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
              onConnect={onConnect}
              onRetarget={onRetarget}
              overview={overview}
              issues={store.issues}
            />
          )}
        </main>

        <aside className="rightpane">
          {selected ? (
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
      </ul>

      <h4 className="subhead">How to edit</h4>
      <ul className="howto">
        <li>Click anything to inspect and edit it. Editing an item marks it reviewed.</li>
        <li>Drag an arrow's head onto another surface to change where it goes.</li>
        <li>Drag from a row's handle to add an outcome, or from “drag to connect” to add an interaction.</li>
        <li>Select something and press Delete to remove it; you'll see exactly what else changes.</li>
        <li>Everything you do collects in <b>Changes</b>. Hit <b>Send</b> to hand it to the agent.</li>
      </ul>
    </div>
  );
}
