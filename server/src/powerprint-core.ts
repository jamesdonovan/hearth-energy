/**
 * PowerPrint core: appliance run detection, features and a nearest-centroid classifier.
 * Pure functions (no HA / IO) so they can be unit-tested with node --experimental-strip-types.
 */

export const STEP_MS = 5 * 60 * 1000;

export type Sample = {
  t: number;
  kw: number;
  max: number;
  car: number;
  rate: number | null; // import GBP/kWh
  // whole-site power means for the slot (kW); optional so detection still works without them
  solar?: number | null;
  batt?: number | null; // + discharging, − charging
  grid?: number | null; // + importing, − exporting
  load?: number | null; // whole house incl. cars
  exportRate?: number | null; // GBP/kWh
};

export type Sources = {
  solar_kwh: number;
  battery_kwh: number;
  grid_kwh: number;
  grid_peak_kwh: number; // grid energy bought at >= 20p
  cost_actual_gbp: number; // grid at the slot's import rate + battery at what its energy cost to store
  solar_forgone_gbp: number; // solar share valued at the export rate (optional view)
  battery_rate_p: number | null; // average cost of the battery energy used
  method: "power" | "none";
};

/**
 * Average cost (GBP/kWh) of the energy sitting in the Powerwall, slot by slot: grid charging adds energy at the slot's
 * import rate, solar charging adds it at 0, discharging takes energy out at the running average. Seeded at the
 * off-peak rate (the battery is normally filled overnight at the cheap rate).
 */
export function batteryCostSeries(samples: Sample[], rateFallback: (t: number) => number, seedRate = 0.07, capacityKwh = 13.5): number[] {
  let kwh = capacityKwh / 2;
  let cost = kwh * seedRate;
  const out: number[] = [];
  for (const sm of samples) {
    out.push(kwh > 0.05 ? cost / kwh : seedRate);
    const b = sm.batt;
    if (b == null || !Number.isFinite(b)) continue;
    const e = Math.abs(b) * (5 / 60);
    if (b < 0) {
      // charging: solar first (whatever solar the house isn't using), the rest from the grid
      const spareSolar = Math.max(0, (sm.solar ?? 0) - Math.max(0, sm.load ?? 0));
      const fromSolar = Math.min(-b, spareSolar) * (5 / 60);
      const fromGrid = Math.max(0, e - fromSolar);
      const rate = sm.rate != null && sm.rate > 0.01 && sm.rate < 1 ? sm.rate : rateFallback(sm.t);
      cost += fromGrid * rate;
      kwh += e;
      if (kwh > capacityKwh) {
        cost *= capacityKwh / kwh;
        kwh = capacityKwh;
      }
    } else if (b > 0 && kwh > 0) {
      const avg = cost / kwh;
      const take = Math.min(e, kwh);
      kwh -= take;
      cost = Math.max(0, cost - take * avg);
    }
  }
  return out;
}

