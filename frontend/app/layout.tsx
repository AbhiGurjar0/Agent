import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Sora } from "next/font/google";
import "./globals.css";
import AuthGate from "@/component/AuthGate";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});


export const metadata: Metadata = {
  title: "Asur AI",
  description: "Autonomous AI agent platform and task coordinator.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable}  h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#FAFAFC] text-[#14123a] selection:bg-[#8b7bff]/20">
  <AuthGate>{children}</AuthGate>
</body>
    </html>
  );
}