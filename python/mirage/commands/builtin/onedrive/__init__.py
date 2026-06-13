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

from mirage.commands.builtin.filetype_factory import make_filetype_commands
from mirage.commands.builtin.onedrive._provision import \
    file_read_provision as _ft_provision
from mirage.commands.builtin.onedrive.awk import awk
from mirage.commands.builtin.onedrive.base64_cmd import base64_cmd
from mirage.commands.builtin.onedrive.basename import basename
from mirage.commands.builtin.onedrive.cat import cat
from mirage.commands.builtin.onedrive.cmp import cmp_cmd
from mirage.commands.builtin.onedrive.column import column
from mirage.commands.builtin.onedrive.comm import comm
from mirage.commands.builtin.onedrive.cp import cp
from mirage.commands.builtin.onedrive.csplit import csplit
from mirage.commands.builtin.onedrive.cut import cut
from mirage.commands.builtin.onedrive.diff import diff
from mirage.commands.builtin.onedrive.dirname import dirname
from mirage.commands.builtin.onedrive.du import du
from mirage.commands.builtin.onedrive.expand import expand
from mirage.commands.builtin.onedrive.file import file
from mirage.commands.builtin.onedrive.find import find
from mirage.commands.builtin.onedrive.fmt import fmt
from mirage.commands.builtin.onedrive.fold import fold
from mirage.commands.builtin.onedrive.grep import grep
from mirage.commands.builtin.onedrive.gunzip import gunzip
from mirage.commands.builtin.onedrive.gzip import gzip
from mirage.commands.builtin.onedrive.head import head
from mirage.commands.builtin.onedrive.iconv import iconv
from mirage.commands.builtin.onedrive.join import join
from mirage.commands.builtin.onedrive.jq import jq
from mirage.commands.builtin.onedrive.ln import ln
from mirage.commands.builtin.onedrive.look import look
from mirage.commands.builtin.onedrive.ls import ls
from mirage.commands.builtin.onedrive.md5 import md5
from mirage.commands.builtin.onedrive.mkdir import mkdir
from mirage.commands.builtin.onedrive.mktemp import mktemp
from mirage.commands.builtin.onedrive.mv import mv
from mirage.commands.builtin.onedrive.nl import nl
from mirage.commands.builtin.onedrive.paste import paste
from mirage.commands.builtin.onedrive.patch import patch
from mirage.commands.builtin.onedrive.readlink import readlink
from mirage.commands.builtin.onedrive.realpath import realpath
from mirage.commands.builtin.onedrive.rev import rev
from mirage.commands.builtin.onedrive.rg import rg
from mirage.commands.builtin.onedrive.rm import rm
from mirage.commands.builtin.onedrive.sed import sed
from mirage.commands.builtin.onedrive.sha256sum import sha256sum
from mirage.commands.builtin.onedrive.shuf import shuf
from mirage.commands.builtin.onedrive.sort import sort
from mirage.commands.builtin.onedrive.split import split
from mirage.commands.builtin.onedrive.stat import stat
from mirage.commands.builtin.onedrive.strings import strings
from mirage.commands.builtin.onedrive.tac import tac
from mirage.commands.builtin.onedrive.tail import tail
from mirage.commands.builtin.onedrive.tar import tar
from mirage.commands.builtin.onedrive.tee import tee
from mirage.commands.builtin.onedrive.touch import touch
from mirage.commands.builtin.onedrive.tr import tr
from mirage.commands.builtin.onedrive.tree import tree
from mirage.commands.builtin.onedrive.tsort import tsort
from mirage.commands.builtin.onedrive.unexpand import unexpand
from mirage.commands.builtin.onedrive.uniq import uniq
from mirage.commands.builtin.onedrive.unzip import unzip as unzip_cmd
from mirage.commands.builtin.onedrive.wc import wc
from mirage.commands.builtin.onedrive.xxd import xxd
from mirage.commands.builtin.onedrive.zcat import zcat
from mirage.commands.builtin.onedrive.zgrep import zgrep
from mirage.commands.builtin.onedrive.zip_cmd import zip_cmd
from mirage.core.onedrive.glob import resolve_glob as _ft_resolve_glob
from mirage.core.onedrive.read import read_bytes as _ft_read

COMMANDS = [
    *make_filetype_commands(
        "onedrive", _ft_resolve_glob, _ft_read, provision=_ft_provision),
    awk,
    base64_cmd,
    basename,
    cat,
    cmp_cmd,
    column,
    comm,
    cp,
    csplit,
    cut,
    diff,
    dirname,
    du,
    expand,
    file,
    find,
    fmt,
    fold,
    grep,
    gunzip,
    gzip,
    head,
    iconv,
    join,
    jq,
    ln,
    look,
    ls,
    md5,
    mkdir,
    mktemp,
    mv,
    nl,
    paste,
    patch,
    readlink,
    realpath,
    rev,
    rg,
    rm,
    sed,
    sha256sum,
    shuf,
    sort,
    split,
    stat,
    strings,
    tac,
    tail,
    tar,
    tee,
    touch,
    tr,
    tree,
    tsort,
    unexpand,
    uniq,
    unzip_cmd,
    wc,
    xxd,
    zcat,
    zgrep,
    zip_cmd,
]