/** Split an appliance's energy (exs[k] kW above baseline at samples[i0+k]) over solar / battery / grid in proportion to supply. */
export function attributeSources(samples: Sample[], i0: number, exs: number[], battCost: number[], rateFallback: (t: number) => number): Sources {
  let sol = 0, bat = 0, grd = 0, gpk = 0, cost = 0, forgone = 0, batCost = 0, any = false;
  for (let k = 0; k < exs.length; k++) {
    const sm = samples[i0 + k];
    if (!sm) continue;
    const e = exs[k] * (5 / 60);
    const rate = sm.rate != null && sm.rate > 0.01 && sm.rate < 1 ? sm.rate : rateFallback(sm.t);
    const s = Math.max(0, sm.solar ?? 0);
    const b = Math.max(0, sm.batt ?? 0);
    const g = Math.max(0, sm.grid ?? 0);
    const tot = s + b + g;
    if (sm.solar == null && sm.batt == null && sm.grid == null) {
      grd += e;
      cost += e * rate;
      if (rate >= 0.2) gpk += e;
      continue;
    }
    any = true;
    const fs = tot > 0.01 ? s / tot : 0;
    const fb = tot > 0.01 ? b / tot : 0;
    const fg = tot > 0.01 ? g / tot : 1;
    sol += e * fs;
    bat += e * fb;
    grd += e * fg;
    if (rate >= 0.2) gpk += e * fg;
    const bc = battCost[i0 + k] ?? 0;
    batCost += e * fb * bc;
    cost += e * fg * rate + e * fb * bc;
    const xr = sm.exportRate != null && sm.exportRate >= 0 && sm.exportRate < 1 ? sm.exportRate : 0.15;
    forgone += e * fs * xr;
  }
  const r = (n: number, d = 100) => Math.round(n * d) / d;
  return {
    solar_kwh: r(sol),
    battery_kwh: r(bat),
    grid_kwh: r(grd),
    grid_peak_kwh: r(gpk),
    cost_actual_gbp: r(cost, 1000),
    solar_forgone_gbp: r(forgone, 1000),
    battery_rate_p: bat > 0.01 ? r((batCost / bat) * 100, 10) : null,
    method: any ? "power" : "none",
  };
}


export type RunFeatures = {
  duration_min: number;
  kwh: number; // energy above baseline
  peak_kw: number; // highest 5-min max above baseline
  plateau_kw: number; // median excess while "on"
  spikes: number; // separate "on" segments merged into the run
  duty: number; // fraction of the run that is "on"
  start_min: number; // London minute of day
  baseline_kw: number;
  car_overlap: number; // fraction of the run with a car charging (subtracted, but adds noise)
};

export type DetectedRun = {
  start: number;
  end: number;
  features: RunFeatures;
  profile: number[]; // 16 points, excess / peak (shape only)
  series: number[]; // excess kW per 5 min (for the mini chart)
  cost_gbp: number;
  peak_kwh: number; // kWh at peak rate (>= 20p)
  peak_min?: number; // minutes running at peak rate
  sources?: Sources; // where the energy came from, and the actual cost
  open: boolean; // still running at the end of the window
  layer?: RunLayer; // "top" = a second appliance stacked on a steady one ("base")
};
export type RunLayer = "single" | "base" | "top";

export type DetectOpts = {
  thresholdKw: number; // "on" when excess above this
  tailKw: number; // extend run while excess above this
  minOnMin: number;
  mergeGapMin: number;
  minKwh: number;
  baselineWindowMin: number;
  baselinePct: number;
  londonMinute: (t: number) => number;
  rateFallback: (t: number) => number; // GBP/kWh when no rate statistic
};

export const DEFAULTS: Omit<DetectOpts, "londonMinute" | "rateFallback"> = {
  thresholdKw: 0.7,
  tailKw: 0.2,
  minOnMin: 10,
  mergeGapMin: 25,
  minKwh: 0.3,
  baselineWindowMin: 360,
  baselinePct: 0.1,
};

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[i];
}

/** Rolling low-percentile baseline (centred window), robust to hours-long appliance runs. */
export function baseline(samples: Sample[], windowMin: number, pct: number): number[] {
  const half = Math.round(windowMin / 2 / 5);
  const out: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(samples.length, i + half + 1);
    const w = samples.slice(a, b).map((s) => s.kw).sort((x, y) => x - y);
    out.push(percentile(w, pct));
  }
  return out;
}

export function resample(xs: number[], n = 16): number[] {
  if (!xs.length) return new Array(n).fill(0);
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * xs.length;
    const b = ((k + 1) / n) * xs.length;
    let s = 0;
    let w = 0;
    for (let i = Math.floor(a); i < Math.ceil(b) && i < xs.length; i++) {
      const ov = Math.min(b, i + 1) - Math.max(a, i);
      if (ov > 0) {
        s += xs[i] * ov;
        w += ov;
      }
    }
    out.push(w ? s / w : 0);
  }
  return out;
}

