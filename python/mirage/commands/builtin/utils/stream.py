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

import inspect
from collections.abc import AsyncIterator, Callable

from mirage.types import PathSpec


async def _read_stdin_async(
        stdin: AsyncIterator[bytes] | bytes | None) -> bytes | None:
    if stdin is None:
        return None
    if isinstance(stdin, bytes):
        return stdin
    chunks: list[bytes] = []
    async for chunk in stdin:
        chunks.append(chunk)
    return b"".join(chunks)


async def _wrap_bytes(data: bytes) -> AsyncIterator[bytes]:
    yield data


def _resolve_source(
    stdin: AsyncIterator[bytes] | bytes | None,
    error_msg: str,
) -> AsyncIterator[bytes]:
    if stdin is not None:
        if isinstance(stdin, bytes):
            return _wrap_bytes(stdin)
        return stdin
    raise ValueError(error_msg)


async def _open_read_stream(
    read_stream: Callable[..., object],
    accessor: object,
    path: PathSpec,
) -> AsyncIterator[bytes]:
    # Accept both async-generator readers and plain async readers that
    # resolve to bytes or an AsyncIterator (e.g. gdrive, github).
    source = read_stream(accessor, path)
    if inspect.isawaitable(source):
        source = await source
    if isinstance(source, bytes):
        return _wrap_bytes(source)
    return source
