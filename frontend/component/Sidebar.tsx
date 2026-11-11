"use client";
import { useState } from "react";
import {
  LayoutDashboard,
  CheckSquare,
  MessageSquare,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  path: string;
};

const mainItems: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    path: "/dashboard",
  },
  { id: "tasks", label: "Tasks", icon: CheckSquare, path: "/tasks" },
  { id: "chats", label: "Chats", icon: MessageSquare, path: "/chat" },
  { id:"jobs",label:"Jobs", icon:CheckSquare,path:"/jobs"},
  { id:"agents",label:"Agents", icon:CheckSquare,path:"/agents"}
];

const bottomItems: NavItem[] = [
  { id: "settings", label: "Settings", icon: Settings, path: "/settings" },
  { id: "logout", label: "Logout", icon: LogOut, path: "/auth" },
];

const removeCookie = (name: string) => {
  document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
};

/* Self-contained styles (no Tailwind needed) so the theme always renders */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600&family=Sora:wght@600;700&display=swap');

.asur-root, .asur-root * { box-sizing: border-box; }
.asur-root { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }

/* ---------- Desktop sidebar ---------- */
.asur-sidebar {
  position: fixed;
  top: 0; left: 0; bottom: 0;
  width: 280px;
  display: flex; flex-direction: column;
  padding: 22px 14px 16px;
  background: linear-gradient(180deg, #16133f 0%, #0f0c32 100%);
  border: 1px solid rgba(255,255,255,0.10);
  box-shadow: 0 0 0 4px rgba(120,100,255,0.08), 0 20px 60px rgba(70,50,220,0.35);
  z-index: 30;
}

.asur-logo { display: flex; align-items: center; gap: 12px; padding: 0 8px 28px; }
.asur-logo-tile {
  width: 42px; height: 42px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 14px;
  background: linear-gradient(135deg, #9a8bff 0%, #5d4cf7 100%);
  box-shadow: 0 8px 22px rgba(109,92,255,0.55), inset 0 1px 0 rgba(255,255,255,0.35);
}
.asur-logo-text {
  font-family: 'Sora', sans-serif;
  font-weight: 700; font-size: 22px; letter-spacing: 0.04em;
  color: #fff;
}

.asur-nav { display: flex; flex-direction: column; gap: 6px; }
.asur-bottom {
  margin-top: auto; display: flex; flex-direction: column; gap: 6px;
  padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.08);
}

.asur-item {
  display: flex; align-items: center; gap: 16px;
  width: 100%; padding: 13px 16px;
  border: 1px solid transparent; border-radius: 14px;
  background: transparent; cursor: pointer;
  font-family: inherit; font-size: 15px; font-weight: 500;
  color: #c4c3e3; text-align: left;
  transition: background .2s, color .2s, border-color .2s;
}
.asur-item:hover { background: rgba(255,255,255,0.06); color: #fff; }
.asur-item.active {
  background: #2b2765; color: #fff; font-weight: 600;
  border-color: rgba(150,130,255,0.28);
}
.asur-item.logout:hover { background: rgba(255,110,140,0.10); color: #ff9db3; }

/* ---------- Mobile ---------- */
.asur-topbar, .asur-drawer-wrap { display: none; }

@media (max-width: 767px) {
  .asur-sidebar { display: none; }

  .asur-topbar {
    position: fixed; top: 0; left: 0; right: 0; height: 64px; z-index: 40;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 16px;
    background: linear-gradient(180deg, #16133f, #0f0c32);
    border-bottom: 1px solid rgba(255,255,255,0.10);
    box-shadow: 0 8px 30px rgba(70,50,220,0.3);
  }
  .asur-topbar .asur-logo { padding: 0; }
  .asur-topbar .asur-logo-tile { width: 38px; height: 38px; border-radius: 12px; }

  .asur-icon-btn {
    width: 42px; height: 42px; border-radius: 12px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,0.06); color: #e2e1ff;
    border: 1px solid rgba(255,255,255,0.10);
  }

  .asur-drawer-wrap { display: block; position: fixed; inset: 0; z-index: 50; pointer-events: none; }
  .asur-drawer-wrap.open { pointer-events: auto; }
  .asur-overlay {
    position: absolute; inset: 0; background: rgba(5,4,25,0.65);
    backdrop-filter: blur(4px); opacity: 0; transition: opacity .3s;
  }
  .asur-drawer-wrap.open .asur-overlay { opacity: 1; }
  .asur-drawer {
    position: absolute; top: 0; left: 0; bottom: 0; width: 280px;
    display: flex; flex-direction: column; padding: 22px 14px 16px;
    background: linear-gradient(180deg, #16133f 0%, #0f0c32 100%);
    border-right: 1px solid rgba(255,255,255,0.12);
    border-radius: 0 26px 26px 0;
    box-shadow: 0 0 60px rgba(70,50,220,0.5);
    transform: translateX(-100%); transition: transform .3s ease;
  }
  .asur-drawer-wrap.open .asur-drawer { transform: translateX(0); }
  .asur-close { position: absolute; top: 18px; right: 14px; }
}
`;

function AsurMark() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
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

function Logo() {
  return (
    <div className="asur-logo">
      <div className="asur-logo-tile">
        <AsurMark />
      </div>
      <span className="asur-logo-text">Asur</span>
    </div>
  );
}

function Items({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (item: NavItem) => void;
}) {
  const render = (item: NavItem) => {
    const Icon = item.icon;
    return (
      <Link
        key={item.id}
        href={item.path}
        onClick={() => onSelect(item)}
        className={`asur-item ${active === item.id ? "active" : ""} ${
          item.id === "logout" ? "logout" : ""
        }`}
      >
        <Icon size={20} strokeWidth={1.9} />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <>
      <nav className="asur-nav">{mainItems.map(render)}</nav>
      <div className="asur-bottom">{bottomItems.map(render)}</div>
    </>
  );
}

export default function Sidebar({
  defaultActive = "dashboard",
  onNavigate,
}: {
  defaultActive?: string;
  onNavigate?: (id: string) => void;
}) {
  const [active, setActive] = useState(defaultActive);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const handleSelect = (item: NavItem) => {
    onNavigate?.(item.id);
    if (item.id === "logout") {
      removeCookie("access_token");
      localStorage.removeItem("access_token");
      sessionStorage.removeItem("access_token");
      console.log("logout");
    } else {
      setActive(item.id);
    }
    setOpen(false);
  };

  if (pathname === "/auth") return null;

  return (
    <div className="asur-root">
      <style>{css}</style>

      {/* Desktop / tablet: fixed sidebar on the left */}
      <aside className="asur-sidebar">
        <Logo />
        <Items active={active} onSelect={handleSelect} />
      </aside>

      {/* Phone: top bar with 3-line menu */}
      <header className="asur-topbar">
        <Logo />
        <button
          className="asur-icon-btn"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
        >
          <Menu size={22} />
        </button>
      </header>

      {/* Phone: slide-in drawer */}
      <div className={`asur-drawer-wrap ${open ? "open" : ""}`}>
        <div className="asur-overlay" onClick={() => setOpen(false)} />
        <aside className="asur-drawer">
          <button
            className="asur-icon-btn asur-close"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
          <Logo />
          <Items active={active} onSelect={handleSelect} />
        </aside>
      </div>
    </div>
  );
}
