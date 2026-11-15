import { useMemo, useState } from "react";
import { buildIndex, labelOf, uniqueId, userMeta, type Located, type Ref } from "../model/plan.ts";
import { revertChange, type Change } from "../model/diff.ts";
import type { Store } from "../store.ts";
import { ImpactBadge, StatusBadge } from "./fields.tsx";
import { clusterStats, clusters, type Cluster, type ClusterStats } from "../graph/groups.ts";
import { groupHue } from "../graph/GroupNodes.tsx";
import { surfaceOf } from "../model/plan.ts";

export type Tab = "map" | "review" | "decisions" | "issues" | "changes";

interface Props {
  store: Store;
  tab: Tab;
  setTab: (t: Tab) => void;
  selected: Ref | null;
  select: (ref: Ref | null) => void;
  openGroup: (groupId: string) => void;
}

const IMPACT_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const TYPE_RANK = ["decision", "surface", "interaction", "outcome", "element", "state", "group"];

export function Sidebar({ store, tab, setTab, selected, select, openGroup }: Props) {
  const review = useMemo(() => reviewItems(store.index), [store.index]);
  const groupCount = useMemo(() => (store.plan ? clusters(store.plan).length : 0), [store.plan]);
  const counts = {
    map: groupCount,
    review: review.length,
    decisions: store.plan?.decisions.length ?? 0,
    issues: store.issues.filter((i) => i.severity !== "info").length,
    changes: store.changes.length,
  };
  return (
    <aside className="sidebar">
      <nav className="tabs">
        {(["map", "review", "decisions", "issues", "changes"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
            {counts[t] > 0 && <span className={`count${t === "issues" && store.blocking.length ? " count-error" : ""}`}>{counts[t]}</span>}
          </button>
        ))}
      </nav>
      <div className="tab-body">
        {tab === "map" && <MapTab store={store} selected={selected} select={select} openGroup={openGroup} />}
        {tab === "review" && <ReviewTab store={store} items={review} selected={selected} select={select} />}
        {tab === "decisions" && <DecisionsTab store={store} selected={selected} select={select} />}
        {tab === "issues" && <IssuesTab store={store} select={select} />}
        {tab === "changes" && <ChangesTab store={store} select={select} />}
      </div>
    </aside>
  );
}

