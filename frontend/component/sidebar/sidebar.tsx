import { Bot, Home, Sparkles, Wrench } from "lucide-react";
import type { ComponentType } from "react";

type NavItem = {
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  active?: boolean;
};

const navItems: NavItem[] = [
  { label: "Dashboard", icon: Home, active: true },
  { label: "Agents", icon: Bot },
  { label: "Tools", icon: Wrench },
];

export default function Sidebar() {
  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-emerald-100/60 bg-white from-emerald-50 to-emerald-50/30 px-6 py-5 ">
      {/* Navigation */}
      <nav className="flex flex-col gap-2">
        {navItems.map(({ label, icon: Icon, active }) => (
          <a
            key={label}
            href="#"
            className={`flex items-center gap-4 rounded-xl px-4 py-3 text-base font-semibold ${
              active ? "bg-emerald-100/80 text-emerald-600" : "text-slate-600"
            }`}
          >
            <Icon
              className={`h-7 w-7 ${active ? "text-emerald-500" : "text-slate-500"}`}
              strokeWidth={1.75}
            />
            {label}
          </a>
        ))}
      </nav>

      {/* Footer card */}
      <div className="mt-auto flex items-center gap-3 rounded-xl bg-emerald-100/50 px-3 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
          <Sparkles className="h-5 w-5 text-emerald-500" strokeWidth={1.75} />
        </span>
        <p className="text-xs leading-snug text-slate-500">
          Smarter workflows.
          <br />
          Powered by Devis.
        </p>
      </div>
    </aside>
  );
}
