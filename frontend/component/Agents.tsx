"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
  Paperclip,
  ChevronDown,
  ChevronUp,
  Bot,
  ArrowRight,
  Sparkles,
  Wallet,
  Repeat,
  Gauge,
  ListChecks,
} from "lucide-react";
import Sidebar from "./Sidebar";
import AgentDeskModal from "./AgentDeskModal";
import type { DeskAction } from "../lib/agentsApi";
import {
  Agent,
  Job,
  JobStatus,
  Stats,
  STATUS_META,
  STATUS_ORDER,
  agentsApi,
} from "../lib/agentsApi";

/* --------------------------- Palette (from dashboard) --------------------------- */

const statusColor: Record<JobStatus, { from: string; to: string }> = {
  running: { from: "#5c9bff", to: "#3b6df0" },
  done: { from: "#62d6a4", to: "#3dbb87" },
  waiting_for_agent: { from: "#ffc25a", to: "#f59e0b" },
  under_review: { from: "#b07bff", to: "#7a4df0" },
  payment_received: { from: "#4fd8e6", to: "#22a8c4" },
  bug_reported: { from: "#ff8ab4", to: "#ec4899" },
};

const avatarColors: [string, string][] = [
  ["#b07bff", "#7a4df0"],
  ["#5c9bff", "#3b6df0"],
  ["#62d6a4", "#3dbb87"],
  ["#ffc25a", "#f59e0b"],
  ["#4fd8e6", "#22a8c4"],
  ["#ff8ab4", "#ec4899"],
];

type FormState = {
  id: string | null;
  name: string;
  skills: string;
  description: string;
  auto: boolean;
  ask: string;
  min: string;
  currency: string;
  style: "firm" | "balanced" | "flexible";
  rounds: string;
  instructions: string;
  paypal: string;
};
const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  skills: "",
  description: "",
  auto: false,
  ask: "",
  min: "",
  currency: "USD",
  style: "balanced",
  rounds: "4",
  instructions: "",
  paypal: "",
};
/* ------------------------------- Styles -------------------------------- */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&family=Sora:wght@600;700&display=swap');

.ag, .ag * { box-sizing: border-box; }
.ag {
  min-height: 100vh; margin-left: 284px; padding: 32px 36px 56px 12px;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #14123a; background: #FAFAFC;
}

