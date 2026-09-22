/**
 * Open-Meteo client with a ten-minute cache (Workers Cache API, in-memory fallback) and the WMO
 * weather-code → icon/description mapping. Icons come from `spec/icons.json`; the large current-
 * conditions glyph only uses names the design library ships at `lg` (the "display" tier).
 */

export type Units = "metric" | "imperial";

export interface Place {
  name: string;
  lat: number;
  lon: number;
  units: Units;
}

export interface Day {
  /** `YYYY-MM-DD` in the place's time zone. */
  date: string;
  code: number;
  hi: number;
  lo: number;
}

export interface Weather {
  temp: number;
  feels: number;
  humidity: number;
  wind: number;
  code: number;
  isDay: boolean;
  days: Day[];
  /** Epoch seconds when this was fetched. */
  fetched: number;
  units: Units;
}

export const WEATHER_TTL = 600;
export const API = "https://api.open-meteo.com/v1/forecast";

export function parsePlace(settings: Record<string, unknown>): Place {
  const num = (v: unknown, fallback: number, lo: number, hi: number) => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
  };
  const name = typeof settings.place === "string" && settings.place.trim() ? settings.place.trim().slice(0, 40) : "Sydney";
  return { name, lat: num(settings.lat, -33.87, -90, 90), lon: num(settings.lon, 151.21, -180, 180), units: settings.units === "imperial" ? "imperial" : "metric" };
}

export function apiUrl(p: Place): string {
  const q = new URLSearchParams({
    latitude: p.lat.toFixed(4),
    longitude: p.lon.toFixed(4),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: "4",
  });
  if (p.units === "imperial") {
    q.set("temperature_unit", "fahrenheit");
    q.set("wind_speed_unit", "mph");
  }
  return `${API}?${q.toString()}`;
}

type J = Record<string, unknown>;
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function parseWeather(json: unknown, units: Units, fetched: number): Weather | undefined {
  const d = json as J | null;
  const cur = d?.current as J | undefined;
  const daily = d?.daily as J | undefined;
  if (!cur || typeof cur.temperature_2m !== "number") return undefined;
  const dates = Array.isArray(daily?.time) ? (daily!.time as unknown[]) : [];
  const codes = Array.isArray(daily?.weather_code) ? (daily!.weather_code as unknown[]) : [];
  const his = Array.isArray(daily?.temperature_2m_max) ? (daily!.temperature_2m_max as unknown[]) : [];
  const los = Array.isArray(daily?.temperature_2m_min) ? (daily!.temperature_2m_min as unknown[]) : [];
  const days: Day[] = dates.slice(0, 4).map((date, i) => ({ date: String(date), code: n(codes[i]), hi: n(his[i]), lo: n(los[i]) }));
  return { temp: cur.temperature_2m, feels: n(cur.apparent_temperature), humidity: n(cur.relative_humidity_2m), wind: n(cur.wind_speed_10m), code: n(cur.weather_code), isDay: cur.is_day !== 0, days, fetched, units };
}

// ---------------------------------------------------------------------------------------------
// Cache

interface Mem {
  exp: number;
  value: Weather;
}
const mem = new Map<string, Mem>();

function cacheKey(p: Place): string {
  return `https://cache.quireos-clock-weather.invalid/${p.lat.toFixed(2)}/${p.lon.toFixed(2)}/${p.units}`;
}

function cacheApi(): Cache | undefined {
  try {
    return (globalThis as { caches?: { default?: Cache } }).caches?.default;
  } catch {
    return undefined;
  }
}

async function fromCache(key: string): Promise<Weather | undefined> {
  const api = cacheApi();
  if (api) {
    try {
      const hit = await api.match(key);
      if (hit) return (await hit.json()) as Weather;
    } catch {
      /* fall through */
    }
  }
  const m = mem.get(key);
  if (m && m.exp > Date.now()) return m.value;
  return undefined;
}

