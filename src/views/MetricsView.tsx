import { Zap, Clock, TrendingUp, MessageSquare, RotateCcw } from "lucide-react";
import { useMetricsStore, approxTokens } from "../store/metricsStore";
import { useSettingsStore } from "../store/settingsStore";

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
const fmtTokens = (t: number) => (t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${t}`);
const fmtTime = (epoch: number | null) => (epoch ? new Date(epoch).toLocaleString() : "—");

export function MetricsView() {
  const m = useMetricsStore();
  const providers = useSettingsStore((s) => s.providers);
  const reset = useMetricsStore((s) => s.reset);

  const totalExec = m.chatPrompts + m.workflowRuns;
  const avgLatency = m.latencySamples > 0 ? m.totalLatencyMs / m.latencySamples : null;
  const totalTokens = approxTokens(m.inChars + m.outChars);
  const providerEntries = Object.entries(m.byProvider).sort((a, b) => b[1].prompts - a[1].prompts);

  const stats = [
    { icon: TrendingUp,    label: "Executions",     value: String(totalExec),               sub: `${m.chatPrompts} chat · ${m.workflowRuns} workflows` },
    { icon: Clock,         label: "Response time",  value: avgLatency != null ? fmtMs(avgLatency) : "—", sub: "average" },
    { icon: Zap,           label: "Tokens (approx.)", value: fmtTokens(totalTokens),        sub: `${fmtTokens(approxTokens(m.inChars))} in · ${fmtTokens(approxTokens(m.outChars))} out` },
    { icon: MessageSquare, label: "Messages to agent", value: String(m.chatPrompts),        sub: "chat turns" },
  ];

  const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;
  const providerColor = (id: string) => providers.find((p) => p.id === id)?.color ?? "#888";

  return (
    <div className="metrics-view">
      <div className="settings-header metrics-header-row">
        <div>
          <h2 className="settings-title">Metrics</h2>
          <p className="settings-subtitle">Real agent and workflow usage. Last activity: {fmtTime(m.lastActivity)}</p>
        </div>
        {totalExec > 0 && (
          <button className="metrics-reset-btn" onClick={reset} title="Reset metrics">
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>

      <div className="metrics-stats">
        {stats.map(({ icon: Icon, label, value, sub }) => (
          <div key={label} className="stat-card">
            <div className="stat-icon"><Icon size={18} /></div>
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
            <div className="stat-sub">{sub}</div>
          </div>
        ))}
      </div>

      {providerEntries.length > 0 ? (
        <div className="metrics-table-wrap">
          <div className="detail-label" style={{ marginBottom: 8 }}>By provider</div>
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Messages</th>
                <th>Avg. latency</th>
                <th>Tokens (approx.)</th>
              </tr>
            </thead>
            <tbody>
              {providerEntries.map(([id, st]) => (
                <tr key={id}>
                  <td>
                    <span className="provider-dot" style={{ background: providerColor(id), display: "inline-block", marginRight: 8 }} />
                    {providerName(id)}
                  </td>
                  <td>{st.prompts}</td>
                  <td>{st.samples > 0 ? fmtMs(st.latencyMs / st.samples) : "—"}</td>
                  <td>{fmtTokens(approxTokens(st.inChars + st.outChars))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="detail-hint">
            Tokens are an approximation (≈ characters ÷ 4): ACP doesn't report exact token usage.
          </p>
        </div>
      ) : (
        <div className="metrics-empty">
          <TrendingUp size={40} opacity={0.2} />
          <p>Metrics will appear here once you use an agent in the chat or run a workflow.</p>
        </div>
      )}
    </div>
  );
}
