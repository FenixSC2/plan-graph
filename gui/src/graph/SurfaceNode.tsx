import { memo, useContext, useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { UIContext } from "../ui/context.ts";
import { interactionLabel } from "../model/plan.ts";
import type { SurfaceNodeT } from "./build.ts";

function SurfaceNodeImpl({ id, data }: NodeProps<SurfaceNodeT>) {
  const { surface, rows, freeElements, isEntry } = data;
  const ui = useContext(UIContext);
  const updateInternals = useUpdateNodeInternals();
  const handleKey = rows.map((r) => r.interaction.id).join("|");
  useEffect(() => updateInternals(id), [id, handleKey, updateInternals]);

  const sel = ui.selected;
  const pick = (ref: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    ui.select(ref);
  };
  const dot = (ref: string) => (ui.agentChanged.has(ref) ? <span className="agent-dot" title="Updated by the agent" /> : null);

  return (
    <div
      className={`snode status-${surface.meta.status} profile-${surface.profile}${sel === surface.id ? " is-selected" : ""}`}
      onClick={pick(surface.id)}
    >
      <Handle type="target" id="in" position={Position.Left} className="h-in" />
      <header className="snode-head">
        <div className="snode-tags">
          <span className="ptag">{surface.profile}</span>
          <span className="ktag">{surface.kind}</span>
          {isEntry && <span className="etag" title="Entry point">entry</span>}
          {surface.meta.status === "sketch" && <span className="sktag">needs detail</span>}
          {surface.meta.status === "proposed" && <span className="prtag" title="Proposed by the agent, not reviewed">proposed</span>}
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
              <button key={st.id} className={`chip state-chip status-${st.meta.status}${sel === ref ? " is-selected" : ""}`} onClick={pick(ref)} title={st.description}>
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
            <div key={it.id} className={`srow status-${it.meta.status}${sel === it.id ? " is-selected" : ""}`} onClick={pick(it.id)}>
              <div className="srow-main">
                {r.fromState && <span className="from-state">[{r.fromState}]</span>}
                <span className="srow-label">{interactionLabel(ui.index, it)}</span>
                {dot(it.id)}
              </div>
              {r.stays.map((o) => (
                <div key={o.id} className={`stay status-${o.meta.status}${sel === o.id ? " is-selected" : ""}`} onClick={pick(o.id)} title={o.result}>
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
            <button key={e.id} className={`chip el-chip status-${e.meta.status}${sel === e.id ? " is-selected" : ""}`} onClick={pick(e.id)} title={e.kind}>
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
