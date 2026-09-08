"use client";

import { useState } from "react";
import { DEPARTMENT_PRESETS } from "@/lib/constants";

const OTHER_VALUE = "__other__";

// A handful of known departments as quick picks, with a free-text
// fallback for anything else — structured enough for the dashboard's
// sector summary to group by, without hard-locking what "department"
// can mean before the fuller roles system this is standing in for
// exists.
export function DepartmentPicker({
  value,
  onChange,
  label = "Department",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const isPreset = (DEPARTMENT_PRESETS as readonly string[]).includes(value);
  const [showOther, setShowOther] = useState(value !== "" && !isPreset);

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-sm">
        {label}
        <select
          className="rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-600"
          value={showOther ? OTHER_VALUE : value}
          onChange={(e) => {
            if (e.target.value === OTHER_VALUE) {
              setShowOther(true);
              onChange("");
            } else {
              setShowOther(false);
              onChange(e.target.value);
            }
          }}
        >
          <option value="">Not set</option>
          {DEPARTMENT_PRESETS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          <option value={OTHER_VALUE}>Other…</option>
        </select>
      </label>
      {showOther && (
        <input
          className="rounded-lg bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-600"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Department name"
        />
      )}
    </div>
  );
}
