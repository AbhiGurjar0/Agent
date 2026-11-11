"use client";
import { useCallback, useEffect, useState } from "react";
import { X, Check, MessageSquare, Hammer, ShieldCheck, Wallet } from "lucide-react";
import { jobsApi, type Job } from "../lib/jobApi";
import AgentDesk from "./AgentDesk";
import NegotiationLive from "./NegotiationLive";

const css = `
.dk-bg { position: fixed; inset: 0; z-index: 60; display: flex; justify-content: flex-end; background: rgba(20,18,58,.5); backdrop-filter: blur(3px); animation: dk-fade .2s ease; }
.dk { position: relative; width: 640px; max-width: 100%; height: 100%; overflow-y: auto; padding: 26px 26px 40px; background: linear-gradient(180deg,#fbfbff,#f3f3fc); box-shadow: -24px 0 70px rgba(60,40,200,.35); font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #14123a; animation: dk-slide .3s cubic-bezier(.2,.8,.2,1); }
.dk-x { position: absolute; top: 18px; right: 18px; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 10px; color: #4a3fd6; background: #fff; border: 1px solid #dcdcf3; }
.dk-x:hover { background: #f0efff; }
.dk h2 { margin: 0 44px 8px 0; font-family: 'Sora', sans-serif; font-size: 20px; line-height: 1.3; }
.dk-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 20px; }
.dk-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 999px; font-size: 12px; font-weight: 700; color: #4a3fd6; background: #e7e5ff; text-transform: capitalize; }
.dk-chip.live { color: #1f9e68; background: #dcf7ea; }
.dk-chip.live i { width: 7px; height: 7px; border-radius: 50%; background: #3dbb87; animation: dk-ping 1.8s infinite; }
.dk-steps { display: grid; grid-template-columns: repeat(4, 1fr); margin-bottom: 22px; padding: 16px 10px 12px; border-radius: 20px; background: #fff; border: 1px solid #ececf8; }
.dk-step { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: #8886ad; text-align: center; }
.dk-step::before { content: ''; position: absolute; top: 17px; right: 50%; width: 100%; height: 3px; border-radius: 2px; background: #ececf8; }
.dk-step:first-child::before { display: none; }
.dk-step.done::before, .dk-step.now::before { background: linear-gradient(90deg,#8b7bff,#5d4cf7); }
.dk-dot { position: relative; z-index: 1; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #f3f3fc; border: 2px solid #dcdcf3; color: #8886ad; transition: all .3s; }
.dk-step.done { color: #1f9e68; } .dk-step.done .dk-dot { color: #fff; border-color: transparent; background: linear-gradient(135deg,#62d6a4,#3dbb87); }
.dk-step.now { color: #4a3fd6; } .dk-step.now .dk-dot { color: #fff; border-color: transparent; background: linear-gradient(135deg,#8b7bff,#5d4cf7); box-shadow: 0 0 0 5px rgba(139,123,255,.2); animation: dk-pulse 2s infinite; }
.dk-idle { margin-top: 16px; padding: 14px 16px; border-radius: 14px; background: #fff; border: 1px solid #ececf8; font-size: 13.5px; color: #3a3865; }
.dk-skel { height: 90px; border-radius: 16px; margin-top: 12px; background: linear-gradient(90deg,#f0f0fa 25%,#f8f8ff 50%,#f0f0fa 75%); background-size: 200% 100%; animation: dk-shim 1.3s infinite; }
.jb-h3 { margin: 20px 0 10px; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 14.5px; }
.jb-desc { margin: 0; font-size: 14px; line-height: 1.7; color: #3a3865; white-space: pre-wrap; }
.jb-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.jb-f { display: flex; flex-direction: column; gap: 6px; }
.jb-f.full { grid-column: 1 / -1; }
.jb-f label { font-size: 12px; font-weight: 700; color: #5a5885; }
.jb-f input, .jb-f textarea { width: 100%; padding: 10px 12px; font-family: inherit; font-size: 14px; color: #14123a; background: #fff; border: 1.5px solid #dcdcf3; border-radius: 12px; outline: none; transition: border-color .2s, box-shadow .2s; }
.jb-f input:focus, .jb-f textarea:focus { border-color: #8b7bff; box-shadow: 0 0 0 3px rgba(139,123,255,.2); }
.jb-f textarea { resize: vertical; line-height: 1.55; }
.jb-btns { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
.jb-btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 16px; border-radius: 12px; cursor: pointer; font-family: inherit; font-size: 13.5px; font-weight: 700; color: #4a3fd6; background: #fff; border: 1px solid #d9d6fb; transition: background .2s; }
.jb-btn:hover { background: #f0efff; }
.jb-btn:disabled { opacity: .5; cursor: not-allowed; }
.jb-btn.primary { color: #fff; border-color: transparent; background: linear-gradient(135deg,#8b7bff,#5d4cf7); box-shadow: 0 6px 16px rgba(93,76,247,.3); }
.jb-btn.danger { color: #c4344f; border-color: #f4c4cd; }
.jb-dirty { font-size: 12.5px; font-weight: 600; color: #c47a05; }
.jb-spin { animation: jb-spin 1.1s linear infinite; }
.dk button:focus-visible, .dk input:focus-visible, .dk textarea:focus-visible { outline: 3px solid rgba(139,123,255,.5); outline-offset: 2px; }
@keyframes jb-spin { to { transform: rotate(360deg); } }
@keyframes jb-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes dk-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes dk-slide { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dk-sheet { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes dk-ping { 0% { box-shadow: 0 0 0 0 rgba(61,187,135,.6); } 100% { box-shadow: 0 0 0 9px rgba(61,187,135,0); } }
@keyframes dk-pulse { 50% { box-shadow: 0 0 0 9px rgba(139,123,255,.08); } }
@keyframes dk-shim { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .dk-bg, .dk, .dk *, .dk-chip i { animation: none !important; } }
@media (max-width: 767px) {
  .dk-bg { align-items: flex-end; }
  .dk { width: 100%; height: 94vh; padding: 22px 16px 36px; border-radius: 24px 24px 0 0; animation-name: dk-sheet; }
  .dk-step { font-size: 11px; } .jb-form { grid-template-columns: 1fr; }
}
`;

