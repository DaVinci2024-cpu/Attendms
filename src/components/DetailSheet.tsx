"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

// A responsive detail popup: a bottom sheet on phones, a centered card on
// tablet/desktop — same content either way. For "tap a summary number to
// see the detail" flows (dashboard stat pills, etc.).
export function DetailSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:px-4">
      <div className="flex max-h-[85vh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-neutral-900 p-5 sm:max-w-md sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
