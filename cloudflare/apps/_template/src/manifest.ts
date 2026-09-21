import type { Manifest } from "@quireos/sdk";

/**
 * §5 manifest. `entry` and `event` default to `/screens/home.json` and `/event` when omitted
 * (createApp fills them in); everything else is yours.
 */
export const manifest: Manifest = {
  spec_version: 1,
  id: "template",
  name: "Template",
  version: "0.1.0",
  min_os: "0.1.0",
  icon: "star",
  orientation: "portrait",
  screens: ["540x960"],
  entry: "/screens/home.json",
  event: "/event",
  hosts: [],
  settings: [
    { key: "name", label: "Your name", type: "string", default: "friend", help: "Shown on the home screen" },
    { key: "count", label: "Starting count", type: "number", min: 0, max: 99, default: 0 },
  ],
};
