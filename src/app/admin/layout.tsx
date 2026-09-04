"use client";

import { RequireAdmin } from "@/components/RequireAdmin";

// One persistent access-check + sidebar for the whole /admin section —
// Next.js keeps a layout mounted across client-side navigation between
// sibling routes, so this runs once per visit instead of once per page.
// Individual /admin/*/page.tsx files no longer wrap themselves in
// <RequireAdmin> — this is the only place that happens now.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RequireAdmin>{children}</RequireAdmin>;
}
