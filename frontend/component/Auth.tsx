"use client";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  ArrowRight,
  Check,
  UserRound,
  Workflow,
  Search,
  Database,
  FileText,
  TrendingUp,
  Code,
  ShieldCheck,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";

/* ------------------------------ Types ---------------------------------- */

type Mode = "login" | "signup";
type Status = "idle" | "loading" | "success";
type Via = "form" | "guest";
type IconC = ComponentType<{ size?: number; strokeWidth?: number }>;

export type AuthResult = {
  token: string;
  tokenType: string;
  email: string;
  guest: boolean;
};

type Props = {
  /** Called after a successful register/login (and the success animation). Navigate from here. */
  onAuth?: (result: AuthResult) => void | Promise<void>;
  defaultMode?: Mode;
};

const ORBIT: { Icon: IconC; from: string; to: string }[] = [
  { Icon: Workflow, from: "#8b7bff", to: "#5d4cf7" },
  { Icon: Search, from: "#5c9bff", to: "#3b6df0" },
  { Icon: Database, from: "#4fd8e6", to: "#22a8c4" },
  { Icon: TrendingUp, from: "#ffc25a", to: "#f59e0b" },
  { Icon: FileText, from: "#ff8ab4", to: "#ec4899" },
  { Icon: Code, from: "#b07bff", to: "#7a4df0" },
  { Icon: ShieldCheck, from: "#62d6a4", to: "#3dbb87" },
];

const COPY: Record<Mode, { h: string; p: string; chips: string[] }> = {
  login: {
    h: "Welcome back.\nYour agents kept working.",
    p: "Pick up right where you left off. Tasks, chats and progress are all waiting for you.",
    chips: ["Live task progress", "Voice mode", "8 specialist agents"],
  },
  signup: {
    h: "Meet the team\nthat gets things done.",
    p: "Create your account and put a team of AI agents to work on research, writing, data and more.",
    chips: ["Free to start", "No credit card", "Set up in a minute"],
  },
};

/* ------------------------------ Helpers -------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ API layer ------------------------------ */

// Leave NEXT_PUBLIC_API_URL empty if the API is on the same origin (or proxied).
const API = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/"
).replace(/\/$/, "");

async function call(path: string, init: RequestInit) {
  let res: Response;
  try {
    // Get existing token if available
    const token =
      typeof window !== "undefined"
        ? localStorage.getItem("access_token") ||
          sessionStorage.getItem("access_token")
        : null;

    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    };

    // Attach Bearer token header if token exists
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    res = await fetch(`${API}${path}`, {
      ...init,
      headers,
      credentials: "include", // Required to send cookies across origins/requests
    });
  } catch {
    throw new Error("Couldn't reach the server. Please try again.");
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const d = data?.detail;
    throw new Error(
      typeof d === "string"
        ? d
        : Array.isArray(d) && d[0]?.msg
          ? String(d[0].msg)
          : `Request failed (${res.status})`,
    );
  }
  return data;
}

/** POST /api/v1/auth/register  (JSON) */
const registerUser = (b: {
  email: string;
  full_name: string;
  password: string;
}) =>
  call("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...b, role: "user", is_active: true }),
  });

/** POST /api/v1/auth/login  (OAuth2 form: username = email, password) */
async function loginUser(email: string, password: string) {
  const data = await call("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: email, password }),
  });
  return {
    token: String(data?.access_token ?? ""),
    tokenType: String(data?.token_type ?? "bearer"),
  };
}

function saveToken(token: string, type: string, persist: boolean) {
  try {
    // 1. Web Storage
    const s = persist ? localStorage : sessionStorage;
    s.setItem("access_token", token);
    s.setItem("token_type", type);

    // 2. Browser Cookie
    const maxAge = persist ? 60 * 60 * 24 * 7 : ""; // 7 days if remember me is checked
    const cookieOptions = `path=/; SameSite=Lax; ${maxAge ? `max-age=${maxAge};` : ""}`;

    document.cookie = `access_token=${token}; ${cookieOptions}`;
  } catch {
    /* storage blocked */
  }
}

function randomId(n: number) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(
    a,
    (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36],
  ).join("");
}

