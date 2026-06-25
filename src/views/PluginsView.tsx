import { Download, Star, Package } from "lucide-react";

const PLUGINS = [
  { id: "warp", name: "Warp Terminal", desc: "Terminal potenciada con IA escrita en Rust", stars: 4.9, tag: "terminal", installed: false },
  { id: "git-flow", name: "Git Flow", desc: "Automatiza tu flujo de Git con commits y PRs inteligentes", stars: 4.7, tag: "git", installed: true },
  { id: "docker", name: "Docker Manager", desc: "Gestiona contenedores desde el agente", stars: 4.5, tag: "infra", installed: false },
  { id: "test-runner", name: "Test Runner", desc: "Ejecuta y monitorea tests con reportes en lenguaje natural", stars: 4.6, tag: "testing", installed: false },
  { id: "db-explorer", name: "DB Explorer", desc: "Consulta bases de datos con lenguaje natural", stars: 4.4, tag: "database", installed: false },
  { id: "api-tester", name: "API Tester", desc: "Testea endpoints REST y GraphQL desde el chat", stars: 4.3, tag: "api", installed: false },
];

export function PluginsView() {
  return (
    <div className="plugins-view">
      <div className="plugins-header">
        <h2 className="settings-title">Plugins</h2>
        <p className="settings-subtitle">Extendé las capacidades de tus agentes con herramientas especializadas.</p>
      </div>
      <div className="plugins-grid">
        {PLUGINS.map((p) => (
          <div key={p.id} className={`plugin-card${p.installed ? " installed" : ""}`}>
            <div className="plugin-card-header">
              <div className="plugin-icon"><Package size={20} /></div>
              <span className={`plugin-tag plugin-tag--${p.tag}`}>{p.tag}</span>
            </div>
            <div className="plugin-name">{p.name}</div>
            <div className="plugin-desc">{p.desc}</div>
            <div className="plugin-footer">
              <div className="plugin-stars"><Star size={11} fill="currentColor" /> {p.stars}</div>
              <button className={`plugin-btn${p.installed ? " installed" : ""}`}>
                {p.installed ? "✓ Instalado" : <><Download size={11} /> Instalar</>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
