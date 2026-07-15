from config import env_get
"""iter454 — Pluggable digital-file security scanning.

The upload pipeline calls `scan_digital_file(data, ext)` and never cares
which engines ran. Engines are tried in order; the FIRST "blocked"
verdict wins. Today: (1) deterministic heuristics, (2) optional ClamAV
via clamd TCP when CLAMAV_HOST is configured — so a real AV engine can
be layered in later without touching the upload pipeline.
"""
import io
import os
import socket
import zipfile

from core import logger

_EXEC_SIGNATURES = (b"MZ", b"\x7fELF", b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa")
_DANGEROUS_MEMBER_EXTS = {"exe", "dll", "bat", "cmd", "sh", "msi", "scr", "com",
                          "pif", "vbs", "js", "jse", "wsf", "ps1", "jar", "apk"}
_MAGIC = {
    "pdf": (b"%PDF",), "png": (b"\x89PNG",), "jpg": (b"\xff\xd8\xff",),
    "jpeg": (b"\xff\xd8\xff",), "zip": (b"PK\x03\x04", b"PK\x05\x06"),
    "epub": (b"PK\x03\x04",), "3mf": (b"PK\x03\x04",),
    "mp3": (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"),
}


def _heuristic_engine(data: bytes, ext: str) -> tuple[str, str]:
    if not data:
        return "blocked", "Empty file."
    head = data[:16]
    if any(head.startswith(sig) for sig in _EXEC_SIGNATURES):
        return "blocked", "Executable binaries are not allowed."
    if head.startswith(b"#!"):
        return "blocked", "Script files are not allowed."
    magics = _MAGIC.get(ext)
    if magics and not any(head.startswith(m) for m in magics):
        return "blocked", f"File content does not match .{ext} format."
    if ext == "mp4" and data[4:8] not in (b"ftyp", b"moov", b"mdat"):
        return "blocked", "File content does not match .mp4 format."
    if ext in ("zip", "epub", "3mf"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                total_uncompressed = 0
                for info in z.infolist():
                    member_ext = info.filename.rsplit(".", 1)[-1].lower() \
                        if "." in info.filename else ""
                    if member_ext in _DANGEROUS_MEMBER_EXTS:
                        return "blocked", f"Archive contains a blocked file type (.{member_ext})."
                    total_uncompressed += info.file_size
                if total_uncompressed > 2 * 1024 * 1024 * 1024:
                    return "blocked", "Archive expands beyond the 2GB safety limit."
                if len(data) > 0 and total_uncompressed / max(len(data), 1) > 300:
                    return "blocked", "Archive compression ratio is suspicious (zip bomb)."
        except zipfile.BadZipFile:
            return "blocked", "Corrupt or invalid archive."
        except Exception:
            return "blocked", "Archive could not be inspected."
    return "clean", ""


def _clamav_engine(data: bytes, ext: str) -> tuple[str, str]:
    """INSTREAM scan against a clamd daemon. Skipped unless CLAMAV_HOST set."""
    host = env_get("CLAMAV_HOST")
    if not host:
        return "clean", ""
    port = int(env_get("CLAMAV_PORT", "3310"))
    try:
        with socket.create_connection((host, port), timeout=20) as s:
            s.sendall(b"zINSTREAM\0")
            for i in range(0, len(data), 1 << 20):
                chunk = data[i:i + (1 << 20)]
                s.sendall(len(chunk).to_bytes(4, "big") + chunk)
            s.sendall((0).to_bytes(4, "big"))
            reply = s.recv(4096).decode("utf-8", "replace")
        if "FOUND" in reply:
            return "blocked", f"Antivirus detection: {reply.split(':')[-1].strip().rstrip(chr(0))}"
        return "clean", ""
    except Exception as e:
        logger.warning("[scan] clamav unavailable (%s) — heuristic verdict stands", e)
        return "clean", ""


ENGINES = [("heuristic-v1", _heuristic_engine), ("clamav", _clamav_engine)]


def scan_digital_file(data: bytes, ext: str) -> tuple[str, str]:
    """("clean", "") or ("blocked", reason). First blocking engine wins."""
    for name, engine in ENGINES:
        status, reason = engine(data, ext)
        if status == "blocked":
            logger.info("[scan] blocked by %s ext=%s: %s", name, ext, reason)
            return status, reason
    return "clean", ""


def engine_label() -> str:
    return "+".join(name for name, _ in ENGINES
                    if name != "clamav" or env_get("CLAMAV_HOST"))