function guestCreds() {
  const id = randomId(10);
  const pool = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  const rest = Array.from(a, (b) => pool[b % pool.length]).join("");
  return {
    name: `Guest ${id.slice(0, 4).toUpperCase()}`,
    email: `guest_${id}@example.com`,
    password: `Aa1!${rest}`, // always has upper, lower, digit, symbol
  };
}

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (pw.length >= 12 && s >= 3) s = 4;
  return Math.min(s, 4);
}
const STRENGTH_LABEL = ["Too weak", "Weak", "Okay", "Good", "Strong"];
const STRENGTH_COLOR = ["#e5486b", "#e5486b", "#f59e0b", "#3dbb87", "#3dbb87"];

/* ------------------------------- Styles -------------------------------- */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700&family=Sora:wght@600;700&display=swap');

.au, .au * { box-sizing: border-box; }
.au {
  min-height: 100vh; min-height: 100dvh; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #14123a; background: #FAFAFC;
}

/* ---------- Brand panel ---------- */
.au-side {
  position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between;
  padding: 36px 44px; color: #fff;
  background:
    radial-gradient(700px 480px at 70% 38%, rgba(122,107,255,.45), transparent 65%),
    linear-gradient(180deg, #14113f, #0a0927);
}
.au-side::before, .au-side::after { content: ''; position: absolute; border-radius: 50%; filter: blur(60px); pointer-events: none; }
.au-side::before { width: 320px; height: 320px; left: -90px; top: -80px; background: rgba(139,123,255,.35); animation: au-drift 14s ease-in-out infinite; }
.au-side::after { width: 280px; height: 280px; right: -60px; bottom: -60px; background: rgba(61,187,135,.22); animation: au-drift 18s ease-in-out infinite reverse; }
@keyframes au-drift { 0%,100% { transform: translate(0,0); } 50% { transform: translate(40px, 30px); } }

.au-brand { position: relative; z-index: 2; display: inline-flex; align-items: center; gap: 12px; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 20px; }
.au-logo { width: 44px; height: 44px; border-radius: 14px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #9a8bff, #5d4cf7); box-shadow: 0 10px 26px rgba(109,92,255,.6); }

.au-stage { position: relative; z-index: 1; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 10px 0; }
.au-par { transform: translate3d(calc(var(--px, 0) * 14px), calc(var(--py, 0) * 14px), 0); transition: transform .25s ease-out; }
.au-orbit { position: relative; width: 340px; height: 340px; display: flex; align-items: center; justify-content: center; }
.au-ring { position: absolute; border-radius: 50%; border: 1.5px dashed rgba(165,150,255,.28); }
.au-ring.r1 { width: 220px; height: 220px; }
.au-ring.r2 { width: 340px; height: 340px; }
.au-core {
  position: relative; width: 120px; height: 120px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 35% 30%, #e4deff 0%, #9d8fff 36%, #5143e0 72%, #2a2190 100%);
  box-shadow: 0 0 70px rgba(122,107,255,.75), inset 0 -12px 30px rgba(20,10,100,.5);
  animation: au-breathe 3.4s ease-in-out infinite;
}
@keyframes au-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.07); } }
.au-core::before, .au-core::after { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(165,150,255,.55); opacity: 0; animation: au-wave 3s ease-out infinite; }
.au-core::after { animation-delay: 1.5s; }
@keyframes au-wave { 0% { transform: scale(1); opacity: .7; } 100% { transform: scale(2.1); opacity: 0; } }

