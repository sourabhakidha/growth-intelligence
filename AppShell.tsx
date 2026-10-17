"use client";

import {
  BarChart3,
  Filter,
  LayoutDashboard,
  LogOut,
  Map,
  Megaphone,
  Menu,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { NAV, type NavIcon } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { DateRangePicker } from "./DateRangePicker";

const ICONS: Record<NavIcon, React.ComponentType<{ size?: number; className?: string }>> = {
  overview: LayoutDashboard,
  meta: Megaphone,
  creative: Sparkles,
  funnel: Filter,
  cart: ShoppingCart,
  sales: TrendingUp,
  region: Map,
};

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = new URLSearchParams();
  const f = sp.get("from");
  const t = sp.get("to");
  if (f) qs.set("from", f);
  if (t) qs.set("to", t);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  return (
    <nav aria-label="Sections" className="space-y-0.5">
      {NAV.map((item) => {
        const Icon = ICONS[item.icon];
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={`${item.href}${suffix}`}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px]",
              active ? "bg-accent-soft font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon size={16} className={active ? "text-accent" : "text-ink-3"} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white">
        <BarChart3 size={16} aria-hidden />
      </span>
      <div className="leading-tight">
        <p className="text-[13px] font-semibold text-ink">Growth Intelligence</p>
        <p className="text-[11px] text-ink-3">Akidha · internal</p>
      </div>
    </div>
  );
}

interface AppShellProps {
  userEmail: string;
  signOutAction: () => Promise<void>;
  liveData: boolean;
  children: React.ReactNode;
}

export function AppShell({ userEmail, signOutAction, liveData, children }: AppShellProps) {
  const [open, setOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col gap-6 py-4">
      <Brand />
      <div className="flex-1 px-2">
        <Suspense fallback={null}>
          <NavLinks onNavigate={() => setOpen(false)} />
        </Suspense>
      </div>
      <div className="space-y-2 border-t border-line px-4 pt-4">
        <p className="truncate text-[11px] text-ink-3" title={userEmail}>
          {userEmail}
        </p>
        <form action={signOutAction}>
          <button type="submit" className="inline-flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink">
            <LogOut size={13} aria-hidden /> Sign out
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-line bg-surface-1 lg:block">{sidebar}</aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[260px] border-r border-line bg-surface-1">
            <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="absolute right-3 top-4 text-ink-2">
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-surface-0/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Open navigation" onClick={() => setOpen(true)} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 lg:hidden">
              <Menu size={18} />
            </button>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                liveData ? "border-good/40 text-ink" : "border-line-strong text-ink-2",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", liveData ? "bg-good" : "bg-ink-3")} aria-hidden />
              {liveData ? "Live data" : "Live data off"}
            </span>
          </div>
          <Suspense fallback={<span className="h-7 w-40" />}>
            <DateRangePicker />
          </Suspense>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
