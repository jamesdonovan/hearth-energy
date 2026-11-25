/** Where an appliance's energy came from: solar / Powerwall / grid, plus "cost (electricity)" vs "cost with energy shift". */
import { useEffect, useState } from "react";
import clsx from "clsx";
import type { PPSources } from "../lib/api";

const C = { solar: "#f0b429", battery: "#3ddc97", grid: "#f07167" };
const gbp = (g: number | null | undefined) => (g == null ? "—" : `£${g.toFixed(2)}`);

export function SourceBar({ s, className, legend = false }: { s?: PPSources | null; className?: string; legend?: boolean }) {
  if (!s) return null;
  const tot = s.solar_kwh + s.battery_kwh + s.grid_kwh;
  if (tot <= 0.001) return null;
  const parts = [
    { k: "Solar", v: s.solar_kwh, c: C.solar },
    { k: "Powerwall", v: s.battery_kwh, c: C.battery },
    { k: "Grid", v: s.grid_kwh, c: C.grid },
  ];
  const title = parts.map((p) => `${p.k} ${p.v.toFixed(2)} kWh (${Math.round((p.v / tot) * 100)}%)`).join(" · ");
  return (
    <div className={className} title={title}>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        {parts.map((p) => (p.v > 0 ? <div key={p.k} style={{ width: `${(p.v / tot) * 100}%`, background: p.c }} /> : null))}
      </div>
      {legend && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]" style={{ color: "var(--muted)" }}>
          {parts.map((p) => (
            <span key={p.k} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: p.c }} />
              {p.k} {Math.round((p.v / tot) * 100)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Optional view: value the solar an appliance used at the export rate it could have earned. */
export function useSolarAtExport(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => localStorage.getItem("hearth-pp-solar-export") === "1");
  useEffect(() => {
    const on = () => setV(localStorage.getItem("hearth-pp-solar-export") === "1");
    window.addEventListener("hearth-pp-solar-export", on);
    return () => window.removeEventListener("hearth-pp-solar-export", on);
  }, []);
  return [
    v,
    (n: boolean) => {
      localStorage.setItem("hearth-pp-solar-export", n ? "1" : "0");
      window.dispatchEvent(new Event("hearth-pp-solar-export"));
    },
  ];
}

export function actualCost(actual: number | null | undefined, forgone: number | null | undefined, solarAtExport: boolean) {
  if (actual == null) return null;
  return actual + (solarAtExport ? forgone ?? 0 : 0);
}

/** "£2.05 electricity · £0.31 with energy shift · saved £1.74" */
export function TwoCosts({ cost, actual, big = false, className }: { cost: number | null | undefined; actual: number | null | undefined; big?: boolean; className?: string }) {
  const saved = cost != null && actual != null ? cost - actual : null;
  return (
    <div className={clsx("flex flex-wrap items-baseline gap-x-3 gap-y-0.5", className)}>
      <span>
        <span className={clsx("num font-medium", big ? "text-xl" : "text-sm")}>{gbp(actual)}</span>{" "}
        <span className={clsx("text-[11px]", big && "block")} style={{ color: "var(--muted)" }}>with energy shift</span>
      </span>
      <span className="text-[11px]" style={{ color: "var(--muted)" }}>
        <span className="num">{gbp(cost)}</span> electricity{saved != null && saved >= 0.005 ? <> · <span className="num text-batt">saved {gbp(saved)}</span></> : null}
      </span>
    </div>
  );
}
