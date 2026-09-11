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

import os
import sys
import sysconfig

from mirage.runtime.sandbox.sandlock.runtime import SandlockRuntime

__all__ = ["SandlockRuntime", "interpreter_readable"]


def interpreter_readable(python: str) -> tuple[str, ...]:
    """Preserve the interpreter read grants exposed at the former import path.

    Host library paths apply only to the interpreter running Mirage.

    Args:
        python (str): The resolved interpreter path.
    """
    paths = {os.path.dirname(os.path.dirname(python))}
    if python == sys.executable:
        paths |= {
            sys.prefix,
            sys.base_prefix,
            sysconfig.get_path("stdlib"),
            sysconfig.get_path("purelib"),
        }
    return tuple(sorted(path for path in paths if path))