export function detectRuns(samples: Sample[], o: DetectOpts): DetectedRun[] {
  if (samples.length < 6) return [];
  const base = baseline(samples, o.baselineWindowMin, o.baselinePct);
  const battCost = batteryCostSeries(samples, o.rateFallback);
  const ex = samples.map((s, i) => Math.max(0, s.kw - base[i]));
  const on = ex.map((e) => e > o.thresholdKw);
  // on-segments
  const segs: [number, number][] = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i]) continue;
    let j = i;
    while (j + 1 < on.length && on[j + 1] && samples[j + 1].t - samples[j].t <= STEP_MS * 1.5) j++;
    segs.push([i, j]);
    i = j;
  }
  // merge segments separated by short gaps (heating spikes of one cycle)
  const gap = o.mergeGapMin * 60000;
  const runs: { a: number; b: number; segs: [number, number][] }[] = [];
  for (const s of segs) {
    const last = runs[runs.length - 1];
    if (last && samples[s[0]].t - samples[last.b].t - STEP_MS <= gap) {
      last.b = s[1];
      last.segs.push(s);
    } else runs.push({ a: s[0], b: s[1], segs: [s] });
  }
  // extend into low-power tails (motor / pump phases, max 45 min each side), then merge runs that now touch
  const ext: { a: number; b: number; segs: [number, number][] }[] = [];
  for (const r of runs) {
    let a = r.a;
    let b = r.b;
    for (let k = 0; k < 9 && a > 0 && ex[a - 1] > o.tailKw; k++) a--;
    for (let k = 0; k < 9 && b < ex.length - 1 && ex[b + 1] > o.tailKw; k++) b++;
    const last = ext[ext.length - 1];
    if (last && a <= last.b + 1) {
      last.b = Math.max(last.b, b);
      last.segs.push(...r.segs);
    } else ext.push({ a, b, segs: [...r.segs] });
  }
  const out: DetectedRun[] = [];
  const thr = o.thresholdKw;
  const build = (a: number, b: number, exs: number[], layer: RunLayer, peakOverride?: number) => {
    // exs: this run's own excess per sample (index 0 = sample a)
    const onIdx = exs.map((v, i) => (v > thr ? i : -1)).filter((i) => i >= 0);
    if (onIdx.length * 5 < o.minOnMin) return;
    let spikes = 0;
    for (let i = 0; i < onIdx.length; i++) if (i === 0 || onIdx[i] - onIdx[i - 1] > 1) spikes++;
    const series = exs.map((v) => Math.round(v * 1000) / 1000);
    const kwh = series.reduce((t, v) => t + v * (5 / 60), 0);
    if (kwh < o.minKwh) return;
    let cost = 0;
    let peakKwh = 0;
    let peakN = 0;
    let carN = 0;
    for (let i = a; i <= b; i++) {
      const rate = samples[i].rate != null && samples[i].rate! > 0.01 && samples[i].rate! < 1 ? samples[i].rate! : o.rateFallback(samples[i].t);
      const k = exs[i - a] * (5 / 60);
      cost += k * rate;
      if (rate >= 0.2) {
        peakKwh += k;
        if (exs[i - a] > o.tailKw) peakN++;
      }
      if (samples[i].car > 0.3) carN++;
    }
    const onVals = onIdx.map((i) => exs[i]).sort((x, y) => x - y);
    const peak = peakOverride ?? Math.max(...samples.slice(a, b + 1).map((sm, i) => Math.max(sm.max - base[a + i], ex[a + i])));
    const pk = Math.max(0.001, Math.max(...series));
    out.push({
      start: samples[a].t,
      end: samples[b].t + STEP_MS,
      features: {
        duration_min: (b - a + 1) * 5,
        kwh: Math.round(kwh * 100) / 100,
        peak_kw: Math.round(peak * 100) / 100,
        plateau_kw: Math.round(percentile(onVals, 0.5) * 100) / 100,
        spikes,
        duty: Math.round((onIdx.length / (b - a + 1)) * 100) / 100,
        start_min: o.londonMinute(samples[a].t),
        baseline_kw: Math.round(base[a] * 100) / 100,
        car_overlap: Math.round((carN / (b - a + 1)) * 100) / 100,
      },
      profile: resample(series).map((v) => Math.round((v / pk) * 1000) / 1000),
      series,
      cost_gbp: Math.round(cost * 1000) / 1000,
      sources: attributeSources(samples, a, exs, battCost, o.rateFallback),
      peak_kwh: Math.round(peakKwh * 100) / 100,
      peak_min: peakN * 5,
      open: b === samples.length - 1,
      layer,
    });
  };

  for (const r of ext) {
    // 1) temporal split: a quiet stretch (>= 30 min well below the run's working level) separates two runs
    const onAll = ex.slice(r.a, r.b + 1).filter((v) => v > thr).sort((x, y) => x - y);
    const level = percentile(onAll, 0.5);
    const quiet = Math.min(1.0, Math.max(0.45, 0.4 * level));
    const pieces: [number, number][] = [];
    let start = r.a;
    let i = r.a;
    while (i <= r.b) {
      if (ex[i] < quiet) {
        let j = i;
        while (j + 1 <= r.b && ex[j + 1] < quiet) j++;
        if (j - i + 1 >= 6 && i > start) {
          pieces.push([start, i - 1]);
          start = j + 1;
        }
        i = j + 1;
      } else i++;
    }
    if (start <= r.b) pieces.push([start, r.b]);
    for (const [pa, pb] of pieces) {
      // trim quiet ends left by the split
      let a = pa;
      let b = pb;
      while (a < b && ex[a] <= o.tailKw) a++;
      while (b > a && ex[b] <= o.tailKw) b--;
      const exs = ex.slice(a, b + 1);
      // 2) layer split: a second appliance on top of a steady one (e.g. dryer during the hot tub)
      const on = exs.filter((v) => v > thr).sort((x, y) => x - y);
      const lower = percentile(on, 0.25);
      const topThr = lower + Math.max(0.9, 0.5 * lower);
      const topIdx = exs.map((v, k) => (v > topThr ? k : -1)).filter((k) => k >= 0);
      const topKwh = topIdx.reduce((t, k) => t + (exs[k] - lower) * (5 / 60), 0);
      const baseOn = exs.filter((v) => v > thr).length;
      const rest = exs.filter((v, k) => v > thr && !topIdx.includes(k)).sort((x, y) => x - y);
      const steady = rest.length >= 4 && percentile(rest, 0.75) - percentile(rest, 0.25) <= 0.6;
      const ta0 = topIdx[0] ?? 0;
      const tb0 = topIdx[topIdx.length - 1] ?? 0;
      const contiguous = topIdx.length / Math.max(1, tb0 - ta0 + 1) >= 0.7;
      const outside = Math.max(ta0, exs.length - 1 - tb0) >= 3; // base runs >= 15 min beyond the top layer
      if (lower >= 1.2 && steady && contiguous && outside && topIdx.length >= 3 && topKwh >= o.minKwh && topIdx.length <= 0.6 * baseOn) {
        const ta = topIdx[0];
        const tb = topIdx[topIdx.length - 1];
        const top = exs.slice(ta, tb + 1).map((v) => Math.max(0, v - lower));
        build(a, b, exs.map((v, k) => (topIdx.length && k >= ta && k <= tb ? Math.min(v, lower) : v)), "base");
        build(a + ta, a + tb, top, "top", Math.max(...top));
      } else build(a, b, exs, "single");
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

// ------------------------------------------------------------------ classifier

export type Labelled = { key: string; features: RunFeatures; profile: number[] };

/** Feature vector; scaled so each dimension is roughly "1 = clearly different". */
export function vec(f: RunFeatures): number[] {
  const ang = (f.start_min / 1440) * 2 * Math.PI;
  return [
    Math.log(Math.max(5, f.duration_min)) / 0.5, // ±65% duration ≈ 1
    Math.log(Math.max(0.1, f.kwh)) / 0.5,
    f.plateau_kw / 0.6,
    f.peak_kw / 0.8,
    Math.min(f.spikes, 6) / 2,
    f.duty / 0.35,
    Math.cos(ang) * 0.6, // time of day: weak signal
    Math.sin(ang) * 0.6,
  ];
}

export function profileDistance(a: number[], b: number[]): number {
  // Small-shift-tolerant distance (DTW-ish with a band of 1).
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let d = -1; d <= 1; d++) {
      const j = i + d;
      if (j < 0 || j >= n) continue;
      best = Math.min(best, Math.abs(a[i] - b[j]) * (d ? 1.15 : 1));
    }
    s += best * best;
  }
  return Math.sqrt(s / n) * 4; // 0.25 average shape difference ≈ 1
}

