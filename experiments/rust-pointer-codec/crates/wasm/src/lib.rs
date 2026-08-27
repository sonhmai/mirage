use mirage_pointer_codec::{
    FilePointer, PointerError, canonicalize_pointer as canonicalize, encode_pointer,
    hash_pointer as hash,
};
use wasm_bindgen::prelude::*;

fn js_error(error: PointerError) -> JsError {
    JsError::new(&error.to_string())
}

#[wasm_bindgen]
pub fn encode_lfs_pointer(oid: String, size: u64) -> Result<Vec<u8>, JsError> {
    encode_pointer(&FilePointer::Lfs { oid, size }).map_err(js_error)
}

#[wasm_bindgen]
pub fn encode_remote_pointer(
    path: String,
    etag: Option<String>,
    version_id: Option<String>,
    size: u64,
) -> Result<Vec<u8>, JsError> {
    encode_pointer(&FilePointer::Remote {
        etag,
        path,
        size,
        version_id,
    })
    .map_err(js_error)
}

#[wasm_bindgen]
pub fn canonicalize_pointer(data: &[u8]) -> Result<Vec<u8>, JsError> {
    canonicalize(data).map_err(js_error)
}

#[wasm_bindgen]
pub fn hash_pointer(data: &[u8]) -> Result<String, JsError> {
    hash(data).map_err(js_error)
}
