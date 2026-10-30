import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChatMessage, ToolCall, getHistory, streamChat,StreamEvent,normalizeMessage, } from "../lib/api";
import { Timeline, Step, applyEvent,applyLog } from "../component/Timeline";




const statusStyle: Record<string, string> = {
  completed: "bg-emerald-400/10 text-emerald-300",
  running: "bg-indigo-400/10 text-indigo-300",
  revoked: "bg-amber-400/10 text-amber-300",
  failed: "bg-rose-400/10 text-rose-300",
};

function ToolBox({ call, align }: { call: ToolCall; align: "left" | "right" }) {
  const [open, setOpen] = useState(true);
  return (
    <div
      className={`flex ${align === "right" ? "justify-end" : "justify-start"}`}
    >
      <div className="w-full max-w-xl rounded-2xl border border-[#2a2c4a] bg-[#14152b] p-4">
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="font-semibold text-white">{call.name}</span>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle[call.status] ?? statusStyle.completed}`}
          >
            {call.status}
          </span>
        </button>
        {open && (
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <p className="mb-1 text-slate-400">Input</p>
              <pre className="overflow-x-auto rounded-lg bg-[#0d0e1c] p-3 text-slate-300">
                {JSON.stringify(call.args, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-slate-400">Response from backend</p>
              <pre className="max-h-64 overflow-auto rounded-lg bg-[#0d0e1c] p-3 text-emerald-200">
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
  const endRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<Extract<StreamEvent, { type: "step" }>[]>(
    [],
  );
  const [steps, setSteps] = useState<Step[]>([]);

  useEffect(() => {
    getHistory()
      .then(setMessages)
      .catch(() => {});
  }, []);
  useEffect(
    () => endRef.current?.scrollIntoView({ behavior: "smooth" }),
    [messages, busy],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", content: text, toolCalls: [] },
    ]);
    setBusy(true);
    try {
      let local: Step[] = [];
setSteps([]);
await streamChat(text, (e: any) => {
  if (e.type === "step") { local = applyEvent(local, e); setSteps(local); }
  if (e.type === "log")  { local = applyLog(local, e);   setSteps(local); }
  if (e.type === "final") {
    const msg = normalizeMessage({ role: "assistant", ...e.data });
    sessionStorage.setItem(`steps:${msg.id}`, JSON.stringify(local));  // so /progress/:id can show it
    setMessages((m) => [...m, msg]);
  }
  if (e.type === "error") setError(e.message);
});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-[#0f1020] text-slate-200">
      <div className="h-1.5 bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300" />
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
        <h1 className="text-lg font-semibold text-white">Chat</h1>
        <Link
          href="/progress"
          className="rounded-full border border-[#2a2c4a] px-4 py-1.5 text-sm hover:bg-[#191a35]"
        >
          Task progress
        </Link>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 overflow-y-auto px-6 pb-4">
        {messages.length === 0 && !busy && (
          <p className="pt-20 text-center text-slate-400">
            Type a message below to start.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="space-y-3">
            {/* Your messages: left. AI messages: right. */}
            {m.content && (
              <div
                className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-xl whitespace-pre-wrap rounded-2xl border px-4 py-3 overflow-x-auto ${
                    m.role === "user"
                      ? "border-[#2a2c4a] bg-[#191a35]"
                      : "border-emerald-400/30 bg-emerald-400/10 text-emerald-50"
                  }`}
                >
                  {m.content}
                  {m.role === "assistant" && m.toolCalls.length > 0 && (
                    <Link
                      href={`/progress/${m.id}`}
                      className="mt-2 block text-sm text-emerald-300 underline"
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
        {busy && <div className="flex justify-end"><div className="w-full max-w-xl"><Timeline steps={steps} /></div></div>}
        {error && <p className="text-center text-sm text-rose-300">{error}</p>}
        <div ref={endRef} />
      </main>

      <form
        onSubmit={submit}
        className="mx-auto flex w-full max-w-4xl gap-3 px-6 pb-6"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything"
          className="flex-1 rounded-full border border-[#2a2c4a] bg-[#191a35] px-5 py-3 text-white outline-none placeholder:text-slate-500 focus:border-emerald-300"
        />
        <button
          disabled={busy || !input.trim()}
          className="rounded-full bg-emerald-300 px-6 py-3 font-semibold text-[#0f1020] disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
