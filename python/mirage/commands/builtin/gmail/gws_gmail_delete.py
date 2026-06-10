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

from mirage.accessor.gmail import GmailAccessor
from mirage.commands.registry import command
from mirage.commands.spec.types import CommandSpec, OperandKind, Option
from mirage.core.gmail.messages import trash_message
from mirage.io.types import ByteSource, IOResult
from mirage.types import PathSpec

SPEC = CommandSpec(
    description="Move one Gmail message to Trash (reversible).",
    options=(Option(long="--id",
                    value_kind=OperandKind.TEXT,
                    description="Gmail message ID (required)"), ),
)


@command("gws-gmail-delete", resource="gmail", spec=SPEC, write=True)
async def gws_gmail_delete(
    accessor: GmailAccessor,
    paths: list[PathSpec],
    *texts: str,
    **_extra: object,
) -> tuple[ByteSource | None, IOResult]:
    message_id = _extra.get("id", "")
    if not message_id or not isinstance(message_id, str):
        raise ValueError("--id is required")
    await trash_message(accessor.token_manager, message_id)
    return None, IOResult()
