'use client'
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from "react";
import { useMemo } from "react"; 
import { api, type RunningSummary, type CompletedRecord } from "../lib/api";
import { useTaskStream } from "../hooks/useTaskStream";
import { createPortal } from "react-dom";
import {
  Workflow,
  Search,
  Database,
  FileText,
  Code,
  ShieldCheck,
  Mail,
  TrendingUp,
  CalendarClock,
  Target,
  Timer,
  Repeat,
  CheckCircle2,
  X,
} from "lucide-react";
import Sidebar from "./Sidebar";

/* ------------------------------ Types ---------------------------------- */

type IconC = ComponentType<{ size?: number; strokeWidth?: number }>;
type Level = "info" | "success" | "warn" | "error";
type AgentId =
  | "planner"
  | "research"
  | "data"
  | "analyst"
  | "writer"
  | "builder"
  | "reviewer"
  | "mailer";

type Agent = {
  id: AgentId;
  name: string;
  role: string;
  icon: IconC;
  from: string;
  to: string;
  about: string;
  skills: string[];
  tools: string[];
};

const AGENTS: Record<AgentId, Agent> = {
  planner: {
    id: "planner", name: "Planner", role: "Coordinates work", icon: Workflow, from: "#8b7bff", to: "#5d4cf7",
    about: "Breaks a goal into steps, hands each step to the right agent and keeps the whole task moving. Every other agent reports back to the Planner.",
    skills: ["Task planning", "Delegation", "Progress tracking"],
    tools: ["scheduler", "task_queue", "agent_router"],
  },
  research: {
    id: "research", name: "Research", role: "Finds sources", icon: Search, from: "#5c9bff", to: "#3b6df0",
    about: "Searches the web and internal documents, reads what it finds and keeps only what is useful. It returns short findings with their sources.",
    skills: ["Source discovery", "Summarising", "Fact checking"],
    tools: ["web_search", "doc_reader", "citation_store"],
  },
  data: {
    id: "data", name: "Data", role: "Handles records", icon: Database, from: "#4fd8e6", to: "#22a8c4",
    about: "Pulls records from connected systems, removes duplicates, fills gaps and keeps the data clean for the agents that depend on it.",
    skills: ["Data cleaning", "Deduplication", "Backfilling"],
    tools: ["crm_export", "sql_query", "sheet_writer"],
  },
  analyst: {
    id: "analyst", name: "Analyst", role: "Finds insights", icon: TrendingUp, from: "#ffc25a", to: "#f59e0b",
    about: "Compares numbers across periods, spots the changes that matter and turns raw data into clear findings.",
    skills: ["Trend analysis", "Anomaly detection", "Forecasting"],
    tools: ["pandas_runner", "chart_engine", "sql_query"],
  },
  writer: {
    id: "writer", name: "Writer", role: "Writes content", icon: FileText, from: "#ff8ab4", to: "#ec4899",
    about: "Turns findings and briefs into clear, on-brand text such as reports, emails and page copy.",
    skills: ["Report writing", "Copywriting", "Tone matching"],
    tools: ["doc_editor", "style_guide", "chart_embed"],
  },
  builder: {
    id: "builder", name: "Builder", role: "Builds workflows", icon: Code, from: "#b07bff", to: "#7a4df0",
    about: "Designs and assembles automated workflows. It wires triggers, steps and fallbacks together, then deploys them.",
    skills: ["Workflow design", "Error handling", "Deployment"],
    tools: ["workflow_engine", "code_runner", "deploy_hook"],
  },
  reviewer: {
    id: "reviewer", name: "Reviewer", role: "Checks quality", icon: ShieldCheck, from: "#62d6a4", to: "#3dbb87",
    about: "Checks the work of other agents for mistakes, missing edge cases and quality problems before anything goes out.",
    skills: ["Quality checks", "Validation", "Brand voice review"],
    tools: ["validator", "diff_viewer", "audit_log"],
  },
  mailer: {
    id: "mailer", name: "Mailer", role: "Sends emails", icon: Mail, from: "#ff9a62", to: "#f0642a",
    about: "Prepares and sends emails, sets up A/B variants and waits for the right send window.",
    skills: ["Email drafting", "A/B testing", "Scheduled sending"],
    tools: ["smtp_gateway", "template_store", "send_scheduler"],
  },
};

const ALIASES: Record<string, AgentId> = {
  coder: "builder", code: "builder", executor: "builder", tool: "builder", terminal: "builder",
  researcher: "research", search: "research", web: "research",
  system: "planner", orchestrator: "planner", conversation: "planner",
  email: "mailer", mail: "mailer",
  writing: "writer", review: "reviewer", analysis: "analyst",
};

function resolveAgent(id?: string | null): AgentId {
  const k = String(id ?? "").toLowerCase().replace(/worker$/, "").trim();
  if (k in AGENTS) return k as AgentId;
  return ALIASES[k] ?? "planner";
}

/* ------------------------------ Running -------------------------------- */

type Msg = { from: AgentId; to: AgentId; text: string; level: Level; log: string };
type Item = Msg & { i: number ,ts:number};
type AgentStatus = "Working" | "Waiting" | "Idle" | "Done";
type AgentState = { status: AgentStatus; doing: string };

type RunningTask = {
  id: string;
  title: string;
  started: string;
  baseProgress: number;
  agents: AgentId[]; // first agent is the hub / coordinator
  state: Partial<Record<AgentId, AgentState>>;

};


/* ------------------------------ Completed ------------------------------ */

type Completed = {
  id: string;
  title: string;
  finished: string;
  duration: string;
  steps: number;
  success: string;
  summary: string;
  outcomes: string[];
  contributions: { agent: AgentId; did: string; actions: number }[];
  logs: { t: string; agent: AgentId; level: Level; text: string }[];
};



/* ------------------------------ Upcoming ------------------------------- */

type Upcoming = {
  id: string;
  title: string;
  when: string;
  repeat: string;
  agents: AgentId[];
  expected: string;
  duration: string;
};



/* ------------------------------- Styles -------------------------------- */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&family=Sora:wght@600;700&family=JetBrains+Mono:wght@400;500&display=swap');
html, body {
  background: #FAFAFC;
  overscroll-behavior: none;   /* stops the bounce that reveals the strip */
}

.tk, .tk * { box-sizing: border-box; }
.tk {
  min-height: 100vh; margin-left: 284px; padding: 32px 36px 48px 12px;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #14123a;
  background: #FAFAFC;
}

