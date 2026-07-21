import { useWorkflowStore } from "../../store/workflowStore";
import { useAgentsStore } from "../../store/agentsStore";
import { DEFAULT_PROVIDERS } from "../../lib/providers";
import { NODE_SCHEMAS } from "../../nodes/nodeSchema";
import { VarInput, type Variable } from "./VarInput";

// Panel lateral que configura el nodo seleccionado en el canvas. Lee el schema declarativo del tipo
// de nodo (nodeSchema.ts) y renderiza sus campos con inputs grandes; los campos con `vars` traen
// autocompletado de variables del flujo. El nodo seleccionado se detecta por `node.selected` (que
// React Flow setea vía onNodesChange → store).
export function NodeInspector() {
  const activeId = useWorkflowStore((s) => s.activeId);
  const nodes = useWorkflowStore((s) => s.workflows[s.activeId]?.nodes ?? []);
  const order = useWorkflowStore((s) => s.order);
  const workflows = useWorkflowStore((s) => s.workflows);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const agents = useAgentsStore((s) => s.agents);

  const selected = nodes.find((n) => n.selected);
  const schema = selected ? NODE_SCHEMAS[selected.type ?? ""] : undefined;

  if (!selected || !schema) {
    return (
      <div className="wf-inspector">
        <div className="wf-inspector-empty">
          <p>Seleccioná un nodo del canvas para configurarlo.</p>
        </div>
      </div>
    );
  }

  // Variables ofrecidas al autocompletado: {{input}} + cada OTRO nodo (output siempre; exitCode si
  // terminal; branch si condition). En runtime solo resuelven las de nodos aguas arriba, pero acá se
  // ofrecen todas (no calculamos el grafo) — más simple y no molesta.
  const variables: Variable[] = [{ token: "input", label: "Entrada (predecesores directos)" }];
  for (const n of nodes) {
    if (n.id === selected.id) continue;
    const name = String(n.data.label ?? n.type ?? n.id);
    variables.push({ token: `${n.id}.output`, label: `${name} → salida` });
    if (n.type === "terminal") variables.push({ token: `${n.id}.exitCode`, label: `${name} → exit code` });
    if (n.type === "condition") variables.push({ token: `${n.id}.branch`, label: `${name} → rama` });
  }

  return (
    <div className="wf-inspector">
      <div className="wf-inspector-header">
        <span className="wf-inspector-icon">{schema.icon}</span>
        <div className="wf-inspector-titles">
          <div className="wf-inspector-title">{schema.title}</div>
          <div className="wf-inspector-id">{selected.id}</div>
        </div>
      </div>
      <p className="wf-inspector-desc">{schema.description}</p>

      <div className="wf-inspector-fields">
        {schema.fields.map((f) => {
          const val = String(selected.data[f.key] ?? "");
          const set = (v: string) => updateNodeData(selected.id, { [f.key]: v });

          if (f.type === "select") {
            const opts =
              f.dynamicOptions === "flows"
                ? order.filter((fid) => fid !== activeId).map((fid) => ({ value: fid, label: workflows[fid].name }))
                : f.dynamicOptions === "agents"
                ? agents
                    .filter((a) => {
                      const p = DEFAULT_PROVIDERS.find((p) => p.id === a.providerId);
                      return !!p?.acp || !!p?.nativeHttp;
                    })
                    .map((a) => ({ value: a.id, label: a.name }))
                : f.options ?? [];
            return (
              <label key={f.key} className="wf-field">
                <span className="wf-field-label">{f.label}</span>
                <select
                  className="wf-field-select"
                  value={val}
                  onChange={(e) => {
                    set(e.target.value);
                    // Sub-flujo: guardamos también el nombre para que la tarjeta del canvas lo muestre.
                    if (f.dynamicOptions === "flows") {
                      updateNodeData(selected.id, { flowName: workflows[e.target.value]?.name ?? "" });
                    }
                  }}
                >
                  <option value="">—</option>
                  {opts.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            );
          }

          return (
            <label key={f.key} className="wf-field">
              <span className="wf-field-label">{f.label}</span>
              {f.vars ? (
                <VarInput
                  value={val}
                  onChange={set}
                  variables={variables}
                  multiline={f.type === "textarea"}
                  rows={f.rows}
                  placeholder={f.placeholder}
                />
              ) : f.type === "textarea" ? (
                <textarea className="wf-var-input" rows={f.rows ?? 3} value={val} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
              ) : (
                <input className="wf-var-input" value={val} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
              )}
            </label>
          );
        })}

        {/* Manejo de errores — genérico para cualquier nodo (lo lee runGraph en el motor). */}
        <div className="wf-adv-sep">Avanzado</div>
        <label className="wf-field">
          <span className="wf-field-label">Reintentos si falla</span>
          <input
            className="wf-var-input"
            type="number"
            min={0}
            value={String(selected.data.retries ?? 0)}
            onChange={(e) => updateNodeData(selected.id, { retries: Math.max(0, Math.floor(Number(e.target.value)) || 0) })}
          />
        </label>
        <label className="wf-field">
          <span className="wf-field-label">Si falla (tras reintentos)</span>
          <select
            className="wf-field-select"
            value={String(selected.data.onError ?? "stop")}
            onChange={(e) => updateNodeData(selected.id, { onError: e.target.value })}
          >
            <option value="stop">Detener el flujo</option>
            <option value="continue">Continuar (capturar error)</option>
          </select>
        </label>
      </div>
    </div>
  );
}
