"""Render validated order originals with Calc, preserving the worksheet layout."""

import atexit
import hashlib
import os
import shutil
import signal
import subprocess
from collections import OrderedDict
from contextlib import contextmanager, suppress
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore

from fastapi import HTTPException
from pypdf import PdfReader
from pypdf.errors import PdfReadError

from .process_route_import import MAX_FILE_BYTES

# Allow cold startup while staying below the proxy's 60-second response timeout.
CONVERSION_TIMEOUT_SECONDS = 45
QUEUE_TIMEOUT_SECONDS = 2
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_CACHE_BYTES = 16 * 1024 * 1024
MAX_CACHE_ENTRIES = 16
_conversion_slot = BoundedSemaphore(1)
_cache = OrderedDict()
_profile = None


def _discard_profile():
    global _profile
    if _profile is not None:
        _profile.cleanup()
        _profile = None


atexit.register(_discard_profile)


def close_order_previews():
    # ASGI shutdown can be followed by SIGTERM, which skips Python's atexit hooks.
    with _conversion_slot:
        _discard_profile()


@contextmanager
def _converter_profile():
    """Reuse private settings under the conversion slot, never the user's profile."""
    global _profile
    if _profile is None:
        _profile = TemporaryDirectory(prefix="heatsink-order-profile-")
    try:
        yield Path(_profile.name)
    except BaseException:
        # Failed/terminated startup may leave locks or recovery state behind.
        _discard_profile()
        raise


def _soffice():
    executable = shutil.which("soffice") or shutil.which("libreoffice")
    if executable:
        return executable
    executable = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
    if os.access(executable, os.X_OK):
        return executable
    raise HTTPException(503, "订单原件预览服务未安装 LibreOffice，请联系管理员")


def _convert(content):
    executable = _soffice()
    with (
        _converter_profile() as profile,
        TemporaryDirectory(prefix="heatsink-order-preview-") as directory,
    ):
        root = Path(directory)
        source = root / "order.xlsx"
        source.write_bytes(content)
        command = [
            executable,
            "-env:UserInstallation=" + profile.as_uri(),
            "--headless",
            "--nologo",
            "--nodefault",
            "--norestore",
            "--convert-to",
            'pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}',
            "--outdir",
            str(root),
            str(source),
        ]
        try:
            process = subprocess.Popen(
                command,
                cwd=root,
                env={**os.environ, "TMPDIR": directory, "SAL_USE_VCLPLUGIN": "svp"},
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except OSError as exc:
            raise HTTPException(503, "订单原件预览服务无法启动，请联系管理员") from exc
        try:
            if process.wait(timeout=CONVERSION_TIMEOUT_SECONDS) != 0:
                raise HTTPException(422, "订单表预览转换失败，请检查文件后重试")
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(504, "订单表预览转换超时，请稍后重试") from exc
        finally:
            # Only the process group created above belongs to this conversion.
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        output = root / "order.pdf"
        if not output.is_file() or not 0 < output.stat().st_size <= MAX_PDF_BYTES:
            raise HTTPException(422, "订单表预览转换失败，请检查文件后重试")
        result = output.read_bytes()
        try:
            pdf = PdfReader(BytesIO(result), strict=True)
            if pdf.is_encrypted or len(pdf.pages) != 1:
                raise ValueError("Invalid worksheet preview")
        except (PdfReadError, ValueError, TypeError, KeyError, IndexError) as exc:
            raise HTTPException(422, "订单表预览转换失败，请检查文件后重试") from exc
        return result


def order_document_preview(content, filename):
    """Convert already validated XLSX bytes; never rebuild cells from parsed fields."""
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(422, "订单资料仅支持 .xlsx 文件")
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(413, "订单表不能超过 5 MB")
    key = hashlib.sha256(content).digest()
    if not _conversion_slot.acquire(timeout=QUEUE_TIMEOUT_SECONDS):
        raise HTTPException(503, "订单原件预览服务正忙，请稍后重试")
    try:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
        result = _convert(content)
        _cache[key] = result
        while len(_cache) > MAX_CACHE_ENTRIES or sum(map(len, _cache.values())) > MAX_CACHE_BYTES:
            _cache.popitem(last=False)
        return result
    finally:
        _conversion_slot.release()
