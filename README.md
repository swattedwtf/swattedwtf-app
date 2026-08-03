# Swatted.wtf Desktop

Open-source desktop client for the swatted.wtf OSINT platform, built with Tauri v2,
React and TypeScript.

All HTTP and all secret storage live in Rust. The webview is a rendering layer: it
never receives a session token, and there is no command that hands one to it.

Targets Windows (`.msi`, NSIS `.exe`) and Linux (`.deb`, `.AppImage`). There is no
macOS build in v1.

> **Screenshot to add before release:** the boot sequence (verify, update check,
> welcome reveal), plus the Windows SmartScreen dialog described below. No
> screenshots exist yet, so this README describes both in words.

> **Pre-release status.** This app has not shipped a release yet, and parts of
> this README describe the intended behaviour of code that is still landing.
> Accurate today: the Rust-side session model, the signed integrity manifest
> format and its verifier, and the network egress described below. Not yet
> wired: the updater (no `plugins.updater` block or public key in
> `tauri.conf.json` yet) and the bundling of `integrity.json` as an app
> resource. This note comes out when both are in place, before the first
> release. Do not treat the update-signing section as describing shipped
> behaviour until then.

## What v1 does

- A boot sequence: integrity check, update check, then a branded welcome reveal.
- Login, two-factor entry, and registration.
- The dashboard home, with your plan, usage and account details.
- Settings.

Every other entry in the sidebar renders visibly disabled with a "soon" pill.
Those modules are not in this release.

## Installing

Downloads are on the
[Releases page](https://github.com/sujrb/swattedwtf-app/releases).

### Windows: the SmartScreen warning

**The installers are not code-signed.** Windows shows a blue
"Windows protected your PC" dialog from Microsoft Defender SmartScreen, which by
default offers only a "Don't run" button. To install anyway:

1. Click **More info**, the small link under the message text.
2. Click **Run anyway**, the button that then appears.

This warning is expected, and it will keep appearing on new releases until either
the build earns enough reputation with SmartScreen or the installers are signed.

Signing was evaluated and rejected on cost: an OV certificate runs $200 to $400 a
year and requires a hardware token, an EV certificate runs $400 to $700 a year,
and Microsoft's $9.99 a month Azure Artifact Signing needs an account we were not
able to create. Because the installers are unsigned, the published SHA-256 hashes
below are how you check that what you downloaded is what was built. Adding signing
later changes only the CI workflow, not the application.

### Linux

Install the `.deb` with `sudo apt install ./<file>.deb`, or make the `.AppImage`
executable (`chmod +x`) and run it directly. There is no SmartScreen equivalent,
so verify with the hashes below.

## Verifying your download

Every release has per-platform checksum files attached:
`SHA256SUMS-ubuntu-22.04.txt` and `SHA256SUMS-windows-latest.txt`. Download the
one matching your platform alongside the installer.

Linux:

```bash
sha256sum -c --ignore-missing SHA256SUMS-ubuntu-22.04.txt
```

The paths in that file are relative to the build tree (for example
`./deb/<file>.deb`), so if `-c` reports that no file was verified, compare the
hash directly instead:

```bash
sha256sum <file>.deb
grep "$(sha256sum <file>.deb | cut -d' ' -f1)" SHA256SUMS-ubuntu-22.04.txt
```

A matching line means the file is byte for byte what CI built. No output means it
is not.

Windows (PowerShell):

```powershell
Get-FileHash .\<file>.exe -Algorithm SHA256

Select-String -Path .\SHA256SUMS-windows-latest.txt `
  -Pattern (Get-FileHash .\<file>.exe -Algorithm SHA256).Hash
```

`Get-FileHash` prints an uppercase hash while the checksum file is lowercase, so
compare case-insensitively. `Select-String` already does.

## Updates are signed, even though the installer is not

These are two separate things, and only one of them is missing.

The installer is unsigned, which is what SmartScreen complains about. The
**updater** is signed: Tauri's updater verifies a minisign signature on every
update before applying it, against a public key compiled into the app. An update
that is not signed by the release key is rejected. Auto-updates are therefore
cryptographically protected regardless of the installer's signing status.

The private key lives in GitHub Actions secrets and is never in this repository.

## What "Verifying" does and does not do

On launch the app hashes its own bundled files and compares them against a
manifest signed with an ed25519 release key.

**Integrity checking detects corrupted or modified installs. It is not a security
control: this app is open source, so the check can be removed from a modified
copy.**

Treat a failure as a hint that something is wrong with your copy, either a bad
download or a build someone else altered, and treat a pass as nothing more than
the absence of that hint. When the check fails, the app lists the files that
differ, links to the official build, and lets you continue anyway.

## What the app talks to

Two hosts, and nothing else:

- `https://swattedw.tf`, for the API.
- GitHub, for release downloads and update checks.

There is no telemetry, no analytics and no crash reporting. Nothing is sent
anywhere on launch, on error, or on a schedule.

You do not have to take our word for it. Every API request the app makes is built
by the single client in
[`src-tauri/src/api/client.rs`](src-tauri/src/api/client.rs), which prefixes each
path with the base URL from
[`src-tauri/src/config.rs`](src-tauri/src/config.rs) (`https://swattedw.tf` unless
overridden at build time). That file is also the only place a `reqwest` client is
constructed, so there is one code path to audit. The only other network traffic is
the Tauri updater's call to GitHub.

## Your session

The session cookie the server issues is held in a Rust cookie jar and persisted to
the OS keychain (Windows Credential Manager, or the Secret Service on Linux). On a
Linux system with no Secret Service provider, it falls back to a file in the app's
local data directory with `0600` permissions, which is weaker at rest. The webview
never receives the cookie. Logging out clears it from both the live jar and the
keychain, so it does not come back after a restart.

See [SECURITY.md](SECURITY.md) for the full model and for how to report a problem.

## Build from source

Prerequisites: Node 20 or newer, the stable Rust toolchain, and, on Linux, the
Tauri system dependencies:

```bash
sudo apt-get update && sudo apt-get install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

Then:

```bash
npm ci
npm run tauri build   # installers land in src-tauri/target/release/bundle/
```

For development:

```bash
npm run tauri dev
npm test              # frontend unit tests
cd src-tauri && cargo test
```

The API base is a build-time constant. Set `SWATTED_API_BASE` to point a build at
a different server. It defaults to `https://swattedw.tf`.

A build you make yourself will not match the published hashes, and its integrity
manifest is not the one CI signed. Both of those are expected.

## Licence

MIT. See [LICENSE](LICENSE).
