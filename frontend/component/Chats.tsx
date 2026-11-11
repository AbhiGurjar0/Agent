"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Workflow,
  Search,
  Database,
  FileText,
  Code,
  ShieldCheck,
  Mail,
  TrendingUp,
  Plus,
  MessagesSquare,
  ImagePlus,
  Mic,
  MicOff,
  ArrowUp,
  ArrowLeft,
  ArrowUpRight,
  X,
  Check,
  ChevronDown,
  CheckCircle2,
  Info,
  Shuffle,
  Zap,
  Gauge,
  Brain,
  ListChecks,
  ClipboardCheck,
  Briefcase,
} from "lucide-react";
import Sidebar from "./Sidebar";
import { api, API } from "../lib/api";
import { subscribeTask, type TaskEvent } from "../hooks/useTaskStream";
import { render as renderMd } from "../utils/formatter";

/* ------------------------------ Types ---------------------------------- */

type IconC = ComponentType<{ size?: number; strokeWidth?: number }>;
type AgentId =
  | "planner"
  | "research"
  | "data"
  | "analyst"
  | "writer"
  | "builder"
  | "reviewer"
  | "mailer";
type ModelId = "haiku" | "sonnet" | "opus";

type Agent = {
  id: AgentId;
  name: string;
  role: string;
  icon: IconC;
  from: string;
  to: string;
};

const AGENTS: Record<AgentId, Agent> = {
  planner: {
    id: "planner",
    name: "Planner",
    role: "Coordinates work",
    icon: Workflow,
    from: "#8b7bff",
    to: "#5d4cf7",
  },
  research: {
    id: "research",
    name: "Research",
    role: "Finds sources",
    icon: Search,
    from: "#5c9bff",
    to: "#3b6df0",
  },
  data: {
    id: "data",
    name: "Data",
    role: "Handles records",
    icon: Database,
    from: "#4fd8e6",
    to: "#22a8c4",
  },
  analyst: {
    id: "analyst",
    name: "Analyst",
    role: "Finds insights",
    icon: TrendingUp,
    from: "#ffc25a",
    to: "#f59e0b",
  },
  writer: {
    id: "writer",
    name: "Writer",
    role: "Writes content",
    icon: FileText,
    from: "#ff8ab4",
    to: "#ec4899",
  },
  builder: {
    id: "builder",
    name: "Builder",
    role: "Builds workflows",
    icon: Code,
    from: "#b07bff",
    to: "#7a4df0",
  },
  reviewer: {
    id: "reviewer",
    name: "Reviewer",
    role: "Checks quality",
    icon: ShieldCheck,
    from: "#62d6a4",
    to: "#3dbb87",
  },
  mailer: {
    id: "mailer",
    name: "Mailer",
    role: "Sends emails",
    icon: Mail,
    from: "#ff9a62",
    to: "#f0642a",
  },
};

const MODELS: { id: ModelId; name: string; desc: string; icon: IconC }[] = [
  {
    id: "haiku",
    name: "Claude Haiku 5.5",
    desc: "Fastest, great for quick tasks",
    icon: Zap,
  },
  {
    id: "sonnet",
    name: "Claude Sonnet 5.5",
    desc: "Balanced speed and quality",
    icon: Gauge,
  },
  {
    id: "opus",
    name: "Claude Opus 5.5",
    desc: "Most capable, for complex work",
    icon: Brain,
  },
];

type TaskStatus = "running" | "completed" | "cancelled";
type TaskView = "mini" | "open" | "hidden";
type ChatTask = {
  id: string; // id used to open this task on the Tasks page
  name: string;
  steps: string[]; // the major steps shown on the progress line
  step: number; // index of the current step
  sub: number; // 0-100 progress inside the current step
  speed: number; // demo speed
  status: TaskStatus;
};

type ChatMsg = {
  id: string;
  role: "user" | "agent";
  agent?: AgentId;
  text: string;
  time: string;
  images?: string[];
  action?: { label: string; href: string };
};

type Chat = {
  id: string;
  title: string;
  agent: AgentId;
  time: string;
  unread: number;
  messages: ChatMsg[];
  tasks: ChatTask[]; // every task started from this chat
  remote?: boolean;
  ts?: number;
  preview?: string;
  hasJob?: boolean;
  hasTask?: boolean;
};

type Toast = {
  id: string;
  kind: "success" | "info" | "queued";
  title: string;
  sub: string;
  taskId?: string;
  href?: string; // where the button goes
};
type Attachment = { id: string; url: string; name: string; data: string };

/* ------------------------------ Sample data ---------------------------- */

const am = (
  id: string,
  agent: AgentId,
  text: string,
  time: string,
  action?: ChatMsg["action"],
): ChatMsg => ({ id, role: "agent", agent, text, time, action });

const isDraft = (c: Chat) =>
  !c.remote &&
  c.messages.length === 0 &&
  c.tasks.length === 0 &&
  c.title === "New chat";

const chatKind = (c: Chat) => ({
  job: !!c.hasJob || c.messages.some((m) => !!m.action),
  task: !!c.hasTask || c.tasks.length > 0,
});

const stamp = (r: any) => {
  const t = Date.parse(r.updated_at ?? r.last_message_at ?? r.created_at ?? "");
  return isNaN(t) ? 0 : t;
};

const fmtListTime = (ts?: number) => {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

// for job messages loaded from history (no job id available there)
const jobHref = (text: string) =>
  /Jobs\s*(→|->)\s*Ready/i.test(text) ? "/jobs?tab=ready" : null;
const um = (
  id: string,
  text: string,
  time: string,
  images?: string[],
): ChatMsg => ({
  id,
  role: "user",
  text,
  time,
  images,
});

const toDataUrl = (file: File, max = 1280): Promise<string> =>
  new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d");
      URL.revokeObjectURL(src);
      if (!ctx) return reject(new Error("canvas"));
      ctx.fillStyle = "#fff"; // PNG transparency would turn black in JPEG
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error("bad image"));
    };
    img.src = src;
  });

const SUGGESTIONS = [
  "Generate this week's sales report",
  "Draft a welcome email series for new users",
  "Reconcile last month's invoices",
  "Write 3 headline ideas for our homepage",
];

/* ------------------------------ Helpers -------------------------------- */

const uid = () => Math.random().toString(36).slice(2, 9);
const blankChat = (): Chat => ({
  id: uid(),
  title: "New chat",
  agent: "planner",
  time: "Now",
  unread: 0,
  messages: [],
  tasks: [],
});
const fmtTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
const nowTime = () =>
  new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function pickAgent(text: string): AgentId {
  const t = text.toLowerCase();
  if (/(report|analy|insight|invoice|revenue|sales)/.test(t)) return "analyst";
  if (/(email|mail|newsletter|reply)/.test(t)) return "mailer";
  if (/(write|copy|headline|blog|draft|content)/.test(t)) return "writer";
  if (/(build|workflow|automat|deploy|code)/.test(t)) return "builder";
  if (/(research|find|compare|competitor)/.test(t)) return "research";
  if (/(data|crm|records|database|backup)/.test(t)) return "data";
  return "planner";
}

function Markdown({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) renderMd(text, ref.current); // also wires up the Copy buttons
  }, [text]);
  return <div ref={ref} />;
}

function stepsFor(agent: AgentId): string[] {
  switch (agent) {
    case "analyst":
    case "data":
      return ["Plan", "Collect data", "Analyse", "Review", "Deliver"];
    case "writer":
      return ["Plan", "Research", "Draft", "Review", "Publish"];
    case "builder":
      return ["Plan", "Build", "Test", "Review", "Deploy"];
    case "mailer":
      return ["Plan", "Draft", "Review", "Schedule", "Send"];
    default:
      return ["Plan", "Gather", "Execute", "Review", "Deliver"];
  }
}

function toTitle(text: string) {
  const cleaned = text
    .replace(
      /^(please|can you|could you|i want you to|i need you to|i want to|i need to)\s+/i,
      "",
    )
    .replace(/[.?!].*$/, "")
    .trim();
  const words = cleaned.split(/\s+/).slice(0, 5).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "New task";
}

function replyText(text: string, imgCount: number): string {
  const what = imgCount === 1 ? "image" : `${imgCount} images`;
  if (imgCount > 0 && !text)
    return `I can see the ${what} you shared. Tell me what you'd like me to do with ${imgCount === 1 ? "it" : "them"}.`;
  if (imgCount > 0)
    return `Thanks, I've looked at the ${what}. I'll use ${imgCount === 1 ? "it" : "them"} along with your request and get back to you shortly.`;
  return "Got it. I'll look into this. If you'd like me to run it as a tracked task, ask me to start or generate it and I'll show the progress right here.";
}

const taskPct = (t: ChatTask) =>
  t.status === "completed"
    ? 100
    : Math.min(
        100,
        Math.round(((t.step + t.sub / 100) / t.steps.length) * 100),
      );

const isRunning = (t: ChatTask) => t.status === "running";

/* ------------------------------- Styles -------------------------------- */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&family=Sora:wght@600;700&display=swap');

.ch, .ch * , .ch-toasts, .ch-toasts * { box-sizing: border-box; }
.ch {
  height: 100vh; height: 100dvh; margin-left: 280px;
  display: grid; grid-template-columns: 320px minmax(0, 1fr);
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #14123a;
  background: #FAFAFC;
}

.ch-ico { flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; position: relative; }

