import type { Manifest } from "@quireos/sdk";

/** The §5 example manifest, plus an optional `single_request` switch. */
export const manifest: Manifest = {
  spec_version: 1,
  id: "ha-lights",
  name: "HA Lights",
  version: "1.0.0",
  min_os: "0.1.0",
  icon: "lightbulb",
  orientation: "portrait",
  screens: ["540x960", "960x540"],
  entry: "/screens/home.json",
  hosts: ["{{settings.ha_url}}"],
  settings: [
    { key: "ha_url", label: "Home Assistant URL", type: "url", required: true, default: "http://homeassistant.local:8123", help: "Where the device can reach HA on your LAN" },
    { key: "ha_token", label: "Long-lived access token", type: "secret", required: true, help: "HA > Profile > Security > Long-lived access tokens" },
    {
      key: "entities",
      label: "Switches",
      type: "list",
      max: 8,
      required: true,
      item: [
        { key: "id", label: "Entity id", type: "string", required: true },
        { key: "label", label: "Tile label", type: "string", required: true },
      ],
    },
    { key: "single_request", label: "One request per refresh", type: "bool", default: false, help: "Read every state with one POST to /api/template instead of one GET per entity" },
  ],
};
