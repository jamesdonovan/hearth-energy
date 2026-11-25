import { CalendarClock } from "lucide-react";
import { fetchPlanView } from "../lib/api";
import { usePoll } from "../lib/store";
import { Card, CardHeader } from "../components/Card";
import { PlanCharts, PlanHeaderNote, PlanSummary, SlotTimeline } from "../components/PlanView";

/** Predbat's plan for today and through tomorrow, read-only. */
export function Plan() {
  const { data, err } = usePoll(fetchPlanView, 120000);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="label mb-1 flex items-center gap-1.5"><CalendarClock size={13} /> Predbat plan</div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Today &amp; tomorrow</h1>
        </div>
        {data && <div className="text-xs" style={{ color: "var(--muted)" }}><PlanHeaderNote data={data} /></div>}
      </div>
      {err && <p className="text-sm text-gridin">{err}</p>}
      {!data && !err && <p className="text-sm" style={{ color: "var(--muted)" }}>Loading plan…</p>}
      {data && (
        <>
          <PlanSummary data={data} />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)]">
            <Card>
              <CardHeader label="Timeline" title="Battery, rates and forecast" />
              <PlanCharts data={data} />
            </Card>
            <Card>
              <CardHeader label="30-minute slots" title="What Predbat will do" />
              <SlotTimeline data={data} />
              <p className="mt-3 text-[11px]" style={{ color: "var(--muted)" }}>
                Read-only view of predbat.plan_html. Energy figures are kWh per slot; battery + is charging, − is discharging. Running total is Predbat's predicted cost including today so far.
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
