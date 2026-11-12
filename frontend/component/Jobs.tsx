"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardCheck,
  Loader2,
  Hourglass,
  CalendarClock,
  CheckCircle2,
  XCircle,
  Send,
  Trash2,
  Save,
  RotateCcw,
  BellRing,
  Ban,
  Check,
  X,
  UserSearch,
  Handshake,
  Hammer,
  ShieldCheck,
  Wallet,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import Sidebar from "./Sidebar";
import {
  jobsApi,
  STAGES,
  type Job,
  type JobDraft,
  type Stage,
  type Activity,
  type BlockedOn,
  type FailureKind,
} from "../lib/jobApi";

import JobFiles from "./JobFiles";
import NegotiationLive from "./NegotiationLive";

/* ------------------------------ Tabs ----------------------------------- */

type Tab =
  | "ready"
  | "running"
  | "waiting"
  | "upcoming"
  | "completed"
  | "failed";
const TABS: { id: Tab; label: string; icon: typeof Loader2; live?: boolean }[] =
  [
    { id: "ready", label: "Ready", icon: ClipboardCheck },
    { id: "running", label: "Running", icon: Loader2, live: true },
    { id: "waiting", label: "Waiting", icon: Hourglass },
    { id: "upcoming", label: "Upcoming", icon: CalendarClock },
    { id: "completed", label: "Completed", icon: CheckCircle2 },
    { id: "failed", label: "Failed", icon: XCircle },
  ];

const bucketOf = (s: Job["status"]): Tab =>
  s === "draft" ? "ready" : s === "scheduled" ? "upcoming" : s;

const STAGE_ICON: Record<Stage, typeof Loader2> = {
  hire: UserSearch,
  negotiate: Handshake,
  work: Hammer,
  validate: ShieldCheck,
  payment: Wallet,
};

const ACTIVITY: Record<Activity, string> = {
  searching_freelancers: "Searching for freelancers",
  contacting: "Contacting freelancer",
  negotiating: "Negotiating price and terms",
  monitoring_work: "Tracking work progress",
  validating: "Validating submitted work",
  processing_payment: "Processing payment",
  retrying_payment: "Retrying payment",
};

const BLOCKED: Record<BlockedOn, string> = {
  freelancer_reply: "Waiting for the freelancer to reply to the offer",
  freelancer_acceptance: "Waiting for the freelancer to accept",
  work_submission: "Waiting for the freelancer to submit the work",
  revision: "Waiting for the freelancer to submit a revision",
  payment_confirmation: "Waiting for the bank to confirm the payment",
  your_approval: "Waiting for your approval",
  budget_approval: "Waiting for your approval to go above budget",
};

const FAIL: Record<FailureKind, string> = {
  no_freelancer: "No freelancer found",
  negotiation_failed: "Negotiation failed",
  deadline_missed: "Deadline missed",
  validation_failed: "Work rejected",
  payment_failed: "Payment failed",
  cancelled: "Cancelled",
  other: "Failed",
};

/* ----------------------------- Helpers --------------------------------- */

const money = (n: number | null | undefined, c: string) =>
  n == null
    ? "-"
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: c || "USD",
        maximumFractionDigits: 0,
      }).format(n);
const when = (s: number) =>
  new Date(s * 1000).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
