import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChatMessage,
  ToolCall,
  StreamEvent,
  api,
  getHistory,
  streamChat,
  normalizeMessage,
} from "../lib/api";
import { Timeline, Step, applyEvent, applyLog } from "../component/Timeline";

/* ---------- Neumorphic tokens (bluish theme) ---------- */
const RAISED = "shadow-[6px_6px_14px_#c3cde0,-6px_-6px_14px_#ffffff]";
const RAISED_SM = "shadow-[4px_4px_9px_#c3cde0,-4px_-4px_9px_#ffffff]";
const INSET = "shadow-[inset_4px_4px_9px_#c3cde0,inset_-4px_-4px_9px_#ffffff]";
const INSET_SM =
  "shadow-[inset_3px_3px_6px_#c3cde0,inset_-3px_-3px_6px_#ffffff]";

const statusStyle: Record<string, string> = {
  completed: "text-emerald-600",
  running: "text-[#3a6fe0]",
  revoked: "text-amber-600",
  failed: "text-rose-600",
};

function ToolBox({ call, align }: { call: ToolCall; align: "left" | "right" }) {
  const [open, setOpen] = useState(true);
  return (
    <div
      className={`flex ${align === "right" ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`w-full max-w-xl rounded-[22px] bg-[#e7edf6] p-4 ${RAISED}`}
      >
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="font-bold text-[#1c2a4a]">{call.name}</span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-xl bg-[#e7edf6] px-3 py-1.5 text-xs font-bold ${INSET_SM} ${statusStyle[call.status] ?? statusStyle.completed}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {call.status}
          </span>
        </button>
        {open && (
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <p className="mb-1.5 font-semibold text-[#7a88a6]">Input</p>
              <pre
                className={`overflow-x-auto rounded-2xl bg-[#e7edf6] p-3 text-[#3b4a6b] ${INSET}`}
              >
                {JSON.stringify(call.args, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1.5 font-semibold text-[#7a88a6]">
                Response from backend
              </p>
              <pre
                className={`max-h-64 overflow-auto rounded-2xl bg-[#e7edf6] p-3 text-emerald-700 ${INSET}`}
              >
                {typeof call.result === "string"
                  ? call.result
                  : JSON.stringify(call.result, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [convoId, setConvoId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // One conversation id per browser, then load its real history from the DB.
  useEffect(() => {
    const saved = localStorage.getItem("convo_id") ?? crypto.randomUUID();
    localStorage.setItem("convo_id", saved);
    setConvoId(saved);
    getHistory(saved)
      .then(setMessages)
      .catch(() => {});
  }, []);

  useEffect(
    () => endRef.current?.scrollIntoView({ behavior: "smooth" }),
    [messages, busy, steps],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || !convoId) return;

    setInput("");
    setError(null);
    setSteps([]);
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", content: text, toolCalls: [] },
    ]);
    setBusy(true);

    let local: Step[] = [];
    const onEvent = (ev: StreamEvent) => {
      switch (ev.type) {
        case "task":
          setTaskId(ev.task_id);
          break;
        case "step":
          local = applyEvent(local, ev);
          setSteps(local);
          break;
        case "log":
          local = applyLog(local, { step: ev.agent, line: ev.text });
          setSteps(local);
          break;
        case "final": {
          const msg = normalizeMessage({ role: "assistant", ...ev.data });
          setMessages((m) => [...m, msg]);
          // Replace client-only ids with the real DB ids (so /progress/:id works).
          getHistory(convoId)
            .then(setMessages)
            .catch(() => {});
          break;
        }
        case "error":
          setError(ev.message);
          break;
      }
    };

    try {
      await streamChat(text, onEvent, { convoId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
      setTaskId(null);
    }
  }

  async function stop() {
    if (!taskId) return;
    try {
      await api.cancelTask(taskId);
    } catch {
      /* task may have just finished */
    }
  }

  function newChat() {
    if (busy) return;
    const id = crypto.randomUUID();
    localStorage.setItem("convo_id", id);
    setConvoId(id);
    setMessages([]);
    setSteps([]);
    setError(null);
  }

  return (
    <div className="flex h-screen flex-col bg-[#e7edf6] text-[#1c2a4a]">
      {/* Header */}
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-6 py-5">
        <div
          className={`flex h-14 items-center rounded-[20px] bg-[#e7edf6] px-6 ${RAISED_SM}`}
        >
          <h1 className="text-lg font-extrabold tracking-tight text-[#1c2a4a]">
            Chat
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={newChat}
            disabled={busy}
            className={`rounded-full bg-[#e7edf6] px-5 py-3 text-sm font-semibold text-[#7a88a6] disabled:opacity-40 ${RAISED_SM}`}
          >
            New chat
          </button>
          <Link
            href="/progress"
            className={`rounded-full bg-[#e7edf6] px-6 py-3 text-sm font-semibold text-[#3a6fe0] transition active:shadow-[inset_3px_3px_6px_#c3cde0,inset_-3px_-3px_6px_#ffffff] ${RAISED_SM}`}
          >
            Task progress
          </Link>
        </div>
      </header>

      {/* Messages */}
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-5 overflow-y-auto px-6 pb-4 pt-2">
        {messages.length === 0 && !busy && (
          <div className="flex justify-center pt-20">
            <p
              className={`rounded-full bg-[#e7edf6] px-6 py-3 text-sm font-medium text-[#7a88a6] ${INSET}`}
            >
              Type a message below to start.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="space-y-4">
            {/* Your messages: left. AI messages: right. */}
            {m.content && (
              <div
                className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-xl overflow-x-auto whitespace-pre-wrap rounded-[22px] px-5 py-3.5 leading-relaxed ${
                    m.role === "user"
                      ? `bg-[#e7edf6] text-[#1c2a4a] ${RAISED}`
                      : `bg-gradient-to-br from-[#dfe9fd] to-[#d3e1fb] text-[#1c2a4a] ${RAISED}`
                  }`}
                >
                  {m.content}
                  {m.role === "assistant" && (
                    <Link
                      href={`/progress/${m.id}`}
                      className="mt-3 block text-sm font-semibold text-[#3a6fe0] hover:underline"
                    >
                      View task progress
                    </Link>
                  )}
                </div>
              </div>
            )}
            {m.toolCalls.map((c) => (
              <ToolBox key={c.id} call={c} align="right" />
            ))}
          </div>
        ))}
        {busy && (
          <div className="flex justify-end">
            <div
              className={`w-full max-w-xl rounded-[22px] bg-[#e7edf6] p-4 ${RAISED}`}
            >
              <Timeline steps={steps} />
            </div>
          </div>
        )}
        {error && (
          <p
            className={`mx-auto w-fit rounded-full bg-[#e7edf6] px-5 py-2 text-center text-sm font-semibold text-rose-600 ${INSET_SM}`}
          >
            {error}
          </p>
        )}
        <div ref={endRef} />
      </main>

      {/* Input */}
      <form
        onSubmit={submit}
        className="mx-auto flex w-full max-w-4xl gap-4 px-6 pb-7 pt-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything"
          className={`flex-1 rounded-full bg-[#e7edf6] px-6 py-4 text-[#1c2a4a] outline-none placeholder:text-[#7a88a6] focus:shadow-[inset_5px_5px_11px_#c3cde0,inset_-5px_-5px_11px_#ffffff] ${INSET}`}
        />
        {busy && taskId && (
          <button
            type="button"
            onClick={stop}
            className={`rounded-full bg-[#e7edf6] px-6 py-4 font-semibold text-rose-600 ${RAISED_SM}`}
          >
            Stop
          </button>
        )}
        <button
          disabled={busy || !input.trim() || !convoId}
          className="rounded-full bg-gradient-to-br from-[#5b95ff] to-[#3a6fe0] px-8 py-4 font-semibold text-white shadow-[6px_6px_14px_#b3c0dc,-5px_-5px_12px_#ffffff] transition active:shadow-[inset_4px_4px_9px_#2d58b8,inset_-4px_-4px_9px_#6ba0ff] disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
