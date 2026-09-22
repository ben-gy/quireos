import type { Manifest } from "@quireos/sdk";

export const manifest: Manifest = {
  spec_version: 1,
  id: "frame",
  name: "Frame",
  version: "1.0.0",
  min_os: "0.1.0",
  icon: "image-outline",
  orientation: "portrait",
  screens: ["540x960", "960x540"],
  entry: "/screens/home.json",
  event: "/event",
  hosts: [],
  settings: [
    {
      key: "mode",
      label: "Mode",
      type: "select",
      default: "quote",
      options: [
        { value: "quote", label: "Quotes" },
        { value: "image", label: "Image from a URL" },
      ],
    },
    { key: "image_url", label: "Image URL", type: "url", help: "PNG or JPEG, fetched by the server, cropped to the screen and dithered. Used in Image mode." },
  ],
};
