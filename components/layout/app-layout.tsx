"use client";

import { useState } from "react";
import { Navbar } from "@/components/layout/navbar";
import { Sidebar } from "@/components/layout/sidebar";

export function AppLayout({
  connected,
  onLogout,
  children,
}: {
  connected: boolean;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  return (
    <div className="flex min-h-dvh w-full flex-col bg-floor font-sans text-ink">
      <Navbar connected={connected} onLogout={onLogout} onToggleSidebar={() => setMobileMenuOpen((v) => !v)} />
      <div className="flex h-[calc(100dvh-4rem)] w-full overflow-hidden">
        <Sidebar isOpenMobile={mobileMenuOpen} onCloseMobile={() => setMobileMenuOpen(false)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
