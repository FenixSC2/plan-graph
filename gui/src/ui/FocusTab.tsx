// Focus: what the agent highlighted for the user right now — questions, suggested changes and
// findings, each with its breakdown and options. The user answers here and presses Send; the
// agent replies in the same item, so a topic can go back and forth without retyping it in chat.
import { useState } from "react";
import { labelOf, type Ref } from "../model/plan.ts";
import { describeAnswer, focusSig, optionLabel, turnOf, type FocusItem, type FocusOption } from "../model/focus.ts";
import type { Store } from "../store.ts";
import { ImpactBadge } from "./fields.tsx";

interface Props {
  store: Store;
  select: (ref: Ref | null) => void;
}

const KIND_LABEL: Record<FocusItem["kind"], string> = { question: "Question", change: "Suggested change", finding: "Finding" };

export function FocusTab({ store, select }: Props) {
  const items = store.focusItems;
  const open = items.filter((i) => i.status === "open");
  const resolved = items.filter((i) => i.status === "resolved");
  const [showResolved, setShowResolved] = useState(false);
  const n = store.focusResponses.length;
  const sentClean = store.sent && store.unsentSinceSend === 0 && n === 0;

  if (!items.length) {
    return (
      <p className="empty-state">
        Nothing in focus. When the agent has a question for you, a change to suggest or something you should
        see, it puts it here with the options laid out, so you can answer without digging through the review pile.
      </p>
    );
  }

  return (
    <div className="focus">
      <p className="muted small">
        What the agent highlighted for you. Pick an option or write your own answer, then press Send. The agent replies here.
      </p>
      {open.length === 0 && <p className="empty-state">All settled. Nothing waiting on you.</p>}
      <ul className="fc-list">
        {open.map((it) => <FocusCard key={it.id} item={it} store={store} select={select} />)}
      </ul>

      {resolved.length > 0 && (
        <section>
          <button className="linkish subhead fc-toggle" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? "▾" : "▸"} Settled ({resolved.length})
          </button>
          {showResolved && (
            <ul className="fc-list fc-resolved">
              {resolved.map((it) => (
                <li key={it.id} className="fc-card is-resolved">
                  <div className="fc-title">{it.title}</div>
                  {it.resolution && <div className="fc-resolution">{it.resolution}</div>}
                  <Refs item={it} store={store} select={select} />
                  {!!it.thread?.length && <Thread item={it} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="send-box">
        <button className="btn primary block fc-send" disabled={!n || !!store.blocking.length} onClick={store.send}>
          {n ? `Send ${n} answer${n === 1 ? "" : "s"}${store.changes.length ? ` and ${store.changes.length} change${store.changes.length === 1 ? "" : "s"}` : ""}` : sentClean ? "Sent ✓ waiting for agent" : "Answer an item to send"}
        </button>
        {store.blocking.length > 0 && <p className="error-text">Resolve errors in Issues first.</p>}
      </div>
    </div>
  );
}

function FocusCard({ item, store, select }: { item: FocusItem; store: Store; select: (r: Ref | null) => void }) {
  const a = store.focusUI[item.id];
  const current = a && a.sig === focusSig(item) ? a : undefined;
  const turn = turnOf(item);
  const sent = !!current?.sent;
  const waiting = turn === "agent";
  const answered = !!current && (!!current.choice || !!current.text.trim() || !!current.done);
  const status = sent || waiting ? "Sent · waiting for the agent" : answered ? "Answer ready to send" : "Needs you";

  return (
    <li className={`fc-card fc-${item.kind}${answered && !sent ? " is-answered" : ""}${sent || waiting ? " is-waiting" : ""}`}>
      <div className="fc-top">
        <span className={`fc-kind fc-kind-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
        {item.impact && <ImpactBadge impact={item.impact} />}
        <span className={`fc-status${!answered && !waiting ? " fc-needs" : ""}`}>{status}</span>
      </div>
      <div className="fc-title">{item.title}</div>
      {item.summary && <p className="fc-summary">{item.summary}</p>}
      {!!item.context?.length && (
        <div className="fc-context">
          <div className="fc-label">Right now</div>
          <ul>{item.context.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      <Refs item={item} store={store} select={select} />
      {!!item.thread?.length && <Thread item={item} />}

      {!!item.options?.length && (
        <div className="fc-options" role="radiogroup" aria-label={item.title}>
          {item.options.map((o) => (
            <OptionCard
              key={o.id} o={o} recommended={item.recommended === o.id} on={current?.choice === o.id} disabled={waiting && !answered}
              onPick={() => store.setFocusChoice(item, current?.choice === o.id ? undefined : o.id)}
            />
          ))}
        </div>
      )}
      {item.recommended && item.rationale && (
        <p className="fc-rationale"><b>Why {optionLabel(item, item.recommended)}:</b> {item.rationale}</p>
      )}

      {!waiting || answered ? (
        <>
          <textarea
            rows={2}
            placeholder={item.kind === "finding" ? "Reply, or ask the agent to act on it (optional)" : item.options?.length ? "Your own answer, a condition, or a follow-up question (optional)" : "Your answer"}
            value={current?.text ?? ""}
            onChange={(e) => store.setFocusText(item, e.target.value)}
          />
          <div className="fc-actions">
            <label className="check">
              <input type="checkbox" checked={!!current?.done} onChange={(e) => store.setFocusDone(item, e.target.checked)} />
              {item.kind === "finding" ? "Got it, nothing to do" : "Settled: no need to come back to me"}
            </label>
            {answered && !sent && <button className="btn ghost small" onClick={() => store.clearFocusAnswer(item.id)}>Clear</button>}
          </div>
        </>
      ) : (
        <p className="hint">Your answer is with the agent. It will reply here.</p>
      )}
    </li>
  );
}

function OptionCard({ o, recommended, on, disabled, onPick }: { o: FocusOption; recommended: boolean; on: boolean; disabled: boolean; onPick: () => void }) {
  return (
    <button role="radio" aria-checked={on} className={`fc-opt${on ? " is-on" : ""}${recommended ? " is-rec" : ""}`} disabled={disabled} onClick={onPick}>
      <div className="fc-opt-head">
        <span className="fc-radio" aria-hidden="true" />
        <span className="fc-opt-label">{o.label}</span>
        {recommended && <span className="fc-rec">recommended</span>}
      </div>
      {o.detail && <div className="fc-opt-detail">{o.detail}</div>}
      {(!!o.pros?.length || !!o.cons?.length) && (
        <ul className="fc-pc">
          {o.pros?.map((p, i) => <li key={`p${i}`} className="fc-pro">{p}</li>)}
          {o.cons?.map((c, i) => <li key={`c${i}`} className="fc-con">{c}</li>)}
        </ul>
      )}
      {o.changes && <div className="fc-changes"><span>Changes</span>{o.changes}</div>}
    </button>
  );
}

function Refs({ item, store, select }: { item: FocusItem; store: Store; select: (r: Ref | null) => void }) {
  if (!item.refs?.length) return null;
  return (
    <div className="fc-refs">
      {item.refs.map((r) => (
        <button key={r} className="chip fc-ref" onClick={() => select(r)} title={r} disabled={!store.index.has(r)}>
          {store.index.has(r) ? labelOf(store.index, r) : r}
        </button>
      ))}
    </div>
  );
}

function Thread({ item }: { item: FocusItem }) {
  return (
    <ol className="fc-thread">
      {item.thread!.map((t, i) => (
        <li key={i} className={`fc-turn fc-turn-${t.from}`}>
          <span className="fc-who">{t.from === "agent" ? "Agent" : "You"}</span>
          {t.from === "agent" ? t.text : describeAnswer(item, t)}
        </li>
      ))}
    </ol>
  );
}
