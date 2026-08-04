//! Bundled-resource integrity check.
//!
//! Hashes every file named in a signed manifest and reports mismatches. The
//! manifest is signed with an ed25519 key whose public half is compiled into
//! the binary, so a redistributor who edits the app without the private key
//! cannot produce a manifest that validates.
//!
//! This detects corrupted installs and casually trojanized copies. It is NOT a
//! security control: the app is open source, so anyone can remove the check.
//! Say so in the UI and the README; never present it as protection.

use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Debug, Serialize, Clone)]
pub struct IntegrityReport {
    pub ok: bool,
    pub changed: Vec<String>,
    pub manifest_version: String,
}

/// Canonical form, and the only thing the signature ever covers.
///
/// Field declaration order IS the canonical byte order, because a derived
/// `Serialize` emits fields in declaration order. Keys are alphabetical
/// (`files` before `version`, `path` before `sha256`) so the canonical bytes
/// also equal what `serde_json` produces from an untyped `Value`, but nothing
/// here depends on that: turning on serde_json's `preserve_order` feature must
/// not change a single byte. The generator in `scripts/gen-integrity.mjs`
/// builds its object literal in exactly this order.
///
/// Do not reorder, rename or add fields without regenerating every manifest.
#[derive(Deserialize, Serialize)]
struct ManifestEntry {
    path: String,
    sha256: String,
}

#[derive(Deserialize, Serialize)]
struct ManifestPayload {
    files: Vec<ManifestEntry>,
    version: String,
}

#[derive(Deserialize)]
struct SignedManifest {
    payload: ManifestPayload,
    signature: String,
}

fn failed(reason: &str) -> IntegrityReport {
    IntegrityReport {
        ok: false,
        changed: vec![reason.to_string()],
        manifest_version: String::new(),
    }
}

/// True for a plain relative path that stays inside the bundle. Rejects `..`
/// segments, absolute paths, and Windows drive or UNC prefixes.
fn is_safe_relative_path(path: &str) -> bool {
    use std::path::{Component, Path};

    if path.is_empty() {
        return false;
    }
    // Windows accepts both separators, so normalise before inspecting.
    let normalised = path.replace('\\', "/");
    if normalised.starts_with('/') || normalised.contains(':') {
        return false;
    }
    Path::new(&normalised)
        .components()
        .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}

