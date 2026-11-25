import { flowModel, type FlowEdgeId, type FlowInput } from "../lib/flowModel";
import { fmtKw, fmtPct } from "../lib/format";
import type { HaEntity } from "../lib/api";
import { num } from "../lib/derived";
import { useHa } from "../lib/store";
import { ev9Of, flowIdsFrom, siteId, teslaOf } from "../lib/variables";

type Props = { entities: Record<string, HaEntity>; /** dev fixtures: override the live readings */ input?: FlowInput; size?: "card" | "wall" };

const C = {
  solar: "#f0b429",
  grid: "#5b9cff",
  gridIn: "#f07167",
  home: "#c4b5fd",
  battery: "#3ddc97",
  car: "#22d3ee",
};

// Compact 360 × 178 layout: solar on top, grid · home · battery across, cars below.
const W = 360;
const H = 178;
const P = {
  solar: { x: 180, y: 24 },
  grid: { x: 52, y: 88 },
  home: { x: 180, y: 88 },
  battery: { x: 300, y: 88 },
  tesla: { x: 122, y: 152 },
  ev9: { x: 238, y: 152 },
};
const R = 15;
const RH = 21;

type Pt = { x: number; y: number };
/** Path from a to b, trimmed to the node circles so dashes start and end at the rims. */
function seg(a: Pt, b: Pt, ra: number, rb: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return `M ${a.x + ux * ra} ${a.y + uy * ra} L ${b.x - ux * rb} ${b.y - uy * rb}`;
}
// Paths are always written source → sink for the direction they can flow; reversed when needed.
const radius = (n: string) => (n === "home" ? RH : R);
const PATHS: Record<FlowEdgeId, { from: keyof typeof P; to: keyof typeof P; color: string; d?: string; base?: boolean }> = {
  solar_home: { from: "solar", to: "home", color: C.solar, base: true },
  solar_battery: { from: "solar", to: "battery", color: C.solar },
  solar_grid: { from: "solar", to: "grid", color: C.solar },
  battery_home: { from: "battery", to: "home", color: C.battery, base: true },
  battery_grid: {
    from: "battery",
    to: "grid",
    color: C.battery,
    // arc under the home node
    d: `M ${P.battery.x - R * 0.8} ${P.battery.y + R * 0.6} Q ${P.home.x} ${P.home.y + 56} ${P.grid.x + R * 0.8} ${P.grid.y + R * 0.6}`,
  },
  grid_home: { from: "grid", to: "home", color: C.gridIn, base: true },
  grid_battery: {
    from: "grid",
    to: "battery",
    color: C.gridIn,
    d: `M ${P.grid.x + R * 0.8} ${P.grid.y + R * 0.6} Q ${P.home.x} ${P.home.y + 56} ${P.battery.x - R * 0.8} ${P.battery.y + R * 0.6}`,
  },
  home_tesla: { from: "home", to: "tesla", color: C.car, base: true },
  home_ev9: { from: "home", to: "ev9", color: C.car, base: true },
};

/** Faster dashes for more power; 0.6 s at ≥ 7 kW, 2.4 s near idle. */
const speed = (kw: number) => `${Math.max(0.6, 2.4 - Math.min(kw, 7) * 0.26).toFixed(2)}s`;

function Node({
  at,
  r = R,
  color,
  label,
  value,
  sub,
  place,
  stale,
  active,
}: {
  at: Pt;
  r?: number;
  color: string;
  label: string;
  value: string;
  sub?: string;
  place: "right" | "below" | "inside";
  stale?: boolean;
  active?: boolean;
}) {
  const tx = place === "right" ? at.x + r + 7 : at.x;
  const anchor = place === "right" ? "start" : "middle";
  const ty = place === "below" ? at.y + r + 11 : place === "right" ? at.y - 3 : at.y - 3;
  return (
    <g opacity={stale ? 0.5 : 1}>
      {stale && <title>Car data lost: last known value</title>}
      <circle cx={at.x} cy={at.y} r={r} fill="var(--bg-elev)" stroke={color} strokeOpacity={active ? 0.95 : 0.45} strokeWidth={1.5} />
      <circle cx={at.x} cy={place === "inside" ? at.y - r + 6 : at.y} r={place === "inside" ? 2.2 : 3.2} fill={color} opacity={active ? 1 : 0.6} />
      {place === "inside" ? (
        <>
          <text x={at.x} y={at.y + 3} textAnchor="middle" fill="var(--text)" fontSize="10.5" fontFamily="IBM Plex Mono, monospace" fontWeight={500}>
            {value.replace(/ kW$/, "")}
          </text>
          <text x={at.x} y={at.y + 12} textAnchor="middle" fill="var(--muted)" fontSize="6.5" fontFamily="Outfit, sans-serif" letterSpacing="0.08em">
            {value.endsWith(" kW") ? "KW" : ""}
          </text>
        </>
      ) : (
        <>
          <text x={tx} y={ty} textAnchor={anchor} fill="var(--muted)" fontSize="8" fontFamily="Outfit, sans-serif" letterSpacing="0.08em">
            {label.toUpperCase()}
          </text>
          <text x={tx} y={ty + 11.5} textAnchor={anchor} fill="var(--text)" fontSize="10.5" fontFamily="IBM Plex Mono, monospace" fontWeight={500}>
            {value}
            {sub && (
              <tspan fill="var(--faint)" fontSize="8" fontFamily="Outfit, sans-serif" dx="4">
                {sub}
              </tspan>
            )}
          </text>
        </>
      )}
    </g>
  );
}

