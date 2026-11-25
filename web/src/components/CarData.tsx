import { Moon, WifiOff, Clock, Wifi } from "lucide-react";
import { useHa } from "../lib/store";

export type CarKey = string;
export type CarMode = "online" | "asleep" | "idle" | "lost" | "no_data";
export type CarDataStatus = {
  car: CarKey;
  name: string;
  mode: CarMode;
  as_of: string | null;
  lost_since: string | null;
  last_seen: string | null;
  live_state: string | null;
  held: string[];
};

const TZ = "Europe/London";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** HH:MM today, "Sun 16:51" otherwise (Europe/London). */
export function fmtWhen(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
  if (dayKey(d) === dayKey(new Date())) return hm;
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" }).format(d);
  return `${wd} ${hm}`;
}

/** Per-car freshness from the server's last-known-good cache (hearth.car_tesla / hearth.car_ev9). */
export function useCarStatus(car: CarKey) {
  const { entities } = useHa();
  const e = entities[`hearth.car_${car}`];
  const a = (e?.attributes || {}) as Partial<CarDataStatus>;
  const mode = (e?.state as CarMode) || "online";
  return {
    mode,
    as_of: a.as_of ?? null,
    lost_since: a.lost_since ?? null,
    last_seen: a.last_seen ?? null,
    live_state: a.live_state ?? null,
    /** Values on screen are the last known ones, not live. */
    stale: mode === "lost" || mode === "no_data",
    known: Boolean(e),
  };
}

/** Grey a held value. */
export const staleCls = (stale: boolean) => (stale ? "opacity-45 grayscale" : "");

export function carBadgeText(s: ReturnType<typeof useCarStatus>, car: CarKey) {
  switch (s.mode) {
    case "asleep":
      return `Asleep · as of ${fmtWhen(s.as_of)}`;
    case "lost":
      return `Connection lost since ${fmtWhen(s.lost_since)} · last seen ${fmtWhen(s.last_seen)}`;
    case "no_data":
      return "No data from the car";
    case "idle":
      return `Last update ${fmtWhen(s.as_of)}`;
    default:
      return car === "tesla" ? "Online" : `Updated ${fmtWhen(s.as_of)}`;
  }
}

export function CarDataBadge({ car, size = "sm", hideOnline = false }: { car: CarKey; size?: "sm" | "lg"; hideOnline?: boolean }) {
  const s = useCarStatus(car);
  if (!s.known) return null;
  if (hideOnline && s.mode === "online") return null;
  const text = carBadgeText(s, car);
  const lost = s.stale;
  const Icon = lost ? WifiOff : s.mode === "asleep" ? Moon : s.mode === "online" ? Wifi : Clock;
  const tone = lost ? "bg-solar/15 text-solar ring-1 ring-solar/40" : s.mode === "asleep" ? "bg-gridout/10 text-gridout" : s.mode === "online" ? "bg-batt/10 text-batt" : "";
  const title = lost
    ? `Home Assistant reports '${s.live_state || "unknown"}' for this car. Showing the last values Hearth saw, greyed out.`
    : s.mode === "asleep"
      ? "The car is asleep. These are its last readings, which stay valid while it sleeps."
      : undefined;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full ${size === "lg" ? "px-3 py-1.5 text-sm" : "px-2.5 py-1 text-xs"} ${tone}`}
      style={!tone ? { color: "var(--muted)", background: "var(--bg-elev)" } : undefined}
    >
      <Icon size={size === "lg" ? 15 : 12} />
      <span className="whitespace-nowrap">{text}</span>
    </span>
  );
}
