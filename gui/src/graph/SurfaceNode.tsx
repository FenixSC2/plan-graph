import { memo, useContext, useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { CompactContext, UIContext } from "../ui/context.ts";
import { interactionLabel } from "../model/plan.ts";
import { isRemoved } from "../model/proposal.ts";
import type { SurfaceNodeT } from "./build.ts";

function SurfaceNodeImpl({ id, data }: NodeProps<SurfaceNodeT>) {
  const { surface, rows, freeElements, isEntry } = data;
  const ui = useContext(UIContext);
  const compact = useContext(CompactContext);
  const updateInternals = useUpdateNodeInternals();
  const handleKey = rows.map((r) => r.interaction.id).join("|");
  useEffect(() => updateInternals(id), [id, handleKey, compact, updateInternals]);

  const sel = ui.selected;
  const pick = (ref: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    ui.select(ref);
  };
  const dot = (ref: string) => (ui.agentChanged.has(ref) ? <span className="agent-dot" title="Updated by the agent" /> : null);
  // Proposal preview: " pm-add" / " pm-update" / " pm-remove" on items the proposal touches.
  const marks = ui.marks;
  const pm = (ref: string) => {
    if (!marks?.size) return "";
    if (isRemoved(marks, ref, ui.index)) return " pm-remove";
    const k = marks.get(ref);
    return k ? ` pm-${k}` : "";
  };
  const touched = !!marks?.size && [...marks.keys()].some((r) => r === surface.id || r.startsWith(surface.id + ".") || r.startsWith(surface.id + "#"));
  const nodePm = pm(surface.id) || (touched ? " pm-touched" : "");

  if (compact) {
    // Zoomed out: just the header and a count. Every row handle still exists (stacked on the
    // right edge) so edges keep their endpoints without rendering the rows themselves.
    const outcomes = rows.reduce((n, r) => n + r.interaction.outcomes.length, 0);
    const changed = ui.agentChanged.size > 0 && [...ui.agentChanged].some((r) => r === surface.id || r.startsWith(surface.id + ".") || r.startsWith(surface.id + "#"));
    return (
      <div
        className={`snode compact status-${surface.meta.status} profile-${surface.profile}${sel === surface.id ? " is-selected" : ""}${nodePm}`}
        onClick={pick(surface.id)}
      >
        <Handle type="target" id="in" position={Position.Left} className="h-in" />
        <header className="snode-head">
          <div className="snode-tags">
            <span className="ptag">{surface.profile}</span>
            <span className="ktag">{surface.kind}</span>
            {isEntry && <span className="etag">entry</span>}
            {surface.meta.status === "sketch" && <span className="sktag">needs detail</span>}
          </div>
          <div className="snode-name">
            {surface.name}
            {changed && <span className="agent-dot" />}
          </div>
          <div className="snode-count">
            {rows.length} action{rows.length === 1 ? "" : "s"} · {outcomes} outcome{outcomes === 1 ? "" : "s"}
          </div>
        </header>
        <div className="snode-handles">
          {rows.map((r) => <Handle key={r.interaction.id} type="source" id={r.interaction.id} position={Position.Right} className="h-out h-compact" />)}
          <Handle type="source" id="__new" position={Position.Right} className="h-out h-compact" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`snode status-${surface.meta.status} profile-${surface.profile}${sel === surface.id ? " is-selected" : ""}${nodePm}`}
      onClick={pick(surface.id)}
    >
      <Handle type="target" id="in" position={Position.Left} className="h-in" />
      <header className="snode-head">
        <div className="snode-tags">
          <span className="ptag">{surface.profile}</span>
          <span className="ktag">{surface.kind}</span>
          {isEntry && <span className="etag" title="Entry point">entry</span>}
          {surface.meta.status === "sketch" && <span className="sktag">needs detail</span>}
          {surface.meta.status === "proposed" && !nodePm.startsWith(" pm-add") && <span className="prtag" title="Proposed by the agent, not reviewed">proposed</span>}
          {nodePm === " pm-add" && <span className="pmtag pmtag-add">new in proposal</span>}
          {nodePm === " pm-remove" && <span className="pmtag pmtag-remove">removed in proposal</span>}
        </div>
        <div className="snode-name">
          {surface.name}
          {dot(surface.id)}
        </div>
        {surface.address && <div className="snode-addr">{surface.address}</div>}
      </header>

      {!!surface.states?.length && (
        <div className="snode-states">
          {surface.states.map((st) => {
            const ref = `${surface.id}#${st.id}`;
            return (
              <button key={st.id} className={`chip state-chip status-${st.meta.status}${sel === ref ? " is-selected" : ""}${pm(ref)}`} onClick={pick(ref)} title={st.description}>
                {st.id}
                {dot(ref)}
              </button>
            );
          })}
        </div>
      )}

      <div className="snode-rows">
        {rows.map((r) => {
          const it = r.interaction;
          return (
            <div key={it.id} className={`srow status-${it.meta.status}${sel === it.id ? " is-selected" : ""}${pm(it.id)}`} onClick={pick(it.id)}>
              <div className="srow-main">
                {r.fromState && <span className="from-state">[{r.fromState}]</span>}
                <span className="srow-label">{interactionLabel(ui.index, it)}</span>
                {dot(it.id)}
              </div>
              {r.stays.map((o) => (
                <div key={o.id} className={`stay status-${o.meta.status}${sel === o.id ? " is-selected" : ""}${pm(o.id)}`} onClick={pick(o.id)} title={o.result}>
                  <span className="stay-when">{o.when}</span>
                  {o.result && <span className="stay-result"> — {o.result}</span>}
                  {dot(o.id)}
                </div>
              ))}
              <Handle type="source" id={it.id} position={Position.Right} className="h-out" />
            </div>
          );
        })}
      </div>

      {!!freeElements.length && (
        <div className="snode-els">
          {freeElements.map((e) => (
            <button key={e.id} className={`chip el-chip status-${e.meta.status}${sel === e.id ? " is-selected" : ""}${pm(e.id)}`} onClick={pick(e.id)} title={e.kind}>
              <span className="el-kind">{e.kind}</span> {e.label}
              {dot(e.id)}
            </button>
          ))}
        </div>
      )}

      <div className="snode-new">
        <span>drag to connect →</span>
        <Handle type="source" id="__new" position={Position.Right} className="h-new" title="Drag to another surface to add an interaction" />
      </div>
    </div>
  );
}

export const SurfaceNode = memo(SurfaceNodeImpl);