const STEPS = [
  { key: "negotiate", label: "Negotiate", icon: MessageSquare },
  { key: "work", label: "Work", icon: Hammer },
  { key: "validate", label: "Review", icon: ShieldCheck },
  { key: "payment", label: "Payment", icon: Wallet },
];

// Map whatever stage name the backend sends onto one of the four steps
const stepIndex = (job: Job) => {
  if (job.status === "completed") return STEPS.length;
  const s = String(job.stage ?? "").toLowerCase();
  const i = STEPS.findIndex((x) => s.includes(x.key.slice(0, 5)));
  if (i >= 0) return i;
  if (s.includes("pay")) return 3;
  if (s.includes("review") || s.includes("valid")) return 2;
  return 0;
};

export default function AgentDeskModal({ jobId, onClose, onChanged }: { jobId: string; onClose: () => void; onChanged: () => unknown }) {
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const pull = useCallback(
    () => jobsApi.get(jobId).then((j) => { setJob(j); setErr(null); }).catch((e: Error) => setErr(e.message)),
    [jobId],
  );
  useEffect(() => {
    pull();
    const t = setInterval(pull, 2000);
    return () => clearInterval(t);
  }, [pull]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);

  const done = async () => { await pull(); await onChanged(); };
  const active = !!job && (job.status === "running" || job.status === "waiting");
  const cur = job ? stepIndex(job) : 0;

  return (
    <div className="dk-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <style>{css}</style>
      <aside className="dk" role="dialog" aria-modal="true" aria-label="Agent live view">
        <button className="dk-x" aria-label="Close" onClick={onClose}><X size={16} /></button>
        {err && <div className="dk-idle" style={{ color: "#c4344f" }}>{err}</div>}
        {!job && !err && <><div className="dk-skel" /><div className="dk-skel" /></>}
        {job && (
          <>
            <h2>{job.title}</h2>
            <div className="dk-meta">
              <span className={`dk-chip ${active ? "live" : ""}`}>{active && <i />}{job.status}</span>
              <span className="dk-chip">Stage: {job.stage}</span>
              {active && <span style={{ fontSize: 12, color: "#6d6b95" }}>Updates every 2 seconds</span>}
            </div>

            <div className="dk-steps" aria-label="Job progress">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const st = i < cur ? "done" : i === cur ? "now" : "";
                return (
                  <div key={s.key} className={`dk-step ${st}`} aria-current={st === "now" ? "step" : undefined}>
                    <span className="dk-dot">{st === "done" ? <Check size={16} strokeWidth={3} /> : <Icon size={16} />}</span>
                    {s.label}
                  </div>
                );
              })}
            </div>

            <AgentDesk key={`d${job.id}`} job={job} onDone={done} />
            {job.status !== "draft" && !active && (
              <div className="dk-idle">This job is {job.status}. Nothing is needed from the agent.</div>
            )}
            {active && job.stage !== "negotiate" && job.stage !== "work" && (
              <div className="dk-idle">Nothing needs the agent right now. This view updates by itself.</div>
            )}
            <NegotiationLive key={`n${job.id}`} job={job} />
          </>
        )}
      </aside>
    </div>
  );
}