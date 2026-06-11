from mirage.accessor.nextcloud import NextcloudAccessor
from mirage.types import PathSpec


async def mkdir(accessor: NextcloudAccessor,
                path: PathSpec,
                parents: bool = False) -> None:
    # opendal create_dir creates missing parents; parents is implicit.
    if isinstance(path, str):
        path = PathSpec.from_str_path(path)
    key = path.strip_prefix.strip("/") + "/"
    op = accessor.operator()
    await op.create_dir(key)
