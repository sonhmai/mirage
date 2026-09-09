from mirage.commands.builtin.generic_bind import make_generic_commands
from mirage.commands.builtin.wandb.io import IO

COMMANDS = make_generic_commands("wandb", IO)
