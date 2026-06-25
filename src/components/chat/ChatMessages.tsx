import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Message } from "../../store/chatStore";
import { DEFAULT_AGENTS } from "../../lib/providers";
import { Bot, User } from "lucide-react";

type Props = { messages: Message[]; isLoading: boolean };

export function ChatMessages({ messages, isLoading }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  return (
    <div className="chat-messages">
      {messages.map((msg) => {
        const agent = DEFAULT_AGENTS.find((a) => a.id === msg.agentId);
        return (
          <div key={msg.id} className={`chat-msg chat-msg--${msg.role}`}>
            <div className="chat-msg-avatar">
              {msg.role === "user" ? (
                <User size={14} />
              ) : (
                <span style={{ color: agent?.color ?? "#a78bfa", fontSize: 14 }}>
                  {agent?.icon ?? <Bot size={14} />}
                </span>
              )}
            </div>
            <div className="chat-msg-body">
              <div className="chat-msg-meta">
                <span className="chat-msg-name">
                  {msg.role === "user" ? "Vos" : (agent?.name ?? "Agente")}
                </span>
                <span className="chat-msg-time">
                  {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="chat-msg-content">
                {msg.role === "assistant" ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                ) : (
                  <p>{msg.content}</p>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {isLoading && (
        <div className="chat-msg chat-msg--assistant">
          <div className="chat-msg-avatar">
            <Bot size={14} />
          </div>
          <div className="chat-msg-body">
            <div className="chat-msg-meta">
              <span className="chat-msg-name">Agente</span>
            </div>
            <div className="chat-msg-content">
              <div className="typing-indicator">
                <span /><span /><span />
              </div>
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
