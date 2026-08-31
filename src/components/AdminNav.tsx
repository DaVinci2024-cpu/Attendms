"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Home,
  LayoutDashboard,
  ScanFace,
  Settings,
  UserPlus,
  Users,
} from "lucide-react";

const LINKS = [
  { href: "/admin", label: "Home", icon: Home },
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/schedule", label: "Schedule", icon: CalendarDays },
  { href: "/enroll", label: "Enroll", icon: UserPlus },
  { href: "/admin/employees", label: "Employees", icon: Users },
  { href: "/admin/kiosk-settings", label: "Kiosk display", icon: Settings },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-xl bg-neutral-900 p-1.5">
      {LINKS.map(({ href, label, icon: Icon }) => {
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
