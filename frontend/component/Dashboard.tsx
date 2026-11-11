"use client";
import { useCallback, useEffect, useState } from "react";
import {
  MessageSquare,
  Activity,
  CheckCircle2,
  Bot,
  Briefcase,
  Wallet,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import Sidebar from "./Sidebar";
import { api, normalizeMessage } from "../lib/api";
import {
  agentsApi,
  STATUS_META,
  type Agent,
  type Job,
  type JobStatus,
  type Stats,
} from "../lib/agentsApi";

/* ----------------------------- Types & helpers ----------------------------- */

type StatCardData = {
  label: string;
  value: string;
  foot: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  from: string;
  to: string;
  glow: string;
};

type ChatStatus = "Active" | "Waiting" | "Resolved";
type ChatRow = {
  id: string;
  title: string;
  message: string;
  agent: string;
  status: ChatStatus;
  time: string;
  color: [string, string];
};

const avatarColors: [string, string][] = [
  ["#b07bff", "#7a4df0"],
  ["#5c9bff", "#3b6df0"],
  ["#62d6a4", "#3dbb87"],
  ["#ffc25a", "#f59e0b"],
  ["#4fd8e6", "#22a8c4"],
  ["#ff8ab4", "#ec4899"],
];

const timeAgo = (iso: string | null | undefined) => {
  if (!iso) return "–";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "–";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const fmt = (n: number) => n.toLocaleString("en-IN");

/* ------------------------------- Styles -------------------------------- */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&family=Sora:wght@600;700&display=swap');

.dash, .dash * { box-sizing: border-box; }

.dash {
  min-height: 100vh;
  margin-left: 284px;
  padding: 32px 36px 48px 12px;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
  color: #14123a;
  background: #FAFAFC;
}

.dash-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 26px; flex-wrap: wrap; }
.dash-title { font-family: 'Sora', sans-serif; font-weight: 700; font-size: 28px; color: #14123a; margin: 0; letter-spacing: .01em; }
.dash-sub { margin: 6px 0 0; font-size: 14px; color: #a9a7d6; }
.dash-range {
  padding: 10px 16px; border-radius: 12px; font-size: 13px; font-weight: 600;
  color: #dcdaff; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12);
}
.dash-error { margin-bottom: 18px; padding: 12px 16px; border-radius: 12px; font-size: 13.5px; font-weight: 600; color: #d23a5c; background: #ffe1e8; }

/* ---------- Stat cards ---------- */
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-bottom: 28px; }

.stat {
  padding: 20px 22px 18px; border-radius: 22px;
  background: linear-gradient(180deg, rgba(255,255,255,.97) 0%, rgba(238,238,252,.92) 100%);
  border: 1px solid rgba(255,255,255,.6);
  box-shadow: 0 12px 40px rgba(90,70,255,.22), 0 0 0 4px rgba(255,255,255,.05);
  transition: transform .25s ease, box-shadow .25s ease;
}
.stat:hover { transform: translateY(-3px); box-shadow: 0 18px 50px rgba(90,70,255,.35), 0 0 0 4px rgba(255,255,255,.08); }
.stat-top { display: flex; align-items: center; gap: 16px; }
.stat-icon {
  width: 56px; height: 56px; flex-shrink: 0; border-radius: 16px;
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.stat-label { font-size: 14px; font-weight: 500; color: #4d4b78; }
.stat-valrow { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-top: 2px; }
.stat-value { font-family: 'Sora', sans-serif; font-weight: 700; font-size: 28px; color: #14123a; letter-spacing: -.01em; }
.stat-foot { margin-top: 14px; font-size: 13px; color: #6d6b95; }

.skel { border-radius: 8px; background: linear-gradient(90deg,#ececf8 25%,#f6f6ff 50%,#ececf8 75%); background-size: 200% 100%; animation: dash-shim 1.3s infinite; }
@keyframes dash-shim { to { background-position: -200% 0; } }

/* ---------- Panels ---------- */
.panel {
  width: 100%;
  margin-bottom: 28px; padding: 24px 26px 14px; border-radius: 24px;
  background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%);
  border: 1px solid rgba(255,255,255,.7);
  box-shadow: 0 16px 50px rgba(60,40,200,.28);
}
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.panel-title { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 18px; color: #14123a; }
.panel-desc { margin: 4px 0 0; font-size: 13px; color: #6d6b95; }
.panel-empty { padding: 28px 10px 24px; text-align: center; font-size: 14px; color: #6d6b95; }
.view-all {
  display: inline-flex; align-items: center; gap: 6px; cursor: pointer; text-decoration: none;
  padding: 9px 16px; border-radius: 11px; font-family: inherit; font-size: 13px; font-weight: 600;
  color: #4a3fd6; background: #fff; border: 1px solid #dcdcf3;
  transition: background .2s, border-color .2s;
}
.view-all:hover { background: #f0efff; border-color: #bdb6ff; }

.row {
  display: grid; align-items: center; column-gap: 16px;
  padding: 14px 10px; border-radius: 14px;
  border-top: 1px solid #ececf8;
  transition: background .2s;
}
.row:first-of-type { border-top: none; }
.row.body:hover { background: #efeefd; }
.row.th {
  padding: 8px 10px; border-top: none;
  font-size: 11.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #8886ad;
}

.chat-row { grid-template-columns: minmax(0, 2.6fr) 1.2fr 1fr .8fr; }
.job-row  { grid-template-columns: minmax(0, 2.2fr) 1.3fr 1.2fr .6fr 1.3fr; }

.who { display: flex; align-items: center; gap: 14px; min-width: 0; }
.avatar {
  width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 14px; color: #fff;
}
.who-text { min-width: 0; }
.who-name { display: flex; align-items: center; gap: 8px; font-size: 14.5px; font-weight: 700; color: #14123a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who-sub { margin-top: 2px; font-size: 13px; color: #6d6b95; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.cell { font-size: 13.5px; color: #3a3865; font-weight: 500; min-width: 0; }
.agent-pill {
  display: inline-block; max-width: 100%; padding: 5px 11px; border-radius: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12.5px; font-weight: 600; color: #4a3fd6; background: #ebe9ff;
}

.chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 700; white-space: nowrap;
}
.chip::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.chip.Active, .chip.done { color: #1f9e68; background: #dcf7ea; }
.chip.Waiting, .chip.waiting_for_agent { color: #c47a05; background: #fff0d1; }
.chip.Resolved, .chip.under_review { color: #4a3fd6; background: #e7e5ff; }
.chip.running { color: #3b6df0; background: #e3ecff; }
.chip.payment_received { color: #148a9f; background: #d9f6fa; }
.chip.bug_reported { color: #d23a5c; background: #ffe1e8; }

.mob-only { display: none; }

/* ---------- Responsive ---------- */
@media (max-width: 1199px) {
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .job-row { grid-template-columns: minmax(0, 2.2fr) 1.3fr 1.3fr; }
  .job-row .c-time, .job-row .c-files { display: none; }
}

@media (max-width: 767px) {
  .dash { margin-left: 0; padding: 88px 16px 40px; }
  .dash-title { font-size: 24px; }
  .stats { grid-template-columns: 1fr; gap: 14px; }
  .panel { padding: 18px 14px 8px; border-radius: 20px; }

  .chat-row { grid-template-columns: minmax(0, 1fr) auto; }
  .chat-row .c-agent, .chat-row .c-time { display: none; }

  .job-row { grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; }
  .job-row .c-agent { display: none; }

  .mob-only { display: block; }
  .avatar { width: 40px; height: 40px; font-size: 13px; }
}
`;

/* ----------------------------- Components ------------------------------ */

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function Avatar({ name, color }: { name: string; color: [string, string] }) {
  return (
    <div
      className="avatar"
      style={{ background: `linear-gradient(135deg, ${color[0]}, ${color[1]})` }}
    >
      {initials(name) || "?"}
    </div>
  );
}

function StatCard({ s, loading }: { s: StatCardData; loading: boolean }) {
  const Icon = s.icon;
  return (
    <div className="stat">
      <div className="stat-top">
        <div
          className="stat-icon"
          style={{
            background: `linear-gradient(135deg, ${s.from}, ${s.to})`,
            boxShadow: `0 8px 20px ${s.glow}`,
          }}
        >
          <Icon size={26} strokeWidth={2} />
        </div>
        <div>
          <div className="stat-label">{s.label}</div>
          <div className="stat-valrow">
            {loading ? (
              <span className="skel" style={{ width: 70, height: 30 }} />
            ) : (
              <span className="stat-value">{s.value}</span>
            )}
          </div>
        </div>
      </div>
      <div className="stat-foot">{s.foot}</div>
    </div>
  );
}

function RecentChats({ rows, loading }: { rows: ChatRow[]; loading: boolean }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Recent Chats</h2>
          <p className="panel-desc">Latest conversations handled by your agents</p>
        </div>
        <Link href="/" className="view-all">
          View all <ArrowRight size={15} />
        </Link>
      </div>

      {loading ? (
        <div className="panel-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="panel-empty">No chats yet.</div>
      ) : (
        <>
          <div className="row th chat-row">
            <div>Chat</div>
            <div className="c-agent">Handled by</div>
            <div>Status</div>
            <div className="c-time">Time</div>
          </div>

          {rows.map((c) => (
            <div key={c.id} className="row body chat-row">
              <div className="who">
                <Avatar name={c.title} color={c.color} />
                <div className="who-text">
                  <div className="who-name">{c.title}</div>
                  <div className="who-sub">{c.message || "No messages yet"}</div>
                  <div className="who-sub mob-only">
                    {c.agent} · {c.time}
                  </div>
                </div>
              </div>
              <div className="c-agent">
                <span className="agent-pill">{c.agent}</span>
              </div>
              <div>
                <span className={`chip ${c.status}`}>{c.status}</span>
              </div>
              <div className="cell c-time">{c.time}</div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function RecentJobs({ jobs, loading }: { jobs: Job[]; loading: boolean }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Recent Jobs</h2>
          <p className="panel-desc">Latest jobs and where they stand</p>
        </div>
        <Link href="/agents" className="view-all">
          View all <ArrowRight size={15} />
        </Link>
      </div>

      {loading ? (
        <div className="panel-empty">Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="panel-empty">No jobs yet.</div>
      ) : (
        <>
          <div className="row th job-row">
            <div>Job</div>
            <div className="c-agent">Agent</div>
            <div className="c-time">Created</div>
            <div className="c-files">Files</div>
            <div>Status</div>
          </div>

          {jobs.map((j, i) => (
            <div key={j.id} className="row body job-row">
              <div className="who">
                <Avatar
                  name={j.agent_name || j.title}
                  color={avatarColors[i % avatarColors.length]}
                />
                <div className="who-text">
                  <div className="who-name">{j.title}</div>
                  <div className="who-sub mob-only">
                    {j.agent_name ?? "Unassigned"} · {timeAgo(j.created_at)}
                  </div>
                </div>
              </div>
              <div className="c-agent">
                {j.agent_name ? (
                  <span className="agent-pill">{j.agent_name}</span>
                ) : (
                  <span className="cell">Unassigned</span>
                )}
              </div>
              <div className="cell c-time">{timeAgo(j.created_at)}</div>
              <div className="cell c-files">{j.files.length}</div>
              <div>
                <span className={`chip ${j.status}`}>{STATUS_META[j.status].label}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

/* -------------------------------- Page -------------------------------- */

export default function Dashboard() {
  const [chatCount, setChatCount] = useState(0);
  const [runningCount, setRunningCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [chatRows, setChatRows] = useState<ChatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [chatsR, tasksR, agentsR, statsR, jobsR] = await Promise.allSettled([
      api.chats(),
      api.tasks(),
      agentsApi.list(),
      agentsApi.stats(),
      agentsApi.jobs(),
    ]);

    const failed: string[] = [];

    if (tasksR.status === "fulfilled") {
      setRunningCount(tasksR.value.running.length);
      setCompletedCount(tasksR.value.completed.length);
    } else failed.push("tasks");

    if (agentsR.status === "fulfilled") setAgents(agentsR.value);
    else failed.push("agents");

    if (statsR.status === "fulfilled") setStats(statsR.value);
    else failed.push("job stats");

    if (jobsR.status === "fulfilled") {
      const sorted = [...jobsR.value].sort(
        (a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "") || 0,
      );
      setJobs(sorted.slice(0, 6));
    } else failed.push("jobs");

    if (chatsR.status === "fulfilled") {
      const all = chatsR.value;
      setChatCount(all.length);
      // newest chats are last in the list (same assumption as getHistory)
      const latest = [...all].reverse().slice(0, 6);
      const rows = await Promise.all(
        latest.map(async (c, i): Promise<ChatRow> => {
          let message = "";
          let agent = "Assistant";
          let status: ChatStatus = "Resolved";
          let time = "–";
          try {
            const msgs = (await api.messages(c.convo_id)).map((raw) => ({
              ...normalizeMessage(raw),
              created_at: raw.created_at,
            }));
            const last = msgs[msgs.length - 1];
            if (last) {
              message = last.content.replace(/\s+/g, " ").trim().slice(0, 140);
              time = timeAgo(last.created_at);
              const recent = last.created_at
                ? Date.now() - Date.parse(last.created_at) < 10 * 60 * 1000
                : false;
              status = recent ? "Active" : last.role === "user" ? "Waiting" : "Resolved";
              const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
              const tool = lastAssistant?.toolCalls[0]?.name;
              if (tool) agent = tool;
            }
          } catch {
            /* keep defaults for this chat */
          }
          return {
            id: c.convo_id,
            title: c.title?.trim() || "Untitled chat",
            message,
            agent,
            status,
            time,
            color: avatarColors[i % avatarColors.length],
          };
        }),
      );
      setChatRows(rows);
    } else failed.push("chats");

    setError(failed.length ? `Could not load: ${failed.join(", ")}` : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const autoAgents = agents.filter((a) => a.auto_negotiate).length;
  const byStatus = (s: JobStatus) => stats?.[s] ?? 0;

  const cards: StatCardData[] = [
    { label: "Total Chats", value: fmt(chatCount), foot: "All conversations", icon: MessageSquare, from: "#b07bff", to: "#7a4df0", glow: "rgba(122,77,240,.35)" },
    { label: "Running Tasks", value: fmt(runningCount), foot: "Live right now", icon: Activity, from: "#5c9bff", to: "#3b6df0", glow: "rgba(59,109,240,.35)" },
    { label: "Tasks Completed", value: fmt(completedCount), foot: "All time", icon: CheckCircle2, from: "#62d6a4", to: "#3dbb87", glow: "rgba(61,187,135,.35)" },
    { label: "Agents Connected", value: fmt(agents.length), foot: `${autoAgents} auto-negotiating`, icon: Bot, from: "#ffc25a", to: "#f59e0b", glow: "rgba(245,158,11,.35)" },
    { label: "Total Jobs", value: fmt(stats?.total ?? 0), foot: `${byStatus("waiting_for_agent")} waiting for agent`, icon: Briefcase, from: "#4fd8e6", to: "#22a8c4", glow: "rgba(34,168,196,.35)" },
    { label: "Payments Received", value: fmt(byStatus("payment_received")), foot: "Jobs marked as paid", icon: Wallet, from: "#ff8ab4", to: "#ec4899", glow: "rgba(236,72,153,.35)" },
  ];

  return (
    <>
      <style>{css}</style>
      <Sidebar />

      <main className="dash">
        <div className="dash-head">
          <div>
            <h1 className="dash-title">Dashboard</h1>
            <p className="dash-sub">Overview of your chats, tasks, agents and jobs</p>
          </div>
          <div className="dash-range">Live · refreshes every 15s</div>
        </div>

        {error && <div className="dash-error">{error}</div>}

        <div className="stats">
          {cards.map((s) => (
            <StatCard key={s.label} s={s} loading={loading} />
          ))}
        </div>

        <RecentChats rows={chatRows} loading={loading} />
        <RecentJobs jobs={jobs} loading={loading} />
      </main>
    </>
  );
}