async function toCache(key: string, w: Weather): Promise<void> {
  mem.set(key, { exp: Date.now() + WEATHER_TTL * 1000, value: w });
  const api = cacheApi();
  if (api) {
    try {
      await api.put(key, new Response(JSON.stringify(w), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${WEATHER_TTL}` } }));
    } catch {
      /* memory copy is enough */
    }
  }
}

export interface WeatherResult {
  weather?: Weather;
  error?: string;
}

/** Cached for ten minutes per rounded coordinate and unit system; a stale memory copy beats an error. */
export async function getWeather(p: Place, fetchFn: typeof fetch = fetch, force = false): Promise<WeatherResult> {
  const key = cacheKey(p);
  if (!force) {
    const hit = await fromCache(key);
    if (hit) return { weather: hit };
  }
  try {
    const res = await fetchFn(apiUrl(p), { headers: { Accept: "application/json", "User-Agent": "QuireOS-clock-weather/1.0" } });
    if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
    const w = parseWeather(await res.json(), p.units, Math.floor(Date.now() / 1000));
    if (!w) throw new Error("Open-Meteo sent an unexpected document");
    await toCache(key, w);
    return { weather: w };
  } catch (err) {
    const stale = mem.get(key)?.value;
    return { weather: stale, error: (err as Error).message.slice(0, 120) };
  }
}

/** Test hook. */
export function clearWeatherCache(): void {
  mem.clear();
}

// ---------------------------------------------------------------------------------------------
// WMO codes

export interface Condition {
  /** Icon for the current conditions at `lg` (display tier only). */
  big: string;
  /** Icon for the forecast row at `md`. */
  icon: string;
  desc: string;
}

/** Display-tier icons (available at `lg`) for the ones that are not. */
const LG_FALLBACK: Record<string, string> = {
  "weather-fog": "weather-cloudy",
  "weather-hazy": "weather-cloudy",
  "weather-windy": "weather-cloudy",
  "weather-pouring": "weather-rainy",
  "weather-hail": "weather-snowy",
  "weather-snowy-rainy": "weather-snowy",
  "weather-lightning-rainy": "weather-lightning",
  "weather-night-partly-cloudy": "weather-partly-cloudy",
};

export function condition(code: number, isDay = true): Condition {
  let icon: string;
  let desc: string;
  if (code === 0) {
    icon = isDay ? "weather-sunny" : "weather-night";
    desc = "Clear";
  } else if (code === 1) {
    icon = isDay ? "weather-partly-cloudy" : "weather-night-partly-cloudy";
    desc = "Mainly clear";
  } else if (code === 2) {
    icon = isDay ? "weather-partly-cloudy" : "weather-night-partly-cloudy";
    desc = "Partly cloudy";
  } else if (code === 3) {
    icon = "weather-cloudy";
    desc = "Overcast";
  } else if (code === 45 || code === 48) {
    icon = "weather-fog";
    desc = code === 48 ? "Rime fog" : "Fog";
  } else if (code >= 51 && code <= 55) {
    icon = "weather-rainy";
    desc = "Drizzle";
  } else if (code === 56 || code === 57) {
    icon = "weather-snowy-rainy";
    desc = "Freezing drizzle";
  } else if (code === 61) {
    icon = "weather-rainy";
    desc = "Light rain";
  } else if (code === 63) {
    icon = "weather-rainy";
    desc = "Rain";
  } else if (code === 65) {
    icon = "weather-pouring";
    desc = "Heavy rain";
  } else if (code === 66 || code === 67) {
    icon = "weather-snowy-rainy";
    desc = "Freezing rain";
  } else if (code === 71) {
    icon = "weather-snowy";
    desc = "Light snow";
  } else if (code === 73) {
    icon = "weather-snowy";
    desc = "Snow";
  } else if (code === 75) {
    icon = "weather-snowy";
    desc = "Heavy snow";
  } else if (code === 77) {
    icon = "weather-hail";
    desc = "Snow grains";
  } else if (code === 80 || code === 81) {
    icon = "weather-rainy";
    desc = code === 80 ? "Light showers" : "Showers";
  } else if (code === 82) {
    icon = "weather-pouring";
    desc = "Heavy showers";
  } else if (code === 85 || code === 86) {
    icon = "weather-snowy";
    desc = "Snow showers";
  } else if (code === 95) {
    icon = "weather-lightning";
    desc = "Thunderstorm";
  } else if (code === 96 || code === 99) {
    icon = "weather-lightning-rainy";
    desc = "Thunderstorm, hail";
  } else {
    icon = "weather-cloudy";
    desc = "Unknown";
  }
  return { icon, big: LG_FALLBACK[icon] ?? icon, desc };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function weekday(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return "";
  return DAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()]!;
}
