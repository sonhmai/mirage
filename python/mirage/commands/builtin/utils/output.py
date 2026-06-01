from collections.abc import Sequence


def format_records(records: Sequence[str]) -> bytes:
    if not records:
        return b""
    return ("\n".join(records) + "\n").encode()


def format_optional_records(records: Sequence[str]) -> bytes | None:
    output = format_records(records)
    return output if output else None


def format_record_text(records: Sequence[str]) -> str:
    if not records:
        return ""
    return "\n".join(records) + "\n"


__all__ = ["format_optional_records", "format_record_text", "format_records"]
