"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEnterTransition } from "@/hooks/useEnterTransition";

// A responsive detail popup: a bottom sheet on phones, a centered card on
// tablet/desktop — same content either way. For "tap a summary number to
// see the detail" flows (dashboard stat pills, etc.). Slides/fades in on
// open instead of just appearing.
export function DetailSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const show = useEnterTransition();

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center bg-black/70 transition-opacity duration-200 ease-out sm:items-center sm:px-4 ${
        show ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`flex max-h-[85vh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl bg-neutral-900 p-5 transition-all duration-200 ease-out sm:max-w-md sm:rounded-2xl ${
          show
            ? "translate-y-0 opacity-100 sm:scale-100"
            : "translate-y-6 opacity-0 sm:translate-y-0 sm:scale-95"
        }`}
      >
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
