"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Home,
  LayoutDashboard,
  Megaphone,
  Menu,
  ScanFace,
  Settings,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { usePermissions } from "@/components/RequireAdmin";
import type { Permission } from "@/lib/types";

interface NavLink {
  href: string;
  label: string;
  icon: typeof Home;
  visible: (has: (p: Permission) => boolean) => boolean;
}

const LINKS: NavLink[] = [
  { href: "/admin", label: "Home", icon: Home, visible: () => true },
  {
    href: "/admin/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    visible: (has) => has("view_reports") || has("edit_attendance"),
  },
  {
    href: "/admin/schedule",
    label: "Schedule",
    icon: CalendarDays,
    visible: (has) => has("manage_schedule"),
  },
  {
    href: "/enroll",
    label: "Enroll",
    icon: UserPlus,
    visible: (has) => has("manage_employees"),
  },
  {
    href: "/admin/employees",
    label: "Employees",
    icon: Users,
    visible: (has) => has("manage_employees"),
  },
  {
    href: "/admin/kiosk-settings",
    label: "Kiosk display",
    icon: Settings,
    visible: (has) => has("manage_kiosk_settings"),
  },
  {
    href: "/admin/permissions",
    label: "Roles",
    icon: ShieldCheck,
    visible: (has) => has("manage_permissions"),
  },
  {
    href: "/admin/announcements",
    label: "Announcements",
    icon: Megaphone,
    visible: (has) => has("manage_announcements"),
  },
  {
    href: "/admin/performance",
    label: "Performance",
    icon: TrendingUp,
    visible: (has) => has("view_reports"),
  },
];

// Remembered per-browser so a desktop admin's collapse preference sticks
// across visits — purely cosmetic, never worth a Firestore round trip.
const COLLAPSE_STORAGE_KEY = "attendms_sidebar_collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const { has } = usePermissions();
  // Lazy initializer (not an effect) so this reads synchronously on first
  // render — an effect-based version would flip the layout a beat after
  // mount, a visible jump on a page that's otherwise static.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Nothing to persist to — the in-memory toggle still works for
        // the rest of this visit.
      }
      return next;
    });
  }

  // Only sections this account actually has a permission for — the same
  // has() gating the pages themselves use, so the sidebar can never
  // advertise a section that would just bounce back to "access denied".
  const visibleLinks = LINKS.filter((link) => link.visible(has));

  const links = (
    <nav className="flex flex-1 flex-col gap-1">
      {visibleLinks.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            title={collapsed ? label : undefined}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              collapsed ? "justify-center" : ""
            } ${
              active
                ? "bg-neutral-800 text-white"
                : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
            }`}
          >
            <Icon className="h-4.5 w-4.5 shrink-0" />
            {!collapsed && label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="flex flex-col gap-1">
      <Link
        href="/"
        title={collapsed ? "View kiosk" : undefined}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-200 ${
          collapsed ? "justify-center" : ""
        }`}
      >
        <ScanFace className="h-4.5 w-4.5 shrink-0" />
        {!collapsed && "View kiosk"}
      </Link>
      <button
        type="button"
        onClick={toggleCollapsed}
        className={`hidden items-center rounded-lg px-3 py-2 text-xs text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-200 md:flex ${
          collapsed ? "justify-center" : "gap-2"
        }`}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        {!collapsed && "Collapse"}
      </button>
    </div>
  );

  const brand = (
    <div className={`flex items-center gap-2 px-2 py-3 ${collapsed ? "justify-center" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.png" alt="" className="h-7 w-7 shrink-0 rounded-md" />
      {!collapsed && <span className="font-semibold">Attendms</span>}
    </div>
  );

  return (
    <>
      {/* Mobile: a slim top bar with a hamburger trigger, replacing the
          persistent column (which would eat too much of a phone's width). */}
      <div className="flex items-center justify-between bg-neutral-900 px-3 py-2 md:hidden print:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
        >
          <Menu className="h-5 w-5" /> Menu
        </button>
        <span className="font-semibold">Attendms</span>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="flex h-full w-64 flex-col gap-1 overflow-y-auto bg-neutral-900 p-2 shadow-xl">
            <div className="flex items-center justify-between">
              {brand}
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {links}
            {footer}
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="flex-1 bg-black/60"
          />
        </div>
      )}

      {/* Desktop: persistent, collapsible column. */}
      <div
        className={`sticky top-0 hidden h-screen shrink-0 flex-col gap-1 overflow-y-auto border-r border-neutral-800 bg-neutral-900 p-2 transition-[width] duration-150 md:flex print:hidden ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        {brand}
        {links}
        {footer}
      </div>
    </>
  );
}
