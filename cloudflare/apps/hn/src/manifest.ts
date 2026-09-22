import type { Manifest } from "@quireos/sdk";

/**
 * The three settings can be set from the device's LAN settings page; the in-app Settings screen
 * stores overrides per install in KV, which win when present.
 */
export const manifest: Manifest = {
  spec_version: 1,
  id: "hn",
  name: "Hacker News",
  version: "1.0.0",
  min_os: "0.1.0",
  icon: "newspaper-variant-outline",
  orientation: "portrait",
  screens: ["540x960", "960x540"],
  entry: "/screens/home.json",
  event: "/event",
  hosts: [],
  settings: [
    {
      key: "text_size",
      label: "Text size",
      type: "select",
      default: "md",
      options: [
        { value: "sm", label: "Small" },
        { value: "md", label: "Medium" },
        { value: "lg", label: "Large" },
      ],
      help: "Comment and article text. The in-app Settings screen overrides this.",
    },
    { key: "dark", label: "Dark theme", type: "bool", default: false, help: "White text on black" },
    { key: "open_article", label: "Open stories as articles", type: "bool", default: false, help: "Tap a story to read the linked page instead of the comments" },
  ],
};
