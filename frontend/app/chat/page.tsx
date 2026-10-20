import {
  ArrowRight,
  CalendarDays,
  Code2,
  FileText,
  GraduationCap,
  Lightbulb,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import type { ComponentType } from "react";

type Task = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
};

const tasks: Task[] = [
  {
    label: "Create a study plan for my exams",
    icon: GraduationCap,
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
  },
  {
    label: "Write a professional email",
    icon: FileText,
    iconBg: "bg-blue-100",
    iconColor: "text-blue-500",
  },
  {
    label: "Write a Python script to sort a list",
    icon: Code2,
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
  },
  {
    label: "Plan my weekly schedule",
    icon: CalendarDays,
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
  },
];

export default function ChatWithAI() {
  return (
    <div className="flex h-full w-full flex-col bg-slate-50 over">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-10 pt-8 ">
        {/* Messages */}
        <div className="mt-8 flex flex-col gap-5">
          {/* User message */}
          <div className="flex items-center justify-end gap-3">
            <div className="rounded-3xl bg-emerald-100 px-5 py-3.5 text-[15px] text-slate-800">
              Create a study plan for my exams
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500">
              <User className="h-5 w-5 text-white" strokeWidth={2} />
            </div>
          </div>

          {/* AI message */}
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
              <Lightbulb
                className="h-5 w-5 text-emerald-500"
                strokeWidth={1.75}
              />
            </div>
            <div>
              <div className="max-w-md rounded-2xl border border-slate-100 bg-slate-100/70 p-4">
                <p className="text-[15px] leading-relaxed text-slate-800">
                  Sure! I’ll create a personalized study plan for your exams.
                  This will include a daily schedule, subject-wise topics, and
                  revision milestones.
                </p>
                <button
                  type="button"
                  className="mt-4 flex w-full items-center justify-between rounded-xl bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-700"
                >
                  <span className="flex items-center gap-3">
                    <FileText className="h-5 w-5" strokeWidth={1.75} />
                    View Study Plan
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              <span className="mt-2 block pl-1 text-xs text-slate-400">
                2:14 PM
              </span>
            </div>
          </div>
        </div>

        {/* Suggested tasks */}
        <section className="mt-8 pb-6">
          <div className="mb-3 flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-emerald-500" strokeWidth={1.75} />
            <h2 className="text-base font-medium text-slate-500">
              Suggested Tasks
            </h2>
          </div>
          <ul className="flex flex-col gap-3">
            {tasks.map(({ label, icon: Icon, iconBg, iconColor }) => (
              <li key={label}>
                <button
                  type="button"
                  className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm"
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconBg}`}
                  >
                    <Icon className={`h-5 w-5 ${iconColor}`} />
                  </span>
                  <span className="flex-1 text-[15px] text-slate-800">
                    {label}
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Input bar pinned to bottom */}
       <footer className="shrink-0 px-10 pb-6">
        <div className="flex items-center gap-3 rounded-2xl bg-slate-100 p-2">
          <input
            type="text"
            placeholder="Type your request..."
            className="h-12 flex-1 rounded-xl border-0 bg-white px-4 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
          <button
            type="button"
            aria-label="Send"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white"
          >
            <Send className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
      </footer>
     
    </div>
    
  );
}
