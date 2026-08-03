# Security policy

This document describes how the desktop client handles your session, what its
integrity check is and is not, how updates are verified, and how to report a
problem.

## Reporting a vulnerability

Please report privately first, not in a public issue.

1. Preferred: open a private report through GitHub's
   **Security > Report a vulnerability** on
   [this repository](https://github.com/swattedwtf/swattedwtf-app/security/advisories/new).
2. If that is unavailable to you, email `support@swattedw.tf` with "security" in
   the subject.

Include the version, the platform, what you observed, and the steps to reproduce
it. A working proof of concept helps but is not required.

There is no bug bounty. Reports are read and fixed, and credit is given in the
release notes if you want it.

Please do not test against other people's accounts or against production
infrastructure in ways that degrade it for other users.

## Supported versions

Only the latest release is supported. Fixes ship in a new release rather than as
patches to older ones, and the in-app updater moves users forward automatically.

## Session storage

The server issues a `parallax_session` cookie. That cookie is the credential, so
the whole design is about keeping it out of reach.

- It is held in a cookie jar owned by the Rust core, attached to the single
  `reqwest` client in `src-tauri/src/api/client.rs`.
- It is persisted through `src-tauri/src/session.rs` to the OS keychain: Windows
  Credential Manager, or the Secret Service on Linux, under the service name
  `tf.swattedw.desktop`.
- On a Linux system with no Secret Service provider, keyring access fails and the
  jar falls back to a file in the app's local data directory, written with `0600`
  permissions. That is weaker at rest: it protects against other user accounts on
  the machine, not against anything running as you. The Settings screen says so.
- **The webview never receives the cookie.** All HTTP originates in Rust, and no
  Tauri command returns the cookie or a token derived from it. A change that
  exposes one to JavaScript is a design violation, not a feature.
- Logging out clears both the live jar and the persisted copy, so a logout
  survives a restart.

## Network egress

The app talks to `https://swattedw.tf` for the API and to GitHub for release
downloads and update checks. Nothing else.

No telemetry, no analytics, no crash reporting. There is no background reporting
of any kind. The client is open source so this is checkable: start at
`src-tauri/src/api/client.rs`, which is the only place an HTTP client is built.

## Integrity checking

At launch the app hashes its bundled files and compares them against a manifest
signed with an ed25519 key whose public half is compiled into the binary.

**Integrity checking detects corrupted or modified installs. It is not a security
control: this app is open source, so the check can be removed from a modified
copy.**

Concretely:

- It catches a truncated or corrupted download, and a copy that someone edited
  without rebuilding.
- It does not catch a hostile rebuild, because an attacker distributing their own
  build simply deletes the check or ships their own key.
- A pass therefore proves nothing about a binary you obtained from somewhere
  other than our releases. Verify those with the published SHA-256 hashes, or
  build from source.

The failure screen offers "Continue anyway" on purpose. Presenting the check as
enforcement would be dishonest.

## Installer signing

**Installers ship unsigned.** On Windows this produces the SmartScreen
"Windows protected your PC" prompt, cleared with "More info" then "Run anyway".
Paid signing was evaluated and rejected on cost (OV certificates $200 to $400 a
year plus a hardware token, EV $400 to $700 a year, and Microsoft's $9.99 a month
Azure Artifact Signing requires an account we could not create).

Because of this, per-platform `SHA256SUMS-<platform>.txt` files are attached to
every release. They are the supported way to verify a download. The README has
the commands.

## Update signing

Update signing is separate from installer signing, and it is real.

Tauri's updater verifies a minisign signature on every update before applying it,
against a public key compiled into the app. An update artifact that is not signed
by the release key is rejected, so the update channel is cryptographically
protected even though the installer is not signed.

The signing keys (the ed25519 integrity key and the updater key) live only in
GitHub Actions secrets. They are not in this repository, and they are not in any
released artifact.

## Scope

This policy covers the desktop client in this repository. Issues in the
swatted.wtf web service or API should go to `support@swattedw.tf` by the same
private-first rule.
