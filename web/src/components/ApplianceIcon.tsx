import { Bath, Car, Fan, Flame, Heater, Microwave, Plug, Refrigerator, Utensils, WashingMachine, Wind, Zap, type LucideIcon } from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  "washing-machine": WashingMachine,
  utensils: Utensils,
  wind: Wind,
  heater: Heater,
  bath: Bath,
  plug: Plug,
  zap: Zap,
  flame: Flame,
  fan: Fan,
  refrigerator: Refrigerator,
  microwave: Microwave,
  car: Car,
};

export function ApplianceIcon({ icon, color, size = 14 }: { icon?: string; color?: string; size?: number }) {
  const I = ICONS[icon || "plug"] || Plug;
  return <I size={size} style={{ color: color || "var(--muted)" }} />;
}
