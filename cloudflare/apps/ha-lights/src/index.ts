/**
 * HA Lights: one screen. The entity list arrives in `X-App-Settings` (non-secret settings reach
 * the Worker); the token does not, and is only used by the device in the data-source and
 * `http` templates. Routes: GET /manifest.json, GET /screens/home.json.
 */
import { createApp } from "@quireos/sdk";
import { manifest } from "./manifest.js";
import { homeScreen, parseEntities } from "./screens.js";

export interface Env {
  DEV?: string;
}

export { manifest };

export default createApp<Env>({
  manifest,
  screens: {
    home: (ctx) => {
      const s = ctx.device.settings;
      return homeScreen({ entities: parseEntities(s), singleRequest: s.single_request === true || s.single_request === "true", screen: ctx.device.screen });
    },
  },
});