.au-spin { position: absolute; inset: 0; animation: au-rot 28s linear infinite; }
.au-sat { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform: rotate(var(--a)) translateY(calc(var(--r) * -1)); }
.au-sat > div { width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 15px; display: flex; align-items: center; justify-content: center; color: #fff; animation: au-rot-rev 28s linear infinite; transform: rotate(calc(var(--a) * -1)); box-shadow: 0 8px 22px rgba(0,0,0,.35); }
@keyframes au-rot { to { transform: rotate(360deg); } }
@keyframes au-rot-rev { to { transform: rotate(calc(var(--a) * -1 - 360deg)); } }

.au-copy { position: relative; z-index: 2; max-width: 460px; }
.au-copy-in { animation: au-fade .5s ease; }
.au-copy h2 { margin: 0; font-family: 'Sora', sans-serif; font-size: 30px; line-height: 1.2; white-space: pre-line; }
.au-copy p { margin: 12px 0 18px; font-size: 14.5px; line-height: 1.65; color: #cfcdf5; }
.au-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.au-chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600; color: #e5e3ff; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); }
.au-chip svg { color: #62d6a4; }

/* ---------- Form side ---------- */
.au-main { display: flex; align-items: center; justify-content: center; padding: 32px 22px; background: linear-gradient(180deg, #fbfbff 0%, #f3f3fc 100%); }
.au-card { width: 100%; max-width: 440px; }
.au-mobile-brand { display: none; align-items: center; gap: 10px; margin-bottom: 22px; font-family: 'Sora', sans-serif; font-weight: 700; font-size: 18px; color: #14123a; }
.au-mobile-brand .au-logo { width: 38px; height: 38px; border-radius: 12px; }

.au-toggle { position: relative; display: grid; grid-template-columns: 1fr 1fr; padding: 5px; border-radius: 16px; background: #eeedfd; border: 1px solid #e0defa; }
.au-thumb { position: absolute; top: 5px; bottom: 5px; left: 5px; width: calc(50% - 5px); border-radius: 12px; background: #fff; box-shadow: 0 6px 16px rgba(93,76,247,.22); transition: transform .35s cubic-bezier(.3,1.2,.4,1); }
.au-toggle.signup .au-thumb { transform: translateX(100%); }
.au-tab { position: relative; z-index: 1; height: 42px; border: none; background: transparent; cursor: pointer; font-family: inherit; font-size: 14px; font-weight: 700; color: #6d6b95; transition: color .25s; }
.au-tab.on { color: #4a3fd6; }

.au-head { margin: 26px 0 20px; animation: au-fade .4s ease; }
.au-head h1 { margin: 0; font-family: 'Sora', sans-serif; font-size: 26px; color: #14123a; }
.au-head p { margin: 8px 0 0; font-size: 14px; line-height: 1.55; color: #6d6b95; }
@keyframes au-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

.au-form { display: flex; flex-direction: column; }
.au-form.shake { animation: au-shake .45s; }
@keyframes au-shake { 0%,100% { transform: none; } 20% { transform: translateX(-8px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }

.au-collapse { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows .4s ease, opacity .3s ease; }
.au-collapse.open { grid-template-rows: 1fr; opacity: 1; }
.au-collapse > div { overflow: hidden; min-height: 0; }

.au-field { padding-bottom: 14px; }
.au-label { display: block; margin-bottom: 7px; font-size: 12.5px; font-weight: 700; color: #2a2858; }
.au-input {
  display: flex; align-items: center; gap: 10px; height: 50px; padding: 0 14px; border-radius: 15px; color: #7d7ba6;
  background: #fff; border: 1.5px solid #dcdcf3; transition: border-color .2s, box-shadow .2s, color .2s;
}
.au-input:hover { border-color: #c9c5f3; }
.au-input:focus-within { border-color: #8b7bff; color: #5d4cf7; box-shadow: 0 0 0 4px rgba(139,123,255,.18); }
.au-input.err { border-color: #e5486b; color: #e5486b; }
.au-input.err:focus-within { box-shadow: 0 0 0 4px rgba(229,72,107,.15); }
.au-input.ok { border-color: #62d6a4; }
.au-input input { flex: 1; min-width: 0; height: 100%; border: none; outline: none; background: transparent; color: #14123a; font-family: inherit; font-size: 14.5px; }
.au-input input::placeholder { color: #8886ad; }
.au-eye { width: 32px; height: 32px; border-radius: 10px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #6d6b95; background: transparent; transition: background .2s; }
.au-eye:hover { background: #efeefd; color: #4a3fd6; }
.au-tick { color: #3dbb87; animation: au-pop .3s cubic-bezier(.3,1.6,.5,1); }
@keyframes au-pop { from { transform: scale(0); } to { transform: scale(1); } }
.au-err { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; font-weight: 600; color: #d23a5c; animation: au-fade .25s ease; }

.au-api-err { display: flex; align-items: flex-start; gap: 9px; margin-bottom: 16px; padding: 12px 14px; border-radius: 14px; font-size: 13px; font-weight: 600; line-height: 1.45; color: #b3273f; background: #fff0f3; border: 1px solid #f4c4cd; animation: au-fade .3s ease; }
.au-api-err svg { flex-shrink: 0; margin-top: 1px; }
.au-meter { display: flex; align-items: center; gap: 6px; margin-top: 9px; }
.au-meter i { flex: 1; height: 4px; border-radius: 4px; background: #e4e3f7; transition: background .3s; }
.au-meter span { min-width: 56px; text-align: right; font-size: 11.5px; font-weight: 700; }

.au-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 0 16px; }
.au-check { display: inline-flex; align-items: flex-start; gap: 10px; cursor: pointer; font-size: 13px; line-height: 1.45; color: #4a4878; user-select: none; }
.au-check input { position: absolute; opacity: 0; pointer-events: none; }
.au-box { width: 20px; height: 20px; margin-top: 1px; flex-shrink: 0; border-radius: 7px; display: flex; align-items: center; justify-content: center; color: transparent; background: #fff; border: 1.5px solid #cfcbf0; transition: all .2s; }
.au-check input:checked + .au-box { color: #fff; border-color: transparent; background: linear-gradient(135deg, #8b7bff, #5d4cf7); transform: scale(1.05); }
.au-check input:focus-visible + .au-box { box-shadow: 0 0 0 4px rgba(139,123,255,.25); }
.au-box.err { border-color: #e5486b; }
.au-link { border: none; background: transparent; cursor: pointer; padding: 0; font-family: inherit; font-size: 13px; font-weight: 700; color: #5d4cf7; }
.au-link:hover { text-decoration: underline; }

.au-submit {
  position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%; height: 52px;
  border: none; border-radius: 16px; cursor: pointer; color: #fff; font-family: inherit; font-size: 15px; font-weight: 700;
  background: linear-gradient(135deg, #8b7bff, #5d4cf7); box-shadow: 0 10px 26px rgba(93,76,247,.45); transition: transform .2s, box-shadow .2s, background .3s;
}
.au-submit::after { content: ''; position: absolute; top: 0; bottom: 0; width: 60px; left: -80px; transform: skewX(-20deg); background: rgba(255,255,255,.28); }
.au-submit:hover:not(:disabled)::after { animation: au-shine .8s ease; }
@keyframes au-shine { to { left: 120%; } }
.au-submit:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 30px rgba(93,76,247,.55); }
.au-submit:hover:not(:disabled) .au-arrow { transform: translateX(4px); }
.au-submit:active:not(:disabled) { transform: translateY(0); }
.au-submit:disabled { cursor: default; }
.au-submit.success { background: linear-gradient(135deg, #62d6a4, #3dbb87); box-shadow: 0 10px 26px rgba(61,187,135,.5); }
.au-arrow { transition: transform .2s; }
.au-spinner { width: 20px; height: 20px; border-radius: 50%; border: 2.5px solid rgba(255,255,255,.35); border-top-color: #fff; animation: au-rot .7s linear infinite; }
.au-swap { animation: au-fade .3s ease; display: inline-flex; align-items: center; gap: 9px; }

.au-or { display: flex; align-items: center; gap: 12px; margin: 20px 0; font-size: 12px; font-weight: 600; color: #8886ad; }
.au-or::before, .au-or::after { content: ''; flex: 1; height: 1px; background: #e3e3f6; }

.au-guest {
  display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; height: 52px; border-radius: 16px; cursor: pointer;
  font-family: inherit; font-size: 14.5px; font-weight: 700; color: #4a3fd6; background: #fff; border: 1.5px dashed #bdb6ff; transition: all .2s;
}
.au-guest:hover:not(:disabled) { background: #f4f3ff; border-style: solid; border-color: #8b7bff; transform: translateY(-2px); box-shadow: 0 10px 24px rgba(93,76,247,.15); }
.au-guest:disabled { cursor: default; opacity: .7; }
.au-guest .au-spinner { border-color: rgba(93,76,247,.25); border-top-color: #5d4cf7; }
.au-guest-note { margin: 10px 0 0; text-align: center; font-size: 12px; color: #7d7ba6; }

.au-switch { margin: 22px 0 0; text-align: center; font-size: 13.5px; color: #6d6b95; }
.au-switch .au-link { font-size: 13.5px; }

@media (max-width: 899px) {
  .au { grid-template-columns: minmax(0, 1fr); }
  .au-side { display: none; }
  .au-mobile-brand { display: flex; }
  .au-main { align-items: flex-start; padding-top: 34px; }
}
@media (max-width: 480px) {
  .au-head h1 { font-size: 23px; }
}
@media (prefers-reduced-motion: reduce) {
  .au *, .au *::before, .au *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;

/* ----------------------------- Small components ------------------------ */

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
const nextUrl = () => {
  const n = new URLSearchParams(window.location.search).get("next");

  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
};

function Field({
  label,
  icon,
  error,
  valid,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  error?: string;
  valid?: boolean;
}) {
  return (
    <div className="au-field">
      <label className="au-label">{label}</label>
      <div className={`au-input ${error ? "err" : valid ? "ok" : ""}`}>
        {icon}
        {children}
        {valid && !error && (
          <Check size={18} strokeWidth={3} className="au-tick" />
        )}
      </div>
      {error && (
        <div className="au-err" role="alert">
          <AlertCircle size={14} /> {error}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- Page --------------------------------- */

export default function Auth({ onAuth, defaultMode = "login" }: Props) {
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [agree, setAgree] = useState(false);
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Status>("idle");
  const [via, setVia] = useState<Via>("form");
  const [shake, setShake] = useState(false);
  const [apiError, setApiError] = useState("");
  const [par, setPar] = useState({ x: 0, y: 0 });
  const alive = useRef(true);
  const router = useRouter();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const signup = mode === "signup";
  const busy = status !== "idle";

  const errors: Record<string, string> = {};
  if (signup && name.trim().length < 2) errors.name = "Please enter your name";
  if (!EMAIL_RE.test(email.trim()))
    errors.email = "Enter a valid email address";
  if (!pw) errors.pw = "Enter your password";
  else if (signup && pw.length < 8) errors.pw = "Use at least 8 characters";
  if (signup && !agree) errors.agree = "Please accept the terms to continue";

  const show = (k: string) => (touched[k] ? errors[k] : undefined);
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));
  const score = strength(pw);

  const switchMode = (m: Mode) => {
    if (m === mode || busy) return;
    setMode(m);
    setTouched({});
    setShowPw(false);
    setApiError("");
  };

  /** Runs the real API calls, then plays the success animation and hands off to onAuth. */
  const finish = async (
    run: () => Promise<{ token: string; tokenType: string; email: string }>,
    how: Via,
    isGuest: boolean,
    persist: boolean,
  ) => {
    setVia(how);
    setApiError("");
    setStatus("loading");
    try {
      const r = await run();
      if (!r.token)
        throw new Error("Request succeeded but no token was returned.");
      if (!alive.current) return;

      // Only persist real session tokens (not registration placeholders)
      if (r.token !== "REGISTERED_ONLY") {
        saveToken(r.token, r.tokenType, persist);
      }

      setStatus("success");
      await sleep(900);

      if (onAuth && r.token !== "REGISTERED_ONLY") {
        await onAuth({ ...r, guest: isGuest });
      }
    } catch (e) {
      if (!alive.current) return;
      setStatus("idle");
      setApiError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
      setShake(true);
      setTimeout(() => setShake(false), 450);
      throw e; // Pass error up so .then() won't fire on failures
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setTouched({ name: true, email: true, pw: true, agree: true });
    if (Object.keys(errors).length) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
      return;
    }
    const em = email.trim();

    finish(
      async () => {
        if (signup) {
          // 1. REGISTER FLOW: Create user account
          await registerUser({
            email: em,
            full_name: name.trim(),
            password: pw,
          });

          // Return a dummy object to satisfy finish()
          return { token: "REGISTERED_ONLY", tokenType: "bearer", email: em };
        } else {
          // 2. LOGIN FLOW: Authenticate existing user
          const t = await loginUser(em, pw);
          return { ...t, email: em };
        }
      },
      "form",
      false,
      signup ? true : remember,
    ).then(() => {
      // Execute post-finish UI actions when success status resolves
      if (signup) {
        // Switch to login slide on register success
        setMode("login");
        setPw(""); // Clear password so user types it to log in
        setTouched({});
        setStatus("idle");
      } else {
        // Redirect to dashboard on login success
        router.push(nextUrl());
      }
    });
  };

  const guest = () => {
    if (busy) return;
    const g = guestCreds(); // generate temporary credentials

    finish(
      async () => {
        // Register guest account and immediately perform OAuth login
        await registerUser({
          email: g.email,
          full_name: g.name,
          password: g.password,
        });
        const t = await loginUser(g.email, g.password);
        return { ...t, email: g.email };
      },
      "guest",
      true,
      false, // session duration bounded to tab lifecycle
    ).then(() => {
      // Redirect guest to dashboard on completion
      router.push(nextUrl());
    });
  };

  const onMove = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPar({
      x: (e.clientX - r.left) / r.width - 0.5,
      y: (e.clientY - r.top) / r.height - 0.5,
    });
  };

  const copy = COPY[mode];

  return (
    <>
      <style>{css}</style>
      <div className="au">
        {/* ---------------- Brand panel ---------------- */}
        <aside
          className="au-side"
          onMouseMove={onMove}
          onMouseLeave={() => setPar({ x: 0, y: 0 })}
        >
          <div className="au-brand">
            <div className="au-logo">
              <AsurMark size={26} />
            </div>
            Asur
          </div>

          <div className="au-stage">
            <div
              className="au-par"
              style={{ "--px": par.x, "--py": par.y } as CSSProperties}
            >
              <div className="au-orbit" aria-hidden>
                <span className="au-ring r1" />
                <span className="au-ring r2" />
                <div className="au-spin">
                  {ORBIT.map(({ Icon, from, to }, i) => {
                    const outer = i % 2 === 0;
                    return (
                      <div
                        key={i}
                        className="au-sat"
                        style={
                          {
                            "--a": `${(360 / ORBIT.length) * i}deg`,
                            "--r": outer ? "170px" : "110px",
                          } as CSSProperties
                        }
                      >
                        <div
                          style={{
                            background: `linear-gradient(135deg, ${from}, ${to})`,
                          }}
                        >
                          <Icon size={22} strokeWidth={2} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="au-core">
                  <Sparkles size={38} color="#fff" strokeWidth={1.8} />
                </div>
              </div>
            </div>
          </div>

          <div className="au-copy">
            <div className="au-copy-in" key={mode}>
              <h2>{copy.h}</h2>
              <p>{copy.p}</p>
              <div className="au-chips">
                {copy.chips.map((c) => (
                  <span className="au-chip" key={c}>
                    <Check size={14} strokeWidth={3} /> {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* ---------------- Form ---------------- */}
        <main className="au-main">
          <div className="au-card">
            <div className="au-mobile-brand">
              <div className="au-logo">
                <AsurMark size={22} />
              </div>
              Asur
            </div>

            <div
              className={`au-toggle ${mode}`}
              role="tablist"
              aria-label="Login or sign up"
            >
              <span className="au-thumb" />
              <button
                type="button"
                role="tab"
                aria-selected={!signup}
                className={`au-tab ${!signup ? "on" : ""}`}
                onClick={() => switchMode("login")}
              >
                Log in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={signup}
                className={`au-tab ${signup ? "on" : ""}`}
                onClick={() => switchMode("signup")}
              >
                Sign up
              </button>
            </div>

            <div className="au-head" key={mode}>
              <h1>{signup ? "Create your account" : "Welcome back"}</h1>
              <p>
                {signup
                  ? "Start delegating work to your AI agents in under a minute."
                  : "Log in to continue with your agents and tasks."}
              </p>
            </div>

            {apiError && (
              <div className="au-api-err" role="alert">
                <AlertCircle size={17} /> {apiError}
              </div>
            )}

            <form
              className={`au-form ${shake ? "shake" : ""}`}
              onSubmit={submit}
              noValidate
            >
              {/* Name: only for sign up */}
              <div
                className={`au-collapse ${signup ? "open" : ""}`}
                aria-hidden={!signup}
              >
                <div>
                  <Field
                    label="Full name"
                    icon={<User size={19} />}
                    error={signup ? show("name") : undefined}
                    valid={signup && !errors.name && name.length > 0}
                  >
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => touch("name")}
                      placeholder="Your name"
                      autoComplete="name"
                      tabIndex={signup ? 0 : -1}
                      disabled={busy}
                    />
                  </Field>
                </div>
              </div>

              <Field
                label="Email"
                icon={<Mail size={19} />}
                error={show("email")}
                valid={!errors.email && email.length > 0}
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => touch("email")}
                  placeholder="you@company.com"
                  autoComplete="email"
                  disabled={busy}
                />
              </Field>

              <Field
                label="Password"
                icon={<Lock size={19} />}
                error={show("pw")}
              >
                <input
                  type={showPw ? "text" : "password"}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  onBlur={() => touch("pw")}
                  placeholder={
                    signup ? "At least 8 characters" : "Your password"
                  }
                  autoComplete={signup ? "new-password" : "current-password"}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="au-eye"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </Field>

              {/* Strength meter: sign up only */}
              <div
                className={`au-collapse ${signup && pw ? "open" : ""}`}
                aria-hidden={!(signup && pw)}
              >
                <div>
                  <div
                    className="au-meter"
                    style={{ marginTop: -4, marginBottom: 14 }}
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <i
                        key={n}
                        style={{
                          background:
                            n <= score ? STRENGTH_COLOR[score] : undefined,
                        }}
                      />
                    ))}
                    <span style={{ color: STRENGTH_COLOR[score] }}>
                      {STRENGTH_LABEL[score]}
                    </span>
                  </div>
                </div>
              </div>

              {/* Login extras */}
              <div
                className={`au-collapse ${!signup ? "open" : ""}`}
                aria-hidden={signup}
              >
                <div>
                  <div className="au-row">
                    <label className="au-check">
                      <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => setRemember(e.target.checked)}
                        tabIndex={signup ? -1 : 0}
                      />
                      <span className="au-box">
                        <Check size={13} strokeWidth={3.5} />
                      </span>
                      Remember me
                    </label>
                    <button
                      type="button"
                      className="au-link"
                      tabIndex={signup ? -1 : 0}
                    >
                      Forgot password?
                    </button>
                  </div>
                </div>
              </div>

              {/* Sign up terms */}
              <div
                className={`au-collapse ${signup ? "open" : ""}`}
                aria-hidden={!signup}
              >
                <div>
                  <div className="au-field" style={{ paddingTop: 2 }}>
                    <label className="au-check">
                      <input
                        type="checkbox"
                        checked={agree}
                        onChange={(e) => {
                          setAgree(e.target.checked);
                          touch("agree");
                        }}
                        tabIndex={signup ? 0 : -1}
                      />
                      <span className={`au-box ${show("agree") ? "err" : ""}`}>
                        <Check size={13} strokeWidth={3.5} />
                      </span>
                      <span>
                        I agree to the <b style={{ color: "#5d4cf7" }}>Terms</b>{" "}
                        and <b style={{ color: "#5d4cf7" }}>Privacy Policy</b>
                      </span>
                    </label>
                    {signup && show("agree") && (
                      <div className="au-err" role="alert">
                        <AlertCircle size={14} /> {errors.agree}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className={`au-submit ${status === "success" && via === "form" ? "success" : ""}`}
                disabled={busy}
              >
                {status === "loading" && via === "form" ? (
                  <span className="au-swap" key="l">
                    <span className="au-spinner" />{" "}
                    {signup ? "Creating account…" : "Logging in…"}
                  </span>
                ) : status === "success" && via === "form" ? (
                  <span className="au-swap" key="s">
                    <Check size={20} strokeWidth={3} />{" "}
                    {signup ? "Account created" : "Welcome back"}
                  </span>
                ) : (
                  <span className="au-swap" key={mode}>
                    {signup ? "Create account" : "Log in"}
                    <ArrowRight size={19} className="au-arrow" />
                  </span>
                )}
              </button>
            </form>

            <div className="au-or">or</div>

            <button
              type="button"
              className="au-guest"
              onClick={guest}
              disabled={busy}
            >
              {status === "loading" && via === "guest" ? (
                <>
                  <span className="au-spinner" /> Setting up your guest session…
                </>
              ) : status === "success" && via === "guest" ? (
                <>
                  <Check size={19} strokeWidth={3} color="#3dbb87" /> You're in
                  as a guest
                </>
              ) : (
                <>
                  <UserRound size={19} /> Continue as guest
                </>
              )}
            </button>
            <p className="au-guest-note">
              No account needed. Your chats won't be saved after you leave.
            </p>

            <p className="au-switch">
              {signup ? "Already have an account? " : "New to Asur? "}
              <button
                type="button"
                className="au-link"
                onClick={() => switchMode(signup ? "login" : "signup")}
              >
                {signup ? "Log in" : "Create an account"}
              </button>
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
