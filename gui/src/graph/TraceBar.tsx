// Trace bar: follow the graph from whatever is selected. For an arrow (outcome) it shows where it
// starts and where it lands; for a surface or action it lists where you can go next and where
// you can come from. Every entry glides the canvas there and selects it, so you can walk a flow
// hop by hop, with Back to retrace your steps.
import { useMemo, useState } from "react";
import { interactionLabel, labelOf, surfaceOf, type Interaction, type Plan, type PlanIndex, type Ref } from "../model/plan.ts";

interface Props {
  plan: Plan;
  index: PlanIndex;
  selected: Ref | null;
  follow: (ref: Ref) => void;
  back: (() => void) | null;
  backLabel?: string;
}

interface Hop {
  /** What clicking selects (and glides to). */
  ref: Ref;
  surface: Ref;
  name: string;
  /** The conditions / actions behind this hop, for the tooltip and sub-label. */
  via: string[];
  kind: "path" | "call";
}

const LIMIT = 8;

/** Group hops by the surface they lead to (or come from), keeping the first ref to select. */
function group(hops: Hop[]): Hop[] {
  const m = new Map<string, Hop>();
  for (const h of hops) {
    const key = `${h.kind}:${h.surface}`;
    const g = m.get(key);
    if (g) g.via.push(...h.via);
    else m.set(key, { ...h, via: [...h.via] });
  }
  return [...m.values()];
}

export function TraceBar({ plan, index, selected, follow, back, backLabel }: Props) {
  const loc = selected ? index.get(selected) : undefined;
  const name = (ref: Ref | null | undefined) => (ref ? labelOf(index, surfaceOf(ref)) : "");

  const view = useMemo(() => {
    if (!loc) return null;
    // An arrow: from → to.
    if (loc.type === "outcome") {
      const it = loc.parent, o = loc.item;
      return { kind: "edge" as const, it, o };
    }
    let sid: Ref | undefined;
    let only: Interaction | undefined;
    if (loc.type === "surface") sid = loc.item.id;
    else if (loc.type === "state" || loc.type === "element") sid = loc.parent.id;
    else if (loc.type === "interaction") { sid = surfaceOf(loc.item.from); only = loc.item; }
    if (!sid) return null;

    const outs: Hop[] = [], ins: Hop[] = [];
    const callee = (target: Ref) => {
      const t = index.get(target);
      return t?.type === "interaction" ? t.item : undefined;
    };
    for (const it of plan.interactions) {
      const from = surfaceOf(it.from);
      if (from === sid && (!only || it.id === only.id)) {
        for (const o of it.outcomes) {
          if (o.to == null || surfaceOf(o.to) === sid) continue;
          outs.push({ ref: o.id, surface: surfaceOf(o.to), name: name(o.to), via: [o.when], kind: "path" });
        }
        for (const e of it.effects ?? []) {
          const c = e.kind === "calls" ? callee(e.target) : undefined;
          if (c && surfaceOf(c.from) !== sid) outs.push({ ref: c.id, surface: surfaceOf(c.from), name: name(c.from), via: [interactionLabel(index, it)], kind: "call" });
        }
      }
      if (from !== sid && !only) {
        for (const o of it.outcomes) {
          if (o.to != null && surfaceOf(o.to) === sid) ins.push({ ref: it.id, surface: from, name: name(from), via: [o.when], kind: "path" });
        }
        for (const e of it.effects ?? []) {
          const c = e.kind === "calls" ? callee(e.target) : undefined;
          if (c && surfaceOf(c.from) === sid) ins.push({ ref: it.id, surface: from, name: name(from), via: [interactionLabel(index, it)], kind: "call" });
        }
      }
    }
    return { kind: "node" as const, sid, only, outs: group(outs), ins: group(ins) };
  }, [loc, plan, index]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view) {
    return back ? (
      <div className="trace-bar"><BackButton back={back} label={backLabel} /></div>
    ) : null;
  }

  if (view.kind === "edge") {
    const { it, o } = view;
    const from = surfaceOf(it.from);
    return (
      <div className="trace-bar trace-edge">
        {back && <BackButton back={back} label={backLabel} />}
        <button className="trace-end" onClick={() => follow(it.id)} title="Go to where this action starts">
          <span className="trace-arrow">⟵</span> {name(from)}
        </button>
        <div className="trace-mid" title={o.result}>
          <span className="trace-action">{interactionLabel(index, it)}</span>
          <span className="trace-when">{o.when}</span>
        </div>
        {o.to ? (
          <button className="trace-end trace-to" onClick={() => follow(o.id)} title="Follow the arrow (or press ])">
            {name(o.to)}{o.to.includes("#") && <span className="trace-state"> · {o.to.split("#")[1]}</span>} <span className="trace-arrow">⟶</span>
          </button>
        ) : (
          <span className="trace-stays">stays on {name(from)}</span>
        )}
        <span className="trace-keys" title="Keyboard: ] follows the selected arrow, [ goes back">] follow · [ back</span>
      </div>
    );
  }

  return (
    <div className="trace-bar trace-node">
      <div className="trace-head">
        {back && <BackButton back={back} label={backLabel} />}
        <div className="trace-here">{name(view.sid)}{view.only && <span className="trace-action"> · {interactionLabel(index, view.only)}</span>}</div>
        <span className="trace-keys" title="Keyboard: ] follows the selected arrow, [ goes back">] follow · [ back</span>
      </div>
      <HopList title="From" hops={view.ins} follow={follow} dir="in" empty={view.only ? null : plan.entryPoints.includes(view.sid) ? "entry point" : "nothing leads here"} />
      <HopList title="Leads to" hops={view.outs} follow={follow} dir="out" empty="stays here" />
    </div>
  );
}

function BackButton({ back, label }: { back: () => void; label?: string }) {
  return (
    <button className="trace-back" onClick={back} title={`Back${label ? ` to ${label}` : ""} ([)`}>
      ↶ <span className="trace-back-label">{label ?? "Back"}</span>
    </button>
  );
}

function HopList({ title, hops, follow, dir, empty }: { title: string; hops: Hop[]; follow: (r: Ref) => void; dir: "in" | "out"; empty: string | null }) {
  const [all, setAll] = useState(false);
  if (!hops.length && empty === null) return null;
  const shown = all ? hops : hops.slice(0, LIMIT);
  return (
    <div className={`trace-hops trace-${dir}`}>
      <span className="trace-title">{title}</span>
      <div className="trace-chips">
      {!hops.length && <span className="trace-none">{empty}</span>}
      {shown.map((h) => (
        <button key={`${h.kind}:${h.surface}`} className={`trace-hop${h.kind === "call" ? " is-call" : ""}`} onClick={() => follow(h.ref)}
          title={`${h.kind === "call" ? "Calls" : "When"}: ${h.via.join("\n")}`}>
          {dir === "in" && <span className="trace-arrow">⟵</span>}
          <span className="trace-hop-name">{h.name}</span>
          <span className="trace-hop-via">{h.kind === "call" ? "calls" : h.via[0]}{h.via.length > 1 ? ` +${h.via.length - 1}` : ""}</span>
          {dir === "out" && <span className="trace-arrow">⟶</span>}
        </button>
      ))}
      {hops.length > LIMIT && <button className="linkish trace-more" onClick={() => setAll(!all)}>{all ? "fewer" : `+${hops.length - LIMIT} more`}</button>}
      </div>
    </div>
  );
}

