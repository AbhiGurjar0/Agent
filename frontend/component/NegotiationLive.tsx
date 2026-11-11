"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Briefcase, Handshake } from "lucide-react";
import { jobsApi, type Job, type ThreadMsg } from "../lib/jobApi";

const LABEL: Record<string, string> = {
  offer: "Offer", counter: "Counter-offer", accept: "Accepted", reject: "Declined", message: "Message",
  assignment: "Brief sent", submission: "Work submitted", revision_request: "Revision requested", reminder: "Reminder",
};
const clock = (s: number) => new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const css = `
.ng { margin-top: 20px; padding: 18px; border-radius: 20px; background: linear-gradient(180deg,#14113f,#0c0a2b); color: #d7d5ff; }
.ng-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.ng-head h3 { margin: 0; font-family: 'Sora', sans-serif; font-size: 15px; color: #fff; display: flex; align-items: center; gap: 8px; }
.ng-ai { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; color: #62d6a4; background: rgba(98,214,164,.15); }
.ng-stage { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 18px 28px; border-radius: 16px; background: rgba(255,255,255,.05); }
.ng-line { position: absolute; left: 90px; right: 90px; top: 50%; height: 2px; background: repeating-linear-gradient(90deg,#6d62ff 0 6px,transparent 6px 12px); opacity: .6; }
.ng-node { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; width: 110px; text-align: center; font-size: 12px; font-weight: 700; }
.ng-ico { width: 46px; height: 46px; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: #fff; background: linear-gradient(135deg,#8b7bff,#5d4cf7); transition: box-shadow .3s; }
.ng-node.b .ng-ico { background: linear-gradient(135deg,#ff8ab4,#ec4899); }
.ng-node.speak .ico, .ng-node.speak .ng-ico { box-shadow: 0 0 0 5px rgba(139,123,255,.35); }
.ng-packet { position: absolute; top: calc(50% - 8px); width: 16px; height: 16px; border-radius: 50%; z-index: 2; background: #fff; box-shadow: 0 0 14px 4px #8b7bff; }
.ng-packet.go { animation: ng-go 1.3s ease-in-out forwards; }
.ng-packet.back { animation: ng-back 1.3s ease-in-out forwards; }
@keyframes ng-go { from { left: 90px; opacity: 1; } to { left: calc(100% - 106px); opacity: 0; } }
@keyframes ng-back { from { left: calc(100% - 106px); opacity: 1; } to { left: 90px; opacity: 0; } }
.ng-ladder { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 12px 0; font-size: 12.5px; }
.ng-p { padding: 4px 10px; border-radius: 9px; font-weight: 700; }
.ng-p.me { background: rgba(139,123,255,.2); color: #c9c2ff; }
.ng-p.them { background: rgba(255,138,180,.18); color: #ffb3cf; }
.ng-p.deal { background: #3dbb87; color: #fff; }
.ng-feed { max-height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 4px; }
.ng-m { display: flex; flex-direction: column; max-width: 82%; animation: jb-fade .35s ease; }
.ng-m.me { align-self: flex-start; } .ng-m.them { align-self: flex-end; align-items: flex-end; }
.ng-meta { font-size: 11px; color: #9b99cf; margin-bottom: 3px; }
.ng-b { padding: 10px 13px; border-radius: 14px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; background: #231f63; }
.ng-m.them .ng-b { background: #3a1f4f; }
.ng-tag { display: inline-block; margin-right: 8px; padding: 2px 8px; border-radius: 7px; font-size: 10.5px; font-weight: 700; background: rgba(255,255,255,.12); }
.ng-tag.accept { background: #3dbb87; color: #fff; } .ng-tag.reject { background: #e5486b; color: #fff; }
.ng-typing { align-self: flex-end; display: flex; align-items: center; gap: 8px; font-size: 12px; color: #9b99cf; }
.ng-typing i { width: 6px; height: 6px; border-radius: 50%; background: #ff8ab4; display: inline-block; animation: ng-bounce 1.2s infinite; }
.ng-typing i:nth-child(2) { animation-delay: .15s; } .ng-typing i:nth-child(3) { animation-delay: .3s; }
@keyframes ng-bounce { 0%,60%,100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
`;

