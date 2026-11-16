// The agent's pending proposal: what it changes, the decisions it changes or touches, and
// the questions it needs answered. The user ticks the changes they want, accepts, and sends.
import { useMemo } from "react";
import { buildIndex, labelOf, type Located, type PlanIndex, type Ref } from "../model/plan.ts";
import { isRemoved, opRef, type DecisionImpact, type MarkKind } from "../model/proposal.ts";
import type { Op } from "../model/diff.ts";
import type { Store } from "../store.ts";
import { ImpactBadge } from "./fields.tsx";

interface Props {
  store: Store;
  select: (ref: Ref | null) => void;
}

/** Readable one-liner for a field value: strings as-is, small objects as their string parts. */
const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return v.length ? v.map(fmt).join(", ") : "none";
  const parts = Object.values(v as Record<string, unknown>).filter((x) => typeof x === "string" || typeof x === "number" || typeof x === "boolean");
  return parts.length ? parts.join(" · ") : JSON.stringify(v);
};
/** Fields that hold refs are shown by label. */
const REF_FIELDS = new Set(["to", "from", "attachedTo", "group", "parent"]);
const showField = (idx: PlanIndex, k: string, v: unknown): string => {
  if (k === "to" && v === null) return "stays";
  if (REF_FIELDS.has(k) && typeof v === "string") return labelOf(idx, v);
  if (REF_FIELDS.has(k) && Array.isArray(v)) return v.length ? v.map((r) => labelOf(idx, r)).join(", ") : "project-wide";
  return fmt(v);
};

/** One line per op, labelled against the plan it applies to. */
function describe(op: Op, idx: PlanIndex, previewIdx: PlanIndex): { kind: string; type: string; label: string; detail?: string } {
  const ref = opRef(op);
  const loc = idx.get(ref) ?? previewIdx.get(ref);
  const type = op.op === "add" ? op.kind : ref === "$plan" ? "project" : loc?.type ?? "item";
  const label = ref === "$plan" ? "Project settings" : labelOf(loc && idx.has(ref) ? idx : previewIdx, ref);
  switch (op.op) {
    case "update": {
      const fields = Object.keys(op.set).filter((k) => k !== "meta");
      return { kind: "update", type, label, detail: fields.length ? fields.join(", ") : "review status" };
    }
    case "confirm": return { kind: "confirm", type, label: op.refs.length > 1 ? `${op.refs.length} items` : label };
    default: return { kind: op.op, type, label };
  }
}

