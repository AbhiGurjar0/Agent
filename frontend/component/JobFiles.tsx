"use client";
import { useRef, useState } from "react";
import { Paperclip, Upload, Download, X, Loader2 } from "lucide-react";
import { jobFilesApi, type JobFile } from "../lib/jobFileApi";

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Files section for a job. Uses the jb-* classes already defined on the Jobs page. */
export default function JobFiles({
  jobId,
  files,
  editable,
  onChange,
}: {
  jobId: string;
  files: JobFile[];
  editable: boolean;
  onChange: () => unknown;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  if (!editable && files.length === 0) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const row: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 12,
    background: "#fff", border: "1px solid #ececf8", fontSize: 13.5, color: "#3a3865",
  };
  const iconBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30,
    borderRadius: 9, cursor: "pointer", background: "#fff", border: "1px solid #dcdcf3", color: "#4a3fd6",
  };

  return (
    <div>
      <h3 className="jb-h3">Files</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {files.map((f) => (
          <div key={f.id} style={row}>
            <Paperclip size={15} color="#8886ad" />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{f.filename}</span>
            <span style={{ color: "#8886ad", fontSize: 12 }}>{size(f.size)}</span>
            <button type="button" style={iconBtn} aria-label={`Download ${f.filename}`} onClick={() => run(() => jobFilesApi.download(jobId, f))}>
              <Download size={14} />
            </button>
            {editable && (
              <button type="button" style={{ ...iconBtn, color: "#c4344f", borderColor: "#f4c4cd" }} aria-label={`Remove ${f.filename}`} disabled={busy} onClick={() => run(() => jobFilesApi.remove(jobId, f.id))}>
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {editable && (
        <div className="jb-btns" style={{ marginTop: files.length ? 12 : 0 }}>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (picked.length) run(() => jobFilesApi.upload(jobId, picked));
            }}
          />
          <button type="button" className="jb-btn" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 size={15} className="jb-spin" /> : <Upload size={15} />}
            Attach files
          </button>
          <span style={{ alignSelf: "center", fontSize: 12, color: "#8886ad" }}>Up to 10 files, 25 MB each. Sent with the brief.</span>
        </div>
      )}
      {err && <p className="jb-dirty" style={{ marginTop: 10, color: "#c4344f" }}>{err}</p>}
    </div>
  );
}