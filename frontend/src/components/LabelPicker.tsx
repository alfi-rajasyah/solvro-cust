import { useState } from "react";
import { LabelChip } from "./LabelChip";
import { useCreateLabel, useProjectLabels, type Label } from "@/lib/queries";

// No red or near-red: a label must never read as an error.
const PALETTE = [
  "#0058be",
  "#10b981",
  "#f59e0b",
  "#0d9488",
  "#7c3aed",
  "#0ea5e9",
  "#ec4899",
  "#64748b",
];

export function LabelPicker({
  projectId,
  selectedIds,
  onChange,
}: {
  projectId: number;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const { data: labels } = useProjectLabels(projectId);
  const createLabel = useCreateLabel(projectId);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0]);

  function toggle(label: Label) {
    if (selectedIds.includes(label.id)) {
      onChange(selectedIds.filter((id) => id !== label.id));
    } else {
      onChange([...selectedIds, label.id]);
    }
  }

  async function handleCreate() {
    if (createLabel.isPending) return;
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      const created = await createLabel.mutateAsync({ name: trimmed, color: newColor });
      onChange([...selectedIds, created.id]);
      setNewName("");
      setNewColor(PALETTE[0]);
      setCreating(false);
    } catch {
      // surfaced via mutation error state below
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {(labels ?? []).map((l) => {
          const active = selectedIds.includes(l.id);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => toggle(l)}
              className={[
                "rounded-sm transition-opacity",
                active ? "ring-2 ring-primary ring-offset-1" : "opacity-60 hover:opacity-100",
              ].join(" ")}
            >
              <LabelChip label={l} />
            </button>
          );
        })}
        {!creating && (
          <button
            type="button"
            onClick={() => {
              createLabel.reset();
              setCreating(true);
            }}
            className="rounded-sm border border-dashed border-outline-variant px-1.5 py-0.5 font-display text-meta text-on-surface-variant hover:border-primary hover:text-primary font-semibold"
          >
            Add label
          </button>
        )}
      </div>

      {creating && (
        <div className="rounded-sm border border-outline-variant bg-surface-container-low p-2">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
              placeholder="Label name"
              maxLength={50}
              className="flex-1 rounded-sm border border-outline-variant bg-surface-container-lowest px-2 py-1 text-xs focus:border-primary focus:outline-hidden"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={createLabel.isPending || !newName.trim()}
              className="rounded-sm bg-primary px-2 py-1 font-display text-xs text-on-primary hover:bg-primary-container disabled:opacity-50 font-semibold"
            >
              {createLabel.isPending ? "…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                createLabel.reset();
                setCreating(false);
                setNewName("");
              }}
              className="rounded-sm px-2 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container"
            >
              Cancel
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1">
            <span className="text-label-caps uppercase text-on-surface-variant">
              Color
            </span>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                aria-label={`Pick color ${c}`}
                className={[
                  "h-4 w-4 rounded-full border",
                  newColor === c ? "ring-2 ring-primary ring-offset-1" : "border-outline-variant",
                ].join(" ")}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          {createLabel.error && (
            <p className="mt-1 text-xs text-error">
              {(createLabel.error as Error).message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
