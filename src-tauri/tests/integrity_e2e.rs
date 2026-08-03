//! End-to-end proof that scripts/gen-integrity.mjs and the Rust verifier agree
//! on the canonical signed bytes.
//!
//! The two sign the same payload in different languages, so a mismatch in key
//! order or serialisation would only ever surface at runtime as a spurious
//! "this copy has been modified" screen. This catches it in CI instead.
//!
//! Skips when the manifest has not been generated (the unit tests in
//! src/integrity.rs cover the logic itself with synthetic fixtures).

use std::path::Path;

#[test]
fn the_generated_manifest_verifies_against_the_generated_key() {
    let manifest_path = Path::new("resources/integrity.json");
    let Ok(manifest) = std::fs::read_to_string(manifest_path) else {
        eprintln!("skipping: run scripts/gen-integrity.mjs first");
        return;
    };
    let Ok(pubkey_hex) = std::env::var("INTEGRITY_PUBKEY") else {
        eprintln!("skipping: INTEGRITY_PUBKEY not set");
        return;
    };
    let dist = Path::new("../dist");
    if !dist.exists() {
        eprintln!("skipping: no dist/ build to hash");
        return;
    }

    let pubkey = hex::decode(pubkey_hex.trim()).expect("INTEGRITY_PUBKEY must be hex");
    let report = swattedwtf_app_lib::integrity::verify_integrity(dist, &manifest, &pubkey);

    assert!(report.ok, "generated manifest must verify: {:?}", report.changed);

    // The workflow builds the manifest version from the git tag, so this also
    // catches a tag pushed without bumping Cargo.toml, which would ship a
    // binary whose reported version disagrees with the release it came from.
    assert_eq!(
        report.manifest_version,
        env!("CARGO_PKG_VERSION"),
        "manifest version (from the git tag) must match the crate version",
    );
}