export type Suggestion = { key: string; confidence: number; distance: number; n: number; runner_up?: string; why: string };

export function classify(f: RunFeatures, profile: number[], training: Labelled[]): Suggestion | null {
  if (!training.length) return null;
  const groups = new Map<string, Labelled[]>();
  for (const t of training) groups.set(t.key, [...(groups.get(t.key) || []), t]);
  const v = vec(f);
  const scored: { key: string; d: number; n: number }[] = [];
  for (const [key, items] of groups) {
    const vs = items.map((x) => vec(x.features));
    const c = v.map((_, i) => vs.reduce((s, x) => s + x[i], 0) / vs.length);
    const pc = profile.map((_, i) => items.reduce((s, x) => s + (x.profile[i] ?? 0), 0) / items.length);
    const fd = Math.sqrt(v.reduce((s, x, i) => s + (x - c[i]) ** 2, 0));
    const pd = profileDistance(profile, pc);
    scored.push({ key, d: Math.sqrt(fd * fd + pd * pd), n: items.length });
  }
  scored.sort((a, b) => a.d - b.d);
  const best = scored[0];
  const second = scored[1];
  // absolute closeness × margin over the runner-up
  const abs = Math.exp(-best.d / 4);
  const margin = second ? Math.min(1, (second.d - best.d) / Math.max(0.5, second.d)) * 0.5 + 0.5 : 0.95;
  const confidence = Math.round(abs * margin * Math.min(1, 0.55 + 0.15 * best.n) * 100) / 100;
  return {
    key: best.key,
    confidence,
    distance: Math.round(best.d * 100) / 100,
    n: best.n,
    runner_up: second?.key,
    why: `closest to ${best.n} confirmed run${best.n === 1 ? "" : "s"} (distance ${best.d.toFixed(1)}${second ? `; next ${second.d.toFixed(1)}` : ""})`,
  };
}

/** Cold-start hints before anything is confirmed: plain rules of thumb, low confidence. */
export function hint(f: RunFeatures): { name: string; why: string } | null {
  const h = f.duration_min / 60;
  if (f.plateau_kw >= 2.3 && f.duty > 0.6 && h >= 1.5) return { name: "Hot Tub", why: "long, steady ~2.5–3 kW heating" };
  if (f.plateau_kw >= 1.2 && f.plateau_kw < 2.3 && f.duty > 0.75 && h >= 1) return { name: "Electric Heater", why: "long, steady 1.2–2.3 kW" };
  if (f.plateau_kw >= 1.6 && f.duty > 0.55 && h >= 0.6 && h <= 2.5 && f.spikes <= 3) return { name: "Tumble Dryer", why: "45–150 min of mostly-on ~2 kW" };
  if (f.spikes >= 2 && h >= 1.2 && h <= 3.5 && f.duty < 0.55) return { name: "Dishwasher", why: "two or more separate heating phases" };
  if (h >= 0.6 && h <= 3.5 && f.duty < 0.6) return { name: "Washing Machine", why: "short heating burst then a long low tail" };
  return null;
}
