from typing import Any, NotRequired, TypedDict


class RunVariables(TypedDict):
    entity: str
    project: str
    run: str


class FileMetadata(TypedDict):
    name: str
    sizeBytes: int | None


class RunFile(FileMetadata):
    directUrl: str | None
    url: str


class RunUser(TypedDict):
    id: str
    name: str
    username: str | None
    email: str | None


class Run(TypedDict):
    name: str
    id: NotRequired[str | None]
    displayName: NotRequired[str | None]
    state: NotRequired[str | None]
    tags: NotRequired[list[str] | None]
    sweepName: NotRequired[str | None]
    group: NotRequired[str | None]
    jobType: NotRequired[str | None]
    commit: NotRequired[str | None]
    readOnly: NotRequired[bool | None]
    createdAt: NotRequired[str | None]
    heartbeatAt: NotRequired[str | None]
    description: NotRequired[str | None]
    notes: NotRequired[str | None]
    user: NotRequired[RunUser | None]
    systemMetrics: NotRequired[str | dict[str, Any] | None]
    historyLineCount: NotRequired[int | None]
    fileCount: NotRequired[int | None]
    config: NotRequired[str | dict[str, Any]]
    summaryMetrics: NotRequired[str | dict[str, Any]]
    historyKeys: NotRequired[dict[str, Any] | None]
