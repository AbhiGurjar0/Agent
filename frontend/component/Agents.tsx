"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
  Paperclip,
  ArrowLeft,
  ArrowRight,
  Bot,
  Sparkles,
  Wallet,
  Repeat,
  Gauge,
  ListChecks,
  Activity,
} from "lucide-react";
import Sidebar from "./Sidebar";
import AgentDeskModal from "./AgentDeskModal";
import type { DeskAction } from "../lib/agentsApi";
import {
  Agent,
  AgentTask,
  Job,
  JobStatus,
  Stats,
  STATUS_META,
  STATUS_ORDER,
  agentsApi,
} from "../lib/agentsApi";

/* --------------------------- Palette (from dashboard) --------------------------- */

const statusColor: Record<string, { from: string; to: string }> = {
  running: { from: "#5c9bff", to: "#3b6df0" },
  done: { from: "#62d6a4", to: "#3dbb87" },
  waiting_for_agent: { from: "#ffc25a", to: "#f59e0b" },
  under_review: { from: "#b07bff", to: "#7a4df0" },
  payment_received: { from: "#4fd8e6", to: "#22a8c4" },
  bug_reported: { from: "#ff8ab4", to: "#ec4899" },
};
const NEUTRAL = { from: "#b9b7d9", to: "#8886ad" };

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

.ag, .ag * , .dp, .dp * { box-sizing: border-box; }
.ag {
  min-height: 100vh; margin-left: 284px; padding: 32px 36px 56px 12px;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #14123a; background: #FAFAFC;
}