/* ---------- Chat list (light) ---------- */
.ch-list {
  display: flex; flex-direction: column; min-height: 0; overflow: hidden;
  background: #FFFFFF;
  border-right: 1px solid #ececf8;
}
.ch-list-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 14px; border-bottom: 1px solid #ececf8; }
.ch-list-title { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 20px; color: #14123a; }
.ch-list-sub { margin: 3px 0 0; font-size: 12.5px; color: #6d6b95; }
.ch-new {
  width: 42px; height: 42px; border-radius: 14px; border: none; cursor: pointer; color: #fff;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #9a8bff, #5d4cf7); box-shadow: 0 8px 20px rgba(109,92,255,.5);
  transition: transform .2s;
}
.ch-new:hover { transform: translateY(-2px); }
.ch-search {
  display: flex; align-items: center; gap: 8px; margin: 12px 14px; padding: 0 14px; height: 42px; border-radius: 14px;
  color: #7d7ba6; background: #f4f4fd; border: 1px solid #e3e3f6;
}
.ch-search:focus-within { border-color: #a99fff; background: #fff; }
.ch-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: #14123a; font-family: inherit; font-size: 14px; }
.ch-search input::placeholder { color: #8886ad; }
.ch-items { flex: 1; min-height: 0; overflow-y: auto; padding: 0 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.ch-item {
  display: flex; align-items: flex-start; gap: 12px; width: 100%; padding: 12px; text-align: left; cursor: pointer;
  font-family: inherit; color: #14123a; background: transparent; border: 1px solid transparent; border-radius: 16px;
  transition: background .2s, border-color .2s;
}
.ch-item:hover { background: #f6f6fe; }
.ch-item.on { background: #efeefd; border-color: #dcd8ff; }
.ch-item-body { flex: 1; min-width: 0; }
.ch-item-top, .ch-item-bot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ch-item-title { font-size: 14px; font-weight: 700; color: #14123a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch-item-time { font-size: 11.5px; color: #6d6b95; flex-shrink: 0; }
.ch-item-bot { margin-top: 3px; }
.ch-item-prev { font-size: 12.5px; color: #6d6b95; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch-badge {
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; color: #fff; background: linear-gradient(135deg, #8b7bff, #5d4cf7);
}
.ch-badge.neutral { color: #5b58a0; background: #e3e1fa; }
.ch-mini { margin-top: 9px; height: 4px; border-radius: 4px; background: #e4e3f7; overflow: hidden; }
.ch-mini i { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, #8b7bff, #3dbb87); transition: width .5s; }
.ch-pulse { position: absolute; right: -3px; top: -3px; width: 12px; height: 12px; border-radius: 50%; background: #35d49a; border: 2px solid #fff; animation: ch-pulse 1.6s infinite; }
.ch-empty-list { padding: 28px 12px; text-align: center; font-size: 13px; color: #6d6b95; }
@keyframes ch-pulse { 0% { box-shadow: 0 0 0 0 rgba(53,212,154,.7); } 70% { box-shadow: 0 0 0 8px rgba(53,212,154,0); } 100% { box-shadow: 0 0 0 0 rgba(53,212,154,0); } }

/* ---------- Main panel ---------- */
.ch-main {
  position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden;
  background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%);
}
.ch-main.voice {
  background: radial-gradient(700px 420px at 50% 42%, rgba(122,107,255,.38), transparent 65%), linear-gradient(180deg, #14113f, #0a0927);
  border-color: rgba(255,255,255,.12);
}

.ch-head { display: flex; align-items: center; gap: 14px; padding: 14px 20px; border-bottom: 1px solid #ececf8; }
.ch-listbtn {
  display: none; width: 40px; height: 40px; border-radius: 12px; cursor: pointer; color: #5b54a8;
  align-items: center; justify-content: center; background: #efeefd; border: 1px solid #e0defa;
}
.ch-head-title { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 16px; color: #14123a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch-head-sub { margin-top: 2px; display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #6d6b95; }
.ch-head-text { min-width: 0; }
.ch-dot { width: 8px; height: 8px; border-radius: 50%; background: #35d49a; animation: ch-pulse 1.6s infinite; flex-shrink: 0; }
.ch-tasksbtn {
  margin-left: auto; display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border-radius: 12px; cursor: pointer;
  font-family: inherit; font-size: 13px; font-weight: 700; color: #4a3fd6; background: #efeefd; border: 1px solid #dcd8ff; transition: background .2s;
}
.ch-tasksbtn:hover { background: #e3e0ff; }

/* ---------- Compact task bar + expandable list ---------- */
.ch-tbwrap { position: relative; z-index: 15; margin: 10px 20px 0; }
.ch-tbar, .ch-tcard { --fc: #6c5cff; }
.ch-tbar.completed, .ch-tcard.completed { --fc: #3dbb87; }
.ch-tbar.cancelled, .ch-tcard.cancelled { --fc: #e5486b; }
.ch-tbar {
  display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 5px 6px 5px 14px; border-radius: 14px;
  background: #fff; border: 1px solid #e3e3f6; box-shadow: 0 4px 14px rgba(60,40,200,.08);
}
.ch-tb-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--fc); }
.ch-tbar.running .ch-tb-dot { animation: ch-pulse 1.6s infinite; background: #35d49a; }
.ch-tb-name { font-size: 13px; font-weight: 700; color: #14123a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; flex-shrink: 1; }
.ch-tb-step { flex: 1; min-width: 0; font-size: 12px; color: #6d6b95; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch-tb-bar { width: 84px; height: 5px; border-radius: 5px; background: #e4e3f7; overflow: hidden; flex-shrink: 0; margin-left: auto; }
.ch-tb-bar i { display: block; height: 100%; border-radius: 5px; background: var(--fc); transition: width .5s; }
.ch-tb-pct { min-width: 34px; text-align: right; font-size: 12px; font-weight: 700; color: var(--fc); flex-shrink: 0; }
.ch-tb-more {
  display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 10px; border-radius: 10px; cursor: pointer; flex-shrink: 0;
  font-family: inherit; font-size: 12px; font-weight: 700; color: #4a3fd6; background: #efeefd; border: 1px solid #dcd8ff; white-space: nowrap; transition: background .2s;
}
.ch-tb-more:hover { background: #e3e0ff; }
.ch-tb-more svg { transition: transform .2s; }
.ch-tb-more.open svg { transform: rotate(180deg); }
.ch-tb-x { width: 30px; height: 30px; border-radius: 10px; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #6d6b95; background: transparent; border: none; }
.ch-tb-x:hover { background: #f0efff; color: #14123a; }

.ch-tpanel {
  position: absolute; left: 0; right: 0; top: calc(100% + 8px); max-height: min(62vh, 560px); overflow-y: auto;
  display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 18px;
  background: #fff; border: 1px solid #e3e3f6; box-shadow: 0 24px 60px rgba(40,30,160,.28); animation: ch-pop .15s ease;
}
.ch-tpanel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 2px 4px 2px; }
.ch-tpanel-head b { font-family: 'Sora', sans-serif; font-size: 14px; color: #14123a; }
.ch-tpanel-head span { font-size: 12px; color: #6d6b95; }

.ch-tcard { padding: 12px 14px; border-radius: 14px; background: #f8f8fe; border: 1px solid #ececf8; }
.ch-task-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ch-task-name { font-family: 'Sora', sans-serif; font-weight: 700; font-size: 14px; color: #14123a; }
.ch-task-sub { margin-top: 3px; font-size: 12.5px; color: #6d6b95; }
.ch-task-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ch-task-ask { font-size: 13px; font-weight: 600; color: #b3273f; }
.ch-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 11px; cursor: pointer;
  font-family: inherit; font-size: 12.5px; font-weight: 700; white-space: nowrap;
  color: #4a3fd6; background: #fff; border: 1px solid #d9d6fb; transition: background .2s, border-color .2s;
}
.ch-btn:hover { background: #f0efff; border-color: #bdb6ff; }
.ch-btn.danger { color: #c4344f; border-color: #f4c4cd; }
.ch-btn.danger:hover { background: #fff0f3; border-color: #ee9aa9; }
.ch-btn.solid { color: #fff; background: #d63a58; border-color: #d63a58; }
.ch-btn.solid:hover { background: #bf2e4b; }
.ch-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
.ch-chip::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.ch-chip.running { color: #1f9e68; background: #dcf7ea; }
.ch-chip.completed { color: #4a3fd6; background: #e7e5ff; }
.ch-chip.cancelled { color: #d23a5c; background: #ffe1e8; }

.ch-stepper { overflow-x: auto; }
.ch-steps { display: grid; grid-template-columns: repeat(var(--n), minmax(70px, 1fr)); margin-top: 14px; }
.ch-step { position: relative; display: flex; flex-direction: column; align-items: center; gap: 7px; text-align: center; }
.ch-step::after {
  content: ''; position: absolute; top: 11px; left: 50%; width: 100%; height: 4px; border-radius: 4px; z-index: 0;
  background: linear-gradient(90deg, var(--fc) 0, var(--fc) var(--fill), #e4e3f7 var(--fill), #e4e3f7 100%);
  transition: background .4s;
}
.ch-step:last-child::after { display: none; }
.ch-node {
  position: relative; z-index: 1; width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 700;
  color: #6d6b95; background: #fff; border: 2px solid #d6d4ef; transition: all .3s;
}
.ch-node.done { color: #fff; border-color: transparent; background: linear-gradient(135deg, #62d6a4, #3dbb87); }
.ch-node.cur { color: #fff; border-color: transparent; background: linear-gradient(135deg, #8b7bff, #5d4cf7); animation: ch-glow 1.6s infinite; }
.ch-node.stop { color: #fff; border-color: transparent; background: linear-gradient(135deg, #ff8a9f, #e5486b); }
@keyframes ch-glow { 0% { box-shadow: 0 0 0 0 rgba(108,92,255,.55); } 70% { box-shadow: 0 0 0 9px rgba(108,92,255,0); } 100% { box-shadow: 0 0 0 0 rgba(108,92,255,0); } }
.ch-step-label { padding: 0 4px; font-size: 11.5px; font-weight: 600; line-height: 1.3; color: #5a5885; }
.ch-step.cur .ch-step-label { color: #4a3fd6; }
.ch-step.done .ch-step-label { color: #2a2858; }

/* Thread */
.ch-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.ch-thread { max-width: 820px; margin: 0 auto; padding: 22px 22px 8px; display: flex; flex-direction: column; gap: 18px; }
.ch-m { display: flex; gap: 12px; max-width: 86%; animation: ch-fade .35s ease; }
.ch-m.user { align-self: flex-end; flex-direction: row-reverse; }
.ch-m-body { min-width: 0; }
.ch-m-meta { margin-bottom: 5px; font-size: 12px; color: #6d6b95; display: flex; gap: 6px; align-items: center; }
.ch-m-meta b { font-size: 13px; color: #14123a; }
.ch-m.user .ch-m-meta { justify-content: flex-end; }
.ch-bubble { padding: 12px 16px; font-size: 14.5px; line-height: 1.6; border-radius: 4px 18px 18px 18px; background: #eeedfd; color: #2a2858; white-space: pre-wrap; word-break: break-word; }
.ch-m.user .ch-bubble { color: #fff; border-radius: 18px 4px 18px 18px; background: linear-gradient(135deg, #7a6bff, #5d4cf7); box-shadow: 0 8px 20px rgba(93,76,247,.3); }
.ch-imgs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.ch-imgs img { max-width: 220px; max-height: 180px; border-radius: 12px; object-fit: cover; border: 2px solid rgba(255,255,255,.4); }
.ch-dots { display: inline-flex; gap: 5px; padding: 15px 16px; border-radius: 4px 18px 18px 18px; background: #eeedfd; }
.ch-dots i { width: 7px; height: 7px; border-radius: 50%; background: #8b7bff; animation: ch-bounce 1.2s infinite; }
.ch-dots i:nth-child(2) { animation-delay: .15s; }
.ch-dots i:nth-child(3) { animation-delay: .3s; }
@keyframes ch-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
@keyframes ch-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* Empty state */
.ch-hero { max-width: 680px; margin: 0 auto; padding: 8vh 22px 8px; text-align: center; }
.ch-hero-logo { width: 64px; height: 64px; margin: 0 auto 18px; border-radius: 20px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #9a8bff, #5d4cf7); box-shadow: 0 12px 30px rgba(109,92,255,.5); }
.ch-hero h2 { margin: 0; font-family: 'Sora', sans-serif; font-size: 26px; color: #14123a; }
.ch-hero p { margin: 10px 0 26px; font-size: 14.5px; color: #6d6b95; line-height: 1.6; }
.ch-sugs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ch-sug { padding: 14px 16px; text-align: left; cursor: pointer; font-family: inherit; font-size: 13.5px; font-weight: 600; color: #2a2858; line-height: 1.45; background: #fff; border: 1px solid #e3e3f6; border-radius: 16px; transition: border-color .2s, transform .2s, box-shadow .2s; }
.ch-sug:hover { border-color: #a99fff; transform: translateY(-2px); box-shadow: 0 10px 24px rgba(93,76,247,.15); }

/* Composer */
.ch-foot { padding: 10px 20px 14px; }
.ch-foot-in { max-width: 820px; margin: 0 auto; }
.ch-box { background: #fff; border: 1.5px solid #dcdcf3; border-radius: 22px; box-shadow: 0 10px 30px rgba(60,40,200,.10); transition: border-color .2s, box-shadow .2s; }
.ch-box:focus-within { border-color: #8b7bff; box-shadow: 0 10px 30px rgba(93,76,247,.2); }
.ch-box textarea { display: block; width: 100%; padding: 15px 18px 6px; resize: none; border: none; outline: none; background: transparent; color: #14123a; font-family: inherit; font-size: 15px; line-height: 1.5; max-height: 160px; }
.ch-box textarea::placeholder { color: #8886ad; }
.ch-thumbs { display: flex; flex-wrap: wrap; gap: 10px; padding: 14px 16px 0; }
.ch-thumb { position: relative; width: 64px; height: 64px; border-radius: 12px; border: 1px solid #e3e3f6; }
.ch-thumb img { width: 100%; height: 100%; border-radius: 11px; object-fit: cover; display: block; }
.ch-thumb button { position: absolute; top: -7px; right: -7px; width: 22px; height: 22px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #fff; background: #2a2858; border: 2px solid #fff; }
.ch-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px 10px; }
.ch-tools-left { position: relative; display: flex; align-items: center; gap: 8px; min-width: 0; }
.ch-tools-right { display: flex; align-items: center; gap: 8px; }
.ch-tool { width: 38px; height: 38px; border-radius: 12px; cursor: pointer; color: #5b54a8; display: flex; align-items: center; justify-content: center; background: transparent; border: none; transition: background .2s; }
.ch-tool:hover { background: #efeefd; }
.ch-voicebtn { width: 40px; height: 40px; border-radius: 50%; cursor: pointer; color: #5d4cf7; display: flex; align-items: center; justify-content: center; background: #efeefd; border: 1px solid #dcd8ff; transition: background .2s, transform .2s; }
.ch-voicebtn:hover { background: #e3e0ff; transform: scale(1.05); }
.ch-send { width: 40px; height: 40px; border-radius: 50%; cursor: pointer; color: #fff; display: flex; align-items: center; justify-content: center; border: none; background: linear-gradient(135deg, #8b7bff, #5d4cf7); box-shadow: 0 6px 16px rgba(93,76,247,.45); transition: opacity .2s, transform .2s; }
.ch-send:hover:not(:disabled) { transform: translateY(-1px); }
.ch-send:disabled { opacity: .35; cursor: not-allowed; box-shadow: none; }
.ch-hint { margin: 8px 0 0; text-align: center; font-size: 11.5px; color: #7d7ba6; }

.ch-dd { position: static; }
.ch-chipbtn { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px 0 6px; border-radius: 12px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; color: #2a2858; background: #f7f7fe; border: 1px solid #e3e3f6; transition: background .2s, border-color .2s; }
.ch-chipbtn:hover, .ch-chipbtn.open { background: #efeefd; border-color: #c9c3ff; }
.ch-chipbtn svg.chev { color: #6d6b95; transition: transform .2s; }
.ch-chipbtn.open svg.chev { transform: rotate(180deg); }
.ch-menu {
  position: absolute; left: 0; bottom: calc(100% + 12px); z-index: 20; width: min(330px, calc(100vw - 56px)); max-height: 360px; overflow-y: auto;
  padding: 8px; background: #fff; border: 1px solid #e3e3f6; border-radius: 18px; box-shadow: 0 20px 60px rgba(40,30,160,.3); animation: ch-pop .15s ease;
}
.ch-menu-title { padding: 8px 10px 6px; font-size: 11.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #6d6b95; }
.ch-opt { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 10px; text-align: left; cursor: pointer; font-family: inherit; background: transparent; border: none; border-radius: 12px; color: #14123a; }
.ch-opt:hover { background: #f4f3ff; }
.ch-opt.sel { background: #efeefd; }
.ch-opt-name { font-size: 13.5px; font-weight: 700; }
.ch-opt-desc { margin-top: 1px; font-size: 12px; color: #6d6b95; }
.ch-opt .tick { margin-left: auto; color: #5d4cf7; flex-shrink: 0; }
@keyframes ch-pop { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: none; } }


.ch-msg-action { margin-top: 8px; }
.ch-skel { display: flex; align-items: center; gap: 12px; padding: 12px; }
.ch-skel-ico, .ch-skel-lines i {
  background: linear-gradient(90deg, #eceafb 25%, #f6f5ff 50%, #eceafb 75%);
  background-size: 200% 100%; animation: ch-shimmer 1.3s infinite;
}
.ch-skel-ico { width: 42px; height: 42px; border-radius: 14px; flex-shrink: 0; }
.ch-skel-lines { flex: 1; display: flex; flex-direction: column; gap: 9px; }
.ch-skel-lines i { display: block; height: 10px; border-radius: 6px; }
@keyframes ch-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

/* ---------- Voice mode ---------- */
.ch-voice { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 18px 22px 30px; color: #fff; }
.ch-voice-top { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ch-back { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 14px; cursor: pointer; font-family: inherit; font-size: 14px; font-weight: 600; color: #fff; background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.2); transition: background .2s; }
.ch-back:hover { background: rgba(255,255,255,.18); }
.ch-vchip { padding: 8px 14px; border-radius: 12px; font-size: 12.5px; color: #cfcdf5; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch-voice-mid { flex: 1; min-height: 0; width: 100%; max-width: 640px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; }
.ch-orb-wrap { position: relative; width: 260px; height: 260px; display: flex; align-items: center; justify-content: center; }
.ch-ring { position: absolute; width: 150px; height: 150px; border-radius: 50%; border: 2px solid rgba(165,150,255,.55); opacity: 0; }
.ch-orb-wrap.on .ch-ring { animation: ch-ring 2.8s ease-out infinite; }
.ch-orb-wrap.on .ch-ring:nth-child(2) { animation-delay: .9s; }
.ch-orb-wrap.on .ch-ring:nth-child(3) { animation-delay: 1.8s; }
@keyframes ch-ring { 0% { transform: scale(1); opacity: .7; } 100% { transform: scale(2); opacity: 0; } }
.ch-orb-breathe { position: relative; }
.ch-orb-wrap.on .ch-orb-breathe { animation: ch-breathe 3s ease-in-out infinite; }
@keyframes ch-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
.ch-orb {
  width: 150px; height: 150px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #e4deff 0%, #9d8fff 36%, #5143e0 72%, #2a2190 100%);
  box-shadow: 0 0 70px rgba(122,107,255,.75), inset 0 -12px 30px rgba(20,10,100,.5);
  transform: scale(calc(1 + var(--lvl, 0) * .45)); transition: transform .08s linear, filter .4s, opacity .4s;
}
.ch-orb-wrap:not(.on) .ch-orb { filter: grayscale(.8) brightness(.7); opacity: .6; box-shadow: 0 0 20px rgba(122,107,255,.2); }
.ch-bars { display: flex; align-items: center; justify-content: center; gap: 5px; height: 36px; }
.ch-bars i { width: 5px; height: 8px; border-radius: 3px; background: linear-gradient(180deg, #b8aeff, #6c5cff); }
.ch-bars.on i { animation: ch-bar 1s ease-in-out infinite; }
.ch-bars i:nth-child(1) { --h: 20px; animation-delay: 0s; } .ch-bars i:nth-child(2) { --h: 32px; animation-delay: .1s; }
.ch-bars i:nth-child(3) { --h: 24px; animation-delay: .2s; } .ch-bars i:nth-child(4) { --h: 36px; animation-delay: .3s; }
.ch-bars i:nth-child(5) { --h: 22px; animation-delay: .4s; } .ch-bars i:nth-child(6) { --h: 30px; animation-delay: .5s; }
.ch-bars i:nth-child(7) { --h: 18px; animation-delay: .6s; }
@keyframes ch-bar { 0%, 100% { height: 8px; } 50% { height: var(--h); } }
.ch-vstatus { font-family: 'Sora', sans-serif; font-weight: 600; font-size: 19px; }
.ch-verror { font-size: 13px; color: #ffb3c0; text-align: center; max-width: 420px; line-height: 1.5; }
.ch-vtext { width: 100%; max-height: 130px; overflow-y: auto; padding: 0 8px; text-align: center; font-size: 17px; line-height: 1.6; color: #e5e3ff; }
.ch-vtext.ph { color: #a9a7d6; font-size: 15px; }
.ch-vnote { font-size: 12px; color: #a9a7d6; text-align: center; }
.ch-voice-bot { display: flex; align-items: center; justify-content: center; gap: 20px; flex-wrap: wrap; }
.ch-micbtn { width: 76px; height: 76px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #fff; border: none; transition: transform .2s, background .3s; }
.ch-micbtn.on { background: linear-gradient(135deg, #9a8bff, #5d4cf7); box-shadow: 0 0 0 8px rgba(122,107,255,.2), 0 14px 34px rgba(93,76,247,.6); }
.ch-micbtn.off { background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.25); }
.ch-micbtn:hover { transform: scale(1.06); }
.ch-mic-cap { margin-top: 10px; text-align: center; font-size: 12.5px; color: #cfcdf5; }

/* ---------- Toasts ---------- */
.ch-toasts { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 200; width: min(450px, calc(100vw - 24px)); display: flex; flex-direction: column; gap: 10px; pointer-events: none; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
.ch-toast {
  pointer-events: auto; position: relative; overflow: hidden; display: flex; align-items: center; gap: 12px; padding: 14px 12px 16px 14px;
  background: #fff; border: 1px solid #e6e6f7; border-radius: 18px; box-shadow: 0 18px 50px rgba(30,20,140,.45);
  animation: ch-drop .4s cubic-bezier(.2,.9,.3,1.2);
}
.ch-toast::after { content: ''; position: absolute; left: 0; bottom: 0; height: 3px; width: 100%; transform-origin: left; background: linear-gradient(90deg, #62d6a4, #3dbb87); animation: ch-life 7s linear forwards; }
.ch-toast.info::after { background: linear-gradient(90deg, #8b7bff, #5d4cf7); }
.ch-toast-ic { width: 40px; height: 40px; border-radius: 13px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; background: linear-gradient(135deg, #62d6a4, #3dbb87); }
.ch-toast.info .ch-toast-ic { background: linear-gradient(135deg, #8b7bff, #5d4cf7); }
.ch-toast.queued::after { display: none; }
.ch-toast.queued .ch-toast-ic { background: linear-gradient(135deg, #ffc25a, #f59e0b); }
.ch-toast-t { font-size: 14px; font-weight: 700; color: #14123a; }
.ch-toast-s { margin-top: 2px; font-size: 12.5px; color: #6d6b95; }
.ch-toast-x { margin-left: auto; width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0; cursor: pointer; color: #6d6b95; display: flex; align-items: center; justify-content: center; background: transparent; border: none; }
.ch-toast-x:hover { background: #f0efff; }
.ch-toast-go { margin-left: auto; }
@keyframes ch-drop { from { opacity: 0; transform: translateY(-20px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes ch-life { from { transform: scaleX(1); } to { transform: scaleX(0); } }

.ch-scrim { display: none; }
.ch-scroll::-webkit-scrollbar, .ch-items::-webkit-scrollbar, .ch-menu::-webkit-scrollbar, .ch-stepper::-webkit-scrollbar, .ch-tpanel::-webkit-scrollbar { width: 6px; height: 6px; }
.ch-scroll::-webkit-scrollbar-thumb, .ch-menu::-webkit-scrollbar-thumb, .ch-stepper::-webkit-scrollbar-thumb, .ch-items::-webkit-scrollbar-thumb, .ch-tpanel::-webkit-scrollbar-thumb { background: #d4d2f0; border-radius: 6px; }

/* ---------- Responsive ---------- */
@media (max-width: 1099px) { .ch { grid-template-columns: 280px minmax(0, 1fr); } }

@media (max-width: 899px) {
  .ch { grid-template-columns: minmax(0, 1fr); }
  .ch-list {
    position: fixed; top: 0; left: 0; bottom: 0; z-index: 60; width: min(330px, 88vw);
    border-radius: 0 24px 24px 0; transform: translateX(-105%); transition: transform .3s ease; box-shadow: 0 20px 60px rgba(40,30,160,.35);
  }
  .ch-list.open { transform: translateX(0); }
  .ch-scrim.open { display: block; position: fixed; inset: 0; z-index: 55; background: rgba(5,4,25,.6); backdrop-filter: blur(3px); }
  .ch-listbtn { display: flex; }
}
  .ch-bubble.md { white-space: normal; }
.ch-m.agent { max-width: 92%; }
/* the chat UI is light-only, so stop the formatter switching to dark text colours */
.ch-bubble.md .jf { --jf-fg: #2a2858; --jf-mut: #6d6b95; --jf-bd: #e5e7eb; --jf-soft: #f8fafc; }

@media (max-width: 767px) {
  .ch { margin-left: 0; padding: 76px 10px 10px; }
  .ch-main, .ch-list { border-radius: 20px; }
  .ch-list { border-radius: 0 20px 20px 0; }
  .ch-head { padding: 12px 14px; }
  .ch-tbwrap { margin: 8px 12px 0; }
  .ch-tb-step, .ch-tb-bar { display: none; }
  .ch-tb-pct { margin-left: auto; }
  .ch-tb-name { max-width: none; flex: 1; }
  .ch-thread { padding: 16px 14px 8px; }
  .ch-m { max-width: 94%; }
  .ch-foot { padding: 8px 10px 10px; }
  .ch-sugs { grid-template-columns: 1fr; }
  .ch-hero { padding-top: 4vh; }
  .ch-chipbtn-name { display: none; }
  .ch-chipbtn { padding: 0 8px 0 6px; }
  .ch-hint { display: none; }
  .ch-orb-wrap { width: 220px; height: 220px; }
  .ch-voice { padding: 14px 14px 22px; }
  
  
}
`;

/* ----------------------------- Small components ------------------------ */

function AgentIcon({ id, size = 40 }: { id: AgentId; size?: number }) {
  const a = AGENTS[id];
  const Icon = a?.icon;
  return (
    <div
      className="ch-ico"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: `linear-gradient(135deg, ${a?.from}, ${a?.to})`,
        boxShadow: `0 6px 14px ${a?.to}55`,
      }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </div>
  );
}
function ChatIcon({
  job,
  task,
  size = 42,
}: {
  job: boolean;
  task: boolean;
  size?: number;
}) {
  const both = job && task;
  const [from, to] = both
    ? ["#8b7bff", "#3dbb87"]
    : job
      ? ["#ffc25a", "#f59e0b"]
      : task
        ? ["#62d6a4", "#3dbb87"]
        : ["#8b7bff", "#5d4cf7"];
  const s = Math.round(size * (both ? 0.38 : 0.5));
  return (
    <div
      className="ch-ico"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: `linear-gradient(135deg, ${from}, ${to})`,
        boxShadow: `0 6px 14px ${to}55`,
        gap: 2,
      }}
    >
      {both ? (
        <>
          <Briefcase size={s} strokeWidth={2.2} />
          <ListChecks size={s} strokeWidth={2.2} />
        </>
      ) : job ? (
        <Briefcase size={s} strokeWidth={2} />
      ) : task ? (
        <ListChecks size={s} strokeWidth={2} />
      ) : (
        <MessagesSquare size={s} strokeWidth={2} />
      )}
    </div>
  );
}

function AsurMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none">
      <path
        d="M12 3.5 4.5 20.5M12 3.5l7.5 17"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 14.5h8"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="3.5" r="1.7" fill="#fff" />
    </svg>
  );
}

type Opt = {
  id: string;
  name: string;
  desc: string;
  icon: (size: number) => ReactNode;
};

function Dropdown({
  value,
  options,
  onChange,
  title,
}: {
  value: string;
  options: Opt[];
  onChange: (id: string) => void;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [open]);

  const cur = options.find((o) => o.id === value) ?? options[0];

  return (
    <div className="ch-dd" ref={ref}>
      <button
        type="button"
        className={`ch-chipbtn ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
      >
        {cur.icon(24)}
        <span className="ch-chipbtn-name">{cur.name}</span>
        <ChevronDown size={15} className="chev" />
      </button>
      {open && (
        <div className="ch-menu" role="listbox">
          <div className="ch-menu-title">{title}</div>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              className={`ch-opt ${o.id === value ? "sel" : ""}`}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            >
              {o.icon(36)}
              <div>
                <div className="ch-opt-name">{o.name}</div>
                <div className="ch-opt-desc">{o.desc}</div>
              </div>
              {o.id === value && <Check size={17} className="tick" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PlainIcon({
  Icon,
  size,
  from,
  to,
}: {
  Icon: IconC;
  size: number;
  from: string;
  to: string;
}) {
  return (
    <div
      className="ch-ico"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: `linear-gradient(135deg, ${from}, ${to})`,
      }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </div>
  );
}

const agentOptions: Opt[] = [
  {
    id: "auto",
    name: "Auto",
    desc: "Asur picks the best agent for you",
    icon: (s) => (
      <PlainIcon Icon={Shuffle} size={s} from="#8b7bff" to="#5d4cf7" />
    ),
  },
  ...(Object.values(AGENTS) as Agent[]).map((a) => ({
    id: a.id as string,
    name: a.name,
    desc: a.role,
    icon: (s: number) => <AgentIcon id={a.id} size={s} />,
  })),
];

const modelOptions: Opt[] = MODELS.map((m) => ({
  id: m.id as string,
  name: m.name,
  desc: m.desc,
  icon: (s: number) => (
    <PlainIcon Icon={m.icon} size={s} from="#6d5cf7" to="#3d2fc4" />
  ),
}));

/* ------------------------------ Tasks ---------------------------------- */

function taskSub(task: ChatTask) {
  const n = task.steps.length;
  return task.status === "completed"
    ? `All ${n} steps complete`
    : task.status === "cancelled"
      ? `Cancelled during step ${task.step + 1} of ${n}`
      : `Step ${task.step + 1} of ${n} · ${task.steps[task.step]}`;
}

/** One task with full stepper, shown inside the expanded list. */
function TaskCard({
  task,
  onCancel,
  onOpen,
}: {
  task: ChatTask;
  onCancel: () => void;
  onOpen: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const pct = taskPct(task);
  const running = isRunning(task);

  useEffect(() => {
    if (!running) setConfirm(false);
  }, [running]);

  return (
    <div className={`ch-tcard ${task.status}`}>
      <div className="ch-task-head">
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span className="ch-task-name">{task.name}</span>
            <span className={`ch-chip ${task.status}`}>
              {running
                ? `Running · ${pct}%`
                : task.status === "completed"
                  ? "Completed"
                  : "Cancelled"}
            </span>
          </div>
          <div className="ch-task-sub">{taskSub(task)}</div>
        </div>

        <div className="ch-task-actions">
          {confirm ? (
            <>
              <span className="ch-task-ask">Cancel this task?</span>
              <button
                className="ch-btn solid"
                onClick={() => {
                  setConfirm(false);
                  onCancel();
                }}
              >
                Yes, cancel
              </button>
              <button className="ch-btn" onClick={() => setConfirm(false)}>
                Keep running
              </button>
            </>
          ) : (
            <>
              <button className="ch-btn" onClick={onOpen}>
                View full details <ArrowUpRight size={14} />
              </button>
              {running && (
                <button
                  className="ch-btn danger"
                  onClick={() => setConfirm(true)}
                >
                  <X size={14} /> Cancel task
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="ch-stepper">
        <div
          className="ch-steps"
          style={{ "--n": task.steps.length } as CSSProperties}
        >
          {task.steps.map((label, i) => {
            const done = task.status === "completed" || i < task.step;
            const state = done
              ? "done"
              : i === task.step
                ? task.status === "cancelled"
                  ? "stop"
                  : "cur"
                : "todo";
            const fill = done ? 100 : i === task.step ? task.sub : 0;
            return (
              <div
                key={label}
                className={`ch-step ${state}`}
                style={{ "--fill": `${fill}%` } as CSSProperties}
              >
                <div className={`ch-node ${state}`}>
                  {state === "done" ? (
                    <Check size={14} strokeWidth={3} />
                  ) : state === "stop" ? (
                    <X size={13} strokeWidth={3} />
                  ) : (
                    i + 1
                  )}
                </div>
                <div className="ch-step-label">{label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Small one-line bar. Expands into a list of every task in this chat. */
function TaskBar({
  tasks,
  view,
  setView,
  onCancel,
  onOpen,
}: {
  tasks: ChatTask[];
  view: TaskView;
  setView: (v: TaskView) => void;
  onCancel: (taskId: string) => void;
  onOpen: (taskId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // click outside closes the expanded list
  useEffect(() => {
    if (view !== "open") return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setView("mini");
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [view, setView]);

  if (view === "hidden") return null;

  const running = tasks.filter(isRunning);
  const focus = running[running.length - 1] ?? tasks[tasks.length - 1];
  const pct = taskPct(focus);
  const open = view === "open";

  return (
    <div className="ch-tbwrap" ref={ref}>
      <div className={`ch-tbar ${focus.status}`}>
        <span className="ch-tb-dot" />
        <span className="ch-tb-name">{focus.name}</span>
        <span className="ch-tb-step">{taskSub(focus)}</span>
        <div className="ch-tb-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="ch-tb-pct">{pct}%</span>
        <button
          className={`ch-tb-more ${open ? "open" : ""}`}
          onClick={() => setView(open ? "mini" : "open")}
          aria-expanded={open}
        >
          {tasks.length > 1 ? `${tasks.length} tasks` : "Details"}
          <ChevronDown size={14} />
        </button>
        <button
          className="ch-tb-x"
          onClick={() => setView("hidden")}
          aria-label="Hide tasks"
          title="Hide"
        >
          <X size={15} />
        </button>
      </div>

      {open && (
        <div className="ch-tpanel">
          <div className="ch-tpanel-head">
            <b>Tasks in this chat</b>
            <span>
              {running.length} running · {tasks.length} total
            </span>
          </div>
          {[...tasks].reverse().map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onCancel={() => onCancel(t.id)}
              onOpen={() => onOpen(t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Voice helpers -------------------------- */

// must match the base URL your api.ts uses
const voiceWsUrl = (convoId: string) =>
  API.replace(/^http/, "ws") +
  `/chats/ws/audio-chat?convo_id=${encodeURIComponent(convoId)}`;

const TARGET_RATE = 16000;
const SPEECH_RMS = 0.02; // louder than this = speech (raise it in noisy rooms)
const END_SILENCE_MS = 900; // this much quiet ends the sentence
const MIN_SPEECH_MS = 350; // shorter sounds are ignored
const MAX_UTTERANCE_MS = 30000;

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function downsample(buf: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return buf;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(buf.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), buf.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += buf[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) =>
    [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function audioMime(buf: ArrayBuffer) {
  const b = new Uint8Array(buf.slice(0, 4));
  if (b[0] === 0x52 && b[1] === 0x49) return "audio/wav"; // RIFF
  if (b[0] === 0x4f && b[1] === 0x67) return "audio/ogg"; // OggS
  return "audio/mpeg";
}

/* ------------------------------ Voice view ----------------------------- */

type VState =
  | "connecting"
  | "listening"
  | "hearing"
  | "thinking"
  | "speaking"
  | "offline";

const V_LABEL: Record<VState, string> = {
  connecting: "Connecting…",
  listening: "Listening…",
  hearing: "Hearing you…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  offline: "Disconnected",
};

function VoiceView({
  agentName,
  convoId,
  onTurn,
  onBack,
}: {
  agentName: string;
  convoId: string;
  onTurn: (user: string, reply: string) => void;
  onBack: () => void;
}) {
  const [state, setState] = useState<VState>("connecting");
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [userText, setUserText] = useState("");
  const [replyText, setReplyText] = useState("");
  const [attempt, setAttempt] = useState(0);

  const stateRef = useRef<VState>("connecting");
  const mutedRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const queueRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTurnRef = useRef(onTurn);
  onTurnRef.current = onTurn;

  const set = (s: VState) => {
    stateRef.current = s;
    setState(s);
  };

  const stopAudio = () => {
    queueRef.current = [];
    const a = audioRef.current;
    audioRef.current = null;
    if (a) {
      a.onended = null;
      a.onerror = null;
      a.pause();
    }
  };

  const interrupt = () => {
    stopAudio();
    if (graceRef.current) clearTimeout(graceRef.current);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "cancel_last" }));
    set("listening");
  };

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let proc: ScriptProcessorNode | null = null;

    setError("");
    set("connecting");

    const playNext = () => {
      if (audioRef.current) return;
      const blob = queueRef.current.shift();
      if (!blob) {
        if (stateRef.current === "speaking") set("listening");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      audioRef.current = a;
      set("speaking");
      const done = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === a) audioRef.current = null;
        playNext();
      };
      a.onended = done;
      a.onerror = done;
      a.play().catch(done);
    };

    const ws = new WebSocket(voiceWsUrl(convoId));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (!cancelled) set("listening");
    };
    ws.onclose = () => {
      if (cancelled) return;
      stopAudio();
      set("offline");
      setError("Connection lost.");
    };
    ws.onerror = () => {
      if (!cancelled) setError("Could not reach the voice server.");
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        let d: any;
        try {
          d = JSON.parse(e.data);
        } catch {
          return;
        }
        if (d.error) {
          setError(String(d.error));
          if (stateRef.current === "thinking") set("listening");
          return;
        }
        if (d.transcribed_prompt !== undefined) {
          setUserText(d.transcribed_prompt);
          setReplyText(d.response_text || "");
          onTurnRef.current(d.transcribed_prompt, d.response_text || "");
          if (graceRef.current) clearTimeout(graceRef.current);
          graceRef.current = setTimeout(() => {
            if (stateRef.current === "thinking") set("listening");
          }, 2500);
          return;
        }
        if (d.notification) setReplyText(d.notification);
        return;
      }
      if (graceRef.current) clearTimeout(graceRef.current);
      queueRef.current.push(new Blob([e.data], { type: audioMime(e.data) }));
      playNext();
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        ctx = new AC();
        const rate = ctx.sampleRate;
        const src = ctx.createMediaStreamSource(stream);
        proc = ctx.createScriptProcessor(4096, 1, 1);
        const silent = ctx.createGain();
        silent.gain.value = 0;
        src.connect(proc);
        proc.connect(silent);
        silent.connect(ctx.destination);

        let speaking = false;
        let speechMs = 0;
        let silenceMs = 0;
        let pre: Float32Array[] = [];
        let chunks: Float32Array[] = [];

        proc.onaudioprocess = (ev) => {
          const data = new Float32Array(ev.inputBuffer.getChannelData(0));
          const ms = (data.length / rate) * 1000;
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
          const rms = Math.sqrt(sum / data.length);
          setLevel(Math.min(1, rms * 6));

          const s = stateRef.current;
          const active =
            !mutedRef.current &&
            (s === "listening" || s === "hearing") &&
            ws.readyState === WebSocket.OPEN;
          if (!active) {
            speaking = false;
            chunks = [];
            pre = [];
            speechMs = silenceMs = 0;
            return;
          }

          const loud = rms > SPEECH_RMS;
          if (!speaking) {
            pre.push(data);
            if (pre.length > 3) pre.shift();
            if (loud) {
              speaking = true;
              chunks = [...pre];
              pre = [];
              speechMs = ms;
              silenceMs = 0;
              set("hearing");
            }
            return;
          }

          chunks.push(data);
          if (loud) {
            speechMs += ms;
            silenceMs = 0;
          } else {
            silenceMs += ms;
          }

          if (
            silenceMs >= END_SILENCE_MS ||
            speechMs + silenceMs >= MAX_UTTERANCE_MS
          ) {
            const voiced = speechMs;
            const done = chunks;
            speaking = false;
            chunks = [];
            speechMs = silenceMs = 0;
            if (voiced < MIN_SPEECH_MS) {
              set("listening");
              return;
            }
            const wav = encodeWav(
              downsample(mergeChunks(done), rate, TARGET_RATE),
              TARGET_RATE,
            );
            ws.send(wav);
            set("thinking");
          }
        };
      } catch {
        if (!cancelled) {
          setError(
            "Microphone access is blocked or unavailable. Allow it in your browser to use voice.",
          );
          set("offline");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (graceRef.current) clearTimeout(graceRef.current);
      stopAudio();
      if (proc) {
        proc.onaudioprocess = null;
        proc.disconnect();
      }
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
      ws.onclose = null;
      ws.close();
      wsRef.current = null;
      setLevel(0);
    };
  }, [convoId, attempt]);

  useEffect(() => {
    if (state !== "thinking") return;
    const t = setTimeout(() => {
      if (stateRef.current === "thinking") {
        setError("No response from the server.");
        set("listening");
      }
    }, 120000);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onBack]);

  const on = state !== "offline" && state !== "connecting";
  const busy = state === "thinking" || state === "speaking";

  return (
    <div className="ch-voice">
      <div className="ch-voice-top">
        <button className="ch-back" onClick={onBack}>
          <ArrowLeft size={17} /> Back to chat
        </button>
        <span className="ch-vchip">{agentName}</span>
      </div>

      <div className="ch-voice-mid">
        <div className={`ch-orb-wrap ${on ? "on" : ""}`}>
          <span className="ch-ring" />
          <span className="ch-ring" />
          <span className="ch-ring" />
          <div className="ch-orb-breathe">
            <div
              className="ch-orb"
              style={
                { "--lvl": state === "hearing" ? level : 0 } as CSSProperties
              }
            />
          </div>
        </div>

        <div
          className={`ch-bars ${state === "hearing" || state === "speaking" ? "on" : ""}`}
          aria-hidden
        >
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>

        <div className="ch-vstatus">
          {muted && on ? "Mic is muted" : V_LABEL[state]}
        </div>
        {error && <div className="ch-verror">{error}</div>}

        {userText && (
          <>
            <div className="ch-vnote">You</div>
            <div className="ch-vtext" style={{ maxHeight: 70 }}>
              {userText}
            </div>
          </>
        )}
        {replyText ? (
          <>
            <div className="ch-vnote">{agentName}</div>
            <div className="ch-vtext">{replyText}</div>
          </>
        ) : (
          !userText && (
            <div className="ch-vtext ph">
              {state === "offline"
                ? "Voice is not connected."
                : "Say something and I'll answer out loud."}
            </div>
          )
        )}
      </div>

      <div>
        <div className="ch-voice-bot">
          <div>
            <button
              className={`ch-micbtn ${muted || !on ? "off" : "on"}`}
              onClick={() => setMuted((m) => !m)}
              disabled={!on}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={muted}
            >
              {muted || !on ? <MicOff size={30} /> : <Mic size={30} />}
            </button>
            <div className="ch-mic-cap">
              {muted ? "Tap to unmute" : "Tap to mute"}
            </div>
          </div>
          {busy && (
            <button className="ch-back" onClick={interrupt}>
              <X size={16} /> Stop
            </button>
          )}
          {state === "offline" && (
            <button
              className="ch-back"
              onClick={() => setAttempt((a) => a + 1)}
            >
              Reconnect
            </button>
          )}
        </div>
        <div className="ch-vnote" style={{ marginTop: 16 }}>
          The conversation is saved in this chat.
        </div>
      </div>
    </div>
  );
}
/* -------------------------------- Page --------------------------------- */

export default function Chats({
  onOpenTask,
}: {
  onOpenTask?: (taskId: string) => void;
}) {
  const seed = useRef<Chat>(blankChat()).current;
  const [chats, setChats] = useState<Chat[]>([seed]);
  const [activeId, setActiveId] = useState(seed.id);
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [voice, setVoice] = useState(false);
  const [draft, setDraft] = useState("");
  const [agent, setAgent] = useState<"auto" | AgentId>("auto");
  const [model, setModel] = useState<ModelId>("sonnet");
  const [images, setImages] = useState<Attachment[]>([]);
  const [typingChat, setTypingChat] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [taskUi, setTaskUi] = useState<Record<string, TaskView>>({}); // per-chat: mini (default), open, hidden

  const activeRef = useRef(activeId);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const notified = useRef<Set<string>>(new Set());
  const streams = useRef<Record<string, () => void>>({});

  const active = chats.find((c) => c.id === activeId) ?? chats[0];
  const view: TaskView = taskUi[active?.id] ?? "mini";
  const setView = useCallback(
    (v: TaskView) => setTaskUi((p) => ({ ...p, [activeId]: v })),
    [activeId],
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  /* toasts */
  const addToast = useCallback((t: Omit<Toast, "id">) => {
    const id = uid();
    setToasts((p) => [...p, { ...t, id }]);
    setTimeout(
      () => setToasts((p) => p.filter((x) => x.id !== id)),
      t.kind === "queued" ? 10000 : 7000,
    );
  }, []);

  /* real task events -> chat state */
  const onTaskEvent = useCallback(
    (cid: string, taskId: string, ev: TaskEvent) => {
      const patch = (fn: (c: Chat) => Chat) =>
        setChats((p) => p.map((c) => (c.id === cid ? fn(c) : c)));
      const patchTask = (fn: (t: ChatTask) => ChatTask) =>
        patch((c) => ({
          ...c,
          tasks: c.tasks.map((t) => (t.id === taskId ? fn(t) : t)),
        }));

      switch (ev.type) {
        case "plan.ready": {
          const labels: string[] = (ev.steps ?? []).map((s: any) => s.label);
          if (!labels.length) return;
          patch((c) => ({
            ...c,
            tasks: c.tasks.some((t) => t.id === taskId)
              ? c.tasks.map((t) =>
                  t.id === taskId
                    ? { ...t, steps: labels, step: 0, sub: 0 }
                    : t,
                )
              : [
                  ...c.tasks,
                  {
                    id: taskId,
                    name: toTitle(ev.goal || "Task"),
                    steps: labels,
                    step: 0,
                    sub: 0,
                    speed: 0,
                    status: "running" as const,
                  },
                ],
          }));
          setTaskUi((p) => (p[cid] === "hidden" ? { ...p, [cid]: "mini" } : p));
          return;
        }
        case "step.started":
          patchTask((t) => ({ ...t, sub: 40 }));
          return;
        case "step.finished":
        case "step.failed":
        case "step.skipped":
          patchTask((t) => ({
            ...t,
            step: Math.min(t.step + 1, t.steps.length - 1),
            sub: 0,
          }));
          return;
        case "task.result": {
          const meta = ev.meta ?? {};
          const jobId =
            meta.category === "job" && meta.job_id ? String(meta.job_id) : null;
          const href = jobId
            ? `/jobs?tab=ready&job=${encodeURIComponent(jobId)}`
            : undefined;

          patch((c) => ({
            ...c,
            time: "Now",
            unread: cid !== activeRef.current ? c.unread + 1 : c.unread,
            messages: [
              ...c.messages,
              am(
                uid(),
                c.agent,
                ev.response || "Task completed.",
                nowTime(),
                href ? { label: "Open job", href } : undefined,
              ),
            ],
          }));
          setTypingChat((t) => (t === cid ? null : t));

          if (href) {
            addToast({
              kind: "queued",
              title: "Job queued for your review",
              sub: "Waiting for your confirmation in Jobs → Ready",
              href,
            });
          }
          return;
        }
        case "task.finished": {
          setTypingChat((t) => (t === cid ? null : t));
          patchTask((t) =>
            t.status !== "running"
              ? t
              : {
                  ...t,
                  step: ev.status === "completed" ? t.steps.length : t.step,
                  sub: 0,
                  status: ev.status === "completed" ? "completed" : "cancelled",
                },
          );
          if (ev.status === "failed")
            patch((c) => ({
              ...c,
              messages: [
                ...c.messages,
                am(
                  uid(),
                  c.agent,
                  "Something went wrong while running that. Please try again.",
                  nowTime(),
                ),
              ],
            }));
          streams.current[taskId]?.();
          delete streams.current[taskId];
          return;
        }
      }
    },
    [addToast],
  );

  const hydrate = useCallback(async (ids: string[]) => {
    const queue = [...ids];
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift()!;
        try {
          const rows = await api.messages(id);
          const last = rows[rows.length - 1];
          const text = (last?.content ?? "")
            .replace(/[*_`#]/g, "")
            .trim()
            .slice(0, 120);
          const hasJob = rows.some(
            (r) => r.role !== "user" && !!jobHref(r.content),
          );
          setChats((p) =>
            p.map((c) =>
              c.id === id && c.remote
                ? {
                    ...c,
                    preview: text
                      ? (last.role === "user" ? "You: " : "") + text
                      : c.preview,
                    hasJob: c.hasJob || hasJob,
                  }
                : c,
            ),
          );
        } catch {
          /* skip this chat */
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]); // 3 requests at a time
  }, []);

  //load chats

  const loadChats = useCallback(() => {
    setListLoading(true);
    setListError(null);
    api
      .chats()
      .then((rows: any[]) => {
        const hasTs = rows.some((r) => stamp(r) > 0);
        // newest first; if the API sends no dates, assume it returns oldest first
        const ordered = hasTs
          ? [...rows].sort((a, b) => stamp(b) - stamp(a))
          : [...rows].reverse();
        setChats((prev) => {
          const known = new Set(prev.map((c) => c.id));
          const loaded: Chat[] = ordered
            .filter((r) => r.convo_id && !known.has(r.convo_id))
            .map((r) => {
              const preview = r.last_message ?? r.preview ?? "";
              return {
                id: r.convo_id,
                title: r.title || "Chat",
                agent: "planner" as AgentId,
                time: fmtListTime(stamp(r)),
                ts: stamp(r),
                preview,
                hasJob: !!(r.has_job ?? r.job_id) || !!jobHref(preview),
                hasTask: !!(r.has_task ?? r.task_id),
                unread: 0,
                messages: [],
                tasks: [],
                remote: true,
              };
            });
          return [...prev, ...loaded];
        });
        hydrate(
          ordered
            .filter((r) => r.convo_id)
            .map((r) => r.convo_id)
            .slice(0, 15),
        );
      })
      .catch((e) =>
        setListError(e instanceof Error ? e.message : "Could not load chats"),
      )
      .finally(() => setListLoading(false));
  }, [hydrate]);

  useEffect(() => {
    loadChats();
    return () => Object.values(streams.current).forEach((close) => close());
  }, [loadChats]);

  const dismissToast = (id: string) =>
    setToasts((p) => p.filter((x) => x.id !== id));

  const openTask = (id: string) => {
    if (onOpenTask) onOpenTask(id);
    else window.location.assign(`/tasks?task=${encodeURIComponent(id)}`);
  };

  /* toast when a task finishes (works in any chat, and in voice mode) */
  useEffect(() => {
    chats.forEach((c) =>
      c.tasks.forEach((t) => {
        if (t.status === "completed" && !notified.current.has(t.id)) {
          notified.current.add(t.id);
          addToast({
            kind: "success",
            title: `${t.name} task completed`,
            sub: "All steps finished successfully",
            taskId: t.id,
          });
        }
      }),
    );
  }, [chats, addToast]);

  /* keep thread scrolled to the newest message */
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [activeId, active?.messages?.length, typingChat, voice]);

  /* grow the textarea with its content */
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [draft, voice]);

  const selectChat = (id: string) => {
    const c = chats.find((x) => x.id === id);
    if (!c) return;
    setActiveId(id);
    setAgent(c.messages.length ? c.agent : "auto");
    setChats((p) => p.map((x) => (x.id === id ? { ...x, unread: 0 } : x)));
    if (c.remote) {
      setLoadingId(id);
      setLoadError(null);
      api
        .messages(id)
        .then((rows) =>
          setChats((p) =>
            p.map((x) =>
              x.id === id
                ? {
                    ...x,
                    remote: false,
                    messages: rows.map((r) => {
                      const images = (r as typeof r & { images?: string[] })
                        .images;
                      return r.role === "user"
                        ? um(
                            r.id,
                            r.content,
                            fmtTime(r.created_at),
                            images?.length ? images : undefined,
                          )
                        : am(
                            r.id,
                            x.agent,
                            r.content,
                            fmtTime(r.created_at),
                            jobHref(r.content)
                              ? { label: "Open job", href: jobHref(r.content)! }
                              : undefined,
                          );
                    }),
                  }
                : x,
            ),
          ),
        )
        .catch((e) =>
          setLoadError(
            e instanceof Error ? e.message : "Could not load messages",
          ),
        )
        .finally(() => setLoadingId((cur) => (cur === id ? null : cur)));
    }
    setListOpen(false);
    setVoice(false);
  };

  const newChat = () => {
    const empty = chats.find(isDraft);
    if (empty) {
      selectChat(empty.id);
      return;
    }
    const id = uid();
    setChats((p) => [
      {
        id,
        title: "New chat",
        agent: "planner",
        time: "Now",
        unread: 0,
        messages: [],
        tasks: [],
      },
      ...p,
    ]);
    setActiveId(id);
    setAgent("auto");
    setDraft("");
    setListOpen(false);
    setVoice(false);
  };

  /* images */
  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const room = 4 - images.length;
    const list = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, Math.max(room, 0));
    if (fileRef.current) fileRef.current.value = "";
    const picked = (
      await Promise.all(
        list.map(async (f) => {
          try {
            return {
              id: uid(),
              url: URL.createObjectURL(f),
              name: f.name,
              data: await toDataUrl(f),
            };
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean) as Attachment[];
    if (picked.length) setImages((p) => [...p, ...picked].slice(0, 4));
  };
  const removeImage = (id: string) =>
    setImages((p) => {
      const hit = p.find((i) => i.id === id);
      if (hit) URL.revokeObjectURL(hit.url);
      return p.filter((i) => i.id !== id);
    });

  /* send */
  const canSend = draft.trim().length > 0 || images.length > 0;
  const send = () => {
    if (!canSend) return;
    const text = draft.trim();
    const cid = active.id;
    const imgUrls = images.map((i) => i.url);
    const imgData = images.map((i) => i.data);
    const resolved: AgentId = agent === "auto" ? pickAgent(text) : agent;

    setChats((p) => {
      const cur = p.find((c) => c.id === cid);
      if (!cur) return p;
      const updated: Chat = {
        ...cur,
        title:
          cur.title === "New chat" ? toTitle(text || "Image chat") : cur.title,
        agent: cur.messages.length === 0 ? resolved : cur.agent,
        time: "Now",
        ts: Date.now(),
        messages: [
          ...cur.messages,
          {
            id: uid(),
            role: "user",
            text,
            time: nowTime(),
            images: imgUrls.length ? imgUrls : undefined,
          },
        ],
      };
      return [updated, ...p.filter((c) => c.id !== cid)];
    });
    setDraft("");
    setImages([]);
    setTypingChat(cid);

    api
      .startTask(cid, text || "What is in the attached image?", imgData)
      .then((res: any) => {
        // 1) Fast path: show the answer immediately
        if (res.kind === "reply") {
          setChats((p) =>
            p.map((c) =>
              c.id === cid
                ? {
                    ...c,
                    time: "Now",
                    messages: [
                      ...c.messages,
                      am(uid(), c.agent, res.reply, nowTime()),
                    ],
                  }
                : c,
            ),
          );
          setTypingChat((t) => (t === cid ? null : t));
          return;
        }

        // 2) Job: queued toast, no progress, no task stream
        if (res.kind === "job") {
          setChats((p) =>
            p.map((c) =>
              c.id === cid
                ? {
                    ...c,
                    time: "Now",
                    messages: [
                      ...c.messages,
                      am(
                        uid(),
                        c.agent,
                        `I've drafted the job **${res.title}**. Review the details, edit anything you like, then confirm and I'll start hiring. Nothing is sent until you confirm.`,
                        nowTime(),
                        {
                          label: "Open job",
                          href: `/jobs?tab=ready&job=${encodeURIComponent(res.job_id)}`,
                        },
                      ),
                    ],
                  }
                : c,
            ),
          );
          setTypingChat((t) => (t === cid ? null : t));
          addToast({
            kind: "queued",
            title: "Job queued for your review",
            sub: "Waiting for your confirmation in Jobs → Ready",
            href: `/jobs?tab=ready&job=${encodeURIComponent(res.job_id)}`,
          });
          return;
        }

        // 3) Existing long task flow
        if (!res.task_id) throw new Error("No task_id returned");
        streams.current[res.task_id] = subscribeTask(res.task_id, (ev) =>
          onTaskEvent(cid, res.task_id, ev),
        );
      })
      .catch(() => {
        setChats((p) =>
          p.map((c) =>
            c.id === cid
              ? {
                  ...c,
                  messages: [
                    ...c.messages,
                    am(
                      uid(),
                      c.agent,
                      "I couldn't reach the server. Please try again.",
                      nowTime(),
                    ),
                  ],
                }
              : c,
          ),
        );
        setTypingChat((t) => (t === cid ? null : t));
      });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  /* cancel a running task */
  const cancelTask = (chatId: string, taskId: string) => {
    const c = chats.find((x) => x.id === chatId);
    const t = c?.tasks.find((x) => x.id === taskId);
    if (!c || !t || !isRunning(t)) return;
    api.cancelTask(taskId).catch(() => {});
    setChats((p) =>
      p.map((x) =>
        x.id === chatId
          ? {
              ...x,
              time: "Now",
              tasks: x.tasks.map(
                (k): ChatTask =>
                  k.id === taskId ? { ...k, status: "cancelled" } : k,
              ),
              messages: [
                ...x.messages,
                am(
                  uid(),
                  x.agent,
                  `Understood. I've cancelled ${t.name}. The agents have stopped working on it, and nothing further will be sent.`,
                  nowTime(),
                ),
              ],
            }
          : x,
      ),
    );
    notified.current.add(t.id);
    addToast({
      kind: "info",
      title: `${t.name} task cancelled`,
      sub: "The agents have stopped working on it",
    });
  };

  const leaveVoice = useCallback(() => setVoice(false), []);

  const onVoiceTurn = useCallback(
    (cid: string, user: string, reply: string) => {
      setChats((p) => {
        const cur = p.find((c) => c.id === cid);
        if (!cur) return p;
        const msgs = [...cur.messages, um(uid(), user, nowTime())];
        if (reply) msgs.push(am(uid(), cur.agent, reply, nowTime()));
        const updated: Chat = {
          ...cur,
          title: cur.title === "New chat" ? toTitle(user) : cur.title,
          time: "Now",
          ts: Date.now(),
          messages: msgs,
        };
        return [updated, ...p.filter((c) => c.id !== cid)];
      });
    },
    [],
  );
  const visible = chats.filter((c) => !isDraft(c)); // hides the "New chat" placeholder
  const filtered = visible.filter((c) =>
    c.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const agentName = agent === "auto" ? "Auto" : AGENTS[agent].name;
  const runCount = active?.tasks?.filter(isRunning).length;

  return (
    <>
      <style>{css}</style>
      <Sidebar defaultActive="chats" />

      <div className="ch">
        <div
          className={`ch-scrim ${listOpen ? "open" : ""}`}
          onClick={() => setListOpen(false)}
        />

        {/* ---------------- Chat list ---------------- */}
        <aside className={`ch-list ${listOpen ? "open" : ""}`}>
          <div className="ch-list-head">
            <div>
              <h2 className="ch-list-title">Chats</h2>
              <p className="ch-list-sub">
                {listLoading ? "Loading…" : `${visible.length} conversations`}
              </p>
            </div>
            <button
              className="ch-new"
              onClick={newChat}
              aria-label="New chat"
              title="New chat"
            >
              <Plus size={22} />
            </button>
          </div>

          <label className="ch-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
            />
          </label>

          <div className="ch-items">
            {listLoading &&
              visible.length === 0 &&
              Array.from({ length: 7 }).map((_, i) => (
                <div className="ch-skel" key={i}>
                  <span className="ch-skel-ico" />
                  <div className="ch-skel-lines">
                    <i style={{ width: `${55 + ((i * 7) % 35)}%` }} />
                    <i style={{ width: "38%" }} />
                  </div>
                </div>
              ))}

            {!listLoading && listError && visible.length === 0 && (
              <div className="ch-empty-list">
                <p style={{ margin: "0 0 12px" }}>Couldn't load your chats.</p>
                <button className="ch-btn" onClick={loadChats}>
                  Try again
                </button>
              </div>
            )}

            {!listLoading && !listError && visible.length === 0 && (
              <div className="ch-empty-list">
                <p style={{ margin: "0 0 12px" }}>No conversations yet.</p>
                <button className="ch-btn" onClick={newChat}>
                  Start a chat
                </button>
              </div>
            )}

            {visible.length > 0 && filtered.length === 0 && (
              <div className="ch-empty-list">No chats found</div>
            )}
            {filtered.map((c) => {
              const k = chatKind(c);
              const last = c.messages[c.messages.length - 1];
              const preview = last
                ? (last.role === "user" ? "You: " : "") + (last.text || "Image")
                : c.remote
                  ? c.preview || ""
                  : "No messages yet";
              const live = c.tasks.filter(isRunning);
              const liveTask = live[live.length - 1];
              return (
                <button
                  key={c.id}
                  className={`ch-item ${c.id === activeId ? "on" : ""}`}
                  onClick={() => selectChat(c.id)}
                >
                  <div className="ch-ico" style={{ position: "relative" }}>
                    <ChatIcon job={k.job} task={k.task} size={42} />
                    {liveTask && <span className="ch-pulse" />}
                  </div>
                  <div className="ch-item-body">
                    <div className="ch-item-top">
                      <span className="ch-item-title">{c.title}</span>
                      <span className="ch-item-time">{c.time}</span>
                    </div>
                    <div className="ch-item-bot">
                      <span className="ch-item-prev">{preview}</span>
                      {c.unread > 0 && (
                        <span className="ch-badge">{c.unread}</span>
                      )}
                    </div>
                    {liveTask && (
                      <div className="ch-mini">
                        <i style={{ width: `${taskPct(liveTask)}%` }} />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ---------------- Main ---------------- */}
        <section className={`ch-main ${voice ? "voice" : ""}`}>
          {voice ? (
            <VoiceView
              agentName={agentName}
              convoId={active.id}
              onTurn={(u, r) => onVoiceTurn(active.id, u, r)}
              onBack={leaveVoice}
            />
          ) : (
            <>
              <header className="ch-head">
                <button
                  className="ch-listbtn"
                  onClick={() => setListOpen(true)}
                  aria-label="Open chats"
                >
                  <MessagesSquare size={20} />
                </button>
                {active && (
                  <ChatIcon
                    job={chatKind(active).job}
                    task={chatKind(active).task}
                    size={40}
                  />
                )}
                <div className="ch-head-text">
                  <h2 className="ch-head-title">{active?.title}</h2>
                  <div className="ch-head-sub">
                    {runCount > 0 && <span className="ch-dot" />}
                    {runCount > 1
                      ? `Working on ${runCount} tasks`
                      : runCount === 1
                        ? "Working on a task"
                        : `${AGENTS[active?.agent]?.name} agent`}
                  </div>
                </div>
                {active?.tasks?.length > 0 && view === "hidden" && (
                  <button
                    className="ch-tasksbtn"
                    onClick={() => setView("mini")}
                  >
                    <ListChecks size={16} /> Tasks
                    <span
                      className={`ch-badge ${runCount > 0 ? "" : "neutral"}`}
                    >
                      {runCount > 0 ? runCount : active.tasks.length}
                    </span>
                  </button>
                )}
              </header>

              {active?.tasks?.length > 0 && (
                <TaskBar
                  tasks={active.tasks}
                  view={view}
                  setView={setView}
                  onCancel={(taskId) => cancelTask(active.id, taskId)}
                  onOpen={openTask}
                />
              )}

              <div className="ch-scroll" ref={scrollRef}>
                {loadingId === active?.id ? (
                  <div className="ch-hero">
                    <p>Loading messages…</p>
                  </div>
                ) : loadError && active.remote ? (
                  <div className="ch-hero">
                    <p>{loadError}</p>
                  </div>
                ) : active?.messages?.length === 0 ? (
                  <div className="ch-hero">
                    <div className="ch-hero-logo">
                      <AsurMark size={34} />
                    </div>
                    <h2>How can I help you today?</h2>
                    <p>
                      Pick an agent and a model below, then ask anything or
                      start a task. Progress shows up right here.
                    </p>
                    <div className="ch-sugs">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          className="ch-sug"
                          onClick={() => {
                            setDraft(s);
                            taRef.current?.focus();
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="ch-thread">
                    {active?.messages?.map((m) => (
                      <div key={m.id} className={`ch-m ${m.role}`}>
                        {m.role === "agent" && m.agent && (
                          <AgentIcon id={m.agent} size={36} />
                        )}
                        <div className="ch-m-body">
                          <div className="ch-m-meta">
                            {m.role === "agent" && m.agent ? (
                              <>
                                <b>{AGENTS[m.agent].name}</b>
                                <span>{m.time}</span>
                              </>
                            ) : (
                              <span>{m.time}</span>
                            )}
                          </div>
                          {m.images && (
                            <div
                              className="ch-imgs"
                              style={
                                m.role === "user"
                                  ? { justifyContent: "flex-end" }
                                  : undefined
                              }
                            >
                              {m.images.map((src) => (
                                <img key={src} src={src} alt="Uploaded" />
                              ))}
                            </div>
                          )}
                          {m.text &&
                            (m.role === "agent" ? (
                              <div className="ch-bubble md">
                                <Markdown text={m.text} />
                              </div>
                            ) : (
                              <div className="ch-bubble">{m.text}</div>
                            ))}
                          {m.action && (
                            <button
                              className="ch-btn ch-msg-action"
                              onClick={() =>
                                window.location.assign(m.action!.href)
                              }
                            >
                              {m.action.label} <ArrowUpRight size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {typingChat === active?.id && (
                      <div className="ch-m">
                        <AgentIcon id={active.agent} size={36} />
                        <div className="ch-m-body">
                          <div className="ch-dots">
                            <i />
                            <i />
                            <i />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="ch-foot">
                <div className="ch-foot-in">
                  <div className="ch-box">
                    {images.length > 0 && (
                      <div className="ch-thumbs">
                        {images.map((im) => (
                          <div className="ch-thumb" key={im.id}>
                            <img src={im.url} alt={im.name} />
                            <button
                              onClick={() => removeImage(im.id)}
                              aria-label={`Remove ${im.name}`}
                            >
                              <X size={12} strokeWidth={3} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <textarea
                      ref={taRef}
                      rows={1}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onKey}
                      placeholder="Message your agents, or ask them to start a task…"
                    />

                    <div className="ch-toolbar">
                      <div className="ch-tools-left">
                        <input
                          ref={fileRef}
                          type="file"
                          accept="image/*"
                          multiple
                          hidden
                          onChange={(e) => onFiles(e.target.files)}
                        />
                        <button
                          type="button"
                          className="ch-tool"
                          onClick={() => fileRef.current?.click()}
                          aria-label="Upload image"
                          title="Upload image"
                        >
                          <ImagePlus size={20} />
                        </button>
                        {/* <Dropdown
                          title="Choose agent"
                          value={agent}
                          options={agentOptions}
                          onChange={(id) => setAgent(id as "auto" | AgentId)}
                        />
                        <Dropdown
                          title="Choose model"
                          value={model}
                          options={modelOptions}
                          onChange={(id) => setModel(id as ModelId)}
                        /> */}
                      </div>

                      <div className="ch-tools-right">
                        <button
                          type="button"
                          className="ch-voicebtn"
                          onClick={() => setVoice(true)}
                          aria-label="Start voice mode"
                          title="Voice"
                        >
                          <Mic size={19} />
                        </button>
                        <button
                          type="button"
                          className="ch-send"
                          onClick={send}
                          disabled={!canSend}
                          aria-label="Send"
                        >
                          <ArrowUp size={20} strokeWidth={2.6} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="ch-hint">
                    Enter to send · Shift + Enter for a new line · Agents can
                    make mistakes
                  </p>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* ---------------- Toasts ---------------- */}
      <div className="ch-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`ch-toast ${t.kind}`}>
            <div className="ch-toast-ic">
              {t.kind === "success" ? (
                <CheckCircle2 size={22} />
              ) : t.kind === "queued" ? (
                <ClipboardCheck size={22} />
              ) : (
                <Info size={22} />
              )}
            </div>
            <div>
              <div className="ch-toast-t">{t.title}</div>
              <div className="ch-toast-s">{t.sub}</div>
            </div>
            {t.href ? (
              <button
                className="ch-btn ch-toast-go"
                onClick={() => {
                  window.location.assign(t.href!);
                  dismissToast(t.id);
                }}
              >
                Review <ArrowUpRight size={14} />
              </button>
            ) : t.taskId ? (
              <button
                className="ch-btn ch-toast-go"
                onClick={() => {
                  openTask(t.taskId!);
                  dismissToast(t.id);
                }}
              >
                View <ArrowUpRight size={14} />
              </button>
            ) : null}
            <button
              className={t.taskId ? "ch-toast-x" : "ch-toast-x ch-toast-go"}
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
              style={t.taskId ? { marginLeft: 0 } : undefined}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
