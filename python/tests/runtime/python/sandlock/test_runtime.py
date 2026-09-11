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

import sys
import sysconfig

from mirage.runtime.python.sandlock import (SandlockConfig, SandlockRuntime,
                                            interpreter_readable)
from mirage.runtime.python.sandlock.config import \
    SandlockConfig as ConfigImport
from mirage.runtime.python.sandlock.runtime import \
    SandlockRuntime as RuntimeImport
from mirage.runtime.python.sandlock.runtime import \
    interpreter_readable as helper_import
from mirage.runtime.sandbox.sandlock import SandlockConfig as SandboxConfig
from mirage.runtime.sandbox.sandlock import SandlockRuntime as SandboxRuntime


def test_former_package_and_submodule_imports_share_the_sandbox_adapter():
    assert SandlockConfig is ConfigImport is SandboxConfig
    assert SandlockRuntime is RuntimeImport is SandboxRuntime
    assert interpreter_readable is helper_import
    config = SandlockConfig(fs_readable=("/work", ), max_memory="512M")
    runtime = SandlockRuntime(config=config)
    assert runtime.config is config
    assert runtime.capabilities.process


def test_interpreter_readable_preserves_host_interpreter_grants():
    paths = interpreter_readable(sys.executable)
    assert sys.prefix in paths
    assert sys.base_prefix in paths
    assert sysconfig.get_path("stdlib") in paths
    assert sysconfig.get_path("purelib") in paths
    assert paths == tuple(sorted(set(paths)))


def test_interpreter_readable_does_not_grant_host_paths_to_another_interpreter(
):
    assert interpreter_readable("/opt/other/bin/python3") == ("/opt/other", )
