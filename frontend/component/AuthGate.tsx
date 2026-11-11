"use client";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import { getToken } from "@/lib/auth"; // or "../lib/auth", matching your other imports

// pages that can be opened without being logged in
const PUBLIC = ["/auth"];

export default function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const check = () => {
      if (isPublic) return setOk(true);
      
      const token = getToken();
      if (!token) {
        setOk(false);
        router.replace(
          `/auth`,
        );
        return;
      }
      setOk(true);
    };
    check();
    // logging out in another tab also redirects this one
    window.addEventListener("storage", check);
    return () => window.removeEventListener("storage", check);
  }, [pathname, isPublic, router]);

  // login/signup pages: no sidebar
  if (isPublic) return <>{children}</>;

  // avoid flashing protected content before the check finishes
  if (!ok) return <div className="min-h-screen bg-[#FAFAFC]" />;

  return (
    <>
      <Sidebar defaultActive="dashboard" />
      <main className="flex-1 min-h-screen overflow-y-auto">{children}</main>
    </>
  );
}