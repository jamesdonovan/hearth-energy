import { useEffect, type ReactNode } from "react";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Apply",
  danger,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} aria-label="Dismiss" />
      <div className="card relative w-full max-w-md p-6">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <div className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          {body}
        </div>
        <p className="mt-3 text-[11px]" style={{ color: "var(--faint)" }}>This change is recorded in the audit log.</p>
        {error && <p className="mt-3 text-sm text-gridin">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm font-medium"
            style={{ color: "var(--muted)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-50 ${
              danger ? "bg-gridin" : "bg-batt"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
