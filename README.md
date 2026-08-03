# Swatted.wtf desktop

Open-source desktop client for the swatted.wtf OSINT platform, built with Tauri v2,
React and TypeScript.

Targets Windows (`.msi`, NSIS `.exe`) and Linux (`.deb`, `.AppImage`).

## Design notes

- All HTTP and all secret storage live in Rust. The webview never receives a
  session token, and there is no command that returns one.
- Network egress is limited to `https://swattedw.tf` and GitHub Releases. No
  telemetry, no analytics, no crash reporting.
- The API base is a build-time constant. Override it with `SWATTED_API_BASE`
  to point a dev build at a local server.

## Build from source

Prerequisites: Node 20+, the stable Rust toolchain, and the Tauri Linux
dependencies (`libwebkit2gtk-4.1-dev`, `build-essential`, `libxdo-dev`,
`libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`).

```bash
npm install
npm run tauri dev     # run in development
npm run tauri build   # produce installers
```

## Licence

MIT. See `LICENSE`.
