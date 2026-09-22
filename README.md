# QuireOS

An open-source operating system for e-paper devices with an app store. Apps are hosted anywhere on
the web and described as small JSON screens; the device renders them and handles taps locally.

- `spec/` — the app specification (`SPEC.md`), JSON schemas, device profiles and conformance fixtures.
- `firmware/` — the OS (PlatformIO, Arduino framework) on a hardware abstraction layer. Boards:
  `t5pro` (LilyGo T5 E-Paper S3 Pro) and `host` (the macOS emulator).
- `cloudflare/` — the store service (Workers + D1 + R2), the TypeScript SDK for app authors, and the
  example apps (Hello, Hacker News, Home Assistant Lights, Clock & Weather, Frame).
- `docs/` — [writing an app](docs/writing-an-app.md), [flashing](docs/flashing.md), [the emulator](docs/emulator.md), [porting to a new board](docs/porting.md), [the deployed services](docs/deployment.md).
- `design/` — the design system: interface guidelines, tokens per device profile, the icon library, the
  component kit (`cloudflare/ui`, `@quireos/ui`), the gallery starter app and a browser preview.

Status: under construction (2026-09).

Licence: MIT for everything written here; see `THIRD_PARTY.md` for vendored components.