export function ProposalTab({ store, select }: Props) {
  const p = store.proposal;
  const u = store.pui;
  const plan = store.plan;
  // "Before" values and labels come from the plan the ops apply to: the working plan while the
  // proposal is open, plan.json once it's accepted (the working plan then already has the ops).
  // Labels fall back to the preview / working plan for items the proposal adds.
  const accepted = !!u && u.accepted !== null;
  const baseIdx = useMemo(
    () => (accepted && store.loaded ? buildIndex(store.loaded.base) : plan ? buildIndex(plan) : new Map<Ref, Located>()),
    [accepted, store.loaded, plan],
  );
  const previewIdx: PlanIndex = useMemo(() => new Map([...baseIdx, ...(store.preview?.index ?? store.index)]), [baseIdx, store.preview, store.index]);
  if (!p || !u || !plan) return <p className="empty-state">No proposal from the agent right now. Ask for a change in chat and the agent can load it here for you to review.</p>;

  const open = u.accepted === null;
  const nIncluded = u.included.filter((i) => !store.proposalFailed.has(i)).length;
  const questions = p.questions ?? [];
  const answered = questions.filter((q) => u.answers[q.id]?.trim()).length;
  const changedDecisions = store.impacts.filter((d) => d.kind !== "affected");
  const affected = store.impacts.filter((d) => d.kind === "affected");
  const sentClean = store.sent && store.unsentSinceSend === 0;

  return (
    <div className="proposal">
      <div className="pp-head">
        <div className="pp-kicker">Proposed by the agent{p.createdAt ? ` · ${new Date(p.createdAt).toLocaleString()}` : ""}</div>
        <h3 className="pp-title">{p.title}</h3>
        {p.request && <blockquote className="pp-request"><span>You asked</span>{p.request}</blockquote>}
        {p.summary && <p className="pp-summary">{p.summary}</p>}
        <div className="pp-counts">
          <span>{p.ops.length} change{p.ops.length === 1 ? "" : "s"}</span>
          {changedDecisions.length > 0 && <span>{changedDecisions.length} decision{changedDecisions.length === 1 ? "" : "s"} changed</span>}
          {affected.length > 0 && <span>{affected.length} to recheck</span>}
          {questions.length > 0 && <span className={answered < questions.length ? "pp-todo" : ""}>{answered}/{questions.length} answered</span>}
        </div>
        {open && p.ops.length > 0 && (
          <label className="check pp-preview">
            <input type="checkbox" checked={store.previewing} onChange={(e) => store.setPreviewing(e.target.checked)} />
            Preview on the graph
          </label>
        )}
      </div>

      {!open && (
        <div className="pp-status">
          {u.accepted!.length
            ? <>Accepted {u.accepted!.length} of {p.ops.length} change{p.ops.length === 1 ? "" : "s"}. They're in <b>Changes</b> as your edits.</>
            : p.ops.length ? <>You rejected this proposal.</> : <>Answers ready.</>}
          {" "}{sentClean ? "Sent; waiting for the agent." : "Press Send to hand your answer to the agent."}
          <button className="btn ghost small" onClick={store.reopenProposal} disabled={sentClean}>Reopen</button>
        </div>
      )}

      {questions.length > 0 && (
        <section className="pp-section">
          <h4 className="subhead">Questions for you</h4>
          <ul className="pp-questions">
            {questions.map((q) => {
              const a = u.answers[q.id] ?? "";
              return (
                <li key={q.id} className={a.trim() ? "is-answered" : ""}>
                  <div className="pq-q">{q.question}</div>
                  {q.why && <div className="pq-why">{q.why}</div>}
                  {!!q.refs?.length && (
                    <div className="pq-refs">
                      {q.refs.map((r) => <button key={r} className="linkish" onClick={() => select(r)}>{labelOf(previewIdx, r)}</button>)}
                    </div>
                  )}
                  {!!q.options?.length && (
                    <div className="pq-options">
                      {q.options.map((o) => (
                        <button key={o} className={`chip pq-opt${a === o ? " is-on" : ""}`} disabled={!open && sentClean} onClick={() => store.setAnswer(q.id, a === o ? "" : o)}>
                          {o}{q.recommended === o && <span className="pq-rec">recommended</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    rows={1}
                    placeholder={q.options?.length ? "Or write your own answer" : "Your answer"}
                    value={q.options?.includes(a) ? "" : a}
                    onChange={(e) => store.setAnswer(q.id, e.target.value)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {store.impacts.length > 0 && (
        <section className="pp-section">
          <h4 className="subhead">Decisions</h4>
          <ul className="pp-decisions">
            {changedDecisions.map((d) => <DecisionRow key={d.ref} d={d} store={store} select={select} />)}
          </ul>
          {affected.length > 0 && (
            <>
              <p className="hint">Not changed by the proposal, but attached to what it changes or named in a question. Check they still hold.</p>
              <ul className="pp-decisions">
                {affected.map((d) => <DecisionRow key={d.ref} d={d} store={store} select={select} />)}
              </ul>
            </>
          )}
        </section>
      )}

      {p.ops.length > 0 && (
        <section className="pp-section">
          <h4 className="subhead pp-ops-head">
            Changes
            {open && (
              <span className="pp-bulk">
                <button className="linkish" onClick={() => store.setProposalOps(p.ops.map((_, i) => i))}>all</button>
                {" · "}
                <button className="linkish" onClick={() => store.setProposalOps([])}>none</button>
              </span>
            )}
          </h4>
          <ul className="clist pp-ops">
            {p.ops.map((op, i) => {
              const d = describe(op, baseIdx, previewIdx);
              const failed = open && store.proposalFailed.has(i);
              const on = open ? u.included.includes(i) : u.accepted!.includes(i);
              const ref = opRef(op);
              return (
                <li key={i} className={`${on ? "" : "is-off"}${failed ? " is-failed" : ""}`} onClick={() => ref !== "$plan" && select(ref)}>
                  {open && (
                    <input type="checkbox" checked={on && !failed} disabled={failed} onClick={(e) => e.stopPropagation()} onChange={() => store.toggleProposalOp(i)} title="Include this change" />
                  )}
                  <span className={`ctag ctag-${d.kind}`}>{d.kind}</span>
                  <div className="c-body">
                    <div className="c-label">{d.label}</div>
                    <div className="c-sub">{d.type}{d.detail && ` · ${d.detail}`}{failed && <span className="error-text"> · no longer applies</span>}</div>
                    {op.op === "update" && <UpdateDiff op={op} idx={baseIdx} previewIdx={previewIdx} />}
                    {(op.note || noteOf(op)) && <div className="c-note">{op.note || noteOf(op)}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="send-box">
        <textarea rows={2} placeholder="Reply to the agent about this proposal (optional)" value={u.reply} onChange={(e) => store.setReply(e.target.value)} />
        {open ? (
          <div className="pp-actions">
            <button className="btn primary" disabled={p.ops.length > 0 && nIncluded === 0} onClick={store.acceptProposal}>
              {p.ops.length === 0 ? "Done answering" : nIncluded === p.ops.length ? `Accept all ${p.ops.length}` : `Accept ${nIncluded} of ${p.ops.length}`}
            </button>
            {p.ops.length > 0 && <button className="btn ghost" onClick={store.rejectProposal}>Reject</button>}
          </div>
        ) : (
          <button className="btn primary block" disabled={!!store.blocking.length || sentClean} onClick={store.send}>
            {sentClean ? "Sent ✓ waiting for agent" : `Send to agent${store.changes.length ? ` (${store.changes.length} change${store.changes.length === 1 ? "" : "s"})` : ""}`}
          </button>
        )}
        {open && questions.length > answered && <p className="hint">Unanswered questions are sent as unanswered; the agent will ask again or pick its recommendation.</p>}
        {!open && store.blocking.length > 0 && <p className="error-text">Resolve errors in Issues first.</p>}
      </div>
    </div>
  );
}

/** The agent's reason for an op lives in the item's meta.note when it used PlanBuilder. */
function noteOf(op: Op): string | undefined {
  if (op.op === "add") return (op.value as any).meta?.note;
  if (op.op === "update") return (op.set.meta as any)?.note;
  return undefined;
}

function UpdateDiff({ op, idx, previewIdx }: { op: Extract<Op, { op: "update" }>; idx: PlanIndex; previewIdx: PlanIndex }) {
  const loc = idx.get(op.ref);
  const rows = Object.entries(op.set).filter(([k]) => k !== "meta");
  if (!rows.length) return null;
  const show = (k: string, v: unknown) => showField(previewIdx, k, v);
  return (
    <div className="pp-diff">
      {rows.map(([k, v]) => (
        <div key={k}>
          <span className="pp-field">{k}</span>
          <span className="pp-before">{show(k, (loc?.item as any)?.[k])}</span>
          <span className="pp-arrow">→</span>
          <span className="pp-after">{show(k, v)}</span>
        </div>
      ))}
    </div>
  );
}

const KIND_LABEL: Record<DecisionImpact["kind"], string> = { changed: "changes", added: "new", removed: "removed", affected: "recheck" };

function DecisionRow({ d, store, select }: { d: DecisionImpact; store: Store; select: (r: Ref) => void }) {
  const idx = store.preview?.index ?? store.index;
  const valueChanged = d.kind === "changed" && d.fields?.includes("value");
  return (
    <li className={`pp-dec pp-dec-${d.kind}`} onClick={() => select(d.ref)}>
      <div className="rl-top">
        <span className={`pp-dkind pp-dkind-${d.kind}`}>{KIND_LABEL[d.kind]}</span>
        <ImpactBadge impact={d.decision.impact} />
        {d.questions?.length ? <span className="pp-dq">question</span> : null}
      </div>
      <div className="rl-label">{d.decision.question}</div>
      {valueChanged ? (
        <div className="pp-diff"><div><span className="pp-before">{d.before?.value || "undecided"}</span><span className="pp-arrow">→</span><span className="pp-after">{d.decision.value || "undecided"}</span></div></div>
      ) : (
        <div className={`rl-value${d.kind === "removed" ? " pp-struck" : ""}`}>{d.decision.value || <em>undecided</em>}</div>
      )}
      {d.kind === "changed" && !valueChanged && <div className="c-sub">changes {d.fields!.join(", ")}</div>}
      {d.kind === "affected" && !!d.via?.length && (
        <div className="c-sub">via {d.via.map((r) => labelOf(idx, r)).join(", ")}</div>
      )}
    </li>
  );
}

/** Read-only view of an item while the proposal is previewed: what it is and what the proposal does to it. */
export function ProposedItem({ store, selected }: { store: Store; selected: Ref }) {
  const pv = store.preview!;
  const loc = pv.index.get(selected);
  if (!loc) return <div className="inspector empty">This item isn't in the preview.</div>;
  const kind: MarkKind | undefined = isRemoved(pv.marks, selected, pv.index) ? "remove" : pv.marks.get(selected);
  const ops = store.proposal!.ops.map((op, i) => ({ op, i })).filter(({ op }) => opRef(op) === selected || (op.op === "confirm" && op.refs.includes(selected)));
  const baseLoc = store.index.get(selected);
  const fields = Object.entries(loc.item).filter(([k, v]) => !["meta", "id", "states", "elements", "outcomes"].includes(k) && v !== undefined);
  return (
    <div className="inspector">
      <div className="insp-head">
        <div className="insp-type">{loc.type}</div>
        <div className="insp-title">{labelOf(pv.index, selected)}</div>
        <div className="insp-id mono">{selected}</div>
        <div className="insp-meta">
          {kind && <span className={`badge pm-badge pm-badge-${kind}`}>{kind === "add" ? "added by proposal" : kind === "update" ? "changed by proposal" : "removed by proposal"}</span>}
          {!kind && <span className="badge">unchanged</span>}
        </div>
      </div>
      <div className="pp-readonly">
        {fields.map(([k, v]) => {
          const before = baseLoc ? (baseLoc.item as any)[k] : undefined;
          const changed = kind === "update" && JSON.stringify(before) !== JSON.stringify(v);
          const show = (x: unknown) => showField(pv.index, k, x);
          return (
            <div key={k} className={`pp-ro-row${changed ? " is-changed" : ""}`}>
              <span className="pp-field">{k}</span>
              <span>
                {changed && <><span className="pp-before">{show(before)}</span><span className="pp-arrow">→</span></>}
                <span className={changed ? "pp-after" : ""}>{show(v)}</span>
              </span>
            </div>
          );
        })}
      </div>
      {(loc.item.meta.note || ops.some(({ op }) => op.note)) && (
        <div className="insp-note"><span>Agent's note</span>{ops.find(({ op }) => op.note)?.op.note ?? loc.item.meta.note}</div>
      )}
      <p className="hint">This is a preview of the agent's proposal. Accept it in the Proposal tab to edit these items, or turn off the preview to edit your plan as it is.</p>
    </div>
  );
}
