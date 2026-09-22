import iconsJson from "./generated/icons.js";

type IconEntry = (typeof iconsJson.icons)[number];
type RoleOf<T> = T extends { role: infer R } ? R : never;
export type IconRole = RoleOf<IconEntry>;
export type IconName = IconEntry["name"];

const byRole = new Map<string, IconEntry>();
const byName = new Map<string, IconEntry>();
for (const ic of iconsJson.icons) { byRole.set(ic.role, ic); byName.set(ic.name, ic); }

/** Semantic icon names: `Icons.back` is `"chevron-left"`. */
export const Icons = Object.fromEntries(iconsJson.icons.map((ic) => [ic.role, ic.name])) as { [R in IconRole]: Extract<IconEntry, { role: R }>["name"] };

export function iconByRole(role: IconRole): IconName { return byRole.get(role)!.name as IconName; }
export function isIcon(name: string): name is IconName { return byName.has(name); }
/** The filled twin of an outline icon, or the icon itself when it has none. */
export function filledTwin(name: IconName): IconName {
  const e = byName.get(name) as (IconEntry & { pair?: string }) | undefined;
  return (e?.pair as IconName | undefined) ?? name;
}
export const iconTier = (name: IconName) => byName.get(name)!.tier;
export const isDisplayIcon = (name: IconName) => !!(byName.get(name) as { display?: boolean } | undefined)?.display;

/** Battery step icon for a literal percentage. */
export function batteryIconFor(pct: number): IconName {
  if (pct < 0) return Icons.battery_low;
  if (pct >= 95) return Icons.battery_100;
  if (pct >= 80) return Icons.battery_90;
  if (pct >= 60) return Icons.battery_70;
  if (pct >= 40) return Icons.battery_50;
  if (pct >= 20) return Icons.battery_30;
  if (pct >= 5) return Icons.battery_10;
  return Icons.battery_0;
}
/** Steps for a templated battery value: [condition, icon]. Order matters; the first true wins on the device only if `when`s are exclusive, so they are written as ranges. */
export const BATTERY_STEPS: ReadonlyArray<readonly [string, IconName]> = [
  ["< 0", Icons.battery_low], [">= 95", Icons.battery_100], [">= 80", Icons.battery_90], [">= 60", Icons.battery_70],
  [">= 40", Icons.battery_50], [">= 20", Icons.battery_30], [">= 5", Icons.battery_10], [">= 0", Icons.battery_0],
];
export function wifiIconFor(rssi: number, online = true): IconName {
  if (!online) return Icons.wifi_off;
  if (rssi >= -55) return Icons.wifi_4;
  if (rssi >= -65) return Icons.wifi_3;
  if (rssi >= -75) return Icons.wifi_2;
  if (rssi >= -85) return Icons.wifi_1;
  return Icons.wifi_0;
}
export const icons = iconsJson;
