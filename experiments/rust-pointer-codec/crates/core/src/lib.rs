use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

/// The two pointer forms scheduled by `strukto-ai/mirage#721`.
///
/// Field order is deliberately not the wire-order authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum FilePointer {
    Lfs {
        oid: String,
        size: u64,
    },
    Remote {
        etag: Option<String>,
        path: String,
        size: u64,
        version_id: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PointerError {
    #[error("LFS oid must be 'sha256:' followed by 64 lowercase hex digits")]
    InvalidLfsOid,
    #[error("remote pointer requires an etag or version_id")]
    MissingRemoteIdentity,
    #[error("invalid pointer JSON: {0}")]
    InvalidJson(String),
}

impl FilePointer {
    fn validate(&self) -> Result<(), PointerError> {
        if let Self::Lfs { oid, .. } = self {
            let Some(digest) = oid.strip_prefix("sha256:") else {
                return Err(PointerError::InvalidLfsOid);
            };
            if digest.len() != 64
                || !digest
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err(PointerError::InvalidLfsOid);
            }
        }
        if let Self::Remote {
            etag: None,
            version_id: None,
            ..
        } = self
        {
            return Err(PointerError::MissingRemoteIdentity);
        }
        Ok(())
    }
}

/// Encode one pointer as compact UTF-8 JSON with object keys sorted.
pub fn encode_pointer(pointer: &FilePointer) -> Result<Vec<u8>, PointerError> {
    pointer.validate()?;
    let mut fields = BTreeMap::new();
    match pointer {
        FilePointer::Lfs { oid, size } => {
            fields.insert("kind", Value::String("lfs".to_owned()));
            fields.insert("oid", Value::String(oid.clone()));
            fields.insert("size", Value::Number((*size).into()));
        }
        FilePointer::Remote {
            etag,
            path,
            size,
            version_id,
        } => {
            fields.insert(
                "etag",
                etag.as_ref()
                    .map_or(Value::Null, |value| Value::String(value.clone())),
            );
            fields.insert("kind", Value::String("remote".to_owned()));
            fields.insert("path", Value::String(path.clone()));
            fields.insert("size", Value::Number((*size).into()));
            fields.insert(
                "version_id",
                version_id
                    .as_ref()
                    .map_or(Value::Null, |value| Value::String(value.clone())),
            );
        }
    }
    serde_json::to_vec(&fields).map_err(|error| PointerError::InvalidJson(error.to_string()))
}

/// Decode and validate a pointer. Re-encoding returns the canonical bytes.
pub fn decode_pointer(data: &[u8]) -> Result<FilePointer, PointerError> {
    let pointer: FilePointer = serde_json::from_slice(data)
        .map_err(|error| PointerError::InvalidJson(error.to_string()))?;
    pointer.validate()?;
    Ok(pointer)
}

/// Strictly decode pointer JSON and return its canonical wire bytes.
pub fn canonicalize_pointer(data: &[u8]) -> Result<Vec<u8>, PointerError> {
    encode_pointer(&decode_pointer(data)?)
}

/// SHA-256 identity of the pointer's canonical bytes.
pub fn canonical_hash(pointer: &FilePointer) -> Result<String, PointerError> {
    let digest = Sha256::digest(encode_pointer(pointer)?);
    let mut hex = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut hex, "{byte:02x}").expect("writing to a String cannot fail");
    }
    Ok(format!("sha256:{hex}"))
}

/// Strictly decode pointer JSON and hash its canonical wire bytes.
pub fn hash_pointer(data: &[u8]) -> Result<String, PointerError> {
    canonical_hash(&decode_pointer(data)?)
}

#[cfg(test)]
mod tests {
    use super::{FilePointer, PointerError, canonical_hash, decode_pointer, encode_pointer};

    const ZERO_OID: &str =
        "sha256:0000000000000000000000000000000000000000000000000000000000000000";

    #[test]
    fn encodes_lfs_pointer_as_sorted_compact_json() {
        let pointer = FilePointer::Lfs {
            oid: ZERO_OID.to_owned(),
            size: 1_048_576,
        };

        let encoded = encode_pointer(&pointer).unwrap();

        assert_eq!(
            encoded,
            concat!(
                r#"{"kind":"lfs","oid":"sha256:"#,
                "0000000000000000000000000000000000000000000000000000000000000000",
                r#"","size":1048576}"#,
            )
            .as_bytes()
        );
    }

    #[test]
    fn encodes_remote_pointer_with_utf8_and_stable_null_fields() {
        let pointer = FilePointer::Remote {
            etag: None,
            path: "/data/café.json".to_owned(),
            size: 42,
            version_id: Some("v17".to_owned()),
        };

        let encoded = encode_pointer(&pointer).unwrap();

        assert_eq!(
            encoded,
            r#"{"etag":null,"kind":"remote","path":"/data/café.json","size":42,"version_id":"v17"}"#
                .as_bytes()
        );
    }

    #[test]
    fn round_trips_both_pointer_variants() {
        let pointers = [
            FilePointer::Lfs {
                oid: ZERO_OID.to_owned(),
                size: 7,
            },
            FilePointer::Remote {
                etag: Some("etag-17".to_owned()),
                path: "/data/a.csv".to_owned(),
                size: 42,
                version_id: Some("v17".to_owned()),
            },
        ];

        for pointer in pointers {
            assert_eq!(
                decode_pointer(&encode_pointer(&pointer).unwrap()).unwrap(),
                pointer
            );
        }
    }

    #[test]
    fn rejects_noncanonical_lfs_oid() {
        let error = encode_pointer(&FilePointer::Lfs {
            oid: "sha256:ABC".to_owned(),
            size: 1,
        })
        .unwrap_err();

        assert_eq!(error, PointerError::InvalidLfsOid);
    }

    #[test]
    fn rejects_unknown_wire_fields() {
        let error = decode_pointer(
            br#"{"kind":"lfs","oid":"sha256:0000000000000000000000000000000000000000000000000000000000000000","size":1,"future":true}"#,
        )
        .unwrap_err();

        assert!(matches!(error, PointerError::InvalidJson(_)));
    }

    #[test]
    fn rejects_remote_pointer_without_backend_identity() {
        let error = encode_pointer(&FilePointer::Remote {
            etag: None,
            path: "/data/a.csv".to_owned(),
            size: 42,
            version_id: None,
        })
        .unwrap_err();

        assert_eq!(error, PointerError::MissingRemoteIdentity);
    }

    #[test]
    fn hashes_the_canonical_bytes_not_host_serialization() {
        let pointer = FilePointer::Lfs {
            oid: ZERO_OID.to_owned(),
            size: 1_048_576,
        };

        assert_eq!(
            canonical_hash(&pointer).unwrap(),
            "sha256:87111343709faa1eaeea2458e4724e9c88f6d33076640795954063efddd8cfda"
        );
    }
}
