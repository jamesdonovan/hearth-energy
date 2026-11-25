import { NavLink, Outlet, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Bell, CalendarClock, Car, Gauge, Home, Monitor, Moon, Settings as Cog, Sun, Zap } from "lucide-react";
import { useHa } from "../lib/store";
import { fmtClock } from "../lib/format";
import { applyTheme, getThemeMode, setThemeMode } from "../lib/theme";
import { AlertsBanner } from "./AlertsBanner";
import clsx from "clsx";

const NAV = [
  { to: "/", label: "Overview", icon: Home, end: true },
  { to: "/energy", label: "Energy", icon: Gauge },
  { to: "/plan", label: "Plan", icon: CalendarClock },
  { to: "/cars", label: "Cars", icon: Car },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/settings", label: "Settings", icon: Cog },
];

export function Shell() {
  const { connected, loading, alerts } = useHa();
  const [clock, setClock] = useState(() => fmtClock());
  const [dark, setDark] = useState(() => applyTheme());
  const activeCount = alerts?.active.length ?? 0;

  useEffect(() => {
    const t = setInterval(() => setClock(fmtClock()), 15000);
    const onTheme = () => setDark(document.documentElement.classList.contains("dark"));
    window.addEventListener("hearth-theme", onTheme);
    return () => {
      clearInterval(t);
      window.removeEventListener("hearth-theme", onTheme);
    };
  }, []);

  function toggleTheme() {
    const next = getThemeMode() === "dark" || (getThemeMode() === "system" && dark) ? "light" : "dark";
    setThemeMode(next);
    setDark(next === "dark");
  }

  const link = ({ isActive }: { isActive: boolean }) =>
    clsx(
      "relative rounded-full px-4 py-1.5 text-sm font-medium transition",
      isActive ? "bg-white/10 text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]",
    );

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-30 border-b backdrop-blur-xl" style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--bg) 82%, transparent)", paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-solar/20 text-solar">
              <Zap size={18} strokeWidth={2.2} />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">Hearth</div>
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                Home Energy
              </div>
            </div>
          </div>
          <nav className="hidden items-center gap-1 rounded-full p-1 md:flex" style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)" }}>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={link}>
                {n.label}
                {n.to === "/alerts" && activeCount > 0 && (
                  <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gridin px-1 text-[10px] font-semibold text-ink-950">{activeCount}</span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right sm:block">
              <div className="num text-xs" style={{ color: "var(--muted)" }}>
                {clock}
              </div>
              <div className="flex items-center justify-end gap-1.5 text-[11px]" style={{ color: "var(--muted)" }}>
                <span className={clsx("inline-block h-1.5 w-1.5 rounded-full", connected ? "bg-batt" : loading ? "bg-solar" : "bg-gridin")} />
                {connected ? "Live" : loading ? "Connecting" : "Offline"}
              </div>
            </div>
            <Link to="/alerts" className="relative rounded-xl p-2 md:hidden" style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)" }} aria-label="Alerts">
              <Bell size={16} />
              {activeCount > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gridin px-1 text-[10px] font-semibold text-ink-950">{activeCount}</span>}
            </Link>
            <Link to="/wall" className="rounded-xl p-2" style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)" }} aria-label="Wall tablet mode" title="Wall tablet mode">
              <Monitor size={16} />
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-xl p-2"
              style={{ background: "var(--card)", boxShadow: "0 0 0 1px var(--line)" }}
              aria-label="Toggle theme"
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <AlertsBanner />
        <Outlet />
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t backdrop-blur-xl md:hidden"
        style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--bg) 90%, transparent)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => clsx("relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium", isActive ? "text-[var(--text)]" : "text-[var(--muted)]")}
          >
            <n.icon size={20} />
            {n.label}
            {n.to === "/alerts" && activeCount > 0 && <span className="absolute right-[28%] top-1 h-2 w-2 rounded-full bg-gridin" />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
