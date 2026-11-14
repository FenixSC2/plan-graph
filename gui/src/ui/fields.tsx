import { useEffect, useState, type ReactNode } from "react";

/** Text input that commits on blur / Enter (textarea: on blur / ⌘Enter), so each edit is one undo step. */
export function TextField(props: {
  label?: string;
  value: string | undefined;
  onCommit: (v: string) => void;
  multiline?: boolean;
  mono?: boolean;
  placeholder?: string;
}) {
  const [v, setV] = useState(props.value ?? "");
  useEffect(() => setV(props.value ?? ""), [props.value]);
  const commit = () => {
    if (v !== (props.value ?? "")) props.onCommit(v);
  };
  const common = {
    value: v,
    placeholder: props.placeholder,
    className: props.mono ? "mono" : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
  };
  return (
    <Field label={props.label}>
      {props.multiline ? (
        <textarea rows={3} {...common} onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && commit()} />
      ) : (
        <input {...common} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), commit())} />
      )}
    </Field>
  );
}

export function SelectField<T extends string>(props: {
  label?: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  allowCustom?: boolean;
}) {
  const known = props.options.some((o) => o.value === props.value);
  return (
    <Field label={props.label}>
      <select value={props.value ?? ""} onChange={(e) => props.onChange(e.target.value as T)}>
        {!known && <option value={props.value ?? ""}>{props.value ? `${props.value} (not in profile)` : "—"}</option>}
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function Field({ label, children }: { label?: string; children: ReactNode }) {
  if (!label) return <>{children}</>;
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="isec">
      <div className="isec-head">
        <h4>{title}</h4>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function StatusBadge({ status, origin }: { status: string; origin?: string }) {
  const text = status === "sketch" ? "needs detail" : status;
  return (
    <span className={`badge badge-${status}`} title={origin ? `origin: ${origin}` : undefined}>
      {text}
      {origin && <span className="badge-origin"> · {origin}</span>}
    </span>
  );
}

export function ImpactBadge({ impact }: { impact: string }) {
  return <span className={`badge impact-${impact}`}>{impact}</span>;
}
