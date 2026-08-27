use mirage_pointer_codec::{
    FilePointer, PointerError, canonicalize_pointer as canonicalize, encode_pointer,
    hash_pointer as hash,
};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyBytes;

fn py_error(error: PointerError) -> PyErr {
    PyValueError::new_err(error.to_string())
}

fn encoded<'py>(py: Python<'py>, pointer: FilePointer) -> PyResult<Bound<'py, PyBytes>> {
    let bytes = encode_pointer(&pointer).map_err(py_error)?;
    Ok(PyBytes::new(py, &bytes))
}

#[pyfunction]
fn encode_lfs_pointer<'py>(
    py: Python<'py>,
    oid: String,
    size: u64,
) -> PyResult<Bound<'py, PyBytes>> {
    encoded(py, FilePointer::Lfs { oid, size })
}

#[pyfunction]
fn encode_remote_pointer<'py>(
    py: Python<'py>,
    path: String,
    etag: Option<String>,
    version_id: Option<String>,
    size: u64,
) -> PyResult<Bound<'py, PyBytes>> {
    encoded(
        py,
        FilePointer::Remote {
            etag,
            path,
            size,
            version_id,
        },
    )
}

#[pyfunction]
fn canonicalize_pointer<'py>(py: Python<'py>, data: &[u8]) -> PyResult<Bound<'py, PyBytes>> {
    let bytes = canonicalize(data).map_err(py_error)?;
    Ok(PyBytes::new(py, &bytes))
}

#[pyfunction]
fn hash_pointer(data: &[u8]) -> PyResult<String> {
    hash(data).map_err(py_error)
}

#[pymodule]
fn mirage_pointer_codec_py(module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(encode_lfs_pointer, module)?)?;
    module.add_function(wrap_pyfunction!(encode_remote_pointer, module)?)?;
    module.add_function(wrap_pyfunction!(canonicalize_pointer, module)?)?;
    module.add_function(wrap_pyfunction!(hash_pointer, module)?)?;
    Ok(())
}