/* ---- Top bar ---- */
.ag-top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 20px; }
.ag-title { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 28px; letter-spacing: .01em; }
.ag-subtitle { margin: 4px 0 0; font-size: 13.5px; color: #6d6b95; }
.ag-spacer { flex: 1; }
.ag-search { position: relative; width: 320px; max-width: 100%; }
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
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; padding: 11px 18px; border-radius: 14px; border: none;
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
.ag-filters { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 20px; }
.ag-fchip {
  flex-shrink: 0; cursor: pointer; padding: 7px 14px; border-radius: 999px; font-family: inherit; font-size: 12.5px; font-weight: 600;
  color: #4a3fd6; background: #fff; border: 1px solid #dcdcf3; transition: background .2s, border-color .2s;
}
.ag-fchip:hover { background: #f0efff; border-color: #bdb6ff; }
.ag-fchip.on { color: #fff; border-color: transparent; background: linear-gradient(135deg, #8b7bff, #5d4cf7); }

/* ---- Pipeline strip ---- */
.ag-pipe {
  margin-bottom: 32px; padding: 18px 22px 16px; border-radius: 22px;
  background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%); border: 1px solid rgba(255,255,255,.7);
  box-shadow: 0 12px 40px rgba(60,40,200,.16);
}
.ag-pipe-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.ag-h2 { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 18px; }
.ag-total { font-size: 13px; color: #6d6b95; }
.ag-bar { display: flex; gap: 4px; height: 12px; }
.ag-seg { min-width: 8px; border-radius: 999px; transition: flex .4s ease; }
.ag-bar-empty { height: 12px; border-radius: 999px; background: #ececf8; }
.ag-legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.ag-leg {
  display: inline-flex; align-items: center; gap: 8px; cursor: pointer; padding: 7px 13px; border-radius: 11px;
  font-family: inherit; font-size: 13px; font-weight: 600; color: #3a3865; background: #fff; border: 1px solid #ececf8;
  transition: background .2s, border-color .2s;
}
.ag-leg:hover { background: #efeefd; }
.ag-leg.on { border-color: #8b7bff; background: #efeefd; }
.ag-leg i { width: 9px; height: 9px; border-radius: 50%; display: block; }
.ag-leg b { font-family: 'Sora', sans-serif; font-size: 14px; color: #14123a; }

/* ---- Sections ---- */
.ag-sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 2px 16px; flex-wrap: wrap; }
.ag-sec-sub { font-size: 13px; color: #6d6b95; }
.ag-empty { padding: 36px 10px; text-align: center; font-size: 14px; color: #6d6b95; }

/* ---- Agent cards (all the same size) ---- */
.ag-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: 1fr; gap: 20px; margin-bottom: 44px; }
.ag-card {
  position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 352px; overflow: hidden; padding: 22px 22px 18px;
  border-radius: 22px; cursor: pointer; text-align: left;
  background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%); border: 1px solid #ececf8;
  box-shadow: 0 8px 28px rgba(90,70,255,.10); transition: transform .2s ease, box-shadow .2s ease, border-color .2s;
}
.ag-card::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 4px; background: var(--ac); }
.ag-card:hover { transform: translateY(-3px); box-shadow: 0 16px 40px rgba(90,70,255,.22); border-color: #dcdaff; }
.ag-card:focus-visible { outline: 3px solid rgba(139,123,255,.55); outline-offset: 3px; }
.ag-card-head { display: flex; align-items: center; gap: 14px; }
.ag-avatar {
  width: 52px; height: 52px; flex-shrink: 0; border-radius: 16px; display: flex; align-items: center; justify-content: center;
  color: #fff; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 17px; box-shadow: 0 8px 18px rgba(90,70,255,.22);
}
.ag-id { min-width: 0; flex: 1; }
.ag-name { margin: 0; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 16.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ag-kind { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 12.5px; font-weight: 600; color: #6d6b95; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ag-kind i { width: 7px; height: 7px; border-radius: 50%; background: #b9b7d9; flex-shrink: 0; }
.ag-kind.auto { color: #1f9e68; }
.ag-kind.auto i { background: #3dbb87; }
.ag-actions { display: flex; gap: 6px; flex-shrink: 0; align-self: flex-start; }
.ag-icon-btn {
  width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  border-radius: 10px; color: #6d6b95; background: #fff; border: 1px solid #ececf8; transition: background .2s, color .2s, border-color .2s;
}
.ag-icon-btn:hover { color: #4a3fd6; background: #f0efff; border-color: #bdb6ff; }
.ag-icon-btn.del:hover { color: #c4344f; background: #fff1f4; border-color: #f4c4cd; }
.ag-desc {
  margin: 16px 0 0; height: 42px; font-size: 13.5px; line-height: 1.55; color: #3a3865;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.ag-desc.none { color: #8886ad; font-style: italic; }
.ag-skills { display: flex; flex-wrap: nowrap; gap: 6px; height: 28px; margin-top: 14px; overflow: hidden; }
.ag-pill { display: inline-flex; align-items: center; flex-shrink: 0; max-width: 100%; padding: 5px 11px; border-radius: 9px; font-size: 12.5px; font-weight: 600; color: #4a3fd6; background: #ebe9ff; white-space: nowrap; }
.ag-pill.more { color: #6d6b95; background: #f0f0f8; }
.ag-pill.green { color: #1f9e68; background: #dcf7ea; }
.ag-recent { margin-top: 16px; padding-top: 14px; border-top: 1px solid #ececf8; }
.ag-recent-label { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #8886ad; }
.ag-recent-list { display: grid; gap: 6px; margin-top: 8px; min-height: 68px; align-content: start; }
.ag-rt { display: flex; align-items: center; gap: 9px; height: 31px; font-size: 13px; font-weight: 600; color: #3a3865; }
.ag-rt i { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ag-rt span.t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ag-rt-none { font-size: 13px; color: #8886ad; padding-top: 6px; }
.ag-card-foot { margin-top: auto; padding-top: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12.5px; color: #6d6b95; font-weight: 600; }
.ag-view { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: #4a3fd6; transition: gap .2s; }
.ag-card:hover .ag-view { gap: 10px; }

/* ---- Chips (status) ---- */
.ag-chip, .ag-select {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 999px;
  font-family: inherit; font-size: 11.5px; font-weight: 700; white-space: nowrap; color: #4a3fd6; background: #e7e5ff;
}
.ag-chip::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.ag-select:disabled { cursor: default; opacity: .85; }
.ag-select { border: none; outline: none; cursor: pointer; width: 100%; padding: 8px 10px; border-radius: 10px; font-size: 12.5px; }
.s-running { color: #3b6df0; background: #e3ecff; }
.s-done { color: #1f9e68; background: #dcf7ea; }
.s-waiting_for_agent { color: #c47a05; background: #fff0d1; }
.s-under_review { color: #4a3fd6; background: #e7e5ff; }
.s-payment_received { color: #148a9f; background: #d9f6fa; }
.s-bug_reported { color: #d23a5c; background: #ffe1e8; }

.ag-act { cursor: pointer; padding: 7px 12px; border-radius: 10px; font-family: inherit; font-size: 12.5px; font-weight: 700; white-space: nowrap; color: #4a3fd6; background: #fff; border: 1px solid #dcdcf3; transition: background .2s, transform .15s; }
.ag-act:hover { background: #f0efff; transform: translateY(-1px); }
.ag-act.hot { color: #fff; border-color: transparent; background: linear-gradient(135deg,#8b7bff,#5d4cf7); box-shadow: 0 6px 16px rgba(93,76,247,.3); }
.ag-act.sm { padding: 4px 10px; font-size: 11.5px; }

/* ---- Job board (table) ---- */
.jt { overflow: hidden; border-radius: 22px; background: #fff; border: 1px solid #ececf8; box-shadow: 0 12px 40px rgba(60,40,200,.10); }
.jt-row { display: grid; grid-template-columns: minmax(0, 2.6fr) minmax(0, 1.3fr) 70px minmax(0, 1.4fr) minmax(0, 1fr); align-items: center; column-gap: 18px; padding: 14px 22px; border-top: 1px solid #ececf8; transition: background .2s; }
.jt-row.body:hover { background: #f6f6ff; }
.jt-row.th { padding: 12px 22px; border-top: none; background: #f6f6fd; font-size: 11.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #8886ad; }
.jt-job { display: flex; align-items: center; gap: 12px; min-width: 0; }
.jt-bar { width: 4px; height: 38px; flex-shrink: 0; border-radius: 4px; }
.jt-title { font-size: 14px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jt-desc { margin-top: 2px; font-size: 12.5px; color: #6d6b95; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jt-agent { display: flex; align-items: center; gap: 9px; min-width: 0; font-size: 13px; font-weight: 600; color: #3a3865; }
.jt-agent .mini { width: 26px; height: 26px; flex-shrink: 0; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; }
.jt-agent span.n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jt-muted { font-size: 13px; color: #8886ad; }
.jt-files { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: #6d6b95; font-weight: 600; }
.jt-empty { padding: 34px 20px; text-align: center; font-size: 14px; color: #6d6b95; }
.ag-filtered { display: inline-flex; align-items: center; gap: 8px; padding: 5px 6px 5px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 700; color: #4a3fd6; background: #e7e5ff; }
.ag-filtered button { width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 50%; cursor: pointer; color: #4a3fd6; background: #fff; }

/* ---- Modal (add / edit) ---- */
.ag-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 14px; border-radius: 14px; background: #fff; border: 1px solid #ececf8; font-size: 13.5px; }
.ag-switch-row b { display: block; }
.ag-switch-row small { display: block; margin-top: 2px; font-size: 12px; color: #6d6b95; }
.ag-switch { flex-shrink: 0; width: 46px; height: 26px; padding: 3px; border-radius: 999px; border: none; cursor: pointer; background: #d6d4ef; transition: background .2s; }
.ag-switch i { display: block; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .2s; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
.ag-switch.on { background: linear-gradient(135deg, #8b7bff, #5d4cf7); }
.ag-switch.on i { transform: translateX(20px); }
.ag-overlay { position: fixed; inset: 0; z-index: 65; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(20,18,58,.45); animation: ag-fade .2s ease; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #14123a; }
.ag-modal {
  width: 520px; max-width: 100%; max-height: 92vh; overflow-y: auto; padding: 26px; border-radius: 24px; display: grid; gap: 14px;
  background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%); box-shadow: 0 24px 70px rgba(60,40,200,.4);
}
.ag-modal-head { display: flex; align-items: center; justify-content: space-between; }
.ag-close { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 10px; color: #4a3fd6; background: #fff; border: 1px solid #dcdcf3; }
.ag-close:hover { background: #f0efff; }
.ag-label { display: grid; gap: 6px; font-size: 12.5px; font-weight: 700; color: #4d4b78; }
.ag-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }

/* ---- Full-screen agent page ---- */
.dp { position: fixed; inset: 0; z-index: 55; display: flex; flex-direction: column; background: #FAFAFC; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #14123a; animation: ag-fade .2s ease; }
.dp-top { display: flex; align-items: center; gap: 14px; padding: 14px 32px; background: #fff; border-bottom: 1px solid #ececf8; }
.dp-back { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; padding: 9px 14px; border-radius: 12px; font-family: inherit; font-size: 13.5px; font-weight: 700; color: #4a3fd6; background: #fff; border: 1px solid #dcdcf3; transition: background .2s, border-color .2s; }
.dp-back:hover { background: #f0efff; border-color: #bdb6ff; }
.dp-crumb { font-size: 13.5px; color: #6d6b95; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dp-crumb b { color: #14123a; }
.dp-top-actions { margin-left: auto; display: flex; gap: 10px; }
.dp-scroll { flex: 1; overflow-y: auto; }
.dp-wrap { max-width: 1240px; margin: 0 auto; padding: 28px 32px 64px; display: grid; gap: 22px; }
.dp-card { padding: 22px 24px; border-radius: 22px; background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%); border: 1px solid #ececf8; box-shadow: 0 8px 28px rgba(90,70,255,.08); }
.dp-card h3 { display: flex; align-items: center; gap: 9px; margin: 0 0 14px; font-family: 'Sora', sans-serif; font-size: 15.5px; }
.dp-card h3 svg { color: #5d4cf7; }
.dp-card h3 .cnt { margin-left: auto; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; font-weight: 700; color: #6d6b95; }
.dp-hero { display: flex; align-items: center; gap: 22px; position: relative; overflow: hidden; }
.dp-hero::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 5px; background: var(--ac); }
.dp-avatar { width: 92px; height: 92px; flex-shrink: 0; border-radius: 26px; display: flex; align-items: center; justify-content: center; color: #fff; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 30px; box-shadow: 0 12px 26px rgba(90,70,255,.28); }
.dp-name { margin: 0; font-family: 'Sora', sans-serif; font-size: 28px; line-height: 1.2; }
.dp-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.dp-lead { margin: 12px 0 0; font-size: 14px; line-height: 1.6; color: #3a3865; max-width: 720px; }
.dp-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.dp-stat { padding: 16px 18px; border-radius: 18px; background: #fff; border: 1px solid #ececf8; }
.dp-stat b { display: block; font-family: 'Sora', sans-serif; font-size: 26px; }
.dp-stat span { font-size: 12.5px; font-weight: 600; color: #6d6b95; }
.dp-cols { display: grid; grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr); gap: 22px; align-items: start; }
.dp-stack { display: grid; gap: 22px; }
.dp-text { margin: 0; font-size: 14.5px; line-height: 1.75; color: #3a3865; white-space: pre-wrap; }
.dp-muted { font-size: 13.5px; color: #8886ad; }
.dp-skills { display: flex; flex-wrap: wrap; gap: 8px; }
.dp-kv { display: grid; gap: 10px; }
.dp-kv div { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 11px 14px; border-radius: 12px; background: #fff; border: 1px solid #ececf8; }
.dp-kv small { font-size: 12.5px; font-weight: 600; color: #6d6b95; flex-shrink: 0; }
.dp-kv b { font-size: 13.5px; text-align: right; word-break: break-word; }
.dp-kv .block { display: block; }
.dp-kv .block b { display: block; margin-top: 6px; text-align: left; font-weight: 600; line-height: 1.6; }
.dp-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.dp-bar { display: flex; gap: 4px; height: 10px; margin-bottom: 14px; }
.dp-leg { display: grid; gap: 8px; }
.dp-leg div { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; color: #3a3865; }
.dp-leg i { width: 9px; height: 9px; border-radius: 50%; }
.dp-leg b { margin-left: auto; font-family: 'Sora', sans-serif; }
.dp-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.dp-list { display: grid; gap: 10px; }
.dp-task { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 16px; background: #fff; border: 1px solid #ececf8; transition: border-color .2s, box-shadow .2s; }
.dp-task:hover { border-color: #dcdaff; box-shadow: 0 8px 22px rgba(90,70,255,.10); }
.dp-task-title { font-size: 14.5px; font-weight: 700; }
.dp-task-desc { margin: 4px 0 0; font-size: 13px; line-height: 1.5; color: #6d6b95; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dp-task-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 8px; font-size: 12px; font-weight: 600; color: #8886ad; }
.dp-task-meta span { display: inline-flex; align-items: center; gap: 5px; }
.dp-task-side { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }

@keyframes ag-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ag *, .dp, .ag-overlay { animation: none !important; transition: none !important; } }

@media (max-width: 1199px) {
  .ag-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dp-cols { grid-template-columns: 1fr; }
  .dp-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 767px) {
  .ag { margin-left: 0; padding: 88px 16px 40px; }
  .ag-title { font-size: 24px; }
  .ag-grid { grid-template-columns: 1fr; }
  .ag-search { width: 100%; }
  .jt-row.th { display: none; }
  .jt-row { grid-template-columns: 1fr; row-gap: 10px; padding: 16px; }
  .dp-top { padding: 12px 16px; }
  .dp-crumb { display: none; }
  .dp-wrap { padding: 18px 16px 48px; }
  .dp-hero { flex-direction: column; align-items: flex-start; }
  .dp-name { font-size: 23px; }
  .dp-task { grid-template-columns: 1fr; }
  .dp-task-side { flex-direction: row; align-items: center; justify-content: space-between; }
}
`;

/* ----------------------------- Helpers ------------------------------- */

const ACRONYMS = new Set(["ui", "ux", "ai", "seo", "api", "qa", "ml", "ocr", "sql", "css", "html", "pdf", "cms", "crm", "erp", "3d", "2d", "it"]);
const SMALL = new Set(["and", "or", "of", "for", "to", "the", "in", "on", "with", "a", "an"]);

// "photo editing" -> "Photo Editing", "ui design" -> "UI Design"; words typed with their own capitals are kept
const titleCase = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const l = w.toLowerCase();
      if (ACRONYMS.has(l)) return l.toUpperCase();
      if (w !== l) return w;
      if (i > 0 && SMALL.has(l)) return l;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");

const sentence = (s: string) => (s ? s.trim().charAt(0).toUpperCase() + s.trim().slice(1) : s);

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const grad = (c: { from: string; to: string } | [string, string]) =>
  Array.isArray(c)
    ? `linear-gradient(135deg, ${c[0]}, ${c[1]})`
    : `linear-gradient(135deg, ${c.from}, ${c.to})`;

const sc = (s: string) => statusColor[s] ?? NEUTRAL;
const statusLabel = (s: string) =>
  STATUS_META[s as JobStatus]?.label ?? titleCase(s.replace(/_/g, " "));
const ts = (s?: string | null) => (s ? Date.parse(s) || 0 : 0);
const fmtDate = (s?: string | null) =>
  s && ts(s)
    ? new Date(ts(s)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "–";
const money = (cur: string, n: number | null | undefined) => (n == null ? "–" : `${cur} ${n}`);

const ACTION_LABEL: Record<NonNullable<DeskAction>, string> = {
  reply_offer: "Reply to offer",
  submit_work: "Submit work",
};

const RECENT = 2;

function Chip({ s }: { s: string }) {
  return <span className={`ag-chip s-${s}`}>{statusLabel(s)}</span>;
}

/* ----------------------------- Component ------------------------------ */

export default function AgentsMarketplace() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [form, setForm] = useState<FormState | null>(null); // null = modal closed
  const [query, setQuery] = useState("");
  const [skill, setSkill] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<JobStatus | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState<string | null>(null);
  const [deskId, setDeskId] = useState<string | null>(null);
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

  useEffect(() => {
    load();
    const t = setInterval(load, 4000); // so "Reply to offer / Submit work" shows up by itself
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => setTaskFilter(null), [detailId]);

  // Esc closes the agent page; the page itself locks background scroll
  useEffect(() => {
    if (!detailId) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deskId && !form) setDetailId(null);
    };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [detailId, deskId, form]);

  const jobById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  // newest first, using the matching job's creation time
  const sortedTasks = useCallback(
    (a: Agent): AgentTask[] =>
      [...a.tasks].sort((x, y) => ts(jobById.get(y.id)?.created_at) - ts(jobById.get(x.id)?.created_at)),
    [jobById],
  );

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

  const visibleJobs = useMemo(
    () =>
      jobs
        .filter((j) => !statusFilter || j.status === statusFilter)
        .sort((a, b) => ts(b.created_at) - ts(a.created_at)),
    [jobs, statusFilter],
  );

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
  const detail = detailId ? agents.find((x) => x.id === detailId) : undefined;
  const colorOf = (a: Agent) => avatarColors[Math.max(0, agents.indexOf(a)) % avatarColors.length];

  return (
    <>
      <style>{css}</style>
      <Sidebar />

      <main className="ag">
        {/* Top bar */}
        <div className="ag-top">
          <div>
            <h1 className="ag-title">Agents</h1>
            <p className="ag-subtitle">
              {agents.length} agent{agents.length === 1 ? "" : "s"} · {total} job{total === 1 ? "" : "s"} in the pipeline
            </p>
          </div>
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

        {/* Pipeline strip */}
        <section className="ag-pipe">
          <div className="ag-pipe-head">
            <h2 className="ag-h2">Job pipeline</h2>
            <span className="ag-total">Click a status to filter the job board</span>
          </div>
          {total === 0 ? (
            <div className="ag-bar-empty" />
          ) : (
            <div className="ag-bar">
              {STATUS_ORDER.filter((s) => (stats?.[s] ?? 0) > 0).map((s) => (
                <div
                  key={s}
                  className="ag-seg"
                  style={{ flex: stats![s], background: grad(sc(s)) }}
                  title={`${statusLabel(s)}: ${stats![s]}`}
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
                <i style={{ background: grad(sc(s)) }} />
                {statusLabel(s)}
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
                {titleCase(s)}
              </button>
            ))}
          </div>
        )}

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
              const color = colorOf(a);
              const tasks = sortedTasks(a);
              const recent = tasks.slice(0, RECENT);
              const running = a.tasks.filter((t) => t.status === "running").length;
              const shownSkills = a.skills.slice(0, 3);
              const extra = a.skills.length - shownSkills.length;
              return (
                <article
                  key={a.id}
                  className="ag-card"
                  style={{ ["--ac" as string]: grad(color) }}
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
                  <div className="ag-card-head">
                    <div className="ag-avatar" style={{ background: grad(color) }}>
                      {initials(a.name) || <Bot size={22} />}
                    </div>
                    <div className="ag-id">
                      <h3 className="ag-name" title={titleCase(a.name)}>{titleCase(a.name)}</h3>
                      <div className={`ag-kind ${a.auto_negotiate ? "auto" : ""}`}>
                        <i />
                        {a.auto_negotiate
                          ? `Auto-negotiates · ${money(a.currency, a.ask_price)}`
                          : "Manual replies"}
                      </div>
                    </div>
                    <div className="ag-actions">
                      <button
                        className="ag-icon-btn"
                        aria-label={`Edit ${a.name}`}
                        title="Edit"
                        onClick={(e) => {
                          e.stopPropagation();
                          editAgent(a);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="ag-icon-btn del"
                        aria-label={`Delete ${a.name}`}
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAgent(a);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <p className={`ag-desc ${a.description ? "" : "none"}`}>
                    {a.description ? sentence(a.description) : "No description added yet."}
                  </p>

                  <div className="ag-skills">
                    {shownSkills.map((s) => (
                      <span key={s} className="ag-pill">{titleCase(s)}</span>
                    ))}
                    {extra > 0 && <span className="ag-pill more">+{extra}</span>}
                  </div>

                  <div className="ag-recent">
                    <div className="ag-recent-label">
                      <span>Recent tasks</span>
                    </div>
                    <div className="ag-recent-list">
                      {recent.length === 0 ? (
                        <div className="ag-rt-none">No tasks yet.</div>
                      ) : (
                        recent.map((t) => (
                          <div key={t.id} className="ag-rt">
                            <i style={{ background: grad(sc(t.status)) }} />
                            <span className="t" title={t.title}>{sentence(t.title)}</span>
                            {t.action ? (
                              <button
                                type="button"
                                className="ag-act hot sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeskId(t.id);
                                }}
                              >
                                {ACTION_LABEL[t.action]}
                              </button>
                            ) : (
                              <Chip s={t.status} />
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="ag-card-foot">
                    <span>
                      {a.tasks.length} task{a.tasks.length === 1 ? "" : "s"}
                      {running > 0 ? ` · ${running} running` : ""}
                    </span>
                    <span className="ag-view">
                      View details <ArrowRight size={14} />
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Job board */}
        <div className="ag-sec-head">
          <h2 className="ag-h2">Job board</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {statusFilter && (
              <span className="ag-filtered">
                {statusLabel(statusFilter)}
                <button aria-label="Clear filter" onClick={() => setStatusFilter(null)}>
                  <X size={12} />
                </button>
              </span>
            )}
            <span className="ag-sec-sub">
              {visibleJobs.length} job{visibleJobs.length === 1 ? "" : "s"} · newest first
            </span>
          </div>
        </div>

        <div className="jt">
          <div className="jt-row th">
            <div>Job</div>
            <div>Agent</div>
            <div>Files</div>
            <div>Status</div>
            <div>Action</div>
          </div>
          {visibleJobs.length === 0 ? (
            <div className="jt-empty">
              {jobs.length === 0 && !loading
                ? "No jobs yet. Create one with POST /api/v1/agents/jobs."
                : "No jobs match this filter."}
            </div>
          ) : (
            visibleJobs.map((j) => {
              const owner = j.agent_id ? agents.find((x) => x.id === j.agent_id) : undefined;
              return (
                <div key={j.id} className="jt-row body">
                  <div className="jt-job">
                    <span className="jt-bar" style={{ background: grad(sc(j.status)) }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="jt-title" title={j.title}>{sentence(j.title)}</div>
                      <div className="jt-desc">
                        {fmtDate(j.created_at)}
                        {j.description ? ` · ${sentence(j.description)}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="jt-agent">
                    {j.agent_name ? (
                      <>
                        <span
                          className="mini"
                          style={{ background: grad(owner ? colorOf(owner) : NEUTRAL) }}
                        >
                          {initials(j.agent_name)}
                        </span>
                        <span className="n">{titleCase(j.agent_name)}</span>
                      </>
                    ) : (
                      <span className="jt-muted">Unassigned</span>
                    )}
                  </div>
                  <div>
                    {j.files.length > 0 ? (
                      <span className="jt-files" title={j.files.map((f) => f.filename).join(", ")}>
                        <Paperclip size={13} /> {j.files.length}
                      </span>
                    ) : (
                      <span className="jt-muted">–</span>
                    )}
                  </div>
                  <div>
                    <select
                      className={`ag-select s-${j.status}`}
                      value={j.status}
                      disabled={j.managed}
                      title={
                        j.managed
                          ? "Updates automatically while the agent works"
                          : undefined
                      }
                      onChange={(e) => changeStatus(j, e.target.value as JobStatus)}
                      aria-label={`Status of ${j.title}`}
                    >
                      {STATUS_ORDER.map((st) => (
                        <option key={st} value={st}>
                          {statusLabel(st)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    {j.managed ? (
                      <button
                        type="button"
                        className={`ag-act ${j.action ? "hot" : ""}`}
                        onClick={() => setDeskId(j.id)}
                      >
                        {j.action ? ACTION_LABEL[j.action] : "Open live view"}
                      </button>
                    ) : (
                      <span className="jt-muted">–</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* Full-screen agent page */}
      {detail &&
        (() => {
          const color = colorOf(detail);
          const tasks = sortedTasks(detail);
          const counts: Record<string, number> = {};
          tasks.forEach((t) => (counts[t.status] = (counts[t.status] ?? 0) + 1));
          const statusKeys = Object.keys(counts);
          const running = counts["running"] ?? 0;
          const needAction = tasks.filter((t) => t.action).length;
          const paid = counts["payment_received"] ?? 0;
          const shown = taskFilter ? tasks.filter((t) => t.status === taskFilter) : tasks;
          return (
            <div className="dp" role="dialog" aria-modal="true" aria-label={`${detail.name} details`}>
              <div className="dp-top">
                <button className="dp-back" onClick={() => setDetailId(null)}>
                  <ArrowLeft size={16} /> Back to agents
                </button>
                <div className="dp-crumb">
                  Agents / <b>{titleCase(detail.name)}</b>
                </div>
                <div className="dp-top-actions">
                  <button className="ag-btn ghost" onClick={() => editAgent(detail)}>
                    <Pencil size={15} /> Edit
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

              <div className="dp-scroll">
                <div className="dp-wrap">
                  <section className="dp-card dp-hero" style={{ ["--ac" as string]: grad(color) }}>
                    <div className="dp-avatar" style={{ background: grad(color) }}>
                      {initials(detail.name) || <Bot size={34} />}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <h2 className="dp-name">{titleCase(detail.name)}</h2>
                      <div className="dp-tags">
                        <span className={`ag-pill ${detail.auto_negotiate ? "green" : ""}`}>
                          {detail.auto_negotiate ? "Auto-negotiates" : "Manual replies"}
                        </span>
                        {running > 0 && <span className="ag-chip s-running">{running} running</span>}
                        {needAction > 0 && (
                          <span className="ag-chip s-waiting_for_agent">{needAction} need action</span>
                        )}
                      </div>
                      {detail.description && <p className="dp-lead">{sentence(detail.description)}</p>}
                    </div>
                  </section>

                  <div className="dp-stats">
                    <div className="dp-stat"><b>{tasks.length}</b><span>Total tasks</span></div>
                    <div className="dp-stat"><b>{running}</b><span>Running</span></div>
                    <div className="dp-stat"><b>{needAction}</b><span>Need action</span></div>
                    <div className="dp-stat"><b>{paid}</b><span>Payments received</span></div>
                  </div>

                  <div className="dp-cols">
                    <div className="dp-stack">
                      <section className="dp-card">
                        <h3><Sparkles size={17} /> About</h3>
                        {detail.description ? (
                          <p className="dp-text">{sentence(detail.description)}</p>
                        ) : (
                          <span className="dp-muted">No description added yet.</span>
                        )}
                      </section>

                      <section className="dp-card">
                        <h3><Gauge size={17} /> Skills <span className="cnt">{detail.skills.length}</span></h3>
                        {detail.skills.length > 0 ? (
                          <div className="dp-skills">
                            {detail.skills.map((s) => (
                              <span key={s} className="ag-pill">{titleCase(s)}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="dp-muted">No skills listed.</span>
                        )}
                      </section>

                      <section className="dp-card">
                        <h3><ListChecks size={17} /> Tasks <span className="cnt">{shown.length} of {tasks.length}</span></h3>
                        {statusKeys.length > 1 && (
                          <div className="dp-tabs">
                            <button
                              className={`ag-fchip ${taskFilter === null ? "on" : ""}`}
                              onClick={() => setTaskFilter(null)}
                            >
                              All ({tasks.length})
                            </button>
                            {statusKeys.map((s) => (
                              <button
                                key={s}
                                className={`ag-fchip ${taskFilter === s ? "on" : ""}`}
                                onClick={() => setTaskFilter(taskFilter === s ? null : s)}
                              >
                                {statusLabel(s)} ({counts[s]})
                              </button>
                            ))}
                          </div>
                        )}
                        {shown.length === 0 ? (
                          <span className="dp-muted">No tasks assigned.</span>
                        ) : (
                          <div className="dp-list">
                            {shown.map((t) => {
                              const job = jobById.get(t.id);
                              return (
                                <div key={t.id} className="dp-task">
                                  <div style={{ minWidth: 0 }}>
                                    <div className="dp-task-title">{sentence(t.title)}</div>
                                    {job?.description && <p className="dp-task-desc">{sentence(job.description)}</p>}
                                    <div className="dp-task-meta">
                                      <span>{fmtDate(job?.created_at)}</span>
                                      {job && job.files.length > 0 && (
                                        <span title={job.files.map((f) => f.filename).join(", ")}>
                                          <Paperclip size={12} /> {job.files.length} file{job.files.length === 1 ? "" : "s"}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="dp-task-side">
                                    <Chip s={t.status} />
                                    {t.action ? (
                                      <button type="button" className="ag-act hot" onClick={() => setDeskId(t.id)}>
                                        {ACTION_LABEL[t.action]}
                                      </button>
                                    ) : job?.managed ? (
                                      <button type="button" className="ag-act" onClick={() => setDeskId(t.id)}>
                                        Open live view
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    </div>

                    <div className="dp-stack">
                      <section className="dp-card">
                        <h3><Repeat size={17} /> Pricing &amp; negotiation</h3>
                        <div className="dp-kv">
                          <div><small>Mode</small><b>{detail.auto_negotiate ? "Auto-negotiate" : "Manual replies"}</b></div>
                          {detail.auto_negotiate ? (
                            <>
                              <div><small>Asking price</small><b>{money(detail.currency, detail.ask_price)}</b></div>
                              <div>
                                <small>Lowest accepted</small>
                                <b>{detail.min_price != null ? money(detail.currency, detail.min_price) : "Not set"}</b>
                              </div>
                              <div><small>Currency</small><b>{detail.currency || "USD"}</b></div>
                              <div><small>Style</small><b>{titleCase(detail.negotiation_style || "balanced")}</b></div>
                              <div><small>Max rounds</small><b>{detail.max_rounds || 4}</b></div>
                              {detail.instructions && (
                                <div className="block">
                                  <small>Extra instructions</small>
                                  <b>{sentence(detail.instructions)}</b>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="block">
                              <small>Offers are answered by you from the live view.</small>
                            </div>
                          )}
                        </div>
                      </section>

                      <section className="dp-card">
                        <h3><Wallet size={17} /> Payout</h3>
                        <div className="dp-kv">
                          <div>
                            <small>PayPal email</small>
                            <b>{detail.paypal_email || "Not set"}</b>
                          </div>
                        </div>
                      </section>

                      <section className="dp-card">
                        <h3><Activity size={17} /> Status breakdown</h3>
                        {tasks.length === 0 ? (
                          <span className="dp-muted">Nothing to show yet.</span>
                        ) : (
                          <>
                            <div className="dp-bar">
                              {statusKeys.map((s) => (
                                <div
                                  key={s}
                                  className="ag-seg"
                                  style={{ flex: counts[s], background: grad(sc(s)) }}
                                  title={`${statusLabel(s)}: ${counts[s]}`}
                                />
                              ))}
                            </div>
                            <div className="dp-leg">
                              {statusKeys.map((s) => (
                                <div key={s}>
                                  <i style={{ background: grad(sc(s)) }} />
                                  {statusLabel(s)}
                                  <b>{counts[s]}</b>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </section>

                      <section className="dp-card">
                        <h3>Agent details</h3>
                        <div className="dp-kv">
                          <div><small>Agent ID</small><b className="dp-mono">{detail.id}</b></div>
                          <div><small>Skills</small><b>{detail.skills.length}</b></div>
                          <div><small>Total tasks</small><b>{tasks.length}</b></div>
                        </div>
                      </section>
                    </div>
                  </div>
                </div>
              </div>
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