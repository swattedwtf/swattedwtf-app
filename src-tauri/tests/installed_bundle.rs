//! Verifies a REAL installed bundle, not a synthetic fixture.
//!
//! The integrity check shipped broken twice: once because the manifest landed
//! at a different path than the code read, and once because the files it names
//! are embedded in the binary rather than present on disk. Both only show up
//! against an actual bundle layout, which is what this reads.
//!
//! Skips unless INSTALLED_ROOT points at an extracted bundle.

use std::path::PathBuf;

#[test]
fn the_installed_layout_verifies() {
    let Ok(root) = std::env::var("INSTALLED_ROOT") else {
        eprintln!("skipping: INSTALLED_ROOT not set");
        return;
    };
    let Ok(pubkey_hex) = std::env::var("INTEGRITY_PUBKEY") else {
        eprintln!("skipping: INTEGRITY_PUBKEY not set");
        return;
    };

    let root = PathBuf::from(root);
    let manifest = std::fs::read_to_string(root.join("integrity.json"))
        .expect("integrity.json must sit at the resource root");
    let pubkey = hex::decode(pubkey_hex.trim()).expect("hex pubkey");

    let report = swattedwtf_app_lib::integrity::verify_integrity(&root.join("app"), &manifest, &pubkey);

    assert!(report.ok, "installed bundle must verify, changed: {:?}", report.changed);
    assert!(!report.manifest_version.is_empty());
    println!("installed bundle verified, version {}", report.manifest_version);
}
