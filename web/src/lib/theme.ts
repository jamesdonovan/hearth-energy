export type ThemeMode = "dark" | "light" | "system";

export function getThemeMode(): ThemeMode {
  const v = localStorage.getItem("hearth-theme");
  return v === "light" || v === "system" ? v : "dark";
}

export function applyTheme(mode: ThemeMode = getThemeMode()) {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", Boolean(dark));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b0f14" : "#f3efe6");
  return Boolean(dark);
}

export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem("hearth-theme", mode);
  applyTheme(mode);
  window.dispatchEvent(new Event("hearth-theme"));
}

export function watchSystemTheme() {
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  const fn = () => getThemeMode() === "system" && applyTheme("system");
  mq?.addEventListener?.("change", fn);
}
