/**
 * Clock & Weather. Routes: GET /manifest.json, GET /screens/home.json. The Worker reads the
 * place from `X-App-Settings`, fetches Open-Meteo (cached ten minutes) and bakes the numbers into
 * the screen; the clock is a `device.time` template.
 */
import { createApp } from "@quireos/sdk";
import { manifest } from "./manifest.js";
import { homeScreen } from "./screens.js";
import { getWeather, parsePlace } from "./weather.js";

export interface Env {
  DEV?: string;
}

export { manifest };

/** Injection point for tests. */
export const deps: { fetch: typeof fetch } = { fetch: (input, init) => fetch(input, init) };

export default createApp<Env>({
  manifest,
  screens: {
    home: async (ctx) => {
      const place = parsePlace(ctx.device.settings);
      const { weather, error } = await getWeather(place, deps.fetch);
      return homeScreen({ place, weather, error, screen: ctx.device.screen });
    },
  },
});
