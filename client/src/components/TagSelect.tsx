import { useState } from "react";
import { cn } from "@/lib/utils";

export interface TagOption {
  id: string;
  value: string;
}

interface TagSelectProps {
  label: string;
  values: TagOption[];
  selectedId: string | null;
  onChange: (id: string | null) => void;
  /** Provide to let the user type a brand-new value ("Other..."). */
  onCreate?: (value: string) => Promise<TagOption>;
  /** Shown as the first option, e.g. { value: "", label: "All Blocks" }. */
  allOption?: { label: string };
  placeholder?: string;
  className?: string;
}

const OTHER_SENTINEL = "__other__";

// A plain <select> (matches the app's existing filter-bar style) that can
// also add a brand-new value on the fly via "+ Add new...". Used for every
// Block / Floor / Flat / Amenity dropdown — both when tagging a capture and
// when filtering the grid.
export function TagSelect({
  label,
  values,
  selectedId,
  onChange,
  onCreate,
  allOption,
  placeholder,
  className,
}: TagSelectProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  const selectCls = cn(
    "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 outline-none cursor-pointer hover:border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100",
    className,
  );

  if (isAdding) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={placeholder || `New ${label.toLowerCase()}...`}
          disabled={saving}
          className="h-9 rounded-lg border border-indigo-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-100 w-36"
          onKeyDown={async (e) => {
            if (e.key === "Enter") await submit();
            if (e.key === "Escape") cancel();
          }}
        />
        <button
          type="button"
          disabled={saving || !newValue.trim()}
          onClick={submit}
          className="h-9 px-2.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-50"
        >
          {saving ? "..." : "Add"}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="h-9 px-2 text-xs text-slate-400 hover:text-slate-600"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <select
      className={selectCls}
      value={selectedId ?? ""}
      onChange={(e) => {
        if (e.target.value === OTHER_SENTINEL) {
          setIsAdding(true);
          return;
        }
        onChange(e.target.value || null);
      }}
    >
      {allOption && <option value="">{allOption.label}</option>}
      {/* Without allOption (upload / edit dialogs) always offer a clear
          option — otherwise a misclicked tag can never be removed. */}
      {!allOption && (
        <option value="">
          {selectedId ? `No ${label.toLowerCase()}` : placeholder || label}
        </option>
      )}
      {values.map((v) => (
        <option key={v.id} value={v.id}>
          {v.value}
        </option>
      ))}
      {onCreate && <option value={OTHER_SENTINEL}>+ Add new...</option>}
    </select>
  );

  async function submit() {
    if (!newValue.trim() || !onCreate) return;
    setSaving(true);
    try {
      const created = await onCreate(newValue.trim());
      onChange(created.id);
      cancel();
    } finally {
      setSaving(false);
    }
  }
  function cancel() {
    setIsAdding(false);
    setNewValue("");
  }
}
