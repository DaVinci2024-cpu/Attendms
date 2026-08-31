"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Home,
  LayoutDashboard,
  ScanFace,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
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
];

export function AdminNav() {
  const pathname = usePathname();
  const { has } = usePermissions();

  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-xl bg-neutral-900 p-1.5">
      {LINKS.filter((link) => link.visible(has)).map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
              active
                ? "bg-neutral-800 text-white"
                : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </Link>
        );
      })}
      <Link
        href="/"
        className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-200"
      >
        <ScanFace className="h-4 w-4" /> View kiosk
      </Link>
    </nav>
  );
}
