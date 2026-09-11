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

from mirage.shell.parse.heredoc.body import (heredoc_bodies, next_line,
                                             terminator_line)
from mirage.shell.parse.heredoc.delimiter import clean_delimiter
from mirage.shell.parse.heredoc.line import operator_line_end, quote_end
from mirage.shell.parse.heredoc.prefix import body_prefix
from mirage.shell.parse.heredoc.shield import (first_content_line,
                                               heredoc_operators,
                                               protected_source, same_shape)
from mirage.shell.parse.heredoc.types import HeredocOperator

__all__ = [
    "HeredocOperator",
    "body_prefix",
    "clean_delimiter",
    "first_content_line",
    "heredoc_bodies",
    "heredoc_operators",
    "next_line",
    "operator_line_end",
    "protected_source",
    "quote_end",
    "same_shape",
    "terminator_line",
]
