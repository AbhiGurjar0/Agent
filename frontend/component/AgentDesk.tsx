"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Send, Upload, X } from "lucide-react";
import { jobsApi, type Job } from "../lib/jobApi";
import { jobFilesApi } from "../lib/jobFileApi";

export default function AgentDesk({ job, onDone }: { job: Job; onDone: () => unknown }) {
  const name = job.freelancer?.name ?? "the agent";
  const auto = !!job.candidates?.find((c) => c.id === job.freelancer?.id)?.auto;
  const lastOffer = (job.offers ?? []).filter((o) => o.by === "agent").slice(-1)[0];

  const answering = !auto && job.stage === "negotiate" && job.status === "waiting" && job.blockedOn === "freelancer_reply" && !!lastOffer;
  const submitting = !!job.freelancer && job.stage === "work" && (job.status === "waiting" || job.status === "running");

  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState("");
  const [links, setLinks] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);

  useEffect(() => { setPrice(lastOffer ? String(lastOffer.price ?? "") : ""); setMsg(""); }, [lastOffer?.round, job.id]); // eslint-disable-line

  if (!answering && !submitting) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); await onDone(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(false); }
  };
  const reply = (type: "accept" | "counter" | "reject") =>
    run(() => jobsApi.reply(job.id, {
      sender: "freelancer", type, message: msg,
      price: type === "reject" ? undefined : type === "accept" ? (lastOffer?.price ?? undefined) : Number(price),
    }));

  const box: React.CSSProperties = { marginTop: 18, padding: 16, borderRadius: 16, background: "#fff", border: "1.5px dashed #bdb6ff" };

  return (
    <div style={box}>
      <h3 className="jb-h3" style={{ marginTop: 0 }}>Demo desk: you are {name}</h3>

      {answering && lastOffer && (
        <>
          <p className="jb-desc">The hiring agent offered <b>{job.currency} {lastOffer.price}</b> (round {lastOffer.round}).</p>
          <div className="jb-form" style={{ marginTop: 12 }}>
            <div className="jb-f"><label>Your counter price</label><input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div className="jb-f full"><label>Message</label><textarea rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Optional: explain your price" /></div>
          </div>
          <div className="jb-btns">
            <button className="jb-btn primary" disabled={busy} onClick={() => reply("accept")}><Check size={15} />Accept {job.currency} {lastOffer.price}</button>
            <button className="jb-btn" disabled={busy || !(Number(price) > 0)} onClick={() => reply("counter")}><Send size={15} />Counter</button>
            <button className="jb-btn danger" disabled={busy} onClick={() => reply("reject")}><X size={15} />Decline</button>
          </div>
        </>
      )}

      {submitting && (
        <>
          {job.blockedOn === "revision" && job.lastValidation?.fixes_text && (
            <p className="jb-dirty" style={{ marginBottom: 10 }}>Revision requested: {job.lastValidation.fixes_text}</p>
          )}
          <p className="jb-desc">Upload the finished work for {name}. It goes to validation and then payment.</p>
          <div className="jb-form" style={{ marginTop: 12 }}>
            <div className="jb-f full"><label>Delivery message</label><textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Describe what you built" /></div>
            <div className="jb-f full"><label>Links (comma or new line)</label><input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://..." /></div>
          </div>
          <input ref={pick} type="file" multiple hidden onChange={(e) => { setFiles((p) => [...p, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
          <div className="jb-btns">
            <button className="jb-btn" type="button" disabled={busy} onClick={() => pick.current?.click()}><Upload size={15} />Attach files{files.length ? ` (${files.length})` : ""}</button>
            <button className="jb-btn primary" disabled={busy || (!msg.trim() && !links.trim() && files.length === 0)}
              onClick={() => run(async () => { await jobFilesApi.submit(job.id, { message: msg, links, files }); setMsg(""); setLinks(""); setFiles([]); })}>
              {busy ? <Loader2 size={15} className="jb-spin" /> : <Send size={15} />}Submit work as {name}
            </button>
          </div>
          {files.length > 0 && <p style={{ fontSize: 12, color: "#6d6b95" }}>{files.map((f) => f.name).join(", ")}</p>}
        </>
      )}
      {err && <p className="jb-dirty" style={{ marginTop: 10, color: "#c4344f" }}>{err}</p>}
    </div>
  );
}