# ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2026 @ Strukto.AI All Rights Reserved. =========

from mirage.core.qdrant.payload import field_value, without_field


def test_field_value_reads_a_dotted_payload_path():
    row = {"metadata": {"source": "report.pdf", "page": 4}}
    assert field_value(row, "metadata.source") == "report.pdf"
    assert field_value(row, "metadata.missing") is None


def test_a_dotted_key_uses_qdrants_nested_field_semantics():
    row = {"metadata.source": "literal", "metadata": {"source": "nested"}}
    assert field_value(row, "metadata.source") == "nested"


def test_without_field_removes_a_nested_value_without_mutating_the_row():
    row = {"metadata": {"source": "report.pdf", "blob": "bytes"}}
    copied = without_field(row, "metadata.blob")
    assert copied == {"metadata": {"source": "report.pdf"}}
    assert row["metadata"]["blob"] == "bytes"