/* ---- Top bar ---- */
.ag-top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
.ag-title { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 28px; letter-spacing: .01em; }
.ag-spacer { flex: 1; }
.ag-search { position: relative; width: 340px; max-width: 100%; }
.ag-search svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #8886ad; }
.ag-input {
  width: 100%; padding: 12px 14px; border-radius: 14px; font-family: inherit; font-size: 14px; color: #14123a;
  background: #fff; border: 1px solid #dcdcf3; outline: none; transition: border-color .2s, box-shadow .2s;
}
.ag-search .ag-input { padding-left: 40px; }
.ag-input::placeholder { color: #8886ad; }
.ag-input:focus { border-color: #8b7bff; box-shadow: 0 0 0 3px rgba(139,123,255,.2); }
textarea.ag-input { resize: vertical; }

.ag-btn {
  display: inline-flex; align-items: center; gap: 8px; cursor: pointer; padding: 11px 18px; border-radius: 14px; border: none;
  font-family: inherit; font-size: 13.5px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #8b7bff, #5d4cf7); box-shadow: 0 8px 20px rgba(93,76,247,.35);
  transition: transform .2s, box-shadow .2s;
}
.ag-btn:hover { transform: translateY(-1px); box-shadow: 0 12px 26px rgba(93,76,247,.45); }
.ag-btn:active { transform: translateY(0) scale(.98); }
.ag-btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }
.ag-btn.ghost { color: #4a3fd6; background: #fff; border: 1px solid #dcdcf3; box-shadow: none; }
.ag-btn.ghost:hover { background: #f0efff; border-color: #bdb6ff; box-shadow: none; }
.ag-btn.danger { color: #c4344f; background: #fff; border: 1px solid #f4c4cd; box-shadow: none; }
.ag-btn.danger:hover { background: #fff1f4; box-shadow: none; }

.ag-error { margin-bottom: 16px; padding: 12px 16px; border-radius: 12px; font-size: 13.5px; font-weight: 600; color: #d23a5c; background: #ffe1e8; }

/* ---- Skill filter chips ---- */
.ag-filters { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 22px; }
.ag-fchip {
  flex-shrink: 0; cursor: pointer; padding: 7px 14px; border-radius: 999px; font-family: inherit; font-size: 12.5px; font-weight: 600;
  color: #4a3fd6; background: #fff; border: 1px solid #dcdcf3; transition: background .2s, border-color .2s, transform .15s;
}
.ag-fchip:hover { background: #f0efff; border-color: #bdb6ff; transform: translateY(-1px); }
.ag-fchip.on { color: #fff; border-color: transparent; background: linear-gradient(135deg, #8b7bff, #5d4cf7); }

/* ---- Pipeline strip ---- */
.ag-pipe {
  margin-bottom: 30px; padding: 20px 24px 18px; border-radius: 24px;
  background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%); border: 1px solid rgba(255,255,255,.7);
  box-shadow: 0 16px 50px rgba(60,40,200,.22);
}
.ag-pipe-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.ag-h2 { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 18px; }
.ag-total { font-size: 13px; color: #6d6b95; }
.ag-bar { display: flex; gap: 4px; height: 14px; }
.ag-seg { min-width: 8px; border-radius: 999px; transition: flex .4s ease, transform .2s; }
.ag-seg:hover { transform: scaleY(1.35); }
.ag-bar-empty { height: 14px; border-radius: 999px; background: #ececf8; }
.ag-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.ag-leg {
  display: inline-flex; align-items: center; gap: 9px; cursor: pointer; padding: 8px 14px; border-radius: 12px;
  font-family: inherit; font-size: 13px; font-weight: 600; color: #3a3865; background: #fff; border: 1px solid #ececf8;
  transition: background .2s, border-color .2s, transform .15s;
}
.ag-leg:hover { background: #efeefd; transform: translateY(-1px); }
.ag-leg.on { border-color: #8b7bff; background: #efeefd; }
.ag-leg i { width: 10px; height: 10px; border-radius: 50%; display: block; }
.ag-leg b { font-family: 'Sora', sans-serif; font-size: 15px; color: #14123a; }

/* ---- Sections ---- */
.ag-sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 2px 16px; }
.ag-sec-sub { font-size: 13px; color: #6d6b95; }
.ag-empty { padding: 36px 10px; text-align: center; font-size: 14px; color: #6d6b95; }

/* ---- Agent marketplace cards ---- */
.ag-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; margin-bottom: 40px; }
.ag-card {
  display: flex; flex-direction: column; min-width: 0; overflow: hidden; border-radius: 24px; cursor: pointer;
  background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%); border: 1px solid rgba(255,255,255,.7);
  box-shadow: 0 12px 40px rgba(90,70,255,.18); transition: transform .25s ease, box-shadow .25s ease;
  animation: ag-rise .35s ease both;
}
.ag-card:hover { transform: translateY(-4px); box-shadow: 0 18px 50px rgba(90,70,255,.3); }
.ag-card:focus-visible { outline: 3px solid rgba(139,123,255,.55); outline-offset: 3px; }
.ag-banner { position: relative; height: 84px; }
.ag-actions { position: absolute; top: 12px; right: 12px; display: flex; gap: 8px; }
.ag-icon-btn {
  width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  border-radius: 10px; color: #fff; background: rgba(255,255,255,.22); border: 1px solid rgba(255,255,255,.4);
  transition: background .2s, transform .15s;
}
.ag-icon-btn:hover { background: rgba(255,255,255,.4); transform: scale(1.08); }
.ag-avatar {
  position: absolute; left: 22px; bottom: -28px; width: 60px; height: 60px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 20px;
  border: 4px solid #fbfbff; box-shadow: 0 8px 20px rgba(90,70,255,.25); transition: transform .25s;
}
.ag-card:hover .ag-avatar { transform: scale(1.06) rotate(-3deg); }
.ag-body { display: flex; flex-direction: column; gap: 12px; padding: 38px 22px 20px; flex: 1; }
.ag-name { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ag-desc {
  margin: 0; font-size: 13.5px; line-height: 1.55; color: #3a3865;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.ag-skills { display: flex; flex-wrap: wrap; gap: 7px; }
.ag-pill { display: inline-block; padding: 5px 11px; border-radius: 9px; font-size: 12.5px; font-weight: 600; color: #4a3fd6; background: #ebe9ff; }
.ag-view { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: #4a3fd6; opacity: .75; transition: opacity .2s, gap .2s; }
.ag-card:hover .ag-view { opacity: 1; gap: 10px; }
.ag-work {
  margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 14px;
  border-top: 1px solid #ececf8; font-size: 13px; color: #6d6b95;
}
.ag-dots { display: flex; gap: 5px; }
.ag-dots i { width: 9px; height: 9px; border-radius: 50%; display: block; }
.ag-toggle {
  display: inline-flex; align-items: center; gap: 4px; cursor: pointer; padding: 6px 10px; border-radius: 10px;
  font-family: inherit; font-size: 12.5px; font-weight: 700; color: #4a3fd6; background: #fff; border: 1px solid #dcdcf3;
}
.ag-toggle:hover { background: #f0efff; border-color: #bdb6ff; }
.ag-tasks { display: grid; gap: 8px; padding: 10px 12px; border-radius: 14px; background: #fff; border: 1px solid #ececf8; max-height: 200px; overflow-y: auto; cursor: default; }
.ag-task { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; font-weight: 500; color: #3a3865; }
.ag-task span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---- Chips (status) ---- */
.ag-chip, .ag-select {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 999px;
  font-family: inherit; font-size: 11.5px; font-weight: 700; white-space: nowrap;
}
.ag-chip::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.ag-select:disabled { cursor: default; opacity: .85; }
.ag-select { border: none; outline: none; cursor: pointer; width: 100%; padding: 7px 10px; border-radius: 10px; font-size: 12.5px; }
.s-running { color: #3b6df0; background: #e3ecff; }
.s-done { color: #1f9e68; background: #dcf7ea; }
.s-waiting_for_agent { color: #c47a05; background: #fff0d1; }
.s-under_review { color: #4a3fd6; background: #e7e5ff; }
.s-payment_received { color: #148a9f; background: #d9f6fa; }
.s-bug_reported { color: #d23a5c; background: #ffe1e8; }

.ag-modal { max-height: 92vh; overflow-y: auto; }
.ag-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 14px; border-radius: 14px; background: #fff; border: 1px solid #ececf8; font-size: 13.5px; }
.ag-switch-row b { display: block; }
.ag-switch-row small { display: block; margin-top: 2px; font-size: 12px; color: #6d6b95; }
.ag-switch { flex-shrink: 0; width: 46px; height: 26px; padding: 3px; border-radius: 999px; border: none; cursor: pointer; background: #d6d4ef; transition: background .2s; }
.ag-switch i { display: block; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .2s; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
.ag-switch.on { background: linear-gradient(135deg, #8b7bff, #5d4cf7); }
.ag-switch.on i { transform: translateX(20px); }

.ag-act { cursor: pointer; padding: 8px 12px; border-radius: 10px; font-family: inherit; font-size: 12.5px; font-weight: 700; color: #4a3fd6; background: #fff; border: 1px solid #dcdcf3; transition: background .2s, transform .15s; }
.ag-act:hover { background: #f0efff; transform: translateY(-1px); }
.ag-act.hot { color: #fff; border-color: transparent; background: linear-gradient(135deg,#8b7bff,#5d4cf7); box-shadow: 0 6px 16px rgba(93,76,247,.3); }

/* ---- Job board (row-wise) ---- */
.ag-rows { display: grid; gap: 16px; }
.ag-row {
  position: relative; overflow: hidden; padding: 16px 18px 18px 22px; border-radius: 22px; background: #f3f3fc; border: 1px solid #ececf8;
  animation: ag-rise .35s ease both;
}
.ag-row::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--rc); }
.ag-row-head {
  width: 100%; display: flex; align-items: center; gap: 10px; padding: 2px 0 0; cursor: pointer; background: none; border: none;
  font-family: inherit; font-size: 14.5px; font-weight: 700; color: #14123a; text-align: left;
}
.ag-row-head i { width: 12px; height: 12px; border-radius: 50%; display: block; }
.ag-row-head .chev { margin-left: auto; color: #6d6b95; transition: transform .2s; }
.ag-row-head:hover .chev { color: #4a3fd6; }
.ag-row.shut .chev { transform: rotate(-90deg); }
.ag-col-count { min-width: 24px; height: 24px; padding: 0 8px; display: inline-flex; align-items: center; justify-content: center; border-radius: 12px; font-size: 12px; color: #4a3fd6; background: #e7e5ff; }
.ag-row-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin-top: 14px; }
.ag-job { display: grid; gap: 10px; align-content: start; padding: 14px; border-radius: 16px; background: #fff; border: 1px solid #ececf8; transition: background .2s, border-color .2s, transform .2s, box-shadow .2s; }
.ag-job:hover { background: #efeefd; border-color: #dcdaff; transform: translateY(-2px); box-shadow: 0 10px 24px rgba(90,70,255,.14); }
.ag-job-title { font-size: 14px; font-weight: 700; line-height: 1.35; }
.ag-job-desc { margin: 0; font-size: 12.5px; line-height: 1.5; color: #6d6b95; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ag-job-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: #8886ad; }
.ag-col-empty { margin-top: 12px; padding: 6px 2px; font-size: 13px; color: #8886ad; }

/* ---- Modal ---- */
.ag-overlay { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(20,18,58,.45); animation: ag-fade .2s ease; }
.ag-modal {
  width: 520px; max-width: 100%; padding: 26px; border-radius: 24px; display: grid; gap: 14px;
  background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%); box-shadow: 0 24px 70px rgba(60,40,200,.4);
}
.ag-modal-head { display: flex; align-items: center; justify-content: space-between; }
.ag-close { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 10px; color: #4a3fd6; background: #fff; border: 1px solid #dcdcf3; }
.ag-close:hover { background: #f0efff; }
.ag-label { display: grid; gap: 6px; font-size: 12.5px; font-weight: 700; color: #4d4b78; }
.ag-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }

/* ---- Agent detail drawer ---- */
.ad-bg { position: fixed; inset: 0; z-index: 55; display: flex; justify-content: flex-end; background: rgba(20,18,58,.5); backdrop-filter: blur(3px); animation: ag-fade .2s ease; }
.ad {
  position: relative; width: 600px; max-width: 100%; height: 100%; overflow-y: auto;
  background: linear-gradient(180deg,#fbfbff,#f3f3fc); box-shadow: -24px 0 70px rgba(60,40,200,.35);
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #14123a; animation: ag-slide .3s cubic-bezier(.2,.8,.2,1);
}
.ad-banner { position: relative; height: 130px; }
.ad-x { position: absolute; top: 16px; right: 16px; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 11px; color: #fff; background: rgba(255,255,255,.22); border: 1px solid rgba(255,255,255,.45); transition: background .2s, transform .15s; }
.ad-x:hover { background: rgba(255,255,255,.4); transform: rotate(90deg); }
.ad-avatar { position: absolute; left: 26px; bottom: -36px; width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 26px; border: 5px solid #fbfbff; box-shadow: 0 10px 26px rgba(90,70,255,.3); }
.ad-main { padding: 48px 26px 32px; display: grid; gap: 20px; }
.ad-name { margin: 0; font-family: 'Sora', sans-serif; font-size: 22px; line-height: 1.3; }
.ad-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.ad-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.ad-stat { padding: 14px; border-radius: 16px; background: #fff; border: 1px solid #ececf8; transition: transform .2s, box-shadow .2s; }
.ad-stat:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(90,70,255,.14); }
.ad-stat b { display: block; font-family: 'Sora', sans-serif; font-size: 22px; }
.ad-stat span { font-size: 12px; font-weight: 600; color: #6d6b95; }
.ad-sec { padding: 16px 18px; border-radius: 18px; background: #fff; border: 1px solid #ececf8; }
.ad-sec h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-family: 'Sora', sans-serif; font-size: 14.5px; }
.ad-sec h3 svg { color: #5d4cf7; }
.ad-sec p { margin: 0; font-size: 14px; line-height: 1.7; color: #3a3865; white-space: pre-wrap; }
.ad-muted { font-size: 13.5px; color: #8886ad; }
.ad-kv { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ad-kv div { padding: 10px 12px; border-radius: 12px; background: #f6f6fd; }
.ad-kv small { display: block; font-size: 11.5px; font-weight: 700; color: #8886ad; text-transform: uppercase; letter-spacing: .04em; }
.ad-kv b { display: block; margin-top: 3px; font-size: 14px; word-break: break-word; text-transform: capitalize; }
.ad-kv .wide { grid-column: 1 / -1; }
.ad-kv .wide b { text-transform: none; font-weight: 600; line-height: 1.55; }
.ad-tasks { display: grid; gap: 8px; }
.ad-task { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: #f6f6fd; font-size: 13.5px; font-weight: 600; transition: background .2s; }
.ad-task:hover { background: #efeefd; }
.ad-task .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ad-foot { display: flex; gap: 10px; flex-wrap: wrap; }
.ad button:focus-visible, .ag-card:focus-visible { outline: 3px solid rgba(139,123,255,.5); outline-offset: 2px; }

@keyframes ag-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ag-slide { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes ag-sheet { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes ag-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .ag *, .ad, .ad-bg, .ag-overlay { animation: none !important; transition: none !important; } }

@media (max-width: 1199px) { .ag-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 767px) {
  .ag { margin-left: 0; padding: 88px 16px 40px; }
  .ag-title { font-size: 24px; }
  .ag-grid { grid-template-columns: 1fr; }
  .ag-search { width: 100%; }
  .ag-row-grid { grid-template-columns: 1fr; }
  .ad-bg { align-items: flex-end; }
  .ad { width: 100%; height: 94vh; border-radius: 24px 24px 0 0; animation-name: ag-sheet; }
  .ad-stats { grid-template-columns: repeat(3, 1fr); }
  .ad-kv { grid-template-columns: 1fr; }
}
`;

/* ----------------------------- Component ------------------------------ */

const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const grad = (c: { from: string; to: string } | [string, string]) =>
  Array.isArray(c)
    ? `linear-gradient(135deg, ${c[0]}, ${c[1]})`
    : `linear-gradient(135deg, ${c.from}, ${c.to})`;

const ACTION_LABEL: Record<NonNullable<DeskAction>, string> = {
  reply_offer: "Reply to offer",
  submit_work: "Submit work",
};

export default function AgentsMarketplace() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [form, setForm] = useState<FormState | null>(null); // null = modal closed
  const [query, setQuery] = useState("");
  const [skill, setSkill] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<JobStatus | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, j, s] = await Promise.all([
        agentsApi.list(),
        agentsApi.jobs(),
        agentsApi.stats(),
      ]);
      setAgents(a);
      setJobs(j);
      setStats(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load data");
    } finally {
      setLoading(false);
    }
  }, []);
  const [deskId, setDeskId] = useState<string | null>(null);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000); // so "Reply to offer / Submit work" shows up by itself
    return () => clearInterval(t);
  }, [load]);

  // Close the detail drawer with Escape (the live-view modal handles its own Escape)
  useEffect(() => {
    if (!detailId) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deskId) setDetailId(null);
    };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [detailId, deskId]);

  const allSkills = useMemo(() => {
    const seen = new Map<string, string>();
    agents.forEach((a) =>
      a.skills.forEach(
        (s) => seen.has(s.toLowerCase()) || seen.set(s.toLowerCase(), s),
      ),
    );
    return Array.from(seen.values()).slice(0, 14);
  }, [agents]);

  const visibleAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) => {
      if (
        skill &&
        !a.skills.some((s) => s.toLowerCase() === skill.toLowerCase())
      )
        return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.skills.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [agents, query, skill]);

  async function saveAgent(e: FormEvent) {
    e.preventDefault();
    if (!form || !form.name.trim() || saving) return;
    const ask = form.ask ? Number(form.ask) : null;
    const min = form.min ? Number(form.min) : null;
    if (form.auto && !(ask && ask > 0)) {
      setError("Set an asking price for an auto-negotiating agent");
      return;
    }
    if (ask && min && min > ask) {
      setError("Minimum price cannot be above the asking price");
      return;
    }
    const paypal = form.paypal.trim().toLowerCase();
    if (paypal && !/^\S+@\S+\.\S+$/.test(paypal)) {
      setError("Enter a valid PayPal email");
      return;
    }
    setSaving(true);
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      skills: form.skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      auto_negotiate: form.auto,
      ask_price: ask,
      min_price: min,
      currency: form.currency,
      negotiation_style: form.style,
      max_rounds: Math.min(5, Math.max(1, Number(form.rounds) || 4)),
      instructions: form.instructions.trim(),
    };
    try {
      if (form.id) await agentsApi.update(form.id, body);
      else await agentsApi.create(body);
      setForm(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save agent");
    } finally {
      setSaving(false);
    }
  }

  async function removeAgent(a: Agent): Promise<boolean> {
    if (!confirm(`Delete ${a.name}? Its jobs will become unassigned.`))
      return false;
    try {
      await agentsApi.remove(a.id);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete agent");
      return false;
    }
  }

  function editAgent(a: Agent) {
    setForm({
      id: a.id,
      name: a.name,
      skills: a.skills.join(", "),
      description: a.description,
      auto: a.auto_negotiate,
      ask: a.ask_price != null ? String(a.ask_price) : "",
      min: a.min_price != null ? String(a.min_price) : "",
      currency: a.currency || "USD",
      style: a.negotiation_style || "balanced",
      rounds: String(a.max_rounds || 4),
      instructions: a.instructions || "",
      paypal: a.paypal_email || "",
    });
  }

  async function changeStatus(job: Job, status: JobStatus) {
    try {
      await agentsApi.setJobStatus(job.id, status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status");
    }
  }

  const total = stats?.total ?? 0;
  const columns = statusFilter ? [statusFilter] : STATUS_ORDER;
  const detail = detailId ? agents.find((x) => x.id === detailId) : undefined;

  return (
    <>
      <style>{css}</style>
      <Sidebar />

      <main className="ag">
        {/* Top bar */}
        <div className="ag-top">
          <h1 className="ag-title">Agents</h1>
          <div className="ag-spacer" />
          <div className="ag-search">
            <Search size={16} />
            <input
              className="ag-input"
              placeholder="Search agents or skills"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="ag-btn" onClick={() => setForm({ ...EMPTY_FORM })}>
            <Plus size={16} strokeWidth={2.6} /> Add agent
          </button>
        </div>

        {error && <div className="ag-error">{error}</div>}

        {allSkills.length > 0 && (
          <div className="ag-filters">
            <button
              className={`ag-fchip ${skill === null ? "on" : ""}`}
              onClick={() => setSkill(null)}
            >
              All skills
            </button>
            {allSkills.map((s) => (
              <button
                key={s}
                className={`ag-fchip ${skill?.toLowerCase() === s.toLowerCase() ? "on" : ""}`}
                onClick={() =>
                  setSkill(skill?.toLowerCase() === s.toLowerCase() ? null : s)
                }
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Pipeline strip */}
        <section className="ag-pipe">
          <div className="ag-pipe-head">
            <h2 className="ag-h2">Job pipeline</h2>
            <span className="ag-total">
              {total} job{total === 1 ? "" : "s"} in total
            </span>
          </div>
          {total === 0 ? (
            <div className="ag-bar-empty" />
          ) : (
            <div className="ag-bar">
              {STATUS_ORDER.filter((s) => (stats?.[s] ?? 0) > 0).map((s) => (
                <div
                  key={s}
                  className="ag-seg"
                  style={{ flex: stats![s], background: grad(statusColor[s]) }}
                  title={`${STATUS_META[s].label}: ${stats![s]}`}
                />
              ))}
            </div>
          )}
          <div className="ag-legend">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                className={`ag-leg ${statusFilter === s ? "on" : ""}`}
                onClick={() => setStatusFilter(statusFilter === s ? null : s)}
              >
                <i style={{ background: grad(statusColor[s]) }} />
                {STATUS_META[s].label}
                <b>{stats ? stats[s] : "–"}</b>
              </button>
            ))}
          </div>
        </section>

        {/* Agent cards */}
        <div className="ag-sec-head">
          <h2 className="ag-h2">Available agents</h2>
          <span className="ag-sec-sub">{visibleAgents.length} shown</span>
        </div>

        {loading ? (
          <div className="ag-empty">Loading…</div>
        ) : visibleAgents.length === 0 ? (
          <div className="ag-empty">
            {agents.length === 0
              ? "No agents yet. Click “Add agent” to create one."
              : "No agents match your search."}
          </div>
        ) : (
          <div className="ag-grid">
            {visibleAgents.map((a) => {
              const color =
                avatarColors[agents.indexOf(a) % avatarColors.length];
              const open = openAgent === a.id;
              const active = a.tasks.filter(
                (t) => t.status === "running",
              ).length;
              return (
                <article
                  key={a.id}
                  className="ag-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`View details of ${a.name}`}
                  onClick={() => setDetailId(a.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setDetailId(a.id);
                    }
                  }}
                >
                  <div
                    className="ag-banner"
                    style={{ background: grad(color) }}
                  >
                    <div className="ag-actions">
                      <button
                        className="ag-icon-btn"
                        aria-label={`Edit ${a.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          editAgent(a);
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="ag-icon-btn"
                        aria-label={`Delete ${a.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAgent(a);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div
                      className="ag-avatar"
                      style={{ background: grad(color) }}
                    >
                      {initials(a.name) || <Bot size={24} />}
                    </div>
                  </div>

                  <div className="ag-body">
                    <h3 className="ag-name">{a.name}</h3>
                    {a.auto_negotiate && (
                      <span
                        className="ag-pill"
                        style={{
                          alignSelf: "flex-start",
                          background: "#dcf7ea",
                          color: "#1f9e68",
                        }}
                      >
                        Auto-negotiates · ask {a.currency} {a.ask_price}
                      </span>
                    )}
                    {a.description && (
                      <p className="ag-desc">{a.description}</p>
                    )}
                    {a.skills.length > 0 && (
                      <div className="ag-skills">
                        {a.skills.map((s) => (
                          <span key={s} className="ag-pill">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}

                    {open && (
                      <div
                        className="ag-tasks"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {a.tasks.length === 0 ? (
                          <span className="ag-sec-sub">No tasks assigned.</span>
                        ) : (
                          a.tasks.map((t) => (
                            <div key={t.id} className="ag-task">
                              <span>{t.title}</span>
                              {t.action && (
                                <button
                                  type="button"
                                  className="ag-act hot"
                                  onClick={() => setDeskId(t.id)}
                                >
                                  {ACTION_LABEL[t.action]}
                                </button>
                              )}
                              <span className={`ag-chip s-${t.status}`}>
                                {STATUS_META[t.status].label}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    <div className="ag-work">
                      <span>
                        {a.tasks.length} task{a.tasks.length === 1 ? "" : "s"}
                        {active > 0 ? ` · ${active} running` : ""}
                      </span>
                      <div className="ag-dots">
                        {a.tasks.slice(0, 8).map((t) => (
                          <i
                            key={t.id}
                            style={{ background: grad(statusColor[t.status]) }}
                            title={STATUS_META[t.status].label}
                          />
                        ))}
                      </div>
                      <button
                        className="ag-toggle"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenAgent(open ? null : a.id);
                        }}
                      >
                        Tasks{" "}
                        {open ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </button>
                    </div>
                    <span className="ag-view">
                      View full details <ArrowRight size={14} />
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Job board (one row per status) */}
        <div className="ag-sec-head">
          <h2 className="ag-h2">Job board</h2>
          <span className="ag-sec-sub">Move a job by changing its status</span>
        </div>
        <div className="ag-rows">
          {columns.map((s) => {
            const list = jobs.filter((j) => j.status === s);
            const closed = !!shut[s];
            return (
              <section
                key={s}
                className={`ag-row ${closed ? "shut" : ""}`}
                style={{ ["--rc" as string]: grad(statusColor[s]) }}
              >
                <button
                  type="button"
                  className="ag-row-head"
                  aria-expanded={!closed}
                  onClick={() => setShut({ ...shut, [s]: !closed })}
                >
                  <i style={{ background: grad(statusColor[s]) }} />
                  {STATUS_META[s].label}
                  <span className="ag-col-count">{list.length}</span>
                  <ChevronDown size={18} className="chev" />
                </button>
                {!closed && list.length === 0 && (
                  <div className="ag-col-empty">No jobs here.</div>
                )}
                {!closed && list.length > 0 && (
                  <div className="ag-row-grid">
                    {list.map((j) => (
                      <div key={j.id} className="ag-job">
                        <div className="ag-job-title">{j.title}</div>
                        {j.description && (
                          <p className="ag-job-desc">{j.description}</p>
                        )}
                        <div className="ag-job-meta">
                          {j.agent_name ? (
                            <span className="ag-pill">{j.agent_name}</span>
                          ) : (
                            <span>Unassigned</span>
                          )}
                          {j.files.length > 0 && (
                            <span
                              title={j.files.map((f) => f.filename).join(", ")}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <Paperclip size={13} /> {j.files.length}
                            </span>
                          )}
                        </div>
                        <select
                          className={`ag-select s-${j.status}`}
                          value={j.status}
                          disabled={j.managed}
                          title={
                            j.managed
                              ? "Updates automatically while the agent works"
                              : undefined
                          }
                          onChange={(e) =>
                            changeStatus(j, e.target.value as JobStatus)
                          }
                          aria-label={`Status of ${j.title}`}
                        >
                          {STATUS_ORDER.map((st) => (
                            <option key={st} value={st}>
                              {STATUS_META[st].label}
                            </option>
                          ))}
                        </select>
                        {j.managed && (
                          <button
                            type="button"
                            className={`ag-act ${j.action ? "hot" : ""}`}
                            onClick={() => setDeskId(j.id)}
                          >
                            {j.action
                              ? ACTION_LABEL[j.action]
                              : "Open live view"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {jobs.length === 0 && !loading && (
          <div className="ag-empty">
            No jobs yet. Create one with POST /api/v1/agents/jobs.
          </div>
        )}
      </main>

      {/* Agent detail drawer */}
      {detail &&
        (() => {
          const color =
            avatarColors[agents.indexOf(detail) % avatarColors.length];
          const running = detail.tasks.filter(
            (t) => t.status === "running",
          ).length;
          const finished = detail.tasks.filter(
            (t) => t.status === "done",
          ).length;
          return (
            <div
              className="ad-bg"
              onMouseDown={(e) =>
                e.target === e.currentTarget && setDetailId(null)
              }
            >
              <aside
                className="ad"
                role="dialog"
                aria-modal="true"
                aria-label={`${detail.name} details`}
              >
                <div className="ad-banner" style={{ background: grad(color) }}>
                  <button
                    className="ad-x"
                    aria-label="Close"
                    onClick={() => setDetailId(null)}
                  >
                    <X size={17} />
                  </button>
                  <div
                    className="ad-avatar"
                    style={{ background: grad(color) }}
                  >
                    {initials(detail.name) || <Bot size={30} />}
                  </div>
                </div>

                <div className="ad-main">
                  <div>
                    <h2 className="ad-name">{detail.name}</h2>
                    <div className="ad-tags">
                      <span
                        className="ag-pill"
                        style={
                          detail.auto_negotiate
                            ? { background: "#dcf7ea", color: "#1f9e68" }
                            : undefined
                        }
                      >
                        {detail.auto_negotiate
                          ? "Auto-negotiates"
                          : "Manual replies"}
                      </span>
                      {running > 0 && (
                        <span className="ag-chip s-running">
                          {running} running
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="ad-stats">
                    <div className="ad-stat">
                      <b>{detail.tasks.length}</b>
                      <span>Total tasks</span>
                    </div>
                    <div className="ad-stat">
                      <b>{running}</b>
                      <span>Running</span>
                    </div>
                    <div className="ad-stat">
                      <b>{finished}</b>
                      <span>Done</span>
                    </div>
                  </div>

                  <div className="ad-sec">
                    <h3>
                      <Sparkles size={16} /> About
                    </h3>
                    {detail.description ? (
                      <p>{detail.description}</p>
                    ) : (
                      <span className="ad-muted">No description added.</span>
                    )}
                  </div>

                  <div className="ad-sec">
                    <h3>
                      <Gauge size={16} /> Skills
                    </h3>
                    {detail.skills.length > 0 ? (
                      <div className="ag-skills">
                        {detail.skills.map((s) => (
                          <span key={s} className="ag-pill">
                            {s}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="ad-muted">No skills listed.</span>
                    )}
                  </div>

                  <div className="ad-sec">
                    <h3>
                      <Repeat size={16} /> Negotiation
                    </h3>
                    {detail.auto_negotiate ? (
                      <div className="ad-kv">
                        <div>
                          <small>Asking price</small>
                          <b>
                            {detail.currency} {detail.ask_price ?? "–"}
                          </b>
                        </div>
                        <div>
                          <small>Lowest accepted</small>
                          <b>
                            {detail.min_price != null
                              ? `${detail.currency} ${detail.min_price}`
                              : "Not set"}
                          </b>
                        </div>
                        <div>
                          <small>Style</small>
                          <b>{detail.negotiation_style || "balanced"}</b>
                        </div>
                        <div>
                          <small>Max rounds</small>
                          <b>{detail.max_rounds || 4}</b>
                        </div>
                        {detail.instructions && (
                          <div className="wide">
                            <small>Extra instructions</small>
                            <b>{detail.instructions}</b>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="ad-muted">
                        Auto-negotiation is off. You reply to offers manually.
                      </span>
                    )}
                  </div>

                  {detail.paypal_email && (
                    <div className="ad-sec">
                      <h3>
                        <Wallet size={16} /> Payout
                      </h3>
                      <div className="ad-kv">
                        <div className="wide">
                          <small>PayPal email</small>
                          <b>{detail.paypal_email}</b>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="ad-sec">
                    <h3>
                      <ListChecks size={16} /> Tasks ({detail.tasks.length})
                    </h3>
                    {detail.tasks.length === 0 ? (
                      <span className="ad-muted">No tasks assigned.</span>
                    ) : (
                      <div className="ad-tasks">
                        {detail.tasks.map((t) => (
                          <div key={t.id} className="ad-task">
                            <span className="t">{t.title}</span>
                            {t.action && (
                              <button
                                type="button"
                                className="ag-act hot"
                                onClick={() => setDeskId(t.id)}
                              >
                                {ACTION_LABEL[t.action]}
                              </button>
                            )}
                            <span className={`ag-chip s-${t.status}`}>
                              {STATUS_META[t.status].label}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="ad-foot">
                    <button
                      className="ag-btn"
                      onClick={() => {
                        editAgent(detail);
                        setDetailId(null);
                      }}
                    >
                      <Pencil size={15} /> Edit agent
                    </button>
                    <button
                      className="ag-btn danger"
                      onClick={async () => {
                        if (await removeAgent(detail)) setDetailId(null);
                      }}
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          );
        })()}

      {/* Add / edit modal */}
      {form && (
        <div className="ag-overlay" onClick={() => setForm(null)}>
          <form
            className="ag-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={saveAgent}
          >
            <div className="ag-modal-head">
              <h2 className="ag-h2">{form.id ? "Edit agent" : "New agent"}</h2>
              <button
                type="button"
                className="ag-close"
                aria-label="Close"
                onClick={() => setForm(null)}
              >
                <X size={16} />
              </button>
            </div>
            <label className="ag-label">
              Name
              <input
                className="ag-input"
                value={form.name}
                maxLength={80}
                required
                autoFocus
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Support Agent"
              />
            </label>
            <label className="ag-label">
              Skills
              <input
                className="ag-input"
                value={form.skills}
                onChange={(e) => setForm({ ...form, skills: e.target.value })}
                placeholder="python, design, testing"
              />
            </label>
            <label className="ag-label">
              Description
              <textarea
                className="ag-input"
                rows={3}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="What does this agent do?"
              />
            </label>
            <div className="ag-switch-row">
              <span>
                <b>Auto-negotiate with AI</b>
                <small>
                  On: this agent haggles and accepts jobs by itself. Off: you
                  reply manually from the Jobs page.
                </small>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={form.auto}
                className={`ag-switch ${form.auto ? "on" : ""}`}
                onClick={() => setForm({ ...form, auto: !form.auto })}
              >
                <i />
              </button>
            </div>
            {form.auto && (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 90px",
                    gap: 10,
                  }}
                >
                  <label className="ag-label">
                    Asking price
                    <input
                      className="ag-input"
                      type="number"
                      min={0}
                      value={form.ask}
                      onChange={(e) =>
                        setForm({ ...form, ask: e.target.value })
                      }
                      placeholder="500"
                    />
                  </label>
                  <label className="ag-label">
                    Lowest I'll accept
                    <input
                      className="ag-input"
                      type="number"
                      min={0}
                      value={form.min}
                      onChange={(e) =>
                        setForm({ ...form, min: e.target.value })
                      }
                      placeholder="80% of ask"
                    />
                  </label>
                  <label className="ag-label">
                    Currency
                    <select
                      className="ag-input"
                      value={form.currency}
                      onChange={(e) =>
                        setForm({ ...form, currency: e.target.value })
                      }
                    >
                      {["USD", "INR", "EUR", "GBP"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <label className="ag-label">
                    Negotiation style
                    <select
                      className="ag-input"
                      value={form.style}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          style: e.target.value as FormState["style"],
                        })
                      }
                    >
                      <option value="firm">Firm (holds price)</option>
                      <option value="balanced">Balanced</option>
                      <option value="flexible">Flexible (concedes fast)</option>
                    </select>
                  </label>
                  <label className="ag-label">
                    Max rounds (1-5)
                    <input
                      className="ag-input"
                      type="number"
                      min={1}
                      max={5}
                      value={form.rounds}
                      onChange={(e) =>
                        setForm({ ...form, rounds: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label className="ag-label">
                  Extra negotiation instructions
                  <textarea
                    className="ag-input"
                    rows={2}
                    value={form.instructions}
                    onChange={(e) =>
                      setForm({ ...form, instructions: e.target.value })
                    }
                    placeholder="e.g. Ask for a longer deadline before lowering the price"
                  />
                </label>
              </>
            )}
            <div className="ag-modal-actions">
              <button
                type="button"
                className="ag-btn ghost"
                onClick={() => setForm(null)}
              >
                Cancel
              </button>
              <button className="ag-btn" disabled={saving || !form.name.trim()}>
                {saving ? "Saving…" : form.id ? "Save changes" : "Create agent"}
              </button>
            </div>
          </form>
        </div>
      )}
      {deskId && (
        <AgentDeskModal
          jobId={deskId}
          onClose={() => setDeskId(null)}
          onChanged={load}
        />
      )}
    </>
  );
}