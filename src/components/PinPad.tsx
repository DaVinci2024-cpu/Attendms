"use client";

import { Delete } from "lucide-react";

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  maxLength?: number;
  disabled?: boolean;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "del"];

export function PinPad({
  value,
  onChange,
  onSubmit,
  maxLength = 6,
  disabled = false,
}: PinPadProps) {
  function press(key: string) {
    if (disabled) return;
    if (key === "clear") {
      onChange("");
      return;
    }
    if (key === "del") {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length < maxLength) {
      onChange(value + key);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-2">
        {Array.from({ length: maxLength }).map((_, i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full border-2 border-neutral-500 ${
              i < value.length ? "bg-neutral-200" : "bg-transparent"
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => press(key)}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-800 text-xl font-medium text-white transition active:bg-neutral-700 disabled:opacity-50"
          >
            {key === "clear" ? "C" : key === "del" ? <Delete className="h-5 w-5" /> : key}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || value.length < 4}
        onClick={onSubmit}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
      >
        Confirm
      </button>
    </div>
  );
}
