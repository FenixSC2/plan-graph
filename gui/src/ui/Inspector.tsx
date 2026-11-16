import { useContext, useState } from "react";
import { UIContext } from "./context.ts";
import {
  buildIndex, interactionLabel, labelOf, slug, surfaceOf, uniqueId, userMeta,
  type Decision, type Element, type Interaction, type Located, type Outcome, type Plan, type Ref, type State, type Surface,
} from "../model/plan.ts";
import type { Store } from "../store.ts";
import { ImpactBadge, Section, SelectField, StatusBadge, TextField } from "./fields.tsx";

interface Props {
  store: Store;
  selected: Ref;
  select: (ref: Ref | null) => void;
  requestDelete: (ref: Ref) => void;
}

type Mutator = (fn: (loc: Located, plan: Plan) => void, opts?: { touch?: boolean }) => void;

export function Inspector({ store, selected, select, requestDelete }: Props) {
  const loc = store.index.get(selected);
  if (!loc || !store.plan || !store.loaded) {
    return <div className="inspector empty">This item no longer exists.</div>;
  }
  const plan = store.plan;

  /** Mutate the selected item. Editing a proposed item counts as reviewing it (→ confirmed). */
  const mutate: Mutator = (fn, opts) =>
    store.edit((p) => {
      const l = buildIndex(p).get(selected);
      if (!l) return;
      fn(l, p);
      if ((opts?.touch ?? true) && l.item.meta.status === "proposed") l.item.meta = { ...l.item.meta, status: "confirmed" };
    });

  const ctx = { store, plan, mutate, select, selected };
  let body: React.ReactNode;
  switch (loc.type) {
    case "surface": body = <SurfaceBody {...ctx} s={loc.item} />; break;
    case "state": body = <StateBody {...ctx} st={loc.item} parent={loc.parent} />; break;
    case "element": body = <ElementBody {...ctx} e={loc.item} parent={loc.parent} />; break;
    case "interaction": body = <InteractionBody {...ctx} it={loc.item} />; break;
    case "outcome": body = <OutcomeBody {...ctx} o={loc.item} parent={loc.parent} />; break;
    case "decision": body = <DecisionBody {...ctx} d={loc.item} />; break;
    case "group": body = (
      <>
        <TextField label="Name" value={loc.item.name} onCommit={(v) => mutate((l) => { (l.item as any).name = v; })} />
        <TextField label="Description" multiline value={loc.item.description ?? ""} placeholder="What this area of the app is for"
          onCommit={(v) => mutate((l) => { (l.item as any).description = v || undefined; })} />
      </>
    ); break;
  }

  const meta = loc.item.meta;
  const isSketchable = meta.origin === "user" || meta.status === "sketch";

  return (
    <div className="inspector">
      <div className="insp-head">
        <div className="insp-type">{loc.type}</div>
        <div className="insp-title">{labelOf(store.index, selected)}</div>
        <div className="insp-id mono">{selected}</div>
        <div className="insp-meta">
          <StatusBadge status={meta.status} origin={meta.origin} />
          {meta.built && meta.built !== "no" && <span className="badge">built: {meta.built}</span>}
          {store.agentChanged.has(selected) && <span className="badge badge-agent">updated by agent</span>}
        </div>
        <div className="insp-actions">
          {meta.status === "proposed" && (
            <button className="btn primary" onClick={() => mutate((l) => { l.item.meta = { ...l.item.meta, status: "confirmed" }; }, { touch: false })}>
              Confirm
            </button>
          )}
          {isSketchable && (
            <label className="check">
              <input
                type="checkbox"
                checked={meta.status === "sketch"}
                onChange={(e) => mutate((l) => { l.item.meta = { ...l.item.meta, status: e.target.checked ? "sketch" : "confirmed" }; }, { touch: false })}
              />
              Needs detail from agent
            </label>
          )}
          <button className="btn danger ghost" onClick={() => requestDelete(selected)}>Delete</button>
        </div>
      </div>

      {meta.note && <div className="insp-note"><span>Note</span>{meta.note}</div>}
      {meta.sources?.length ? (
        <div className="insp-sources">
          {meta.sources.map((s, i) => <code key={i}>{s.file}{s.line ? `:${s.line}` : ""}</code>)}
        </div>
      ) : null}

      {body}

      <RelatedDecisions store={store} plan={plan} ref_={selected} type={loc.type} select={select} />

      <Section title="Note to agent">
        <TextField
          multiline
          value={store.notes[selected]}
          placeholder="Why you changed this, or a question / request about it. Sent with your changes."
          onCommit={(v) => store.setNote(selected, v)}
        />
      </Section>
    </div>
  );
}

