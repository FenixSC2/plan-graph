// Focus (agent ⇄ user): the short list of topics in play. Shared by the GUI and the agent
// scripts (scripts/build.ts, scripts/plan.ts). See schema/focus.ts for the format.
import type { FocusFile, FocusItem, FocusOption, FocusResponse, FocusTurn } from "../../../schema/focus.ts";
import type { PlanIndex } from "./plan.ts";

export type { FocusFile, FocusItem, FocusOption, FocusResponse, FocusTurn };

/** Small stable string hash (FNV-1a), so the GUI and the CLI fingerprint identically. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Fingerprint of an item as the user sees it. When the agent follows up or edits the item,
 * the fingerprint changes, and the GUI drops an answer the user gave to the older version.
 */
export function focusSig(item: FocusItem): string {
  const { updatedAt, createdAt, ...rest } = item;
  void updatedAt; void createdAt;
  return hash(JSON.stringify(rest));
}

/** Whose move it is on an open item: the user's, unless their answer is the latest turn. */
export function turnOf(item: FocusItem): "user" | "agent" | "none" {
  if (item.status === "resolved") return "none";
  const last = item.thread?.[item.thread.length - 1];
  return last?.from === "user" ? "agent" : "user";
}

/** Open items first (the user's turn before the agent's), then by impact; resolved last. */
export function sortFocus(items: FocusItem[]): FocusItem[] {
  const turnRank = { user: 0, agent: 1, none: 2 } as const;
  const impactRank = { high: 0, medium: 1, low: 2 } as const;
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) =>
      turnRank[turnOf(a.it)] - turnRank[turnOf(b.it)] ||
      impactRank[a.it.impact ?? "medium"] - impactRank[b.it.impact ?? "medium"] ||
      a.i - b.i)
    .map(({ it }) => it);
}

export function optionLabel(item: FocusItem, choice?: string): string | undefined {
  if (!choice) return undefined;
  return item.options?.find((o) => o.id === choice)?.label ?? choice;
}

/** One line for a user turn or response: “Encrypted adapter — keep reinstall signed out”. */
export function describeAnswer(item: FocusItem, r: { choice?: string; choiceLabel?: string; text?: string; done?: boolean }): string {
  const parts = [r.choiceLabel ?? optionLabel(item, r.choice), r.text?.trim()].filter(Boolean) as string[];
  if (r.done) parts.push(parts.length ? "(marked settled)" : "Settled");
  return parts.join(" — ") || "(no answer)";
}

/** Problems with an item before it's written: unknown refs, a recommendation that isn't an option. */
export function checkFocusItem(item: FocusItem, idx: PlanIndex): string[] {
  const out: string[] = [];
  if (!/^[a-z0-9][a-z0-9.\-_]*$/i.test(item.id)) out.push(`${item.id}: ids are dotted words, e.g. f.session-storage`);
  if (!item.title?.trim()) out.push(`${item.id}: needs a title`);
  const ids = new Set<string>();
  for (const o of item.options ?? []) {
    if (ids.has(o.id)) out.push(`${item.id}: option id ${o.id} is used twice`);
    ids.add(o.id);
  }
  if (item.recommended && !ids.has(item.recommended)) out.push(`${item.id}: recommended “${item.recommended}” is not one of its option ids`);
  for (const r of item.refs ?? []) if (!idx.has(r)) out.push(`${item.id}: ref ${r} is not in the plan`);
  return out;
}

/**
 * Record the user's answers in each item's thread (done by `plan.ts apply`), so the history
 * stays with the topic and the GUI shows the item as waiting for the agent.
 * Returns the answers that matched no open item (removed or resolved meanwhile).
 */
export function recordResponses(file: FocusFile, responses: FocusResponse[], at = new Date().toISOString()): FocusResponse[] {
  const unmatched: FocusResponse[] = [];
  for (const r of responses) {
    const item = file.items.find((i) => i.id === r.id);
    if (!item || item.status !== "open") { unmatched.push(r); continue; }
    const label = optionLabel(item, r.choice);
    const turn: FocusTurn = { from: "user", ...(r.choice ? { choice: r.choice, ...(label ? { choiceLabel: label } : {}) } : {}), ...(r.text?.trim() ? { text: r.text.trim() } : {}), ...(r.done ? { done: true } : {}), at };
    (item.thread ??= []).push(turn);
    item.updatedAt = at;
  }
  return unmatched;
}

export const emptyFocus = (): FocusFile => ({ version: 1, items: [] });