/* Page header + tabs (dark text on the light page so everything is readable) */
.tk-title { font-family: 'Sora', sans-serif; font-weight: 700; font-size: 28px; color: #14123a; margin: 0; letter-spacing: .01em; }
.tk-sub { margin: 6px 0 22px; font-size: 14px; color: #6d6b95; }

.tk-tabs { display: flex; gap: 6px; margin-bottom: 24px; border-bottom: 1px solid #e3e3f2; overflow-x: auto; }
.tk-tab {
  display: flex; align-items: center; gap: 9px; padding: 12px 20px; cursor: pointer;
  font-family: inherit; font-size: 15px; font-weight: 600; white-space: nowrap;
  color: #7d7ba6; background: none; border: none; border-bottom: 3px solid transparent;
  transition: color .2s, border-color .2s;
}
.tk-tab:hover { color: #14123a; }
.tk-tab.active { color: #14123a; border-bottom-color: #5d4cf7; }
.tk-count {
  min-width: 22px; height: 22px; padding: 0 7px; border-radius: 11px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #5b58a0; background: #ecebf7;
}
.tk-tab.active .tk-count { background: #5d4cf7; color: #fff; }
.tk-live { width: 8px; height: 8px; border-radius: 50%; background: #35d49a; flex-shrink: 0; animation: tk-pulse 1.6s infinite; }
@keyframes tk-pulse { 0% { box-shadow: 0 0 0 0 rgba(53,212,154,.7); } 70% { box-shadow: 0 0 0 8px rgba(53,212,154,0); } 100% { box-shadow: 0 0 0 0 rgba(53,212,154,0); } }

/* Panels */
.tk-panel {
  min-width: 0; padding: 22px 24px; border-radius: 24px;
  background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%);
  border: 1px solid rgba(255,255,255,.7); box-shadow: 0 16px 50px rgba(60,40,200,.28);
}
.tk-term {
  min-width: 0; padding: 20px 22px; border-radius: 24px; color: #d7d5ff;
  background: linear-gradient(180deg, #14113f 0%, #0c0a2b 100%);
  border: 1px solid rgba(255,255,255,.12); box-shadow: 0 16px 50px rgba(30,20,140,.45);
}
.tk-term .tk-pt { color: #fff; }
.tk-term .tk-pd { color: #9b99cf; }
.tk-ph { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.tk-pt { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 17px; color: #14123a; display: flex; align-items: center; gap: 10px; }
.tk-pd { margin: 4px 0 0; font-size: 13px; color: #6d6b95; }

.tk-bar { height: 8px; border-radius: 6px; background: #e4e3f7; overflow: hidden; }
.tk-bar > i { display: block; height: 100%; border-radius: 6px; background: linear-gradient(90deg, #8b7bff, #5d4cf7); transition: width .6s ease; }

.tk-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
.tk-chip::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.tk-chip.Working, .tk-chip.Completed { color: #1f9e68; background: #dcf7ea; }
.tk-chip.Waiting { color: #c47a05; background: #fff0d1; }
.tk-chip.Idle { color: #6d6b95; background: #ecebf7; }
.tk-chip.Done { color: #4a3fd6; background: #e7e5ff; }
.tk-chip.Scheduled { color: #2f5fd0; background: #e1ebff; }
.tk-tag { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 9px; font-size: 12.5px; font-weight: 600; color: #4a3fd6; background: #ebe9ff; white-space: nowrap; }

.tk-ico { flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; }

/* ---------- Running ---------- */
.tk-picks { display: flex; gap: 14px; margin-bottom: 22px; overflow-x: auto; padding-bottom: 4px; }
.tk-pick {
  min-width: 270px; flex: 1; text-align: left; cursor: pointer; font-family: inherit;
  padding: 16px 18px; border-radius: 18px; color: #14123a;
  background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%);
  border: 2px solid transparent; box-shadow: 0 10px 30px rgba(60,40,200,.22);
  transition: border-color .2s, transform .2s;
}
.tk-pick:hover { transform: translateY(-2px); }
.tk-pick.sel { border-color: #8b7bff; }
.tk-pick-title { font-weight: 700; font-size: 14.5px; margin-bottom: 4px; }
.tk-pick-meta { font-size: 12.5px; color: #6d6b95; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tk-stack { display: flex; }
.tk-stack .tk-ico { border: 2px solid #f6f6fe; margin-left: -8px; }
.tk-stack .tk-ico:first-child { margin-left: 0; }

.tk-run { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 22px; align-items: start; }
.tk-col { display: flex; flex-direction: column; gap: 22px; min-width: 0; }

/* Stage */
.tk-stage {
  position: relative; height: 400px; border-radius: 18px; overflow: hidden;
  background-color: #f4f4fd; background-image: radial-gradient(#cfcdf0 1.2px, transparent 1.2px); background-size: 22px 22px;
  border: 1px solid #e3e3f6;
}
.tk-lines { position: absolute; inset: 0; width: 100%; height: 100%; }

/* idle links flow slowly outward from the hub */
.tk-hub { stroke: #c4bfff; stroke-width: 1.5; stroke-dasharray: 5 6; fill: none; animation: tk-flow 1.4s linear infinite; transition: stroke .3s; }
.tk-hub.hot { stroke: #8b7bff; stroke-width: 2; }
@keyframes tk-flow { to { stroke-dashoffset: -11; } }

/* active link draws itself from sender to receiver, in step with the packet */
.tk-draw { fill: none; stroke-linecap: round; stroke-dasharray: var(--len) var(--len); animation: tk-draw 1.9s cubic-bezier(.42, 0, .58, 1) forwards; }
@keyframes tk-draw { from { stroke-dashoffset: var(--len); } to { stroke-dashoffset: 0; } }

/* the packet rides the same path as the line */
.tk-packet {
  position: absolute; left: 0; top: 0; z-index: 1; width: 16px; height: 16px; border-radius: 50%; pointer-events: none;
  offset-rotate: 0deg;
  background: radial-gradient(circle at 35% 30%, #fff 0 30%, var(--c1) 72%, var(--c2));
  box-shadow: 0 0 0 3px rgba(255,255,255,.75), 0 0 16px 5px color-mix(in srgb, var(--c1) 60%, transparent);
  animation: tk-travel 1.9s cubic-bezier(.42, 0, .58, 1) forwards, tk-vanish .3s ease 1.9s forwards;
}
.tk-packet::after { content: ''; position: absolute; inset: -9px; border-radius: 50%; border: 2px solid var(--c1); opacity: .6; animation: tk-halo 1s ease-out infinite; }
@keyframes tk-travel { from { offset-distance: 0%; } to { offset-distance: 100%; } }
@keyframes tk-vanish { to { opacity: 0; transform: scale(.3); } }
@keyframes tk-halo { from { transform: scale(.6); opacity: .7; } to { transform: scale(1.5); opacity: 0; } }
@keyframes tk-fade { from { opacity: 0; } to { opacity: 1; } }

/* Agent nodes (clickable) */
.tk-node {
  position: absolute; z-index: 2; cursor: pointer; user-select: none; outline: none;
  left: calc(50% + var(--dx) * 1%); top: calc(50% + var(--dy) * 1%); transform: translate(-50%, -50%);
  display: flex; align-items: center; gap: 10px; padding: 9px 16px 9px 9px;
  background: #fff; border: 1.5px solid #e6e6f7; border-radius: 16px;
  box-shadow: 0 8px 24px rgba(60,40,200,.12);
  transition: box-shadow .3s, border-color .3s, transform .25s;
}
.tk-node:hover { transform: translate(-50%, calc(-50% - 3px)); border-color: var(--c1); box-shadow: 0 14px 30px rgba(60,40,200,.2); }
.tk-node:focus-visible { box-shadow: 0 0 0 3px var(--c1); }
.tk-node::before { content: ''; position: absolute; inset: -5px; border-radius: 21px; border: 2px solid var(--c1); opacity: 0; pointer-events: none; }
.tk-node.speaking { border-color: var(--c1); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c1) 22%, transparent), 0 10px 30px rgba(90,70,255,.3); }
.tk-node.speaking::before { animation: tk-ring 1.5s ease-out infinite; }
.tk-node.speaking .tk-ico { animation: tk-bob 1.1s ease-in-out infinite; }
.tk-node.listening { border-color: color-mix(in srgb, var(--c1) 55%, #fff); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c1) 14%, transparent), 0 8px 24px rgba(60,40,200,.12); }
.tk-node.listening::before { animation: tk-ring 1.1s ease-out 1.85s 2 both; }
@keyframes tk-ring { 0% { opacity: .75; transform: scale(1); } 100% { opacity: 0; transform: scale(1.16); } }
@keyframes tk-bob { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-2px) scale(1.07); } }

.tk-node-name { font-size: 13.5px; font-weight: 700; color: #14123a; white-space: nowrap; }
.tk-node-role { font-size: 11.5px; color: #6d6b95; white-space: nowrap; }
.tk-dot { position: absolute; top: -4px; right: -4px; width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; background: #b4b2d6; }
.tk-dot.Working { background: #35d49a; animation: tk-pulse 1.6s infinite; }
.tk-dot.Waiting { background: #ffb547; }
.tk-dot.Done { background: #7a6bff; }

/* small pill under a node that is sending or reading */
.tk-pill {
  position: absolute; left: 50%; bottom: -12px; transform: translateX(-50%); z-index: 1;
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 8px; border-radius: 999px;
  font-size: 10.5px; font-weight: 700; color: #fff; white-space: nowrap;
  background: linear-gradient(135deg, var(--c1), var(--c2)); box-shadow: 0 4px 12px color-mix(in srgb, var(--c2) 45%, transparent);
  animation: tk-pop .3s cubic-bezier(.2,.9,.3,1.3) both;
}
.tk-pill.read { animation-delay: 1.7s; }
@keyframes tk-pop { from { opacity: 0; transform: translateX(-50%) translateY(4px) scale(.85); } to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); } }
.tk-bars { display: inline-flex; align-items: center; gap: 2px; height: 10px; }
.tk-bars i { width: 2.5px; height: 10px; border-radius: 2px; background: #fff; animation: tk-eq .8s ease-in-out infinite; }
.tk-bars i:nth-child(2) { animation-delay: .15s; }
.tk-bars i:nth-child(3) { animation-delay: .3s; }
@keyframes tk-eq { 0%, 100% { transform: scaleY(.35); } 50% { transform: scaleY(1); } }

.tk-hint { position: absolute; left: 14px; bottom: 12px; z-index: 0; font-size: 11.5px; font-weight: 600; color: #8886ad; }

.tk-caption {
  margin-top: 14px; padding: 12px 16px; border-radius: 14px; font-size: 13.5px; line-height: 1.5;
  color: #e5e3ff; background: linear-gradient(135deg, #1c1858, #14113f);
  display: flex; gap: 12px; align-items: flex-start;
}
.tk-caption .tk-live { margin-top: 6px; }
.tk-caption b { color: #fff; }

.tk-feed { max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding-right: 6px; }
.tk-msg { display: flex; gap: 12px; animation: tk-fade .4s ease; }
.tk-msg-body { min-width: 0; }
.tk-msg-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12.5px; color: #6d6b95; margin-bottom: 5px; }
.tk-msg-head b { color: #14123a; font-size: 13px; }
.tk-msg-head .arr { color: #8f8ab8; }
.tk-bubble { padding: 11px 14px; border-radius: 4px 16px 16px 16px; background: #eeedfd; color: #2a2858; font-size: 13.5px; line-height: 1.55; }
.tk-typing { display: flex; align-items: center; gap: 12px; font-size: 12.5px; color: #6d6b95; }
.tk-dots { display: inline-flex; gap: 4px; padding: 11px 14px; border-radius: 4px 16px 16px 16px; background: #eeedfd; }
.tk-dots i { width: 6px; height: 6px; border-radius: 50%; background: #8b7bff; animation: tk-bounce 1.2s infinite; }
.tk-dots i:nth-child(2) { animation-delay: .15s; }
.tk-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes tk-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }

.tk-agents { display: flex; flex-direction: column; gap: 4px; }
.tk-arow { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 14px; transition: background .3s; }
.tk-arow.on { background: #eceafe; }
.tk-arow-text { flex: 1; min-width: 0; }
.tk-arow-name { font-size: 14px; font-weight: 700; color: #14123a; }
.tk-arow-doing { font-size: 12px; color: #6d6b95; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.tk-log { max-height: 380px; overflow-y: auto; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12.5px; line-height: 1.55; padding-right: 6px; }
.tk-line { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 10px; align-items: start; padding: 7px 0; border-bottom: 1px dashed rgba(255,255,255,.07); animation: tk-fade .4s ease; }
.tk-time { color: #8886c0; }
.tk-lv { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 6px; font-size: 10.5px; font-weight: 500; letter-spacing: .04em; }
.tk-lv.info { color: #9fb0ff; background: rgba(159,176,255,.14); }
.tk-lv.success { color: #62d6a4; background: rgba(98,214,164,.14); }
.tk-lv.warn { color: #ffc25a; background: rgba(255,194,90,.14); }
.tk-lv.error { color: #ff8a9f; background: rgba(255,138,159,.14); }
.tk-ltext { color: #d7d5ff; word-break: break-word; }
.tk-ltext b { font-weight: 500; margin-right: 6px; }

.tk-feed::-webkit-scrollbar, .tk-log::-webkit-scrollbar, .tk-picks::-webkit-scrollbar, .tk-tabs::-webkit-scrollbar, .tk-mbody::-webkit-scrollbar { width: 6px; height: 6px; }
.tk-feed::-webkit-scrollbar-thumb, .tk-picks::-webkit-scrollbar-thumb { background: #cfcdf0; border-radius: 6px; }
.tk-log::-webkit-scrollbar-thumb, .tk-tabs::-webkit-scrollbar-thumb, .tk-mbody::-webkit-scrollbar-thumb { background: rgba(255,255,255,.2); border-radius: 6px; }
.tk-tabs::-webkit-scrollbar-thumb { background: #d6d5ee; }

/* ---------- Agent popup ---------- */
.tk-mbg {
  position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(8,6,32,.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif; animation: tk-fade .2s ease;
}
.tk-mbg, .tk-mbg * { box-sizing: border-box; }
.tk-modal {
  position: relative; width: min(580px, 100%); max-height: min(80vh, 640px); display: flex; flex-direction: column;
  border-radius: 24px; overflow: hidden; color: #d7d5ff;
  background:
    radial-gradient(120% 70% at 0% 0%, color-mix(in srgb, var(--c1) 24%, transparent), transparent 60%),
    linear-gradient(180deg, #14113f 0%, #0c0a2b 100%);
  border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 30px 80px rgba(8,4,60,.6), 0 0 60px color-mix(in srgb, var(--c2) 28%, transparent);
  animation: tk-modal-in .3s cubic-bezier(.2,.9,.3,1.15);
}
@keyframes tk-modal-in { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
.tk-modal::before {
  content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background-image: linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
  background-size: 26px 26px; -webkit-mask-image: linear-gradient(180deg, #000, transparent 55%); mask-image: linear-gradient(180deg, #000, transparent 55%);
}
.tk-modal > :not(.tk-x) { position: relative; z-index: 1; }
.tk-x {
  position: absolute; top: 16px; right: 16px; z-index: 2; width: 32px; height: 32px; border-radius: 10px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; color: #cfcdf5;
  background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); transition: background .2s, color .2s;
}
.tk-x:hover { background: rgba(255,255,255,.18); color: #fff; }

.tk-mh { display: flex; align-items: center; gap: 18px; padding: 24px 64px 18px 24px; flex-shrink: 0; }
.tk-m-ico { position: relative; flex-shrink: 0; }
.tk-m-ico::before { content: ''; position: absolute; inset: -12px; border-radius: 50%; background: radial-gradient(circle, var(--c1), transparent 70%); opacity: .45; animation: tk-aura 2.4s ease-in-out infinite; }
.tk-m-ico > .tk-ico { position: relative; }
@keyframes tk-aura { 0%, 100% { transform: scale(.9); opacity: .3; } 50% { transform: scale(1.15); opacity: .6; } }
.tk-m-eyebrow { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; color: #9b99cf; margin-bottom: 3px; }
.tk-m-name { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 22px; color: #fff; }
.tk-m-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
.tk-m-role { font-size: 13px; color: #b3b1e6; }
.tk-scan { height: 2px; flex-shrink: 0; background: linear-gradient(90deg, transparent, var(--c1), var(--c2), transparent); background-size: 200% 100%; animation: tk-sweep 2.4s linear infinite; }
@keyframes tk-sweep { from { background-position: 200% 0; } to { background-position: -200% 0; } }

.tk-mtabs { display: flex; gap: 6px; margin: 16px 24px 0; padding: 4px; border-radius: 14px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.08); flex-shrink: 0; }
.tk-mtab {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 9px 12px; border-radius: 10px; border: none; cursor: pointer;
  font-family: inherit; font-size: 13.5px; font-weight: 600; color: #b3b1e6; background: none; transition: color .2s, background .2s;
}
.tk-mtab:hover { color: #fff; }
.tk-mtab.on { color: #fff; background: linear-gradient(135deg, var(--c1), var(--c2)); box-shadow: 0 6px 16px color-mix(in srgb, var(--c2) 45%, transparent); }
.tk-mtab .n { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 9px; background: rgba(255,255,255,.18); }

.tk-mbody { padding: 18px 24px 24px; overflow-y: auto; min-height: 0; flex: 1; }
.tk-mlabel { margin: 20px 0 8px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; font-weight: 500; color: #9b99cf; }
.tk-mlabel.first { margin-top: 0; }
.tk-mabout { margin: 0; font-size: 14px; line-height: 1.7; color: #e0defa; }
.tk-now { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); font-size: 13.5px; color: #fff; }
.tk-nowdot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; background: #b4b2d6; }
.tk-nowdot.Working { background: #35d49a; animation: tk-pulse 1.6s infinite; }
.tk-nowdot.Waiting { background: #ffb547; }
.tk-nowdot.Done { background: #7a6bff; }
.tk-mstats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.tk-ms { padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); }
.tk-ms-v { font-family: 'Sora', sans-serif; font-weight: 700; font-size: 21px; color: #fff; }
.tk-ms-l { margin-top: 2px; font-size: 12px; color: #b3b1e6; }
.tk-mq { padding: 12px 14px; border-radius: 4px 14px 14px 14px; background: rgba(255,255,255,.07); border-left: 3px solid var(--c1); font-size: 13.5px; line-height: 1.6; color: #e5e3ff; }
.tk-mq b { display: block; margin-bottom: 4px; font-size: 12px; color: var(--c1); }
.tk-mchips { display: flex; flex-wrap: wrap; gap: 8px; }
.tk-mchip { padding: 6px 12px; border-radius: 10px; font-size: 12.5px; font-weight: 600; color: #e5e3ff; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); }
.tk-mchip.mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 400; color: #fff; border-color: color-mix(in srgb, var(--c1) 55%, transparent); background: color-mix(in srgb, var(--c1) 14%, transparent); }
.tk-empty { padding: 28px 0; text-align: center; font-size: 13.5px; color: #b3b1e6; }

/* ---------- Completed ---------- */
.tk-comp { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 22px; align-items: start; }
.tk-picklist {
  display: flex; flex-direction: column; gap: 14px;
  max-height: calc(7 * 150px + 6 * 14px + 20px);  /* exactly 7 cards, then scroll */
  overflow-y: auto;
  background: transparent;
  padding: 6px 14px 14px 6px;
  margin: -6px -14px -14px -6px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.tk-picklist::-webkit-scrollbar { display: none; }

.tk-picklist .tk-pick {
  width: 100%;
  height: 150px;          /* fixed size for every card */
  min-width: 0;
  flex: none;
  overflow: hidden;
  box-shadow: 0 4px 14px rgba(60,40,200,.10);
}
.tk-picklist .tk-pick-title {   /* long titles stop at 2 lines */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tk-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 22px; }
.tk-stat { padding: 14px 16px; border-radius: 16px; background: #fff; border: 1px solid #ececf8; }
.tk-stat-l { font-size: 12px; color: #6d6b95; font-weight: 600; }
.tk-stat-v { margin-top: 4px; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 20px; color: #14123a; }

.tk-h3 { margin: 0 0 12px; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 15px; color: #14123a; }
.tk-summary { margin: 0 0 16px; font-size: 14px; line-height: 1.7; color: #3a3865; }
.tk-outcomes { list-style: none; margin: 0 0 24px; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.tk-outcomes li { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; color: #2a2858; font-weight: 500; }
.tk-outcomes svg { color: #1f9e68; flex-shrink: 0; margin-top: 1px; }

.tk-contrib { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.tk-cc { display: flex; gap: 14px; padding: 16px; border-radius: 16px; background: #fff; border: 1px solid #ececf8; }
.tk-cc-name { font-size: 14.5px; font-weight: 700; color: #14123a; }
.tk-cc-role { font-size: 12px; color: #6d6b95; margin-bottom: 8px; }
.tk-cc-did { font-size: 13.5px; line-height: 1.55; color: #3a3865; margin-bottom: 10px; }

.tk-filters { display: flex; gap: 6px; flex-wrap: wrap; }
.tk-fbtn { padding: 6px 13px; border-radius: 999px; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 600; color: #b3b1e6; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); }
.tk-fbtn.on { color: #fff; background: #5d4cf7; border-color: #5d4cf7; }

/* ---------- Upcoming ---------- */
.tk-up { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
.tk-up-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.tk-up-title { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 17px; color: #14123a; }
.tk-when { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 13.5px; font-weight: 600; color: #4a3fd6; }
.tk-label { font-size: 11.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #6d6b95; margin: 18px 0 10px; }
.tk-agent-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.tk-achip { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px 5px 5px; border-radius: 12px; background: #fff; border: 1px solid #ececf8; font-size: 13px; font-weight: 600; color: #14123a; }
.tk-expect { display: flex; gap: 12px; padding: 14px 16px; border-radius: 16px; background: linear-gradient(135deg, #efedff, #e6e3ff); border: 1px solid #dcd8ff; font-size: 13.5px; line-height: 1.6; color: #2a2858; }
.tk-expect svg { color: #5d4cf7; flex-shrink: 0; margin-top: 2px; }
.tk-up-foot { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-top: 18px; padding-top: 14px; border-top: 1px solid #ececf8; font-size: 13px; color: #6d6b95; }
.tk-up-foot span { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; }

/* ---------- Responsive ---------- */
@media (max-width: 1279px) { .tk-run { grid-template-columns: 1fr; } }
@media (max-width: 1099px) {
  .tk-comp { grid-template-columns: 1fr; }
  .tk-picklist { flex-direction: row; overflow-x: auto; overflow-y: hidden; max-height: none; margin: 0; padding: 0 0 4px; }
  .tk-picklist .tk-pick { min-width: 250px; width: auto; }
}
@media (max-width: 899px) { .tk-up { grid-template-columns: 1fr; } .tk-contrib { grid-template-columns: 1fr; } }
@media (max-width: 767px) {
  .tk { margin-left: 0; padding: 88px 16px 40px; }
  .tk-title { font-size: 24px; }
  .tk-panel, .tk-term { padding: 18px 16px; border-radius: 20px; }
  .tk-stage { height: 370px; }
  .tk-node { flex-direction: column; width: 88px; padding: 9px 6px 8px; gap: 5px; text-align: center; }
  .tk-node-role { display: none; }
  .tk-node-name { font-size: 12px; }
  .tk-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tk-tab { padding: 12px 14px; font-size: 14px; }
  .tk-mbg { padding: 12px; }
  .tk-mh { padding: 20px 56px 14px 18px; gap: 14px; }
  .tk-mtabs { margin: 14px 18px 0; }
  .tk-mbody { padding: 16px 18px 20px; }
  .tk-mstats { gap: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .tk-hub, .tk-packet::after, .tk-node::before, .tk-node .tk-ico, .tk-m-ico::before, .tk-scan { animation: none !important; }
}
`;

/* ----------------------------- Helpers --------------------------------- */

function AgentIcon({ id, size = 38 }: { id: string; size?: number }) {
  const a = AGENTS[resolveAgent(id)];
  const Icon = a.icon;
  return (
    <div
      className="tk-ico"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: `linear-gradient(135deg, ${a.from}, ${a.to})`,
        boxShadow: `0 6px 14px ${a.to}55`,
      }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </div>
  );
}
function AgentStack({ ids }: { ids: string[] }) {
  const uniq = [...new Set(ids.map(resolveAgent))];
  return (
    <div className="tk-stack">
      {uniq.map((id) => <AgentIcon key={id} id={id} size={28} />)}
    </div>
  );
}

const fmt = (s: number) => {
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(sec)}`;
};
const fmtTs = (ts: number) => fmt(new Date(ts * 1000).getHours() * 3600 + new Date(ts * 1000).getMinutes() * 60 + new Date(ts * 1000).getSeconds());

function layout(ids: AgentId[]) {
  const pos = {} as Record<AgentId, { x: number; y: number }>;
  pos[ids[0]] = { x: 50, y: 50 };
  const n = ids.length - 1;
  ids.slice(1).forEach((id, i) => {
    const a = ((-90 + (360 * i) / n) * Math.PI) / 180;
    pos[id] = {
      x: +(50 + 32 * Math.cos(a)).toFixed(1),
      y: +(50 + 32 * Math.sin(a)).toFixed(1),
    };
  });
  return pos;
}

const LV_LABEL: Record<Level, string> = { info: "INFO", success: "OK", warn: "WARN", error: "ERR" };

/* ----------------------------- Agent popup ----------------------------- */

function AgentModal({
  id,
  task,
  items,
  status,
  onClose,
}: {
  id: AgentId;
  task: RunningTask;
  items: Item[];
  status: AgentState;
  onClose: () => void;
}) {
  const ag = AGENTS[id];
  const [tab, setTab] = useState<"about" | "logs">("about");
  const logRef = useRef<HTMLDivElement>(null);

  const mine = items.filter((m) => m.from === id); // only this agent's own log lines
  const logs = mine.slice(-40);
  const received = items.filter((m) => m.to === id).length;
  const partners = new Set(
    items.filter((m) => m.from === id || m.to === id).map((m) => (m.from === id ? m.to : m.from))
  ).size;
  const last = mine[mine.length - 1];
  const isHub = task.agents[0] === id;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab === "logs") logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [tab, logs.length]);

  return createPortal(
    <div
      className="tk-mbg"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="tk-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${ag.name} agent`}
        style={{ "--c1": ag.from, "--c2": ag.to } as CSSProperties}
      >
        <button className="tk-x" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>

        <div className="tk-mh">
          <div className="tk-m-ico">
            <AgentIcon id={id} size={60} />
          </div>
          <div>
            <div className="tk-m-eyebrow">{isHub ? "coordinator agent" : "specialist agent"}</div>
            <h3 className="tk-m-name">{ag.name}</h3>
            <div className="tk-m-meta">
              <span className={`tk-chip ${status.status}`}>{status.status}</span>
              <span className="tk-m-role">{ag.role}</span>
            </div>
          </div>
        </div>
        <div className="tk-scan" />

        <div className="tk-mtabs">
          <button className={`tk-mtab ${tab === "about" ? "on" : ""}`} onClick={() => setTab("about")}>
            Description
          </button>
          <button className={`tk-mtab ${tab === "logs" ? "on" : ""}`} onClick={() => setTab("logs")}>
            Logs
            <span className="n">{mine.length}</span>
          </button>
        </div>

        <div className="tk-mbody">
          {tab === "about" ? (
            <>
              <div className="tk-mlabel first">about</div>
              <p className="tk-mabout">{ag.about}</p>

              <div className="tk-mlabel">right now</div>
              <div className="tk-now">
                <span className={`tk-nowdot ${status.status}`} />
                {status.doing}
              </div>

              <div className="tk-mlabel">in this task</div>
              <div className="tk-mstats">
                <div className="tk-ms">
                  <div className="tk-ms-v">{mine.length}</div>
                  <div className="tk-ms-l">Messages sent</div>
                </div>
                <div className="tk-ms">
                  <div className="tk-ms-v">{received}</div>
                  <div className="tk-ms-l">Messages received</div>
                </div>
                <div className="tk-ms">
                  <div className="tk-ms-v">{partners}</div>
                  <div className="tk-ms-l">Agents worked with</div>
                </div>
              </div>

              {last && (
                <>
                  <div className="tk-mlabel">latest message</div>
                  <div className="tk-mq">
                    <b>to {AGENTS[last.to].name}</b>
                    {last.text}
                  </div>
                </>
              )}

              <div className="tk-mlabel">capabilities</div>
              <div className="tk-mchips">
                {ag.skills.map((s) => (
                  <span className="tk-mchip" key={s}>{s}</span>
                ))}
              </div>

              <div className="tk-mlabel">tools</div>
              <div className="tk-mchips">
                {ag.tools.map((t) => (
                  <span className="tk-mchip mono" key={t}>{t}</span>
                ))}
              </div>
            </>
          ) : logs.length === 0 ? (
            <div className="tk-empty">{ag.name} has not logged anything yet.</div>
          ) : (
            <div className="tk-log" ref={logRef} style={{ maxHeight: 340 }}>
              {logs.map((m) => (
                <div className="tk-line" key={m.i}>
                  <span className="tk-time">{fmtTs(m.ts)}</span>
                  <span className={`tk-lv ${m.level}`}>{LV_LABEL[m.level]}</span>
                  <span className="tk-ltext">
                    <b style={{ color: ag.from }}>to {AGENTS[m.to].name}</b>
                    {m.log}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ----------------------------- Running view ---------------------------- */

function RunningView({ summary }: { summary: RunningSummary }) {
  const live = useTaskStream(summary.id);
  const [openId, setOpenId] = useState<AgentId | null>(null);
  const [box, setBox] = useState({ w: 700, h: 400 });
  const feedRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Measure the stage so lines and the packet use real pixel coordinates.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const items: Item[] = live.messages.map((m, i) => ({
  from: resolveAgent(m.from), to: resolveAgent(m.to),
  text: m.text, level: m.level ?? "info", log: m.log ?? m.text, i,
  ts: m.ts ?? Date.now() / 1000,
}));
  const step = items.length;

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [step]);

  const agentIds = useMemo(() => {
    const ids: AgentId[] = ["planner"];
    const add = (a?: string) => { if (!a) return; const r = resolveAgent(a); if (!ids.includes(r)) ids.push(r); };
    summary.agents.forEach(add);
    live.steps.forEach((s) => add(s.agent));
    Object.keys(live.agents).forEach(add);
    items.forEach((m) => { add(m.from); add(m.to); });
    return ids;
  }, [summary.agents, live.steps, live.agents, items.length]);



  const progress =
    live.status === "completed" ? 100
    : live.steps.length ? Math.min(98, Math.round((live.done / live.steps.length) * 100))
    : summary.progress;

  const task: RunningTask = {
    id: summary.id, title: live.title || summary.title, started: summary.started,
    baseProgress: progress, agents: agentIds, state: live.agents as RunningTask["state"],
  };

  if (!items.length) {
    return (
      <section className="tk-panel">
        <h2 className="tk-pt"><span className="tk-live" />{task.title}</h2>
        <p className="tk-pd">
          {live.status === "running" ? "Waiting for the agents to start…" : `Task ${live.status}`}
        </p>
      </section>
    );
  }

  const len = items.length;
  const feed = items.slice(-24);
  const logs = items.slice(-40);
  const cur = items[len - 1];
  const next = { from: cur.to };           // the agent that just received a message is up next
  const pos = layout(task.agents);

  const statusOf = (id: AgentId): AgentState => {
    if (live.status === "running") {
      if (id === cur.from)
        return { status: "Working", doing: `Sending an update to ${AGENTS[cur.to].name}` };
      if (id === cur.to)
        return { status: "Working", doing: `Reading ${AGENTS[cur.from].name}'s message` };
    }
    return task.state[id] ?? { status: "Idle", doing: "Standing by" };
  };

  const px = (p: { x: number; y: number }) => ({ x: (p.x / 100) * box.w, y: (p.y / 100) * box.h });
  const H = px(pos[task.agents[0]]);
  const A = px(pos[cur.from]);
  const B = px(pos[cur.to]);
  const dist = Math.hypot(B.x - A.x, B.y - A.y);
  const fromA = AGENTS[cur.from];
  const toA = AGENTS[cur.to];

  return (
    <div className="tk-run">
      {/* Left: collaboration + conversation */}
      <div className="tk-col">
        <section className="tk-panel">
          <div className="tk-ph">
            <div>
              <h2 className="tk-pt">
                <span className="tk-live" />
                {task.title}
              </h2>
              <p className="tk-pd">
                Started at {task.started} · {task.agents.length} agents collaborating · {progress}% complete
              </p>
            </div>
            <span className="tk-chip Working">{live.status === "running" ? "Running" : live.status}</span>
          </div>

          <div className="tk-stage" ref={stageRef}>
            <svg className="tk-lines" viewBox={`0 0 ${box.w} ${box.h}`}>
              <defs>
                <linearGradient id="tk-grad" gradientUnits="userSpaceOnUse" x1={A.x} y1={A.y} x2={B.x} y2={B.y}>
                  <stop offset="0" stopColor={fromA.from} />
                  <stop offset="1" stopColor={toA.to} />
                </linearGradient>
                <filter id="tk-blur" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" />
                </filter>
              </defs>

              {task.agents.slice(1).map((id) => {
                const P = px(pos[id]);
                return (
                  <line
                    key={id}
                    className={`tk-hub ${id === cur.from || id === cur.to ? "hot" : ""}`}
                    x1={H.x}
                    y1={H.y}
                    x2={P.x}
                    y2={P.y}
                  />
                );
              })}

              <g key={step} style={{ "--len": dist } as CSSProperties}>
                <line className="tk-draw" x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="url(#tk-grad)" strokeWidth={10} opacity={0.35} filter="url(#tk-blur)" />
                <line className="tk-draw" x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="url(#tk-grad)" strokeWidth={3.5} />
              </g>
            </svg>

            {task.agents.map((id) => {
              const ag = AGENTS[id];
              const p = pos[id];
              const st = statusOf(id).status;
              const speaking = id === cur.from;
              const listening = id === cur.to;
              return (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${ag.name} details`}
                  className={`tk-node ${speaking ? "speaking" : listening ? "listening" : ""}`}
                  style={{ "--dx": p.x - 50, "--dy": p.y - 50, "--c1": ag.from, "--c2": ag.to } as CSSProperties}
                  onClick={() => setOpenId(id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenId(id);
                    }
                  }}
                >
                  <AgentIcon id={id} />
                  <div>
                    <div className="tk-node-name">{ag.name}</div>
                    <div className="tk-node-role">{ag.role}</div>
                  </div>
                  <span className={`tk-dot ${st}`} />
                  {(speaking || listening) && (
                    <span key={`${step}-${id}`} className={`tk-pill ${speaking ? "send" : "read"}`}>
                      <span className="tk-bars">
                        <i />
                        <i />
                        <i />
                      </span>
                      {speaking ? "Sending" : "Reading"}
                    </span>
                  )}
                </div>
              );
            })}

            <span
              key={`p${step}`}
              className="tk-packet"
              style={
                {
                  offsetPath: `path("M ${A.x} ${A.y} L ${B.x} ${B.y}")`,
                  "--c1": fromA.from,
                  "--c2": fromA.to,
                } as CSSProperties
              }
            />

            <div className="tk-hint">Click an agent to see details</div>
          </div>

          <div className="tk-caption">
            <span className="tk-live" />
            <div>
              <b>{fromA.name}</b> to <b>{toA.name}</b>: {cur.text}
            </div>
          </div>
        </section>

        <section className="tk-panel">
          <div className="tk-ph">
            <div>
              <h2 className="tk-pt">Agent Conversation</h2>
              <p className="tk-pd">Agents handing work and feedback to each other in real time</p>
            </div>
          </div>
          <div className="tk-feed" ref={feedRef}>
            {feed.map((m) => (
              <div className="tk-msg" key={m.i}>
                <AgentIcon id={m.from} size={36} />
                <div className="tk-msg-body">
                  <div className="tk-msg-head">
                    <b>{AGENTS[m.from].name}</b>
                    <span className="arr">to</span>
                    <b>{AGENTS[m.to].name}</b>
                    <span>· {fmtTs(m.ts)}</span>
                  </div>
                  <div className="tk-bubble">{m.text}</div>
                </div>
              </div>
            ))}
            {live.status === "running" && (
              <div className="tk-typing">
                <AgentIcon id={next.from} size={36} />
                <div>
                  {AGENTS[next.from].name} is working
                  <div className="tk-dots" style={{ marginTop: 5 }}>
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Right: status + logs */}
      <div className="tk-col">
        <section className="tk-panel">
          <div className="tk-ph">
            <div>
              <h2 className="tk-pt">Agent Status</h2>
              <p className="tk-pd">What each agent is doing right now</p>
            </div>
          </div>
          <div className="tk-agents">
            {task.agents.map((id) => {
              const s = statusOf(id);
              return (
                <div key={id} className={`tk-arow ${id === cur.from ? "on" : ""}`}>
                  <AgentIcon id={id} size={36} />
                  <div className="tk-arow-text">
                    <div className="tk-arow-name">{AGENTS[id].name}</div>
                    <div className="tk-arow-doing">{s.doing}</div>
                  </div>
                  <span className={`tk-chip ${s.status}`}>{s.status}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="tk-term">
          <div className="tk-ph">
            <div>
              <h2 className="tk-pt">
                <span className="tk-live" />
                Live Logs
              </h2>
              <p className="tk-pd">Everything the agents are doing</p>
            </div>
          </div>
          <div className="tk-log" ref={logRef}>
            {logs.map((m) => (
              <div className="tk-line" key={m.i}>
                <span className="tk-time">{fmtTs(m.ts)}</span>
                <span className={`tk-lv ${m.level}`}>{LV_LABEL[m.level]}</span>
                <span className="tk-ltext">
                  <b style={{ color: AGENTS[m.from].from }}>{AGENTS[m.from].name}</b>
                  {m.log}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {openId && (
        <AgentModal
          id={openId}
          task={task}
          items={items}
          status={statusOf(openId)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

/* ---------------------------- Completed view --------------------------- */

type Filter = "all" | Level;

function CompletedView({ tasks, initialId }: { tasks: CompletedRecord[]; initialId?: string }) {
  const [sel, setSel] = useState(initialId ?? tasks[0]?.id ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const task = tasks.find((t) => t.id === sel) ?? tasks[0];
  if (!task) return <section className="tk-panel"><p className="tk-pd">No finished tasks yet.</p></section>;
  const logs = task.logs.filter((l) => filter === "all" || l.level === filter);

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "info", label: "Info" },
    { id: "success", label: "Success" },
    { id: "warn", label: "Warnings" },
  ];

  return (
    <div className="tk-comp">
      <div className="tk-picklist">
        {tasks.map((t) => (
          <button
            key={t.id}
            className={`tk-pick ${sel === t.id ? "sel" : ""}`}
            onClick={() => setSel(t.id)}
          >
            <div className="tk-pick-title">{t.title}</div>
            <div className="tk-pick-meta">
              <span>{t.finished}</span>
              <span className="tk-chip Completed">Completed</span>
            </div>
           <AgentStack ids={t.contributions.map((c) => c.agent)} />
          </button>
        ))}
      </div>

      <div className="tk-col">
        <section className="tk-panel">
          <div className="tk-ph">
            <div>
              <h2 className="tk-pt">{task.title}</h2>
              <p className="tk-pd">Finished {task.finished}</p>
            </div>
            <span className="tk-chip Completed">Completed</span>
          </div>

          <div className="tk-stats">
            <div className="tk-stat">
              <div className="tk-stat-l">Duration</div>
              <div className="tk-stat-v">{task.duration}</div>
            </div>
            <div className="tk-stat">
              <div className="tk-stat-l">Agents used</div>
              <div className="tk-stat-v">{task.contributions.length}</div>
            </div>
            <div className="tk-stat">
              <div className="tk-stat-l">Total steps</div>
              <div className="tk-stat-v">{task.steps}</div>
            </div>
            <div className="tk-stat">
              <div className="tk-stat-l">Success rate</div>
              <div className="tk-stat-v" style={{ color: "#1f9e68" }}>{task.success}</div>
            </div>
          </div>

          <h3 className="tk-h3">Task Summary</h3>
          <p className="tk-summary">{task.summary}</p>
          <ul className="tk-outcomes">
            {task.outcomes.map((o) => (
              <li key={o}>
                <CheckCircle2 size={18} />
                {o}
              </li>
            ))}
          </ul>

          <h3 className="tk-h3">What each agent did</h3>
          <div className="tk-contrib">
            {task.contributions.map((c) => (
              <div className="tk-cc" key={c.agent}>
                <AgentIcon id={c.agent} size={42} />
                <div>
                  <div className="tk-cc-name">{AGENTS[resolveAgent(c.agent)].name}</div>
                  <div className="tk-cc-role">{AGENTS[resolveAgent(c.agent)].role}</div>
                  <div className="tk-cc-did">{c.did}</div>
                  <span className="tk-tag">{c.actions} actions</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="tk-term">
          <div className="tk-ph">
            <div>
              <h2 className="tk-pt">Full Logs</h2>
              <p className="tk-pd">Complete record of this task, in order</p>
            </div>
            <div className="tk-filters">
              {filters.map((f) => (
                <button
                  key={f.id}
                  className={`tk-fbtn ${filter === f.id ? "on" : ""}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="tk-log" style={{ maxHeight: 420 }}>
            {logs.map((l, idx) => (
              <div className="tk-line" key={`${l.t}-${idx}`}>
                <span className="tk-time">{l.t}</span>
                <span className={`tk-lv ${l.level}`}>{LV_LABEL[l.level]}</span>
                <span className="tk-ltext">
                  <b style={{ color: AGENTS[resolveAgent(l.agent)].from }}>{AGENTS[resolveAgent(l.agent)].name}</b>
                  {l.text}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------------------------- Upcoming view ---------------------------- */

function UpcomingView() {
  return (
    <section className="tk-panel">
      <h2 className="tk-pt">No scheduled tasks</h2>
      <p className="tk-pd">Scheduled and recurring tasks will show up here once scheduling exists on the server.</p>
    </section>
  );
}

/* -------------------------------- Page --------------------------------- */

type Tab = "completed" | "running" | "upcoming";

export default function Tasks() {
  const wanted = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("task") : null;
  const [running, setRunning] = useState<RunningSummary[]>([]);
  const [completed, setCompleted] = useState<CompletedRecord[]>([]);
  const [tab, setTab] = useState<Tab>("running");
  const [runId, setRunId] = useState<string | undefined>(wanted ?? undefined);
  const picked = useRef(false);

  // poll the list (running tasks live in memory on the server, finished ones in Mongo)
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.tasks().then((d) => {
        if (!alive) return;
        setRunning(d.running);
        setCompleted(d.completed);
        if (!picked.current) {                    // choose the tab once, based on where ?task=<id> lives
          picked.current = true;
          if (wanted && d.completed.some((t) => t.id === wanted)) setTab("completed");
        }
      }).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [wanted]);

  const run = running.find((r) => r.id === runId) ?? running[0];

  const tabs: { id: Tab; label: string; count: number; live?: boolean }[] = [
    { id: "completed", label: "Completed", count: completed.length },
    { id: "running", label: "Running", count: running.length, live: true },
    { id: "upcoming", label: "Upcoming", count: 0 },
  ];

  return (
    <>
      <style>{css}</style>
      <Sidebar defaultActive="tasks" />

      <main className="tk">
        <h1 className="tk-title">Tasks</h1>
        <p className="tk-sub">Watch your agents work, review finished tasks and plan what runs next</p>

        <div className="tk-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`tk-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.live && <span className="tk-live" />}
              {t.label}
              <span className="tk-count">{t.count}</span>
            </button>
          ))}
        </div>

        {tab === "running" && (
          <>
            <div className="tk-picks">
              {running.map((r) => (
                <button
                  key={r.id}
                  className={`tk-pick ${runId === r.id ? "sel" : ""}`}
                  onClick={() => setRunId(r.id)}
                >
                  <div className="tk-pick-title">{r.title}</div>
                  <div className="tk-pick-meta">
                    <AgentStack ids={r.agents as AgentId[]} />
                    <span>{r.progress}%</span>
                  </div>
                  <div className="tk-bar">
                    <i style={{ width: `${r.progress}%` }} />
                  </div>
                </button>
              ))}
            </div>
            {run ? (
              <RunningView key={run.id} summary={run} />
            ) : (
              <section className="tk-panel">
                <p className="tk-pd">No tasks are running right now.</p>
              </section>
            )}
          </>
        )}

        {tab === "completed" && <CompletedView tasks={completed} initialId={wanted ?? undefined} />}
        {tab === "upcoming" && <UpcomingView />}
      </main>
    </>
  );
}