export default function NegotiationLive({ job }: { job: Job }) {
  const [msgs, setMsgs] = useState<ThreadMsg[]>([]);
  const feed = useRef<HTMLDivElement>(null);
  const live = job.status === "running" || job.status === "waiting";
  const name = job.freelancer?.name ?? "Freelancer";
  const auto = !!job.candidates?.find((c) => c.id === job.freelancer?.id)?.auto;
  const money = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: job.currency || "USD", maximumFractionDigits: 0 }).format(n);

  useEffect(() => {
    let alive = true;
    const pull = () => jobsApi.thread(job.id).then((d) => alive && setMsgs(d)).catch(() => {});
    pull();
    if (!live) return () => { alive = false; };
    const t = setInterval(pull, 1500);
    return () => { alive = false; clearInterval(t); };
  }, [job.id, live]);

  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" }); }, [msgs.length]);

  const ladder = useMemo(() => msgs.filter((m) => m.price != null && ["offer", "counter", "accept"].includes(m.type)), [msgs]);
  const last = msgs[msgs.length - 1];
  const thinking = live && job.blockedOn === "freelancer_reply" && auto;

  if (!job.freelancer && msgs.length === 0) return null;

  return (
    <div className="ng">
      <style>{css}</style>
      <div className="ng-head">
        <h3><Handshake size={17} /> Live negotiation</h3>
        {auto ? <span className="ng-ai">{name} is an AI agent, negotiating automatically</span> : <span className="ng-ai" style={{ color: "#ffc25a", background: "rgba(255,194,90,.15)" }}>Manual agent: its owner replies from the Agents page</span>}
      </div>

      <div className="ng-stage">
        <div className="ng-line" />
        {last && <span key={last.id} className={`ng-packet ${last.dir === "out" ? "go" : "back"}`} />}
        <div className={`ng-node ${last?.dir === "out" ? "speak" : ""}`}><div className="ng-ico"><Briefcase size={22} /></div>Hiring agent</div>
        <div className={`ng-node b ${last?.dir === "in" ? "speak" : ""}`}><div className="ng-ico"><Bot size={22} /></div>{name}</div>
      </div>

      {ladder.length > 0 && (
        <div className="ng-ladder">
          {ladder.map((m, i) => (
            <span key={m.id} style={{ display: "contents" }}>
              {i > 0 && <span>→</span>}
              <span className={`ng-p ${m.dir === "out" ? "me" : "them"}`}>{money(m.price as number)}</span>
            </span>
          ))}
          {job.agreedPrice != null && <><span>→</span><span className="ng-p deal">Deal {money(job.agreedPrice)}</span></>}
        </div>
      )}

      <div className="ng-feed" ref={feed}>
        {msgs.filter((m) => m.type !== "reminder" || true).map((m) => {
          const me = m.dir === "out";
          return (
            <div key={m.id} className={`ng-m ${me ? "me" : "them"}`}>
              <div className="ng-meta">{me ? "Hiring agent" : name} · {clock(m.ts)}</div>
              <div className="ng-b">
                <span className={`ng-tag ${m.type}`}>{LABEL[m.type] ?? m.type}</span>
                {m.price != null && <b>{money(m.price)} </b>}
                <div style={{ marginTop: 4 }}>{m.text}</div>
              </div>
            </div>
          );
        })}
        {thinking && <div className="ng-typing">{name} is thinking <i /><i /><i /></div>}
        {live && !auto && job.blockedOn === "freelancer_reply" && <div className="ng-typing">Waiting for {name}'s owner to reply</div>}
      </div>
    </div>
  );
}