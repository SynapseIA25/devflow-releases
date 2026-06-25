import { Zap, DollarSign, Clock, TrendingUp } from "lucide-react";

const STATS = [
  { icon: Zap,         label: "Tokens usados",      value: "0",      sub: "este mes" },
  { icon: DollarSign,  label: "Costo estimado",      value: "$0.00",  sub: "este mes" },
  { icon: Clock,       label: "Tiempo de respuesta", value: "—",      sub: "promedio" },
  { icon: TrendingUp,  label: "Ejecuciones",         value: "0",      sub: "totales" },
];

export function MetricsView() {
  return (
    <div className="metrics-view">
      <div className="settings-header">
        <h2 className="settings-title">Métricas</h2>
        <p className="settings-subtitle">Monitoreo de uso, costos y rendimiento por proveedor.</p>
      </div>

      <div className="metrics-stats">
        {STATS.map(({ icon: Icon, label, value, sub }) => (
          <div key={label} className="stat-card">
            <div className="stat-icon"><Icon size={18} /></div>
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
            <div className="stat-sub">{sub}</div>
          </div>
        ))}
      </div>

      <div className="metrics-empty">
        <TrendingUp size={40} opacity={0.2} />
        <p>Las métricas aparecerán aquí una vez que configures un proveedor y empieces a usar los agentes.</p>
      </div>
    </div>
  );
}
