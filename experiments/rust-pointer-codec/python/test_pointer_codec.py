import unittest

import mirage_pointer_codec_py as codec

ZERO_OID = "sha256:" + "0" * 64


class PointerCodecTest(unittest.TestCase):

    def test_lfs_pointer_bytes_and_hash_match_core_vector(self) -> None:
        encoded = codec.encode_lfs_pointer(ZERO_OID, 1_048_576)

        self.assertEqual(
            encoded,
            ('{"kind":"lfs","oid":"sha256:' + "0" * 64 +
             '","size":1048576}').encode(),
        )
        self.assertEqual(
            codec.hash_pointer(encoded),
            ("sha256:87111343709faa1eaeea2458e4724e9c88"
             "f6d33076640795954063efddd8cfda"),
        )
        self.assertEqual(codec.canonicalize_pointer(encoded), encoded)

    def test_remote_pointer_uses_utf8_and_stable_null_fields(self) -> None:
        encoded = codec.encode_remote_pointer("/data/café.json", None, "v17",
                                              42)

        self.assertEqual(
            encoded,
            ('{"etag":null,"kind":"remote","path":"/data/café.json",'
             '"size":42,"version_id":"v17"}').encode(),
        )
        self.assertEqual(
            codec.hash_pointer(encoded),
            ("sha256:3dedd256a35c0953506be9f8e6d73744d"
             "11d88d616f7790d255b5003817f333e"),
        )

    def test_invalid_oid_is_a_value_error(self) -> None:
        with self.assertRaisesRegex(ValueError, "64 lowercase hex digits"):
            codec.encode_lfs_pointer("sha256:ABC", 1)

    def test_strict_decode_error_crosses_python_boundary(self) -> None:
        unknown_field = ('{"future":true,"kind":"lfs","oid":"' + ZERO_OID +
                         '","size":1}').encode()

        with self.assertRaisesRegex(ValueError, "unknown field"):
            codec.canonicalize_pointer(unknown_field)


if __name__ == "__main__":
    unittest.main()
