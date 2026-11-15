import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Send, Square } from 'lucide-react';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
}

export type ChatSender = (messages: ChatMessage[], signal: AbortSignal, onText: (text: string) => void) => Promise<void>;

export interface AiChatProps {
  send: ChatSender;
  title?: string;
  theme?: 'light' | 'dark' | 'system';
  className?: string;
}

export function AiChat({ send, title = 'AI 助手', theme = 'system', className = '' }: AiChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const composerId = useId();

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [messages, error]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || controller.current) return;
    const request = new AbortController();
    controller.current = request;
    const history: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setDraft('');
    setError('');
    setBusy(true);
    try {
      await send(history, request.signal, text => {
        if (request.signal.aborted) return;
        setMessages(current => {
          const next = [...current];
          const last = next[next.length - 1];
          if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + text };
          return next;
        });
      });
    } catch (reason) {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setBusy(false);
        setMessages(current => current.filter((message, index) => index !== current.length - 1 || message.role !== 'assistant' || message.content));
      }
    }
  }

  return <section className={`cai-chat ${className}`} data-theme={theme} aria-label={title}>
    <header className="cai-header"><span className="cai-mark" aria-hidden="true">✳</span><strong>{title}</strong><span className="cai-status">{busy ? '回复中' : '就绪'}</span></header>
    <div className="cai-messages" aria-live="polite">
      {messages.length === 0 && <div className="cai-empty"><span className="cai-empty-mark" aria-hidden="true">✳</span><strong>有什么可以帮你？</strong></div>}
      {messages.map((message, index) => <div className={`cai-message cai-${message.role}`} key={index}>
        <span className="cai-role">{message.role === 'user' ? '你' : title}</span>
        <div className="cai-content">{message.content || (busy ? '正在思考…' : '')}</div>
      </div>)}
      {error && <div className="cai-error" role="alert">{error}</div>}
      <div ref={end} />
    </div>
    <form className="cai-composer" onSubmit={submit}>
      <label className="cai-sr-only" htmlFor={composerId}>输入消息</label>
      <textarea id={composerId} value={draft} onChange={event => setDraft(event.target.value)} placeholder="输入消息…" rows={2} />
      {busy
        ? <button className="cai-send" type="button" title="停止生成" aria-label="停止生成" onClick={() => controller.current?.abort()}><Square size={16} fill="currentColor" /></button>
        : <button className="cai-send" type="submit" title="发送" aria-label="发送" disabled={!draft.trim()}><Send size={17} /></button>}
    </form>
  </section>;
}