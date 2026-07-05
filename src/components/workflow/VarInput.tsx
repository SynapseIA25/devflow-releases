import { useRef, useState, useEffect, type KeyboardEvent, type ChangeEvent } from "react";

export type Variable = { token: string; label: string };

type Props = {
  value: string;
  onChange: (v: string) => void;
  variables: Variable[];
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
};

// Input/textarea con autocompletado de variables de workflow: al tipear `{{` (opcionalmente seguido
// de texto parcial) se abre un popup con las variables disponibles ({{id.output}}, {{input}}, …).
// Enter/Tab acepta, ↑/↓ navega, Esc cierra. Al aceptar inserta `{{token}}` cerrando las llaves.
export function VarInput({ value, onChange, variables, multiline, rows = 3, placeholder }: Props) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  // Posición del caret a restaurar tras insertar (React re-renderiza y perdería la ubicación).
  const caretRef = useRef<number | null>(null);

  const filtered = open
    ? variables.filter((v) => `${v.token} ${v.label}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : [];

  useEffect(() => {
    if (caretRef.current != null && ref.current) {
      const pos = caretRef.current;
      ref.current.selectionStart = ref.current.selectionEnd = pos;
      ref.current.focus();
      caretRef.current = null;
    }
  });

  // ¿El texto justo antes del caret termina en un `{{` sin cerrar? Devuelve el texto parcial o null.
  const partialBefore = (val: string, caret: number): string | null => {
    const m = /\{\{\s*([\w.]*)$/.exec(val.slice(0, caret));
    return m ? m[1] : null;
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    onChange(val);
    const partial = partialBefore(val, e.target.selectionStart ?? val.length);
    if (partial !== null) {
      setOpen(true);
      setQuery(partial);
      setIdx(0);
    } else {
      setOpen(false);
    }
  };

  const accept = (v: Variable) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const m = /\{\{\s*([\w.]*)$/.exec(value.slice(0, caret));
    if (!m) return;
    const start = caret - m[0].length;
    const insert = `{{${v.token}}}`;
    onChange(value.slice(0, start) + insert + value.slice(caret));
    caretRef.current = start + insert.length;
    setOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => (i + 1) % filtered.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => (i - 1 + filtered.length) % filtered.length); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(filtered[idx]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  const shared = {
    ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => { ref.current = el; },
    className: "wf-var-input",
    value,
    placeholder,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    // Delay para que un click en una opción (onMouseDown) alcance a dispararse antes de cerrar.
    onBlur: () => setTimeout(() => setOpen(false), 120),
  };

  return (
    <div className="wf-var-wrap">
      {multiline ? <textarea {...shared} rows={rows} /> : <input {...shared} />}
      {open && filtered.length > 0 && (
        <div className="wf-var-pop">
          {filtered.map((v, i) => (
            <div
              key={v.token}
              className={`wf-var-opt${i === idx ? " active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); accept(v); }}
            >
              <code>{`{{${v.token}}}`}</code>
              <span>{v.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
