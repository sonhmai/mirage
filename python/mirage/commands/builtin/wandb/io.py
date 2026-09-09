from mirage.commands.builtin.generic_bind import CommandIO
from mirage.core.wandb.read import read, read_stream
from mirage.core.wandb.readdir import readdir
from mirage.core.wandb.stat import stat

IO = CommandIO(readdir=readdir,
               read_bytes=read,
               read_stream=read_stream,
               stat=stat,
               is_mounted=lambda a: True,
               local=False,
               max_du_entries=1000)
