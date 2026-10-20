import { Bell, ChevronDown, LogOut, User } from "lucide-react";

function Logo() {
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12 shrink-0" fill="none">
      <path
        d="M4 6h18c11 0 20 8 20 18s-9 18-20 18H4V28h6v8h12c6.6 0 12-5 12-12S28.6 12 22 12H10v10H4V6Z"
        className="fill-emerald-500"
      />
      <path d="M4 14h10v6H4z" className="fill-emerald-400" />
    </svg>
  );
}

export default function Topbar() {
  return (
    <header className="relative z-10 flex h-20 w-full shrink-0 items-center justify-between border-b border-slate-100 bg-white px-8">
      <div className="flex items-center gap-3">
        <Logo />
        <div className="leading-tight">
          <h1 className="text-2xl font-bold text-slate-900">Devis</h1>
          <p className="text-[11px] text-slate-500">
            your personal agent for everthing
          </p>
        </div>
      </div>

      <div className="flex items-center gap-6">
        {/* Notifications */}
        <button type="button" className="relative p-1">
          <Bell className="h-6 w-6 text-emerald-700" strokeWidth={1.75} />
          <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />
        </button>

        {/* Profile */}
        <div className="flex items-center gap-3 cursor-pointer">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-lg font-semibold text-slate-900">
            A
          </span>
          <span className="text-sm font-semibold text-slate-900">Abhishek</span>
          <ChevronDown className="h-4 w-4 text-slate-900" strokeWidth={2.5} />
        </div>
      </div>

      <div className="absolute right-8 top-[72px] w-48 rounded-xl border border-slate-100 bg-white py-2 shadow-lg shadow-slate-200/60">
        <a
          href="#"
          className="flex items-center gap-4 px-5 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          <User className="h-5 w-5 text-slate-500" strokeWidth={1.75} />
          See Profile
        </a>
        <a
          href="#"
          className="flex items-center gap-4 px-5 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          <LogOut className="h-5 w-5 text-slate-500" strokeWidth={1.75} />
          Logout
        </a>
      </div>
    </header>
  );
}
