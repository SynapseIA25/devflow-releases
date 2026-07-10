import { useEffect, useRef, useState } from "react";
import { Play, Square, Plus, Trash2, RotateCw, Server } from "lucide-react";
import { useProjectStore, type Service } from "../store/projectStore";
import { ServicePane } from "../components/ServicePane";
import { ptyKill } from "../lib/tauriApi";

// Panel de Servicios: corre servers/procesos de larga duración (npm run dev, etc.) en terminales
// AISLADAS gestionadas, para no correrlos dentro de un turno del agente (que es lo que lo cuelga).
// Cada servicio tiene su propio PTY (id del servicio) y su log en vivo; iniciar/detener/reiniciar.
export function ServicesView() {
  // Servicios del proyecto activo (scope duro): la vista solo muestra los del proyecto actual.
  const activeId = useProjectStore((s) => s.activeId);
  const services = useProjectStore((s) => s.projects[s.activeId]?.services ?? []);
  const addService = useProjectStore((s) => s.addService);
  const removeService = useProjectStore((s) => s.removeService);
  const setStatus = useProjectStore((s) => s.setServiceStatus);
  const projectEnv = useProjectStore((s) => s.projects[s.activeId]?.env ?? {});
  const projectPath = useProjectStore((s) => s.projectPath);

  const [selected, setSelected] = useState<string | null>(null);
  // Al cambiar de proyecto activo, la selección de un servicio del proyecto anterior deja de ser válida.
  useEffect(() => { setSelected(null); }, [activeId]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCmd, setNewCmd] = useState("");

  // Generación por servicio: bumpeada al (re)iniciar para forzar el remonte del ServicePane (respawn),
  // incluso si el servicio ya tenía un pane con logs viejos (estado "exited").
  const genRef = useRef<Map<string, number>>(new Map());
  // Ids que el usuario está deteniendo, para distinguir un stop manual de una muerte natural del proceso.
  const stoppingRef = useRef<Set<string>>(new Set());
  const gen = (id: string) => genRef.current.get(id) ?? 0;

  const start = (svc: Service) => {
    genRef.current.set(svc.id, gen(svc.id) + 1);
    stoppingRef.current.delete(svc.id);
    setStatus(svc.id, "running");
    setSelected(svc.id);
  };
  const stop = (svc: Service) => {
    stoppingRef.current.add(svc.id);
    void ptyKill(svc.id);
    setStatus(svc.id, "stopped");
  };
  const onPaneExit = (id: string, code: number | null) => {
    // Si el usuario lo detuvo, ya quedó "stopped"; si murió solo (crash/fin), lo marcamos "exited"
    // y dejamos el pane montado para poder ver los logs de por qué terminó.
    if (stoppingRef.current.delete(id)) return;
    setStatus(id, "exited", code ?? undefined);
  };
  const remove = (svc: Service) => {
    void ptyKill(svc.id);
    removeService(svc.id);
    if (selected === svc.id) setSelected(null);
  };
  const addNew = () => {
    const cmd = newCmd.trim();
    if (!cmd) return;
    const name = newName.trim() || cmd.slice(0, 24) || "Service";
    const id = addService(name, cmd);
    setNewName("");
    setNewCmd("");
    setShowAdd(false);
    setSelected(id);
  };

  // Panes montados: servicios corriendo o recién terminados (para conservar sus logs). "stopped" = sin pane.
  const paneServices = services.filter((s) => s.status === "running" || s.status === "exited");
  const selectedSvc = services.find((s) => s.id === selected);
  const statusLabel = (s: Service) =>
    s.status === "running" ? "running" : s.status === "exited" ? `exited${s.exitCode != null ? ` (exit ${s.exitCode})` : ""}` : "stopped";

  return (
    <div className="services-view">
      <div className="services-sidebar">
        <div className="services-header">
          <span className="services-title"><Server size={14} /> Services</span>
          <button className="svc-add-btn" onClick={() => setShowAdd((v) => !v)} title="Add service"><Plus size={14} /></button>
        </div>

        {showAdd && (
          <div className="svc-add-form">
            <input className="svc-input" placeholder="Name (e.g. Dev server)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input
              className="svc-input"
              placeholder="Command (e.g. npm run dev)"
              value={newCmd}
              onChange={(e) => setNewCmd(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addNew(); }}
            />
            <div className="svc-add-actions">
              <button className="svc-btn svc-btn--primary" onClick={addNew} disabled={!newCmd.trim()}>Add</button>
              <button className="svc-btn" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="svc-list">
          {services.length === 0 && !showAdd && (
            <div className="svc-empty">No services. Add one with ＋ to run a server (npm run dev, etc.) without hanging the agent chat.</div>
          )}
          {services.map((svc) => (
            <div key={svc.id} className={`svc-row${selected === svc.id ? " selected" : ""}`} onClick={() => setSelected(svc.id)}>
              <span className={`svc-dot svc-dot--${svc.status}${svc.status === "exited" && svc.exitCode ? " svc-dot--error" : ""}`} />
              <div className="svc-row-info">
                <div className="svc-row-name">{svc.name}</div>
                <div className="svc-row-cmd">{svc.command}</div>
              </div>
              <div className="svc-row-actions">
                {svc.status === "running" ? (
                  <>
                    <button className="svc-icon" onClick={(e) => { e.stopPropagation(); stop(svc); }} title="Stop"><Square size={12} /></button>
                    <button className="svc-icon" onClick={(e) => { e.stopPropagation(); start(svc); }} title="Restart"><RotateCw size={12} /></button>
                  </>
                ) : (
                  <button className="svc-icon svc-icon--play" onClick={(e) => { e.stopPropagation(); start(svc); }} title="Start"><Play size={12} /></button>
                )}
                <button className="svc-icon svc-icon--del" onClick={(e) => { e.stopPropagation(); remove(svc); }} title="Remove"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="services-main">
        {selectedSvc && (
          <div className="svc-detail-bar">
            <span className={`svc-dot svc-dot--${selectedSvc.status}${selectedSvc.status === "exited" && selectedSvc.exitCode ? " svc-dot--error" : ""}`} />
            <span className="svc-detail-name">{selectedSvc.name}</span>
            <span className="svc-detail-cmd">{selectedSvc.command}</span>
            <span className="svc-detail-status">{statusLabel(selectedSvc)}</span>
          </div>
        )}
        <div className="svc-logs">
          {paneServices.map((svc) => (
            <ServicePane
              key={`${svc.id}#${gen(svc.id)}`}
              id={svc.id}
              command={svc.command}
              cwd={svc.cwd?.trim() || projectPath}
              env={projectEnv}
              active={svc.id === selected}
              onExit={(code) => onPaneExit(svc.id, code)}
            />
          ))}
          {(!selectedSvc || selectedSvc.status === "stopped") && (
            <div className="svc-logs-empty">
              {services.length === 0
                ? "Add and start a service to see its live logs here."
                : selectedSvc
                  ? "Service stopped. Start it (▶) to see its live logs."
                  : "Select a service on the left."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
