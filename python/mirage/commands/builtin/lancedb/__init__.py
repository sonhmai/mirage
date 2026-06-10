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

from mirage.commands.builtin.lancedb.cat import cat
from mirage.commands.builtin.lancedb.find import find
from mirage.commands.builtin.lancedb.grep import grep
from mirage.commands.builtin.lancedb.head import head
from mirage.commands.builtin.lancedb.ls import ls
from mirage.commands.builtin.lancedb.rg import rg
from mirage.commands.builtin.lancedb.search import search
from mirage.commands.builtin.lancedb.stat import stat
from mirage.commands.builtin.lancedb.tail import tail
from mirage.commands.builtin.lancedb.tree import tree
from mirage.commands.builtin.lancedb.wc import wc

COMMANDS = [
    cat,
    find,
    grep,
    head,
    ls,
    rg,
    search,
    stat,
    tail,
    tree,
    wc,
]