const clock = (s: number) =>
  new Date(s * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const ago = (s?: number | null) => {
  if (!s) return "";
  const d = Math.max(0, Math.floor(Date.now() / 1000 - s));
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
};
const stageIdx = (s: Stage) => STAGES.findIndex((x: any) => x.id === s);
const toLocalInput = (iso?: string | null) =>
  iso
    ? new Date(
        new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";

/**
 * Anti-flicker. Negotiation bounces between "agent is thinking" (running) and
 * "sent offer, awaiting reply" (waiting). We keep a job in its current tab and
 * only move it between Running <-> Waiting after the new state has been stable
 * for HOLD_MS. All other moves (ready, completed, failed...) apply instantly.
 */
const HOLD_MS = 6000;
function useStableBuckets(jobs: Job[]) {
  const [shown, setShown] = useState<Record<string, Tab>>({});
  const timers = useRef<
    Record<string, { target: Tab; t: ReturnType<typeof setTimeout> }>
  >({});

  useEffect(() => {
    const ids = new Set(jobs.map((x) => x.id));
    setShown((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const job of jobs) {
        const raw = bucketOf(job.status);
        const cur = next[job.id];
        const soft = (b?: Tab) => b === "running" || b === "waiting";
        if (cur === undefined || !(soft(cur) && soft(raw))) {
          if (cur !== raw) {
            next[job.id] = raw;
            changed = true;
          }
          if (timers.current[job.id]) {
            clearTimeout(timers.current[job.id].t);
            delete timers.current[job.id];
          }
        } else if (raw === cur) {
          if (timers.current[job.id]) {
            clearTimeout(timers.current[job.id].t);
            delete timers.current[job.id];
          }
        } else if (timers.current[job.id]?.target !== raw) {
          if (timers.current[job.id]) clearTimeout(timers.current[job.id].t);
          timers.current[job.id] = {
            target: raw,
            t: setTimeout(() => {
              delete timers.current[job.id];
              setShown((p) => ({ ...p, [job.id]: raw }));
            }, HOLD_MS),
          };
        }
      }
      for (const id of Object.keys(next))
        if (!ids.has(id)) {
          delete next[id];
          changed = true;
        }
      return changed ? next : prev;
    });
  }, [jobs]);

  useEffect(
    () => () => Object.values(timers.current).forEach((x) => clearTimeout(x.t)),
    [],
  );
  return shown;
}

/* ------------------------------- Styles -------------------------------- */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&family=Sora:wght@600;700&family=JetBrains+Mono:wght@400;500&display=swap');
html, body { background: #FAFAFC; overscroll-behavior: none; }
.jb, .jb * { box-sizing: border-box; }
.jb { min-height: 100vh; margin-left: 284px; padding: 32px 36px 48px 12px; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #14123a; background: #FAFAFC; }
.jb-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.jb-title { font-family: 'Sora', sans-serif; font-weight: 700; font-size: 28px; margin: 0; }
.jb-sub { margin: 6px 0 22px; font-size: 14px; color: #6d6b95; }
.jb-err { margin-bottom: 14px; padding: 10px 14px; border-radius: 12px; font-size: 13px; color: #b3273f; background: #ffe9ee; border: 1px solid #f4c4cd; }

.jb-tabs { display: flex; gap: 4px; margin-bottom: 24px; border-bottom: 1px solid #e3e3f2; overflow-x: auto; }
.jb-tab { display: flex; align-items: center; gap: 8px; padding: 12px 16px; cursor: pointer; font-family: inherit; font-size: 14.5px; font-weight: 600; white-space: nowrap; color: #7d7ba6; background: none; border: none; border-bottom: 3px solid transparent; transition: color .2s, border-color .2s; }
.jb-tab:hover { color: #14123a; }
.jb-tab.active { color: #14123a; border-bottom-color: #5d4cf7; }
.jb-count { min-width: 22px; height: 22px; padding: 0 7px; border-radius: 11px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #5b58a0; background: #ecebf7; }
.jb-tab.active .jb-count { background: #5d4cf7; color: #fff; }
.jb-tab.attn .jb-count { background: #ffb547; color: #3d2a00; }
.jb-live { width: 8px; height: 8px; border-radius: 50%; background: #35d49a; animation: jb-pulse 1.6s infinite; }
@keyframes jb-pulse { 0% { box-shadow: 0 0 0 0 rgba(53,212,154,.7); } 70% { box-shadow: 0 0 0 8px rgba(53,212,154,0); } 100% { box-shadow: 0 0 0 0 rgba(53,212,154,0); } }
@keyframes jb-spin { to { transform: rotate(360deg); } }
@keyframes jb-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

/* rows */
.jb-rows { display: flex; flex-direction: column; gap: 12px; }
.jb-row { display: grid; grid-template-columns: 44px minmax(0, 2.4fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.4fr) auto 20px; align-items: center; gap: 18px; width: 100%; padding: 16px 20px; text-align: left; cursor: pointer; font-family: inherit; color: #14123a; background: #fff; border: 2px solid transparent; border-radius: 18px; box-shadow: 0 4px 14px rgba(60,40,200,.10); transition: border-color .2s, transform .2s, box-shadow .2s; animation: jb-fade .3s ease; }
.jb-row:hover { transform: translateY(-2px); border-color: #c9c3ff; box-shadow: 0 10px 26px rgba(60,40,200,.16); }
.jb-row:hover .jb-row-go { transform: translateX(3px); color: #5d4cf7; }
.jb-row-ico { width: 44px; height: 44px; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: #fff; background: linear-gradient(135deg, #8b7bff, #5d4cf7); }
.jb-row-ico.waiting { background: linear-gradient(135deg, #ffc25a, #f59e0b); }
.jb-row-ico.completed { background: linear-gradient(135deg, #62d6a4, #3dbb87); }
.jb-row-ico.failed { background: linear-gradient(135deg, #ff8a9f, #e5486b); }
.jb-row-ico.upcoming { background: linear-gradient(135deg, #7aa2ff, #3b6df0); }
.jb-row-main { min-width: 0; }
.jb-row-t { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jb-row-d { margin-top: 3px; font-size: 12.5px; color: #6d6b95; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jb-row-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.jb-row-l { font-size: 12px; color: #6d6b95; font-weight: 600; }
.jb-row-v { font-family: 'Sora', sans-serif; font-weight: 700; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jb-row-prog { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.jb-row-go { color: #8886ad; transition: transform .2s, color .2s; }
.jb-skel { height: 76px; border-radius: 18px; background: linear-gradient(90deg, #eceafb 25%, #f6f5ff 50%, #eceafb 75%); background-size: 200% 100%; animation: jb-shimmer 1.3s infinite; }
@keyframes jb-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

/* details */
.jb-detail { animation: jb-fade .25s ease; }
.jb-detail-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.jb-nav { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #6d6b95; }
.jb-detail-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(320px, 1fr); gap: 22px; align-items: start; }
.jb-detail-grid.single { grid-template-columns: minmax(0, 1fr); }
.jb-detail-grid .jb-panel { margin-bottom: 0; }
.jb-detail-grid .jb-term { position: sticky; top: 16px; }
.jb-detail-grid .jb-log { max-height: calc(100vh - 230px); }

@media (max-width: 1099px) {
  .jb-row { grid-template-columns: 44px minmax(0, 1fr) auto 20px; }
  .jb-row-col, .jb-row-prog { display: none; }
  .jb-detail-grid { grid-template-columns: minmax(0, 1fr); }
  .jb-detail-grid .jb-term { position: static; }
}
.jb-bar { height: 6px; border-radius: 6px; background: #e4e3f7; overflow: hidden; }
.jb-bar > i { display: block; height: 100%; border-radius: 6px; background: linear-gradient(90deg, #8b7bff, #5d4cf7); transition: width .6s ease; }

.jb-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
.jb-chip::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.jb-chip.running { color: #1f9e68; background: #dcf7ea; }
.jb-chip.waiting { color: #c47a05; background: #fff0d1; }
.jb-chip.ready { color: #4a3fd6; background: #e7e5ff; }
.jb-chip.upcoming { color: #2f5fd0; background: #e1ebff; }
.jb-chip.completed { color: #1f9e68; background: #dcf7ea; }
.jb-chip.failed { color: #d23a5c; background: #ffe1e8; }

.jb-panel { min-width: 0; padding: 22px 24px; border-radius: 24px; background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%); border: 1px solid rgba(255,255,255,.7); box-shadow: 0 16px 50px rgba(60,40,200,.22); margin-bottom: 22px; }
.jb-term { min-width: 0; padding: 20px 22px; border-radius: 24px; color: #d7d5ff; background: linear-gradient(180deg, #14113f 0%, #0c0a2b 100%); border: 1px solid rgba(255,255,255,.12); box-shadow: 0 16px 50px rgba(30,20,140,.45); }
.jb-term .jb-h { color: #fff; }
.jb-ph { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.jb-h { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 17px; }
.jb-pd { margin: 4px 0 0; font-size: 13px; color: #6d6b95; }
.jb-term .jb-pd { color: #9b99cf; }
.jb-h3 { margin: 20px 0 10px; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 14.5px; }
.jb-desc { margin: 0; font-size: 14px; line-height: 1.7; color: #3a3865; white-space: pre-wrap; }

.jb-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0 6px; }
.jb-stat { padding: 12px 14px; border-radius: 14px; background: #fff; border: 1px solid #ececf8; }
.jb-stat-l { font-size: 12px; color: #6d6b95; font-weight: 600; }
.jb-stat-v { margin-top: 3px; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 18px; }
.jb-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.jb-tag { padding: 5px 11px; border-radius: 9px; font-size: 12.5px; font-weight: 600; color: #4a3fd6; background: #ebe9ff; }
.jb-ul { margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.7; color: #3a3865; }

/* stage track */
.jb-track { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); margin: 6px 0 4px; }
.jb-st { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.jb-st::after { content: ''; position: absolute; top: 19px; left: 50%; width: 100%; height: 4px; border-radius: 4px; background: #e4e3f7; z-index: 0; }
.jb-st.done::after { background: #3dbb87; }
.jb-st:last-child::after { display: none; }
.jb-node { position: relative; z-index: 1; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #8886ad; background: #fff; border: 2px solid #d6d4ef; transition: all .3s; }
.jb-st.done .jb-node { color: #fff; border-color: transparent; background: linear-gradient(135deg, #62d6a4, #3dbb87); }
.jb-st.cur.running .jb-node { color: #fff; border-color: transparent; background: linear-gradient(135deg, #8b7bff, #5d4cf7); box-shadow: 0 0 0 6px rgba(108,92,255,.18); }
.jb-st.cur.waiting .jb-node { color: #fff; border-color: transparent; background: linear-gradient(135deg, #ffc25a, #f59e0b); box-shadow: 0 0 0 6px rgba(245,158,11,.18); }
.jb-st.cur.failed .jb-node { color: #fff; border-color: transparent; background: linear-gradient(135deg, #ff8a9f, #e5486b); }
.jb-st-l { font-size: 12px; font-weight: 600; color: #5a5885; }
.jb-st.cur .jb-st-l { color: #14123a; }
.jb-spin { animation: jb-spin 1.1s linear infinite; }

.jb-now { display: flex; align-items: center; gap: 12px; margin-top: 18px; padding: 12px 16px; border-radius: 14px; font-size: 13.5px; font-weight: 600; }
.jb-now.running { color: #14503a; background: #e2f8ee; }
.jb-now.waiting { color: #6b4300; background: #fff3da; }
.jb-now.failed { color: #8f1f38; background: #ffe9ee; }
.jb-now small { display: block; font-weight: 500; opacity: .8; margin-top: 2px; }

.jb-btns { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
.jb-btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 16px; border-radius: 12px; cursor: pointer; font-family: inherit; font-size: 13.5px; font-weight: 700; color: #4a3fd6; background: #fff; border: 1px solid #d9d6fb; transition: background .2s, opacity .2s; }
.jb-btn:hover:not(:disabled) { background: #f0efff; }
.jb-btn:disabled { opacity: .5; cursor: not-allowed; }
.jb-btn.primary { color: #fff; border-color: transparent; background: linear-gradient(135deg, #8b7bff, #5d4cf7); box-shadow: 0 6px 16px rgba(93,76,247,.35); }
.jb-btn.primary:hover:not(:disabled) { background: linear-gradient(135deg, #7d6cff, #5040e8); }
.jb-btn.danger { color: #c4344f; border-color: #f4c4cd; }
.jb-btn.danger:hover:not(:disabled) { background: #fff0f3; }

/* form */
.jb-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.jb-f { display: flex; flex-direction: column; gap: 6px; }
.jb-f.full { grid-column: 1 / -1; }
.jb-f label { font-size: 12px; font-weight: 700; color: #5a5885; letter-spacing: .02em; }
.jb-f input, .jb-f textarea, .jb-f select { width: 100%; padding: 10px 12px; font-family: inherit; font-size: 14px; color: #14123a; background: #fff; border: 1.5px solid #dcdcf3; border-radius: 12px; outline: none; transition: border-color .2s; }
.jb-f textarea { resize: vertical; min-height: 96px; line-height: 1.55; }
.jb-f input:focus, .jb-f textarea:focus, .jb-f select:focus { border-color: #8b7bff; }
.jb-f small { font-size: 11.5px; color: #8886ad; }
.jb-dirty { font-size: 12.5px; font-weight: 600; color: #c47a05; }

/* logs */
.jb-log { max-height: 380px; overflow-y: auto; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12.5px; line-height: 1.55; padding-right: 6px; }
.jb-line { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 10px; align-items: start; padding: 7px 0; border-bottom: 1px dashed rgba(255,255,255,.07); }
.jb-time { color: #8886c0; }
.jb-lv { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 6px; font-size: 10.5px; letter-spacing: .04em; }
.jb-lv.info { color: #9fb0ff; background: rgba(159,176,255,.14); }
.jb-lv.success { color: #62d6a4; background: rgba(98,214,164,.14); }
.jb-lv.warn { color: #ffc25a; background: rgba(255,194,90,.14); }
.jb-lv.error { color: #ff8a9f; background: rgba(255,138,159,.14); }
.jb-lt { color: #d7d5ff; word-break: break-word; }
.jb-empty { padding: 36px 16px; text-align: center; font-size: 14px; color: #6d6b95; border-radius: 18px; background: #fff; border: 1px dashed #d6d4ef; }

.jb-toast { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 200; display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 14px; font-size: 13.5px; font-weight: 600; color: #14123a; background: #fff; border: 1px solid #e6e6f7; box-shadow: 0 18px 50px rgba(30,20,140,.35); animation: jb-fade .3s ease; }


@media (max-width: 767px) { .jb { margin-left: 0; padding: 88px 16px 40px; } .jb-title { font-size: 24px; } .jb-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .jb-form { grid-template-columns: 1fr; } .jb-panel, .jb-term { padding: 18px 16px; } .jb-st-l { font-size: 10.5px; } }

`;

/* --------------------------- Small components -------------------------- */

function StageTrack({ job, bucket }: { job: Job; bucket: Tab }) {
  const cur = stageIdx(job.stage);
  const allDone = job.status === "completed";
  const mode =
    bucket === "failed"
      ? "failed"
      : bucket === "waiting"
        ? "waiting"
        : "running";
  return (
    <div className="jb-track">
      {STAGES.map((s, i) => {
        const Icon = STAGE_ICON[s.id];
        const done = allDone || i < cur;
        const isCur =
          !allDone &&
          i === cur &&
          job.status !== "draft" &&
          job.status !== "scheduled";
        return (
          <div
            key={s.id}
            className={`jb-st ${done ? "done" : ""} ${isCur ? `cur ${mode}` : ""}`}
          >
            <div className="jb-node">
              {done ? (
                <Check size={18} strokeWidth={3} />
              ) : isCur && mode === "failed" ? (
                <X size={18} strokeWidth={3} />
              ) : isCur && mode === "running" ? (
                <Loader2 size={18} className="jb-spin" />
              ) : (
                <Icon size={18} />
              )}
            </div>
            <div className="jb-st-l">{s.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function NowBanner({ job, bucket }: { job: Job; bucket: Tab }) {
  if (bucket === "running")
    return (
      <div className="jb-now running">
        <Loader2 size={18} className="jb-spin" />
        <div>
          {job.activity ? ACTIVITY[job.activity] : "Working"}
          {job.freelancer ? <small>with {job.freelancer.name}</small> : null}
        </div>
      </div>
    );
  if (bucket === "waiting")
    return (
      <div className="jb-now waiting">
        <Hourglass size={18} />
        <div>
          {job.blockedOn ? BLOCKED[job.blockedOn] : "Waiting"}
          <small>
            Waiting for {ago(job.waitingSince) || "a moment"}. The agent resumes
            automatically when it arrives.
          </small>
        </div>
      </div>
    );
  if (bucket === "failed" && job.failure)
    return (
      <div className="jb-now failed">
        <XCircle size={18} />
        <div>
          {FAIL[job.failure.kind]} at{" "}
          {STAGES[stageIdx(job.failure.stage)].label}
          <small>{job.failure.reason}</small>
        </div>
      </div>
    );
  return null;
}

function Facts({ job }: { job: Job }) {
  return (
    <>
      <div className="jb-stats">
        <div className="jb-stat">
          <div className="jb-stat-l">Budget</div>
          <div className="jb-stat-v">{money(job.budget, job.currency)}</div>
        </div>
        <div className="jb-stat">
          <div className="jb-stat-l">Agreed price</div>
          <div className="jb-stat-v">
            {money(job.agreedPrice, job.currency)}
          </div>
        </div>
        <div className="jb-stat">
          <div className="jb-stat-l">Freelancer</div>
          <div className="jb-stat-v" style={{ fontSize: 15 }}>
            {job.freelancer?.name ?? "Not hired yet"}
          </div>
        </div>
        <div className="jb-stat">
          <div className="jb-stat-l">Deadline</div>
          <div className="jb-stat-v" style={{ fontSize: 15 }}>
            {job.deadline
              ? new Date(job.deadline).toLocaleDateString()
              : "None"}
          </div>
        </div>
      </div>
      <h3 className="jb-h3">Description</h3>
      <p className="jb-desc">{job.description}</p>
      {job.skills.length > 0 && (
        <>
          <h3 className="jb-h3">Skills</h3>
          <div className="jb-tags">
            {job.skills.map((s) => (
              <span className="jb-tag" key={s}>
                {s}
              </span>
            ))}
          </div>
        </>
      )}
      {job.criteria.length > 0 && (
        <>
          <h3 className="jb-h3">Acceptance criteria</h3>
          <ul className="jb-ul">
            {job.criteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** Ready tab: edit everything, then confirm to send. */
function ReadyEditor({
  job,
  busy,
  onSave,
  onSend,
  onDiscard,
}: {
  job: Job;
  busy: boolean;
  onSave: (d: Partial<JobDraft>) => Promise<void>;
  onSend: (d: Partial<JobDraft>) => Promise<void>;
  onDiscard: () => void;
}) {
  const initial = useMemo(
    () => ({
      title: job.title,
      description: job.description,
      skills: job.skills.join(", "),
      criteria: job.criteria.join("\n"),
      budget: String(job.budget),
      maxBudget: job.maxBudget != null ? String(job.maxBudget) : "",
      currency: job.currency || "USD",
      deadline: toLocalInput(job.deadline),
      scheduledFor: toLocalInput(job.scheduledFor),
    }),
    [job.id, job.updatedAt],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(initial);
  useEffect(() => setF(initial), [initial]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  const errors: string[] = [];
  if (!f.title.trim()) errors.push("Add a title");
  if (f.description.trim().length < 20)
    errors.push("Describe the work in a bit more detail");
  if (!(Number(f.budget) > 0)) errors.push("Budget must be above 0");
  if (f.maxBudget && Number(f.maxBudget) < Number(f.budget))
    errors.push("Max budget cannot be below budget");

  const draft = (): Partial<JobDraft> => ({
    title: f.title.trim(),
    description: f.description.trim(),
    skills: f.skills
      .split(",")
      .map((s: any) => s.trim())
      .filter(Boolean),
    criteria: f.criteria
      .split("\n")
      .map((s: any) => s.trim())
      .filter(Boolean),
    budget: Number(f.budget),
    maxBudget: f.maxBudget ? Number(f.maxBudget) : undefined,
    currency: f.currency,
    deadline: f.deadline ? new Date(f.deadline).toISOString() : null,
    scheduledFor: f.scheduledFor
      ? new Date(f.scheduledFor).toISOString()
      : null,
  });

  return (
    <>
      <div className="jb-form">
        <div className="jb-f full">
          <label>Job title</label>
          <input value={f.title} onChange={set("title")} />
        </div>
        <div className="jb-f full">
          <label>Full description</label>
          <textarea
            rows={6}
            value={f.description}
            onChange={set("description")}
          />
        </div>
        <div className="jb-f">
          <label>Budget</label>
          <input
            type="number"
            min={0}
            value={f.budget}
            onChange={set("budget")}
          />
        </div>
        <div className="jb-f">
          <label>Currency</label>
          <select value={f.currency} onChange={set("currency")}>
            {["USD", "INR", "EUR", "GBP"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="jb-f">
          <label>Max budget for negotiation</label>
          <input
            type="number"
            min={0}
            value={f.maxBudget}
            onChange={set("maxBudget")}
            placeholder="Same as budget"
          />
          <small>The agent will never agree above this.</small>
        </div>
        <div className="jb-f">
          <label>Deadline</label>
          <input
            type="datetime-local"
            value={f.deadline}
            onChange={set("deadline")}
          />
        </div>
        <div className="jb-f full">
          <label>Skills (comma separated)</label>
          <input value={f.skills} onChange={set("skills")} />
        </div>
        <div className="jb-f full">
          <label>Acceptance criteria (one per line)</label>
          <textarea rows={4} value={f.criteria} onChange={set("criteria")} />
          <small>
            The validator checks the submitted work against these before paying.
          </small>
        </div>
        <div className="jb-f full">
          <label>Start later (optional)</label>
          <input
            type="datetime-local"
            value={f.scheduledFor}
            onChange={set("scheduledFor")}
          />
          <small>
            Leave empty to start right after you send. Set a time to move it to
            Upcoming.
          </small>
        </div>
      </div>
      {errors.length > 0 && (
        <p className="jb-dirty" style={{ marginTop: 12 }}>
          {errors.join(" · ")}
        </p>
      )}
      <div className="jb-btns">
        <button
          className="jb-btn primary"
          disabled={busy || errors.length > 0}
          onClick={() => onSend(draft())}
        >
          <Send size={15} />
          {f.scheduledFor ? "Confirm & schedule" : "Confirm & send"}
        </button>
        <button
          className="jb-btn"
          disabled={busy || !dirty}
          onClick={() => onSave(draft())}
        >
          <Save size={15} />
          Save changes
        </button>
        <button className="jb-btn danger" disabled={busy} onClick={onDiscard}>
          <Trash2 size={15} />
          Discard
        </button>
        {dirty && (
          <span className="jb-dirty" style={{ alignSelf: "center" }}>
            Unsaved changes
          </span>
        )}
      </div>
    </>
  );
}

/* -------------------------------- Page --------------------------------- */

export default function Jobs() {
  const q =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const wantedJob = q?.get("job") ?? undefined;
  const wantedTab = (q?.get("tab") as Tab | null) ?? null;

  const [jobs, setJobs] = useState<Job[]>([]);
  const [selId, setSelId] = useState<string | undefined>(wantedJob);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const pickedTab = useRef(false);
  const editing = useRef(false); // do not clobber the form mid-edit
  const [open, setOpen] = useState(!!wantedJob); // false = job rows, true = full details
  const [loaded, setLoaded] = useState(false);

  const tabChosen = useRef(!!wantedTab || !!wantedJob);
  const firstLoad = useRef(true);
  const prevStatus = useRef<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>(wantedTab ?? "ready");
  const chooseTab = (t: Tab) => {
    tabChosen.current = true;
    setTab(t);
    try {
      localStorage.setItem("jobs.tab", t);
    } catch {
      /* ignore */
    }
  };

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(
    () =>
      jobsApi
        .list()
        .then((d: Job[]) => {
          d.forEach((j) => {
            const p = prevStatus.current[j.id];
            if (p && p !== j.status && j.status === "failed")
              flash(
                `"${j.title}" failed: ${j.failure?.reason ?? "see the Failed tab"}`,
              );
            if (p && p !== j.status && j.status === "completed")
              flash(`"${j.title}" completed`);
          });
          prevStatus.current = Object.fromEntries(
            d.map((j) => [j.id, j.status]),
          );
          setJobs(d);
          setErr(null);
        })
        .catch((e: Error) => setErr(e.message))
        .finally(() => setLoaded(true)),
    [],
  );

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  // On first load (no ?tab=), reopen the last tab, or the most useful non-empty one, instead of an empty "Ready"
  useEffect(() => {
    if (!firstLoad.current || !jobs.length || tabChosen.current) return;
    firstLoad.current = false;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("jobs.tab");
    } catch {
      /* ignore */
    }
    const count = (t: Tab) =>
      jobs.filter((j) => bucketOf(j.status) === t).length;
    const order: Tab[] = [
      "running",
      "waiting",
      "ready",
      "upcoming",
      "failed",
      "completed",
    ];
    const pick =
      saved && count(saved as Tab) > 0
        ? (saved as Tab)
        : order.find((t) => count(t) > 0);
    if (pick) setTab(pick);
  }, [jobs]);

  const shown = useStableBuckets(jobs);
  const bucket = (j: Job): Tab => shown[j.id] ?? bucketOf(j.status);

  // open the right tab once when arriving via ?job=<id>
  useEffect(() => {
    if (pickedTab.current || !wantedJob || !jobs.length) return;
    const j = jobs.find((x) => x.id === wantedJob);
    if (j) {
      pickedTab.current = true;
      setTab(bucket(j));
    }
  }, [jobs, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const byTab = useMemo(() => {
    const m: Record<Tab, Job[]> = {
      ready: [],
      running: [],
      waiting: [],
      upcoming: [],
      completed: [],
      failed: [],
    };
    jobs.forEach((j) => m[bucket(j)].push(j));
    (Object.keys(m) as Tab[]).forEach((k) =>
      m[k].sort((a, b) => b.updatedAt - a.updatedAt),
    );
    return m;
  }, [jobs, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = byTab[tab];
  const selIdx = list.findIndex((j) => j.id === selId);
  const sel = selIdx >= 0 ? list[selIdx] : undefined;
  const detail = open && !!sel;
  useEffect(() => setConfirmCancel(false), [sel?.id, tab]);
  useEffect(() => {
  if (!open || !selId) return;
  const j = jobs.find((x) => x.id === selId);
  if (j && bucket(j) !== tab) setTab(bucket(j));
}, [jobs, shown, open, selId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      await load();
      if (ok) flash(ok);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const empty: Record<Tab, string> = {
    ready:
      "No drafts waiting. Ask your agent in chat to hire a freelancer and the job will appear here for your review.",
    running: "Nothing is running right now.",
    waiting: "No jobs are waiting on anyone.",
    upcoming: "No scheduled jobs.",
    completed: "No completed jobs yet.",
    failed: "No failed jobs. Nice.",
  };

  return (
    <>
      <style>{css}</style>
      <Sidebar defaultActive="jobs" />
      <main className="jb">
        <div className="jb-top">
          <div>
            <h1 className="jb-title">Jobs</h1>
            <p className="jb-sub">
              Review jobs, then watch your agent hire, negotiate, validate and
              pay
            </p>
          </div>
        </div>

        {err && <div className="jb-err">{err}</div>}

        <div className="jb-tabs">
          {TABS.map((t) => {
            const n = byTab[t.id].length;
            return (
              <button
                key={t.id}
                className={`jb-tab ${tab === t.id ? "active" : ""} ${t.id === "ready" && n > 0 && tab !== "ready" ? "attn" : ""} ${t.id === "waiting" && tab !== "waiting" && byTab.waiting.some((j) => j.pendingApproval) ? "attn" : ""}`}
                onClick={() => { setTab(t.id); setOpen(false); }}
              >
                {t.live && n > 0 && <span className="jb-live" />}
                {t.label}
                <span className="jb-count">{n}</span>
              </button>
            );
          })}
        </div>

        {!loaded ? (
          <div className="jb-rows">
            {Array.from({ length: 4 }).map((_, i) => (
              <div className="jb-skel" key={i} />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="jb-empty">{empty[tab]}</div>
        ) : !detail ? (
          /* ---------------- Job rows ---------------- */
          <div className="jb-rows">
            {list.map((j) => {
              const StageIcon = STAGE_ICON[j.stage];
              return (
                <button
                  key={j.id}
                  className="jb-row"
                  onClick={() => {
                    setSelId(j.id);
                    setOpen(true);
                  }}
                >
                  <span className={`jb-row-ico ${tab}`}>
                    <StageIcon size={20} />
                  </span>
                  <div className="jb-row-main">
                    <div className="jb-row-t">{j.title}</div>
                    <div className="jb-row-d">{j.description}</div>
                  </div>
                  <div className="jb-row-col">
                    <span className="jb-row-l">
                      {j.agreedPrice != null ? "Agreed price" : "Budget"}
                    </span>
                    <span className="jb-row-v">
                      {money(j.agreedPrice ?? j.budget, j.currency)}
                    </span>
                  </div>
                  <div className="jb-row-col">
                    <span className="jb-row-l">Stage</span>
                    <span className="jb-row-v">
                      {STAGES[stageIdx(j.stage)].label}
                    </span>
                  </div>
                  <div className="jb-row-prog">
                    {(tab === "running" || tab === "waiting") && (
                      <>
                        <div className="jb-bar">
                          <i style={{ width: `${j.progress}%` }} />
                        </div>
                        <span className="jb-row-l">
                          {j.progress}% · updated {ago(j.updatedAt)} ago
                        </span>
                      </>
                    )}
                    {tab === "upcoming" && j.scheduledFor && (
                      <span
                        style={{
                          fontSize: 12.5,
                          color: "#2f5fd0",
                          fontWeight: 600,
                        }}
                      >
                        Starts{" "}
                        {new Date(j.scheduledFor).toLocaleString([], {
                          day: "numeric",
                          month: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                    {tab === "failed" && j.failure && (
                      <span
                        style={{
                          fontSize: 12.5,
                          color: "#d23a5c",
                          fontWeight: 600,
                        }}
                      >
                        {FAIL[j.failure.kind]}
                      </span>
                    )}
                    {tab === "ready" && (
                      <span className="jb-row-l">Needs your review</span>
                    )}
                    {tab === "completed" && (
                      <span className="jb-row-l">
                        Finished {ago(j.updatedAt)} ago
                      </span>
                    )}
                  </div>
                  <span className={`jb-chip ${tab}`}>
                    {TABS.find((x) => x.id === tab)!.label}
                  </span>
                  <ChevronRight size={18} className="jb-row-go" />
                </button>
              );
            })}
          </div>
        ) : (
          /* ---------------- Full details ---------------- */
          <div className="jb-detail">
            <div className="jb-detail-bar">
              <button className="jb-btn" onClick={() => setOpen(false)}>
                <ArrowLeft size={15} />
                All {TABS.find((x) => x.id === tab)!.label.toLowerCase()} jobs
              </button>
              <div className="jb-nav">
                <span>
                  {selIdx + 1} of {list.length}
                </span>
                <button
                  className="jb-btn"
                  disabled={selIdx <= 0}
                  onClick={() => setSelId(list[selIdx - 1].id)}
                  aria-label="Previous job"
                >
                  <ArrowLeft size={15} />
                </button>
                <button
                  className="jb-btn"
                  disabled={selIdx >= list.length - 1}
                  onClick={() => setSelId(list[selIdx + 1].id)}
                  aria-label="Next job"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>

            <div
              className={`jb-detail-grid ${tab === "ready" ? "single" : ""}`}
            >
              <section className="jb-panel" key={sel!.id}>
                <div className="jb-ph">
                  <div>
                    <h2 className="jb-h">{sel!.title}</h2>
                    <p className="jb-pd">
                      {tab === "ready"
                        ? "Check the details below. Nothing is sent until you confirm."
                        : `Created ${when(sel!.createdAt)} · updated ${ago(sel!.updatedAt)} ago`}
                    </p>
                  </div>
                  <span className={`jb-chip ${tab}`}>
                    {TABS.find((x) => x.id === tab)!.label}
                  </span>
                </div>

                {tab === "ready" ? (
                  <>
                    <ReadyEditor
                      job={sel!}
                      busy={busy}
                      onSave={(d) =>
                        act(() => jobsApi.update(sel!.id, d), "Changes saved")
                      }
                      onSend={(d) =>
                        act(async () => {
                          await jobsApi.update(sel!.id, d);
                          await jobsApi.confirm(sel!.id);
                        }, "Job sent. Your agent is on it")
                      }
                      onDiscard={() =>
                        act(() => jobsApi.discard(sel!.id), "Draft discarded")
                      }
                    />
                    <div style={{ marginTop: 22 }}>
                      <JobFiles
                        jobId={sel!.id}
                        files={sel!.files ?? []}
                        editable
                        onChange={load}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    {tab !== "upcoming" && (
                      <StageTrack job={sel!} bucket={tab} />
                    )}
                    <NowBanner job={sel!} bucket={tab} />
                    {sel!.status === "waiting" && sel!.pendingApproval && (
  <div className="jb-now waiting" style={{ flexDirection: "column", alignItems: "flex-start" }}>
    <div>
      {sel!.pendingApproval.freelancer} wants {money(sel!.pendingApproval.price, sel!.currency)}, above your
      max of {money(sel!.pendingApproval.max, sel!.currency)}. Allow it?
    </div>
    <div className="jb-btns" style={{ marginTop: 0 }}>
      <button className="jb-btn primary" disabled={busy}
        onClick={() => act(() => jobsApi.approveBudget(sel!.id), "Approved. Deal agreed")}>
        <Check size={15} />Approve {money(sel!.pendingApproval.price, sel!.currency)}
      </button>
      <button className="jb-btn danger" disabled={busy}
        onClick={() => act(() => jobsApi.declineBudget(sel!.id), "Declined. Trying the next freelancer")}>
        <X size={15} />Decline
      </button>
    </div>
  </div>
)}
                    
                    <NegotiationLive key={`n${sel!.id}`} job={sel!} />
                    <Facts job={sel!} />
                    <JobFiles
                      jobId={sel!.id}
                      files={sel!.files ?? []}
                      editable={false}
                      onChange={load}
                    />

                    <div className="jb-btns">
                      {tab === "waiting" && (
                        <button
                          className="jb-btn"
                          disabled={busy}
                          onClick={() =>
                            act(() => jobsApi.nudge(sel!.id), "Reminder sent")
                          }
                        >
                          <BellRing size={15} />
                          Send reminder
                        </button>
                      )}
                      {tab === "failed" && sel!.failure?.retryable && (
                        <button
                          className="jb-btn primary"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () => jobsApi.retry(sel!.id),
                              sel!.failure!.kind === "payment_failed"
                                ? "Retrying payment"
                                : "Retrying job",
                            )
                          }
                        >
                          <RotateCcw size={15} />
                          {sel!.failure!.kind === "payment_failed"
                            ? "Retry payment"
                            : `Retry from ${STAGES[stageIdx(sel!.failure!.stage)].label}`}
                        </button>
                      )}
                      {(tab === "running" ||
                        tab === "waiting" ||
                        tab === "upcoming") &&
                        (confirmCancel ? (
                          <>
                            <button
                              className="jb-btn danger"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  () => jobsApi.cancel(sel!.id),
                                  "Job cancelled",
                                )
                              }
                            >
                              <Ban size={15} />
                              Yes, cancel job
                            </button>
                            <button
                              className="jb-btn"
                              onClick={() => setConfirmCancel(false)}
                            >
                              Keep it
                            </button>
                          </>
                        ) : (
                          <button
                            className="jb-btn danger"
                            onClick={() => setConfirmCancel(true)}
                          >
                            <Ban size={15} />
                            Cancel job
                          </button>
                        ))}
                    </div>
                  </>
                )}
              </section>

              {tab !== "ready" && (
                <section className="jb-term">
                  <div className="jb-ph">
                    <div>
                      <h2 className="jb-h">Activity log</h2>
                      <p className="jb-pd">
                        Every step the agent took on this job
                      </p>
                    </div>
                  </div>
                  <div className="jb-log">
                    {sel!.events.length === 0 && (
                      <div style={{ color: "#9b99cf" }}>
                        Nothing logged yet.
                      </div>
                    )}
                    {sel!.events.map((e, i) => (
                      <div className="jb-line" key={i}>
                        <span className="jb-time">{clock(e.ts)}</span>
                        <span className={`jb-lv ${e.level}`}>
                          {STAGES[stageIdx(e.stage)].label.toUpperCase()}
                        </span>
                        <span className="jb-lt">{e.text}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </main>
      {toast && (
        <div className="jb-toast">
          <CheckCircle2 size={18} color="#3dbb87" />
          {toast}
        </div>
      )}
    </>
  );
}
