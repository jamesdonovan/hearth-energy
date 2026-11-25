const TZ = "Europe/London";

export function isUnavailable(v: string | null | undefined) {
  return v == null || v === "" || v === "unknown" || v === "unavailable";
}

export function fmtKw(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 10) return `${n.toFixed(1)} kW`;
  return `${n.toFixed(digits)} kW`;
}

export function fmtKwh(n: number | null | undefined, digits = 1) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)} kWh`;
}

export function fmtPct(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

/** Predbat costs are pence; Octopus sensors are often GBP. */
export function fmtPence(p: number | null | undefined) {
  if (p == null || Number.isNaN(p)) return "—";
  const pounds = p / 100;
  const sign = pounds < 0 ? "−" : "";
  return `${sign}£${Math.abs(pounds).toFixed(2)}`;
}

export function fmtGbp(g: number | null | undefined) {
  if (g == null || Number.isNaN(g)) return "—";
  const sign = g < 0 ? "−" : "";
  return `${sign}£${Math.abs(g).toFixed(2)}`;
}

export function fmtRateP(p: number | null | undefined) {
  if (p == null || Number.isNaN(p)) return "—";
  return `${p.toFixed(1)}p`;
}

/** Octopus rate sensors are GBP/kWh. */
export function fmtRateGbp(g: number | null | undefined) {
  if (g == null || Number.isNaN(g)) return "—";
  return `${(g * 100).toFixed(1)}p`;
}

export function fmtHours(h: number | null | undefined) {
  if (h == null || Number.isNaN(h) || h < 0) return "—";
  const totalMin = Math.round(h * 60);
  const hr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (hr <= 0) return `${min} min`;
  if (min === 0) return `${hr}h`;
  return `${hr}h ${min}m`;
}

export function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    // maybe already HH:MM
    return iso.slice(0, 5);
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function fmtTimeDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function fmtClock(iso = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

export function windowLabel(start?: string | null, end?: string | null) {
  if (!start && !end) return "—";
  return `${fmtTime(start || undefined)}–${fmtTime(end || undefined)}`;
}

export function titleCase(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
