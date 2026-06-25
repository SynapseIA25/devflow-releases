import { useState, useRef, KeyboardEvent } from "react";
import { Send, ChevronDown, Zap } from "lucide-react";
import { DEFAULT_AGENTS } from "../../lib/providers";
import { useSettingsStore } from "../../store/settingsStore";
import { useChatStore } from "../../store/chatStore";

type Props = { onSend: (text: string) => void; disabled?: boolean };

export function ChatInput({ onSend, disabled }: Props) {
  const [text, setText] = useState("");
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { activeAgentId, setActiveAgent } = useChatStore();
  const { selectedModel, selectedProviderId } = useSettingsStore();

  const activeAgent = DEFAULT_AGENTS.find((a) => a.id === activeAgentId);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    textareaRef.current?.focus();
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-input-wrapper">
      <div className="chat-input-box">
        <div className="chat-input-top">
          <div className="agent-selector" onClick={() => setShowAgentMenu((v) => !v)}>
            <span style={{ color: activeAgent?.color ?? "#a78bfa" }}>{activeAgent?.icon ?? "⬡"}</span>
            <span className="agent-selector-name">{activeAgent?.name ?? "Agente"}</span>
            <ChevronDown size={12} />
            {showAgentMenu && (
              <div className="agent-dropdown">
                {DEFAULT_AGENTS.map((a) => (
                  <div
                    key={a.id}
                    className={`agent-option${a.id === activeAgentId ? " active" : ""}`}
                    onClick={(e) => { e.stopPropagation(); setActiveAgent(a.id); setShowAgentMenu(false); }}
                  >
                    <span style={{ color: a.color }}>{a.icon}</span>
                    <div>
                      <div className="agent-option-name">{a.name}</div>
                      <div className="agent-option-desc">{a.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="model-badge">
            <Zap size={10} />
            <span>{selectedModel} · {selectedProviderId}</span>
          </div>
        </div>

        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Pedile algo al agente... (Enter para enviar, Shift+Enter para nueva línea)"
          rows={3}
          disabled={disabled}
        />

        <div className="chat-input-footer">
          <span className="chat-hint">Enter para enviar · Shift+Enter para nueva línea</span>
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!text.trim() || disabled}
          >
            <Send size={14} />
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
