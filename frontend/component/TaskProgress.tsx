"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getHistory } from "../lib/api"; // adjust the path to where api.ts is
import { Timeline, Step, stepsFromToolCalls } from "./Timeline";

export default function TaskProgress() {
  const { chatId } = useParams<{ chatId?: string }>();
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 1. Steps saved by Home when the run finished (has real names, durations, logs)
    const load = (id?: string) => {
      const saved = id ? sessionStorage.getItem(`steps:${id}`) : null;
      return saved ? (JSON.parse(saved) as Step[]) : null;
    };

    const fromUrl = load(chatId);
    if (fromUrl) {
      setSteps(fromUrl);
      setLoading(false);
      return;
    }

    // 2. Fallback: whatever the database stored for that turn
    getHistory(100)
      .then((all) => {
        const withTools = all.filter((m) => m.role === "assistant" && m.toolCalls.length > 0);
        const turn = chatId ? all.find((m) => m.id === chatId) : withTools.at(-1);
        setSteps(load(turn?.id) ?? stepsFromToolCalls(turn?.toolCalls ?? []));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [chatId]);

  return (
    <div className="min-h-screen bg-[#0f1020] text-slate-200">
      <div className="h-1.5 bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-300" />
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Link href="/" className="text-sm text-slate-400 hover:text-white">Back to chat</Link>
        <h1 className="mb-6 mt-2 text-2xl font-semibold text-white">Task progress</h1>

        {loading && <p className="text-slate-400">Loading…</p>}
        {error && <p className="text-rose-300">{error}</p>}
        {!loading && !error && steps.length === 0 && (
          <p className="text-slate-400">No tool activity yet. Send a request from the chat and it will show up here.</p>
        )}
        {steps.length > 0 && <Timeline steps={steps} />}
      </div>
    </div>
  );
}