pub fn verify_integrity(resource_dir: &Path, manifest_json: &str, pubkey: &[u8]) -> IntegrityReport {
    let signed: SignedManifest = match serde_json::from_str(manifest_json) {
        Ok(v) => v,
        Err(_) => return failed("<malformed manifest>"),
    };

    // Re-serialise the payload into the canonical form so the signed bytes match
    // the generator's byte for byte. This deliberately ignores the key order of
    // the manifest as it was received: only ManifestPayload's declaration order
    // defines what was signed.
    let canon = match serde_json::to_string(&signed.payload) {
        Ok(s) => s,
        Err(_) => return failed("<malformed manifest>"),
    };

    let key_bytes: [u8; 32] = match pubkey.try_into() {
        Ok(k) => k,
        Err(_) => return failed("<bad public key>"),
    };

    // The all-zero key is the "not configured" sentinel, and it must be rejected
    // explicitly rather than relied on to fail verification. It is a valid curve
    // point of ORDER 4, so [k]A is the identity whenever k is a multiple of 4,
    // and an attacker can retry until that holds to forge a signature over any
    // message. Trusting it to fail was the exact opposite of what it does.
    if key_bytes == [0u8; 32] {
        return failed("<no integrity key configured>");
    }

    let key = match VerifyingKey::from_bytes(&key_bytes) {
        Ok(k) => k,
        Err(_) => return failed("<bad public key>"),
    };
    let sig_bytes = match hex::decode(&signed.signature) {
        Ok(b) => b,
        Err(_) => return failed("<manifest signature>"),
    };
    let sig = match Signature::from_slice(&sig_bytes) {
        Ok(s) => s,
        Err(_) => return failed("<manifest signature>"),
    };
    // verify_strict, not verify: it rejects small-order and non-canonical public
    // keys, closing the same class of forgery the sentinel check above covers.
    if key.verify_strict(canon.as_bytes(), &sig).is_err() {
        return failed("<manifest signature>");
    }

    let mut changed = Vec::new();
    for entry in &signed.payload.files {
        // A manifest path is a relative path INSIDE the bundle. Rejecting
        // traversal and absolute paths keeps a manifest from turning the check
        // into a file-existence oracle for arbitrary paths on the host. This is
        // defence in depth: reaching here already requires the release key.
        if !is_safe_relative_path(&entry.path) {
            changed.push(entry.path.clone());
            continue;
        }
        let full = resource_dir.join(&entry.path);
        match std::fs::read(&full) {
            Ok(bytes) => {
                if hex::encode(Sha256::digest(&bytes)) != entry.sha256 {
                    changed.push(entry.path.clone());
                }
            }
            Err(_) => changed.push(entry.path.clone()),
        }
    }

    IntegrityReport {
        ok: changed.is_empty(),
        changed,
        manifest_version: signed.payload.version,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::fs;

    fn signed_manifest(entries: &[(&str, &str)], key: &SigningKey) -> String {
        let files: Vec<_> = entries
            .iter()
            .map(|(p, h)| serde_json::json!({ "path": p, "sha256": h }))
            .collect();
        let payload = serde_json::json!({ "version": "0.1.0", "files": files });
        let canon = serde_json::to_string(&payload).unwrap();
        let sig = key.sign(canon.as_bytes());
        serde_json::json!({
            "payload": payload,
            "signature": hex::encode(sig.to_bytes()),
        })
        .to_string()
    }

    fn sha256_of(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(bytes))
    }

    #[test]
    fn accepts_an_unmodified_tree() {
        let dir = tempdir();
        fs::write(dir.join("a.js"), b"hello").unwrap();
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let m = signed_manifest(&[("a.js", &sha256_of(b"hello"))], &key);

        let report = verify_integrity(&dir, &m, key.verifying_key().as_bytes());
        assert!(report.ok);
        assert!(report.changed.is_empty());
        assert_eq!(report.manifest_version, "0.1.0");
    }

    #[test]
    fn flags_a_modified_file() {
        let dir = tempdir();
        fs::write(dir.join("a.js"), b"tampered").unwrap();
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let m = signed_manifest(&[("a.js", &sha256_of(b"hello"))], &key);

        let report = verify_integrity(&dir, &m, key.verifying_key().as_bytes());
        assert!(!report.ok);
        assert_eq!(report.changed, vec!["a.js".to_string()]);
    }

    #[test]
    fn flags_a_missing_file() {
        let dir = tempdir();
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let m = signed_manifest(&[("gone.js", &sha256_of(b"hello"))], &key);

        let report = verify_integrity(&dir, &m, key.verifying_key().as_bytes());
        assert!(!report.ok);
        assert_eq!(report.changed, vec!["gone.js".to_string()]);
    }

    #[test]
    fn rejects_a_manifest_signed_by_the_wrong_key() {
        let dir = tempdir();
        fs::write(dir.join("a.js"), b"hello").unwrap();
        let attacker = SigningKey::from_bytes(&[9u8; 32]);
        let ours = SigningKey::from_bytes(&[7u8; 32]);
        let m = signed_manifest(&[("a.js", &sha256_of(b"hello"))], &attacker);

        let report = verify_integrity(&dir, &m, ours.verifying_key().as_bytes());
        assert!(!report.ok);
        assert_eq!(report.changed, vec!["<manifest signature>".to_string()]);
    }

    #[test]
    fn rejects_a_malformed_manifest() {
        let dir = tempdir();
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let report = verify_integrity(&dir, "{ not json", key.verifying_key().as_bytes());
        assert!(!report.ok);
    }

    /// Locks the canonical bytes the signature covers, so a future refactor
    /// cannot silently desync the Rust verifier from scripts/gen-integrity.mjs.
    /// The expected string is literally what
    /// `JSON.stringify({ files, version })` prints in Node.
    #[test]
    fn canonical_payload_bytes_match_the_js_generator() {
        let payload = ManifestPayload {
            files: vec![
                ManifestEntry { path: "a.js".into(), sha256: "deadbeef".into() },
                ManifestEntry { path: "assets/b.css".into(), sha256: "cafe".into() },
            ],
            version: "0.1.0".into(),
        };
        assert_eq!(
            serde_json::to_string(&payload).unwrap(),
            r#"{"files":[{"path":"a.js","sha256":"deadbeef"},{"path":"assets/b.css","sha256":"cafe"}],"version":"0.1.0"}"#
        );
    }

    /// The manifest as received may carry any key order; only the canonical
    /// re-serialisation is signed, so a reordered but otherwise identical
    /// manifest must still verify.
    #[test]
    fn ignores_key_order_in_the_received_manifest() {
        let dir = tempdir();
        fs::write(dir.join("a.js"), b"hello").unwrap();
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let canon = format!(
            r#"{{"files":[{{"path":"a.js","sha256":"{}"}}],"version":"0.1.0"}}"#,
            sha256_of(b"hello")
        );
        let sig = hex::encode(key.sign(canon.as_bytes()).to_bytes());
        // version first, sha256 first: neither matches the canonical order.
        let m = format!(
            r#"{{"signature":"{}","payload":{{"version":"0.1.0","files":[{{"sha256":"{}","path":"a.js"}}]}}}}"#,
            sig,
            sha256_of(b"hello")
        );

        let report = verify_integrity(&dir, &m, key.verifying_key().as_bytes());
        assert!(report.ok, "{:?}", report.changed);
    }


    /// The all-zero key is a valid order-4 curve point, so signatures over
    /// arbitrary messages can be forged against it. It must be rejected as a
    /// sentinel rather than trusted to fail verification on its own.
    #[test]
    fn rejects_the_unconfigured_all_zero_key_outright() {
        let dir = tempdir();
        fs::write(dir.join("a.js"), b"hello").unwrap();
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let m = signed_manifest(&[("a.js", &sha256_of(b"hello"))], &key);

        let report = verify_integrity(&dir, &m, &[0u8; 32]);
        assert!(!report.ok);
        assert_eq!(report.changed, vec!["<no integrity key configured>".to_string()]);
    }

    #[test]
    fn rejects_a_manifest_path_that_escapes_the_resource_dir() {
        let dir = tempdir();
        let key = SigningKey::from_bytes(&[7u8; 32]);
        for bad in ["../outside.txt", "/etc/passwd", "a/../../b", "C:/windows/x", "..\\win.txt"] {
            let m = signed_manifest(&[(bad, &sha256_of(b"whatever"))], &key);
            let report = verify_integrity(&dir, &m, key.verifying_key().as_bytes());
            assert!(!report.ok, "{bad} should be rejected");
            assert_eq!(report.changed, vec![bad.to_string()]);
        }
    }

    #[test]
    fn still_accepts_ordinary_nested_paths() {
        let dir = tempdir();
        fs::create_dir_all(dir.join("assets")).unwrap();
        fs::write(dir.join("assets/index.js"), b"hello").unwrap();
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let m = signed_manifest(&[("assets/index.js", &sha256_of(b"hello"))], &key);

        let report = verify_integrity(&dir, &m, key.verifying_key().as_bytes());
        assert!(report.ok, "changed: {:?}", report.changed);
    }

    fn tempdir() -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!("integ-{}", std::process::id()));
        let d = base.join(format!("{:?}", std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
}