/* ───────────────────────── map ───────────────────────── */

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function MapTab({ store, selected, select, openGroup }: { store: Store; selected: Ref | null; select: (r: Ref) => void; openGroup: (g: string) => void }) {
  const plan = store.plan!;
  const list = useMemo(() => clusters(plan), [plan]);
  const stats = useMemo(() => clusterStats(plan, store.index, store.issues), [plan, store.index, store.issues]);
  // Unreviewed items per surface, for the expanded lists.
  const todo = useMemo(() => {
    const m = new Map<Ref, number>();
    const bump = (sid: Ref, status: string) => { if (status !== "confirmed") m.set(sid, (m.get(sid) ?? 0) + 1); };
    for (const s of plan.surfaces) {
      bump(s.id, s.meta.status);
      for (const x of [...(s.states ?? []), ...(s.elements ?? [])]) bump(s.id, x.meta.status);
    }
    for (const it of plan.interactions) {
      const sid = surfaceOf(it.from);
      bump(sid, it.meta.status);
      for (const o of it.outcomes) bump(sid, o.meta.status);
    }
    return m;
  }, [plan]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const named = list.filter((c) => c.id !== "__ungrouped").length;

  return (
    <div className="map">
      <p className="muted small">
        {named
          ? `${named} group${named === 1 ? "" : "s"} · ${plan.surfaces.length} surfaces. Click a group to zoom to it; expand it to see its surfaces.`
          : "This plan has no groups yet. Ask the agent to group the surfaces by area of the app: large plans are much easier to read that way."}
      </p>
      <ul className="map-list">
        {list.map((c, i) => (
          <MapGroup
            key={c.id} cluster={c} stats={stats.get(c.id)} hue={groupHue(i)} expanded={open.has(c.id)}
            onToggle={() => toggle(c.id)} onOpen={() => openGroup(c.id)}
            surfaces={c.surfaces.map((sid) => store.index.get(sid)).filter((l): l is Extract<Located, { type: "surface" }> => l?.type === "surface")}
            todo={todo} selected={selected} select={select}
          />
        ))}
      </ul>
    </div>
  );
}

function MapGroup({ cluster, stats, hue, expanded, onToggle, onOpen, surfaces, todo, selected, select }: {
  cluster: Cluster; stats?: ClusterStats; hue: number; expanded: boolean; onToggle: () => void; onOpen: () => void;
  surfaces: Extract<Located, { type: "surface" }>[]; todo: Map<Ref, number>; selected: Ref | null; select: (r: Ref) => void;
}) {
  return (
    <li className="map-group" style={{ "--g": `${hue}` } as React.CSSProperties}>
      <div className="map-head">
        <button className="map-caret" onClick={onToggle} title={expanded ? "Collapse" : "Show surfaces"}>{expanded ? "▾" : "▸"}</button>
        <button className="map-title" onClick={onOpen} title="Zoom to this group">
          <span className="map-swatch" />
          <span className="map-name">{cluster.name}</span>
          {stats && stats.unreviewed > 0 && <span className="map-stodo">{stats.unreviewed} to review</span>}
        </button>
      </div>
      {cluster.description && <div className="map-desc">{cluster.description}</div>}
      {stats && (
        <div className="map-stats">
          {plural(stats.surfaces, "surface")} · {plural(stats.actions, "action")} · {plural(stats.outcomes, "outcome")}
          {stats.problems > 0 && <span className="map-warn"> · {stats.problems} issue{stats.problems === 1 ? "" : "s"}</span>}
          {stats.openDecisions > 0 && <span className="map-todo"> · {stats.openDecisions} open decision{stats.openDecisions === 1 ? "" : "s"}</span>}
        </div>
      )}
      {expanded && (
        <ul className="map-surfaces">
          {surfaces.map(({ item: s }) => (
            <li key={s.id} className={selected === s.id ? "is-selected" : ""} onClick={() => select(s.id)}>
              <span className={`ptag gp-${s.profile}`}>{s.profile}</span>
              <span className="map-sname">{s.name}</span>
              {(todo.get(s.id) ?? 0) > 0 && <span className="map-stodo">{todo.get(s.id)}</span>}
              {s.address && <span className="map-addr">{s.address}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/* ───────────────────────── review ───────────────────────── */

function reviewItems(idx: Map<Ref, Located>): Located[] {
  const out = [...idx.values()].filter((l) => l.item.meta.status !== "confirmed");
  return out.sort((a, b) => {
    const sa = a.item.meta.status === "sketch" ? 0 : 1, sb = b.item.meta.status === "sketch" ? 0 : 1;
    const ta = TYPE_RANK.indexOf(a.type), tb = TYPE_RANK.indexOf(b.type);
    const ia = a.type === "decision" ? IMPACT_RANK[a.item.impact] : 3, ib = b.type === "decision" ? IMPACT_RANK[b.item.impact] : 3;
    return ia - ib || sa - sb || ta - tb;
  });
}

type Filter = "important" | "all" | "sketch";

function ReviewTab({ store, items, selected, select }: { store: Store; items: Located[]; selected: Ref | null; select: (r: Ref) => void }) {
  const [filter, setFilter] = useState<Filter>("important");
  const shown = items.filter((l) =>
    filter === "all" ? true :
    filter === "sketch" ? l.item.meta.status === "sketch" :
    l.item.meta.status === "sketch" || (l.type === "decision" && l.item.impact !== "low"),
  );
  const confirm = (refs: Ref[]) =>
    store.edit((p) => {
      const idx = buildIndex(p);
      for (const r of refs) { const l = idx.get(r); if (l) l.item.meta = { ...l.item.meta, status: "confirmed" }; }
    });
  const total = store.index.size;

  return (
    <div className="review">
      <div className="progress">
        <div className="bar"><div style={{ width: `${total ? ((total - items.length) / total) * 100 : 0}%` }} /></div>
        <span>{total - items.length} of {total} reviewed</span>
      </div>
      <div className="seg">
        <button className={filter === "important" ? "on" : ""} onClick={() => setFilter("important")}>Needs you</button>
        <button className={filter === "sketch" ? "on" : ""} onClick={() => setFilter("sketch")}>Sketches</button>
        <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All unreviewed</button>
      </div>
      {filter === "important" && <p className="hint">Decisions with medium or high impact, and anything that needs detail. Everything else is in “All unreviewed”.</p>}
      {shown.length === 0 && <p className="empty-state">Nothing here. 🎉</p>}
      <ul className="rlist">
        {shown.map((l) => (
          <li key={l.ref} className={selected === l.ref ? "is-selected" : ""} onClick={() => select(l.ref)}>
            <div className="rl-top">
              <span className="rl-type">{l.type}</span>
              {l.type === "decision" && <ImpactBadge impact={l.item.impact} />}
              {l.item.meta.status === "sketch" && <StatusBadge status="sketch" />}
              {store.agentChanged.has(l.ref) && <span className="agent-dot" title="Updated by the agent" />}
            </div>
            <div className="rl-label">{labelOf(store.index, l.ref)}</div>
            {l.type === "decision" && <div className="rl-value">{l.item.value || <em>undecided</em>}</div>}
            {l.type === "outcome" && <div className="rl-value">→ {labelOf(store.index, l.item.to)}</div>}
            {l.item.meta.status === "proposed" && (
              <button className="btn small rl-confirm" onClick={(e) => { e.stopPropagation(); confirm([l.ref]); }}>Confirm</button>
            )}
          </li>
        ))}
      </ul>
      {shown.some((l) => l.item.meta.status === "proposed") && (
        <button
          className="btn ghost block"
          onClick={() => {
            const refs = shown.filter((l) => l.item.meta.status === "proposed").map((l) => l.ref);
            if (window.confirm(`Confirm all ${refs.length} items shown without reviewing them individually?`)) confirm(refs);
          }}
        >
          Confirm all shown
        </button>
      )}
    </div>
  );
}

/* ───────────────────────── decisions ───────────────────────── */

function DecisionsTab({ store, selected, select }: { store: Store; selected: Ref | null; select: (r: Ref) => void }) {
  const plan = store.plan!;
  const profiles = store.loaded!.profiles;
  const sorted = [...plan.decisions].sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact]);
  const answered = new Set(plan.decisions.map((d) => d.checklistKey).filter(Boolean));
  const gaps = plan.profiles.flatMap((pid) => (profiles[pid]?.decisionChecklist ?? []).filter((c) => !answered.has(c.key)).map((c) => ({ ...c, pid })));

  const addDecision = (question: string, checklistKey?: string) => {
    const id = uniqueId(store.index, `d.${checklistKey ?? "new"}`);
    const sel = selected && store.index.get(selected);
    const attach = sel && sel.type !== "decision" && sel.type !== "group" ? [selected!] : [];
    store.edit((p) => {
      p.decisions.push({ id, attachedTo: checklistKey ? [] : attach, question, value: "", impact: "medium", ...(checklistKey ? { checklistKey } : {}), meta: userMeta("sketch") });
    });
    select(id);
  };

  return (
    <div className="decisions">
      <button className="btn block" onClick={() => addDecision("New decision")}>+ New decision{selected ? " on selection" : ""}</button>
      <ul className="rlist">
        {sorted.map((d) => (
          <li key={d.id} className={selected === d.id ? "is-selected" : ""} onClick={() => select(d.id)}>
            <div className="rl-top">
              <ImpactBadge impact={d.impact} />
              <StatusBadge status={d.meta.status} />
              {store.agentChanged.has(d.id) && <span className="agent-dot" />}
            </div>
            <div className="rl-label">{d.question}</div>
            <div className="rl-value">{d.value || <em>undecided</em>}</div>
          </li>
        ))}
      </ul>
      {gaps.length > 0 && (
        <>
          <h4 className="subhead">Unanswered checklist ({gaps.length})</h4>
          <p className="hint">Questions every {plan.profiles.join(" / ")} project should answer. Add one to answer it yourself, or leave the answer empty and the agent will propose one.</p>
          <ul className="gaps">
            {gaps.map((g) => (
              <li key={`${g.pid}:${g.key}`}>
                <span className="ptag">{g.pid}</span>
                <span>{g.question}</span>
                <button className="btn small" onClick={() => addDecision(g.question, g.key)}>Add</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ───────────────────────── issues ───────────────────────── */

function IssuesTab({ store, select }: { store: Store; select: (r: Ref) => void }) {
  const [showInfo, setShowInfo] = useState(false);
  const shown = store.issues.filter((i) => showInfo || i.severity !== "info");
  const infoCount = store.issues.length - store.issues.filter((i) => i.severity !== "info").length;
  return (
    <div className="issues">
      {store.blocking.length > 0 && <p className="error-text">Fix {store.blocking.length} error(s) before sending.</p>}
      {shown.length === 0 && <p className="empty-state">No problems found.</p>}
      <ul className="ilist">
        {shown.map((i, k) => (
          <li key={k} className={`sev-${i.severity}${i.ref ? " clickable" : ""}`} onClick={() => i.ref && select(i.ref)}>
            <span className="sev">{i.severity}</span>
            <span>{i.message}</span>
          </li>
        ))}
      </ul>
      {infoCount > 0 && (
        <button className="btn ghost block" onClick={() => setShowInfo(!showInfo)}>
          {showInfo ? "Hide" : "Show"} {infoCount} informational
        </button>
      )}
    </div>
  );
}

/* ───────────────────────── changes ───────────────────────── */

function ChangesTab({ store, select }: { store: Store; select: (r: Ref) => void }) {
  const baseIdx = useMemo(() => (store.loaded ? buildIndex(store.loaded.base) : new Map()), [store.loaded]);
  const label = (c: Change) => {
    if (c.type === "plan") return "Project settings";
    return labelOf(c.kind === "remove" ? baseIdx : store.index, c.ref);
  };
  const revert = (c: Change) => {
    if (c.kind === "comment") return store.setNote(c.ref, "");
    store.replace(revertChange(store.loaded!.base, store.plan!, c));
    if (store.notes[c.ref]) store.setNote(c.ref, "");
  };
  const sentAndClean = store.sent && store.unsentSinceSend === 0;

  return (
    <div className="changes">
      {store.changes.length === 0 && <p className="empty-state">No changes yet. Edit the graph, confirm items, or add notes. Your changes collect here.</p>}
      <ul className="clist">
        {store.changes.map((c) => (
          <li key={c.key} onClick={() => c.kind !== "remove" && c.type !== "plan" && select(c.ref)}>
            <span className={`ctag ctag-${c.kind}`}>{c.kind}</span>
            <div className="c-body">
              <div className="c-label">{label(c)}</div>
              <div className="c-sub">
                {c.type}
                {c.fields && ` · ${c.fields.join(", ")}`}
              </div>
              {c.op.note && <div className="c-note">“{c.op.note}”</div>}
            </div>
            <button className="btn ghost small" title="Revert this change" onClick={(e) => { e.stopPropagation(); revert(c); }}>↶</button>
          </li>
        ))}
      </ul>
      {store.changes.length > 0 && (
        <div className="send-box">
          <textarea
            rows={2}
            placeholder="Overall note to the agent (optional)"
            value={store.globalNote}
            onChange={(e) => store.setGlobalNote(e.target.value)}
          />
          <button className="btn primary block" disabled={!!store.blocking.length || sentAndClean} onClick={store.send}>
            {sentAndClean ? "Sent ✓ waiting for agent" : store.sent ? `Send again (${store.changes.length})` : `Send ${store.changes.length} change(s) to agent`}
          </button>
          {store.blocking.length > 0 && <p className="error-text">Resolve errors in Issues first.</p>}
        </div>
      )}
    </div>
  );
}
