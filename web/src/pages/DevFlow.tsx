import { PowerFlow } from "../components/PowerFlow";
import { Card, CardHeader } from "../components/Card";
import { FLOW_FIXTURES, flowModel } from "../lib/flowModel";
import { fmtKw } from "../lib/format";

/** Dev fixture page (/dev/flow): the live-flow diagram for each scenario, no HA data involved. */
export function DevFlow() {
  const fake = {
    "sensor.powerwall_percentage_charged": { entity_id: "sensor.powerwall_percentage_charged", state: "64", attributes: {} },
    "sensor.tesla_battery_level": { entity_id: "sensor.tesla_battery_level", state: "71", attributes: {} },
    "sensor.kia_ev_battery_level": { entity_id: "sensor.kia_ev_battery_level", state: "80", attributes: {} },
  } as never;
  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Dev fixtures for the live power flow (HA sign conventions: battery + discharge / − charge, grid + import / − export). Same cases as <code>npm test</code>.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(FLOW_FIXTURES).map(([id, f]) => (
          <Card key={id}>
            <CardHeader label={id.replace("_", " ")} title={f.title} />
            <PowerFlow entities={fake} input={f.input} />
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              {flowModel(f.input).flows.map((x) => `${x.from} → ${x.to} ${fmtKw(x.kw)}`).join(" · ") || "no flows"}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
