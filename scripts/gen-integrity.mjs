#!/usr/bin/env node
// Generates and signs integrity.json over the built frontend bundle.
//
// Usage: node scripts/gen-integrity.mjs <distDir> <outFile> <version>
// The signing key comes from INTEGRITY_SIGNING_KEY (hex-encoded 32-byte ed25519
// seed). In CI that is a repository secret; locally, generate a throwaway one.

import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import nacl from "tweetnacl"

const [distDir, outFile, version] = process.argv.slice(2)
if (!distDir || !outFile || !version) {
  console.error("usage: gen-integrity.mjs <distDir> <outFile> <version>")
  process.exit(1)
}

const seedHex = process.env.INTEGRITY_SIGNING_KEY
if (!seedHex || seedHex.length !== 64) {
  console.error("INTEGRITY_SIGNING_KEY must be a 64-char hex seed")
  process.exit(1)
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

// Sorted for determinism, POSIX separators so Windows and Linux manifests match.
const files = walk(distDir)
  .map((full) => ({
    path: relative(distDir, full).split(sep).join("/"),
    sha256: createHash("sha256").update(readFileSync(full)).digest("hex"),
  }))
  .sort((a, b) => a.path.localeCompare(b.path))

// Key order is load-bearing: the signature covers these exact bytes, and the
// Rust verifier rebuilds them from ManifestPayload's field declaration order
// (files, then version; path, then sha256). Reordering anything here, or in
// src-tauri/src/integrity.rs, invalidates every manifest.
const payload = { files, version }
const canon = JSON.stringify(payload)
const key = nacl.sign.keyPair.fromSeed(Buffer.from(seedHex, "hex"))
const signature = Buffer.from(nacl.sign.detached(Buffer.from(canon, "utf8"), key.secretKey)).toString("hex")

writeFileSync(outFile, JSON.stringify({ payload, signature }))
console.log(`integrity: ${files.length} files, pubkey ${Buffer.from(key.publicKey).toString("hex")}`)