interface Ctx {
  store: Store;
  plan: Plan;
  mutate: Mutator;
  select: (ref: Ref | null) => void;
  selected: Ref;
}

const profileOf = (store: Store, id: string) => store.loaded!.profiles[id];
const opts = (xs: string[] = []) => xs.map((x) => ({ value: x, label: x }));

/* ───────────────────────── surface ───────────────────────── */

function SurfaceBody({ store, plan, mutate, select, s }: Ctx & { s: Surface }) {
  const prof = profileOf(store, s.profile);
  const [newState, setNewState] = useState("");
  const [elKind, setElKind] = useState(prof?.elementKinds[0] ?? "button");
  const [elLabel, setElLabel] = useState("");
  const set = (k: keyof Surface) => (v: unknown) => mutate((l) => { (l.item as any)[k] = v === "" ? undefined : v; });
  const outgoing = plan.interactions.filter((it) => surfaceOf(it.from) === s.id);
  const isEntry = plan.entryPoints.includes(s.id);

  const addState = () => {
    const id = slug(newState);
    if (!newState.trim() || s.states?.some((x) => x.id === id)) return;
    mutate((l) => { const sf = l.item as Surface; (sf.states ??= []).push({ id, meta: userMeta() }); }, { touch: false });
    setNewState("");
  };
  const addElement = () => {
    if (!elLabel.trim()) return;
    const id = uniqueId(store.index, `${s.id}.${slug(elLabel)}`);
    mutate((l) => { const sf = l.item as Surface; (sf.elements ??= []).push({ id, kind: elKind, label: elLabel.trim(), meta: userMeta() }); }, { touch: false });
    setElLabel("");
    select(id);
  };
  const addInteraction = () => {
    const id = uniqueId(store.index, `${s.id}.new-interaction`);
    store.edit((p) => {
      p.interactions.push({
        id, from: s.id,
        trigger: { kind: prof?.triggerKinds[0] ?? "click", description: "New interaction" },
        outcomes: [], meta: userMeta("sketch"),
      });
    });
    select(id);
  };

  return (
    <>
      <Section title="Surface">
        <TextField label="Name" value={s.name} onCommit={set("name")} />
        <SelectField label="Kind" value={s.kind} options={opts(prof?.surfaceKinds)} onChange={set("kind")} />
        <TextField label="Address" mono value={s.address} placeholder={prof?.addressFormat} onCommit={set("address")} />
        <TextField label="Description" multiline value={s.description} onCommit={set("description")} />
        {!!plan.groups?.length && (
          <SelectField
            label="Group"
            value={s.group ?? ""}
            options={[{ value: "", label: "— none —" }, ...plan.groups.map((g) => ({ value: g.id, label: g.name }))]}
            onChange={set("group")}
          />
        )}
        <div className="row-checks">
          <label className="check">
            <input
              type="checkbox"
              checked={isEntry}
              onChange={(e) => store.edit((p) => { p.entryPoints = e.target.checked ? [...p.entryPoints, s.id] : p.entryPoints.filter((r) => r !== s.id); })}
            />
            Entry point
          </label>
          <label className="check">
            <input type="checkbox" checked={!!s.terminal} onChange={(e) => set("terminal")(e.target.checked || undefined)} />
            Terminal (no way onward)
          </label>
        </div>
      </Section>

      <Section title={`States (${s.states?.length ?? 0})`}>
        <div className="chips">
          {s.states?.map((st) => (
            <button key={st.id} className={`chip status-${st.meta.status}`} onClick={() => select(`${s.id}#${st.id}`)}>{st.id}</button>
          ))}
        </div>
        <div className="inline-add">
          <input value={newState} placeholder="new state, e.g. empty" onChange={(e) => setNewState(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addState()} />
          <button className="btn" onClick={addState}>Add</button>
        </div>
      </Section>

      <Section title={`Elements (${s.elements?.length ?? 0})`}>
        <ul className="list">
          {s.elements?.map((e) => (
            <li key={e.id} onClick={() => select(e.id)} className={`status-${e.meta.status}`}>
              <span className="el-kind">{e.kind}</span> {e.label}
            </li>
          ))}
        </ul>
        <div className="inline-add">
          <select value={elKind} onChange={(e) => setElKind(e.target.value)}>
            {prof?.elementKinds.map((k) => <option key={k}>{k}</option>)}
          </select>
          <input value={elLabel} placeholder="label" onChange={(e) => setElLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addElement()} />
          <button className="btn" onClick={addElement}>Add</button>
        </div>
      </Section>

      <Section title={`Interactions (${outgoing.length})`} actions={<button className="btn small" onClick={addInteraction}>+ Add</button>}>
        <ul className="list">
          {outgoing.map((it) => (
            <li key={it.id} onClick={() => select(it.id)} className={`status-${it.meta.status}`}>
              {interactionLabel(store.index, it)} <span className="muted">· {it.outcomes.length} outcome(s)</span>
            </li>
          ))}
        </ul>
        <p className="hint">Or drag from a surface's bottom-right handle onto another surface.</p>
      </Section>
    </>
  );
}

/* ───────────────────────── state / element ───────────────────────── */

function StateBody({ mutate, select, st, parent }: Ctx & { st: State; parent: Surface }) {
  return (
    <Section title="State">
      <p className="muted">State of <a onClick={() => select(parent.id)}>{parent.name}</a>. Reference it as a destination: <code>{parent.id}#{st.id}</code></p>
      <TextField label="Description" multiline value={st.description} onCommit={(v) => mutate((l) => { (l.item as State).description = v || undefined; })} />
    </Section>
  );
}

function ElementBody({ store, plan, mutate, select, e, parent }: Ctx & { e: Element; parent: Surface }) {
  const prof = profileOf(store, parent.profile);
  const [specErr, setSpecErr] = useState<string | null>(null);
  const usedBy = plan.interactions.filter((it) => it.trigger.element === e.id);
  return (
    <>
      <Section title="Element">
        <p className="muted">On <a onClick={() => select(parent.id)}>{parent.name}</a></p>
        <TextField label="Label" value={e.label} onCommit={(v) => mutate((l) => { (l.item as Element).label = v; })} />
        <SelectField label="Kind" value={e.kind} options={opts(prof?.elementKinds)} onChange={(v) => mutate((l) => { (l.item as Element).kind = v; })} />
        <TextField
          label="Spec (JSON)"
          multiline
          mono
          value={e.spec ? JSON.stringify(e.spec, null, 2) : ""}
          placeholder='{ "required": true }'
          onCommit={(v) => {
            try {
              const spec = v.trim() ? JSON.parse(v) : undefined;
              setSpecErr(null);
              mutate((l) => { (l.item as Element).spec = spec; });
            } catch (err) {
              setSpecErr(String(err));
            }
          }}
        />
        {specErr && <p className="error-text">{specErr}</p>}
      </Section>
      <Section title="Triggers">
        {usedBy.length ? (
          <ul className="list">{usedBy.map((it) => <li key={it.id} onClick={() => select(it.id)}>{interactionLabel(store.index, it)}</li>)}</ul>
        ) : (
          <p className="muted">No interaction uses this element.</p>
        )}
      </Section>
    </>
  );
}

/* ───────────────────────── interaction / outcome ───────────────────────── */

function destinationOptions(plan: Plan, withStays: boolean) {
  const o: { value: string; label: string }[] = withStays ? [{ value: "", label: "↺ stays here" }] : [];
  for (const s of plan.surfaces) {
    o.push({ value: s.id, label: `${s.name}  (${s.profile})` });
    for (const st of s.states ?? []) o.push({ value: `${s.id}#${st.id}`, label: `   ${s.name} · ${st.id}` });
  }
  return o;
}

function InteractionBody({ store, plan, mutate, select, it }: Ctx & { it: Interaction }) {
  const from = store.index.get(surfaceOf(it.from));
  const surface = from?.type === "surface" ? from.item : undefined;
  const prof = surface ? profileOf(store, surface.profile) : undefined;
  const setTrigger = (k: keyof Interaction["trigger"]) => (v: string) =>
    mutate((l) => { const t = (l.item as Interaction).trigger as any; if (v) t[k] = v; else delete t[k]; });
  const allInteractions = plan.interactions.filter((x) => x.id !== it.id);

  const addOutcome = () => {
    const id = uniqueId(store.index, `${it.id}.outcome`);
    mutate((l) => { (l.item as Interaction).outcomes.push({ id, when: "New condition", to: null, meta: userMeta() }); }, { touch: false });
    select(id);
  };

  return (
    <>
      <Section title="Trigger">
        <SelectField label="From" value={it.from} options={destinationOptions(plan, false)} onChange={(v) => mutate((l) => { (l.item as Interaction).from = v; })} />
        <SelectField label="Kind" value={it.trigger.kind} options={opts(prof?.triggerKinds)} onChange={setTrigger("kind")} />
        <SelectField
          label="Element"
          value={it.trigger.element ?? ""}
          options={[{ value: "", label: "— none —" }, ...(surface?.elements ?? []).map((e) => ({ value: e.id, label: `${e.label} (${e.kind})` }))]}
          onChange={setTrigger("element")}
        />
        <TextField label="Description" value={it.trigger.description} onCommit={setTrigger("description")} />
      </Section>

      <Section title={`Outcomes (${it.outcomes.length})`} actions={<button className="btn small" onClick={addOutcome}>+ Add</button>}>
        <ul className="list">
          {it.outcomes.map((o) => (
            <li key={o.id} onClick={() => select(o.id)} className={`status-${o.meta.status}`}>
              <div>{o.when}</div>
              <div className="muted">→ {labelOf(store.index, o.to)}{o.result ? ` · ${o.result}` : ""}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={`Effects (${it.effects?.length ?? 0})`}
        actions={
          <button className="btn small" onClick={() => mutate((l) => { const x = l.item as Interaction; (x.effects ??= []).push({ kind: "writes", target: "" }); })}>
            + Add
          </button>
        }
      >
        {it.effects?.map((ef, i) => (
          <div key={i} className="effect-row">
            <select
              value={ef.kind}
              onChange={(e) => mutate((l) => { (l.item as Interaction).effects![i] = { ...ef, kind: e.target.value as any, target: "" }; })}
            >
              {["calls", "emits", "writes", "reads"].map((k) => <option key={k}>{k}</option>)}
            </select>
            {ef.kind === "calls" ? (
              <select value={ef.target} onChange={(e) => mutate((l) => { (l.item as Interaction).effects![i].target = e.target.value; })}>
                <option value="">— choose —</option>
                {allInteractions.map((x) => <option key={x.id} value={x.id}>{labelOf(store.index, surfaceOf(x.from))}: {interactionLabel(store.index, x)}</option>)}
              </select>
            ) : (
              <TextField value={ef.target} placeholder="resource, e.g. users table" onCommit={(v) => mutate((l) => { (l.item as Interaction).effects![i].target = v; })} />
            )}
            <button className="btn ghost small" title="Remove effect" onClick={() => mutate((l) => { const x = l.item as Interaction; x.effects!.splice(i, 1); if (!x.effects!.length) delete x.effects; })}>✕</button>
          </div>
        ))}
      </Section>
    </>
  );
}

function OutcomeBody({ store, plan, mutate, select, o, parent }: Ctx & { o: Outcome; parent: Interaction }) {
  const { follow } = useContext(UIContext);
  return (
    <Section title="Outcome">
      <p className="muted">Branch of <a onClick={() => select(parent.id)}>{interactionLabel(store.index, parent)}</a> on {labelOf(store.index, surfaceOf(parent.from))}</p>
      <TextField label="When" value={o.when} onCommit={(v) => mutate((l) => { (l.item as Outcome).when = v; })} />
      <SelectField label="Goes to" value={o.to ?? ""} options={destinationOptions(plan, true)} onChange={(v) => mutate((l) => { (l.item as Outcome).to = v || null; })} />
      {o.to && follow && <p className="follow-link"><a onClick={() => follow(o.id)}>Follow to {labelOf(store.index, o.to)} ⟶</a> <span className="muted small">(or press ])</span></p>}
      <TextField label="Observable result" multiline value={o.result} placeholder="status code, exit code, message, UI feedback…" onCommit={(v) => mutate((l) => { (l.item as Outcome).result = v || undefined; })} />
      <p className="hint">Tip: drag the arrow's end onto another surface to retarget it.</p>
    </Section>
  );
}

/* ───────────────────────── decision ───────────────────────── */

function DecisionBody({ store, plan, mutate, select, d }: Ctx & { d: Decision }) {
  const [newAlt, setNewAlt] = useState("");
  const [attach, setAttach] = useState("");
  const set = (k: keyof Decision) => (v: unknown) => mutate((l) => { (l.item as any)[k] = v === "" ? undefined : v; });
  const swap = (i: number) =>
    mutate((l) => {
      const x = l.item as Decision;
      const alts = [...(x.alternatives ?? [])];
      const chosen = alts[i];
      alts[i] = x.value;
      x.value = chosen;
      x.alternatives = alts.filter(Boolean);
    });
  const attachable = [
    ...plan.surfaces.map((s) => ({ value: s.id, label: `Surface: ${s.name}` })),
    ...plan.interactions.map((it) => ({ value: it.id, label: `Interaction: ${labelOf(store.index, surfaceOf(it.from))} · ${interactionLabel(store.index, it)}` })),
    ...plan.interactions.flatMap((it) => it.outcomes.map((o) => ({ value: o.id, label: `Outcome: ${o.when}` }))),
  ].filter((x) => !d.attachedTo.includes(x.value));

  return (
    <>
      <Section title="Decision">
        <TextField label="Question" multiline value={d.question} onCommit={set("question")} />
        <TextField label="Chosen" multiline value={d.value} placeholder="Leave empty to have the agent propose an answer" onCommit={set("value")} />
        <div className="field">
          <span className="field-label">Alternatives</span>
          <ul className="alts">
            {d.alternatives?.map((a, i) => (
              <li key={i}>
                <span>{a}</span>
                <button className="btn small" onClick={() => swap(i)} title="Use this instead">Use</button>
                <button className="btn ghost small" title="Remove" onClick={() => mutate((l) => { (l.item as Decision).alternatives!.splice(i, 1); })}>✕</button>
              </li>
            ))}
          </ul>
          <div className="inline-add">
            <input value={newAlt} placeholder="add an alternative" onChange={(e) => setNewAlt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !newAlt.trim()) return;
                mutate((l) => { const x = l.item as Decision; x.alternatives = [...(x.alternatives ?? []), newAlt.trim()]; });
                setNewAlt("");
              }} />
          </div>
        </div>
        <TextField label="Rationale" multiline value={d.rationale} onCommit={set("rationale")} />
        <SelectField label="Impact" value={d.impact} options={opts(["high", "medium", "low"])} onChange={set("impact")} />
        {d.checklistKey && <p className="muted">Answers checklist item <code>{d.checklistKey}</code></p>}
      </Section>
      <Section title="Applies to">
        {d.attachedTo.length === 0 && <p className="muted">Project-wide</p>}
        <div className="chips">
          {d.attachedTo.map((r) => (
            <span key={r} className="chip">
              <a onClick={() => select(r)}>{labelOf(store.index, r)}</a>
              <button className="chip-x" onClick={() => mutate((l) => { const x = l.item as Decision; x.attachedTo = x.attachedTo.filter((y) => y !== r); })}>✕</button>
            </span>
          ))}
        </div>
        <div className="inline-add">
          <select value={attach} onChange={(e) => setAttach(e.target.value)}>
            <option value="">Attach to…</option>
            {attachable.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
          <button className="btn" disabled={!attach} onClick={() => { mutate((l) => { (l.item as Decision).attachedTo.push(attach); }); setAttach(""); }}>Attach</button>
        </div>
      </Section>
    </>
  );
}

/* ───────────────────────── related decisions ───────────────────────── */

function RelatedDecisions({ store, plan, ref_, type, select }: { store: Store; plan: Plan; ref_: Ref; type: string; select: (r: Ref) => void }) {
  if (type === "decision") return null;
  const scope = new Set<Ref>([ref_]);
  if (type === "surface") {
    const s = plan.surfaces.find((x) => x.id === ref_);
    s?.states?.forEach((st) => scope.add(`${s.id}#${st.id}`));
    s?.elements?.forEach((e) => scope.add(e.id));
    for (const it of plan.interactions) if (surfaceOf(it.from) === ref_) { scope.add(it.id); it.outcomes.forEach((o) => scope.add(o.id)); }
  }
  if (type === "interaction") plan.interactions.find((x) => x.id === ref_)?.outcomes.forEach((o) => scope.add(o.id));
  const related = plan.decisions.filter((d) => d.attachedTo.some((r) => scope.has(r)));
  if (!related.length) return null;
  return (
    <Section title={`Decisions (${related.length})`}>
      <ul className="list decisions-mini">
        {related.map((d) => (
          <li key={d.id} onClick={() => select(d.id)} className={`status-${d.meta.status}`}>
            <div className="dq">{d.question} <ImpactBadge impact={d.impact} /></div>
            <div className="dv">{d.value || <em>undecided</em>}</div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
