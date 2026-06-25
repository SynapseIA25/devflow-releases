import { useEffect, useRef } from "react";

export type LogEntry = {
  time: string;
  level: "info" | "success" | "error" | "warn";
  message: string;
};

type Props = {
  logs: LogEntry[];
  onClear: () => void;
};

export function OutputPanel({ logs, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="output-panel">
      <div className="output-header">
        <span className="output-title">Output</span>
        <button className="output-clear" onClick={onClear}>Clear</button>
      </div>
      <div className="output-logs">
        {logs.length === 0 && (
          <span style={{ color: "var(--text-muted)" }}>
            Run a flow to see output here...
          </span>
        )}
        {logs.map((log, i) => (
          <div key={i} className="log-line">
            <span className="log-time">{log.time}</span>
            <span className={`log-${log.level}`}>{log.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