const carMode = (entities: Props["entities"], car: string) => entities[`hearth.car_${car}`]?.state;
const carLost = (entities: Props["entities"], car: string) => ["lost", "no_data"].includes(carMode(entities, car) || "");
const carSub = (entities: Props["entities"], car: string) => {
  const m = carMode(entities, car);
  return m === "lost" ? "last known" : m === "asleep" ? "asleep" : undefined;
};

export function PowerFlow({ entities, input, size = "card" }: Props) {
  const { variables: cfg } = useHa();
  const ids = flowIdsFrom(cfg);
  const tesla = teslaOf(cfg);
  const ev9 = ev9Of(cfg);
  const m = flowModel(
    input ?? {
      solar: num(entities, ids.solar),
      load: num(entities, ids.load),
      battery: num(entities, ids.battery),
      grid: num(entities, ids.grid),
      tesla: num(entities, ids.tesla),
      ev9: num(entities, ids.ev9),
    },
  );
  const soc = num(entities, siteId(cfg, "pw_soc"));
  const active = new Map(m.flows.map((f) => [f.id, f.kw]));
  const on = (n: string) => m.flows.some((f) => f.from === n || f.to === n);
  const gridSub = m.gridExport >= 0.02 ? "out" : m.gridImport >= 0.02 ? "in" : "idle";
  const battSub = m.batteryCharge >= 0.02 ? `charging ${fmtKw(m.batteryCharge, 1)}` : m.batteryDischarge >= 0.02 ? `supplying ${fmtKw(m.batteryDischarge, 1)}` : "idle";
  const teslaLevel = num(entities, tesla?.soc);
  const ev9Level = num(entities, ev9?.soc);
  const summary = m.flows.map((f) => `${f.from} to ${f.to} ${fmtKw(f.kw)}`).join(", ") || "no power flowing";

  return (
    <div className={size === "wall" ? "mx-auto w-full max-w-[640px]" : "mx-auto w-full max-w-[480px]"}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Live power flow: ${summary}`}>
        {(Object.keys(PATHS) as FlowEdgeId[]).map((id) => {
          const p = PATHS[id];
          const kw = active.get(id);
          if (!p.base && kw == null) return null;
          const d = p.d ?? seg(P[p.from], P[p.to], radius(p.from), radius(p.to));
          return (
            <g key={id}>
              <path d={d} stroke="var(--line)" strokeWidth={p.base ? 1.5 : 1} fill="none" />
              {kw != null && (
                <path
                  d={d}
                  stroke={p.color}
                  strokeWidth={Math.min(3, 1.4 + kw * 0.2)}
                  strokeLinecap="round"
                  fill="none"
                  className="flow-dash"
                  style={{ animationDuration: speed(kw) }}
                  data-flow={`${p.from}>${p.to}`}
                >
                  <title>{`${p.from} → ${p.to}: ${fmtKw(kw)}`}</title>
                </path>
              )}
            </g>
          );
        })}

        <Node at={P.solar} color={C.solar} label="Solar" value={fmtKw(m.solar)} place="right" active={on("solar")} />
        <Node at={P.grid} color={gridSub === "in" ? C.gridIn : C.grid} label="Grid" value={fmtKw(m.gridExport >= 0.02 ? m.gridExport : m.gridImport)} sub={gridSub} place="below" active={on("grid")} />
        <Node at={P.home} r={RH} color={C.home} label="Home" value={fmtKw(m.load)} place="inside" active />
        <Node at={P.battery} color={C.battery} label="Powerwall" value={fmtPct(soc, 0)} sub={battSub} place="below" active={on("battery")} />
        <Node
          at={P.tesla}
          color={C.car}
          label={tesla?.name || "Car 1"}
          value={m.tesla >= 0.02 ? fmtKw(m.tesla) : fmtPct(teslaLevel)}
          sub={carSub(entities, tesla?.id || "car_1")}
          place="right"
          stale={carLost(entities, tesla?.id || "car_1")}
          active={m.tesla >= 0.02}
        />
        <Node
          at={P.ev9}
          color={C.car}
          label={ev9?.name || "Car 2"}
          value={m.ev9 >= 0.02 ? fmtKw(m.ev9) : fmtPct(ev9Level)}
          sub={carSub(entities, ev9?.id || "car_2")}
          place="right"
          stale={carLost(entities, ev9?.id || "car_2")}
          active={m.ev9 >= 0.02}
        />
      </svg>
    </div>
  );
}
