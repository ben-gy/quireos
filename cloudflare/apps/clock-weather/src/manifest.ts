import type { Manifest } from "@quireos/sdk";

export const manifest: Manifest = {
  spec_version: 1,
  id: "clock-weather",
  name: "Clock & Weather",
  version: "1.0.0",
  min_os: "0.1.0",
  icon: "weather-partly-cloudy",
  orientation: "portrait",
  screens: ["540x960", "960x540"],
  entry: "/screens/home.json",
  hosts: [],
  settings: [
    { key: "place", label: "Place name", type: "string", default: "Sydney", help: "Shown above the clock" },
    { key: "lat", label: "Latitude", type: "number", default: -33.87, min: -90, max: 90 },
    { key: "lon", label: "Longitude", type: "number", default: 151.21, min: -180, max: 180 },
    {
      key: "units",
      label: "Units",
      type: "select",
      default: "metric",
      options: [
        { value: "metric", label: "Metric (°C, km/h)" },
        { value: "imperial", label: "Imperial (°F, mph)" },
      ],
    },
  ],
};
