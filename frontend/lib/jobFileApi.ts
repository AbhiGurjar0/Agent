// File attachments for engine jobs. Needs `export const BASE` in lib/jobApi.ts.
import { BASE } from "./jobApi";

export type JobFile = { id: string; filename: string; size: number; content_type?: string | null };

function auth(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function check(r: Response) {
  if (r.ok) return;
  let msg = `Request failed (${r.status})`;
  try {
    const d = await r.json();
    if (typeof d.detail === "string") msg = d.detail;
  } catch {
    /* no json body */
  }
  throw new Error(msg);
}

export const jobFilesApi = {
  async upload(jobId: string, files: File[]) {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f)); // no Content-Type header: the browser adds the boundary
    await check(await fetch(`${BASE}/jobs/${jobId}/files`, { method: "POST", body: fd, credentials: "include", headers: auth() }));
  },
  async remove(jobId: string, fileId: string) {
    await check(await fetch(`${BASE}/jobs/${jobId}/files/${fileId}`, { method: "DELETE", credentials: "include", headers: auth() }));
  },
  async download(jobId: string, file: JobFile) {
    const r = await fetch(`${BASE}/jobs/${jobId}/files/${file.id}`, { credentials: "include", headers: auth() });
    await check(r);
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    a.click();
    URL.revokeObjectURL(url);
  },
   async submit(jobId: string, p: { message: string; links: string; files: File[] }) {
    const fd = new FormData();
    fd.append("message", p.message);
    fd.append("links", p.links);
    p.files.forEach((f) => fd.append("files", f));
    await check(await fetch(`${BASE}/jobs/${jobId}/submit`, { method: "POST", body: fd, credentials: "include", headers: auth() }));
  },
};