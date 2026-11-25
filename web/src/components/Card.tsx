import type { ReactNode } from "react";
import clsx from "clsx";

export function Card({
  children,
  className,
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return <section className={clsx("card", pad && "p-5", className)}>{children}</section>;
}

export function CardHeader({
  label,
  title,
  right,
}: {
  label?: string;
  title?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        {label && <div className="label mb-1">{label}</div>}
        {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
      </div>
      {right}
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "solar" | "batt" | "gridin" | "gridout" | "neutral";
}) {
  const color =
    tone === "solar"
      ? "text-solar"
      : tone === "batt"
        ? "text-batt"
        : tone === "gridin"
          ? "text-gridin"
          : tone === "gridout"
            ? "text-gridout"
            : "";
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className={clsx("num text-2xl font-medium leading-none sm:text-3xl", color)}>{value}</div>
      {hint && <div className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>{hint}</div>}
    </div>
  );
}
