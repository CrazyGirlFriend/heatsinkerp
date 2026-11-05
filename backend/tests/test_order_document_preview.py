"""Original worksheets go to Calc unchanged and conversion resources stay bounded."""

import signal
import subprocess
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from threading import BoundedSemaphore, Event
from unittest.mock import Mock
from urllib.parse import unquote, urlparse

import pytest
from app import order_document_preview as preview
from fastapi import HTTPException
from pypdf import PdfReader, PdfWriter


def pdf(*, pages=1, password=False):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=1200, height=120)
    if password:
        writer.encrypt("secret")
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.fixture()
def converter(monkeypatch):
    preview._discard_profile()
    monkeypatch.setattr(preview, "_cache", OrderedDict())
    monkeypatch.setattr(preview, "_conversion_slot", BoundedSemaphore(1))
    monkeypatch.setattr(preview, "_soffice", lambda: "/converter/soffice")
    kill = Mock()
    monkeypatch.setattr(preview.os, "killpg", kill)
    process = Mock(pid=123456)
    process.wait.return_value = 0
    calls = []

    def popen(command, **kwargs):
        root = Path(kwargs["cwd"])
        calls.append((command, kwargs, Path(command[-1]).read_bytes()))
        (root / "order.pdf").write_bytes(pdf())
        return process

    start = Mock(side_effect=popen)
    monkeypatch.setattr(preview.subprocess, "Popen", start)
    yield process, start, kill, calls
    preview._discard_profile()


def profile_path(command):
    setting = next(arg for arg in command if arg.startswith("-env:UserInstallation="))
    return Path(unquote(urlparse(setting.split("=", 1)[1]).path))


def test_original_bytes_layout_and_isolated_profile_are_preserved(converter):
    process, start, kill, calls = converter
    original = b"original xlsx bytes, including styles and column widths"
    result = preview.order_document_preview(original, "../../原件.xlsx")
    assert result == pdf()
    page = PdfReader(BytesIO(result)).pages[0]
    assert page.mediabox.width == 1200 and page.mediabox.height == 120
    assert page.rotation == 0
    command, options, copied = calls[0]
    assert copied == original
    assert "--headless" in command
    assert 'pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}' in command
    root = Path(options["cwd"])
    profile = profile_path(command)
    assert profile.name.startswith("heatsink-order-profile-")
    assert profile.is_dir() and profile.parent != root
    assert options["env"]["TMPDIR"] == str(root)
    assert options["start_new_session"] is True
    assert options["stdout"] == options["stderr"] == subprocess.DEVNULL
    process.wait.assert_any_call(timeout=preview.CONVERSION_TIMEOUT_SECONDS)
    kill.assert_called_once_with(process.pid, signal.SIGKILL)
    assert not root.exists()
    assert preview.order_document_preview(original, "renamed.xlsx") == result
    assert start.call_count == 1
    preview.order_document_preview(original + b"changed", "原件.xlsx")
    assert start.call_count == 2
    assert calls[1][1]["cwd"] != root


@pytest.mark.parametrize("failure", ["exit", "missing", "invalid", "large", "encrypted", "pages"])
def test_failed_output_is_rejected_and_never_cached(converter, monkeypatch, failure):
    process, start, kill, calls = converter
    original_start = start.side_effect

    def fail(command, **kwargs):
        process = original_start(command, **kwargs)
        output = Path(kwargs["cwd"]) / "order.pdf"
        if failure == "exit":
            process.wait.return_value = 1
        elif failure == "missing":
            output.unlink()
        elif failure == "invalid":
            output.write_bytes(b"not pdf")
        elif failure == "large":
            monkeypatch.setattr(preview, "MAX_PDF_BYTES", 1)
        elif failure == "encrypted":
            output.write_bytes(pdf(password=True))
        elif failure == "pages":
            output.write_bytes(pdf(pages=2))
        return process

    start.side_effect = fail
    with pytest.raises(HTTPException) as error:
        preview.order_document_preview(b"original", "订单.xlsx")
    assert error.value.status_code == 422
    assert preview._cache == {}
    assert not Path(calls[0][1]["cwd"]).exists()
    assert not profile_path(calls[0][0]).exists()
    kill.assert_called_once_with(process.pid, signal.SIGKILL)


def test_timeout_kills_owned_process_group_and_cleans_temporary_files(converter):
    process, start, kill, calls = converter
    process.wait.side_effect = [
        subprocess.TimeoutExpired("soffice", preview.CONVERSION_TIMEOUT_SECONDS),
        0,
    ]
    with pytest.raises(HTTPException) as error:
        preview.order_document_preview(b"original", "订单.xlsx")
    assert error.value.status_code == 504 and "超时" in error.value.detail
    kill.assert_called_once_with(process.pid, signal.SIGKILL)
    assert process.wait.call_count == 2
    assert not Path(calls[0][1]["cwd"]).exists()
    failed_profile = profile_path(calls[0][0])
    assert not failed_profile.exists()
    assert preview._cache == {}
    process.wait.side_effect = None
    assert preview.order_document_preview(b"original", "订单.xlsx") == pdf()
    assert profile_path(calls[1][0]) != failed_profile
    assert profile_path(calls[1][0]).is_dir()


def test_start_failure_is_reported_without_command_or_contents(converter):
    process, start, kill, calls = converter
    start.side_effect = FileNotFoundError("private document contents")
    with pytest.raises(HTTPException) as error:
        preview.order_document_preview(b"private document contents", "订单.xlsx")
    assert error.value.status_code == 503 and "无法启动" in error.value.detail
    assert "private" not in error.value.detail
    kill.assert_not_called()


def test_missing_converter_has_clear_service_error(monkeypatch):
    monkeypatch.setattr(preview.shutil, "which", lambda name: None)
    monkeypatch.setattr(preview.os, "access", lambda path, mode: False)
    with pytest.raises(HTTPException) as error:
        preview._soffice()
    assert error.value.status_code == 503 and "LibreOffice" in error.value.detail


def test_queue_is_bounded_and_releases_slot_after_busy_response(converter, monkeypatch):
    monkeypatch.setattr(preview, "QUEUE_TIMEOUT_SECONDS", 0)
    assert preview._conversion_slot.acquire(blocking=False)
    try:
        with pytest.raises(HTTPException) as error:
            preview.order_document_preview(b"original", "订单.xlsx")
        assert error.value.status_code == 503 and "正忙" in error.value.detail
        converter[1].assert_not_called()
    finally:
        preview._conversion_slot.release()
    assert preview.order_document_preview(b"original", "订单.xlsx") == pdf()


def test_concurrent_requests_share_one_conversion(converter):
    process, start, kill, calls = converter
    entered, finish = Event(), Event()

    def wait(timeout=None):
        entered.set()
        assert finish.wait(2)
        return 0

    process.wait.side_effect = wait
    with ThreadPoolExecutor(max_workers=2) as threads:
        first = threads.submit(preview.order_document_preview, b"original", "订单.xlsx")
        try:
            assert entered.wait(2)
            second = threads.submit(preview.order_document_preview, b"original", "另一名.xlsx")
        finally:
            finish.set()
        assert first.result(timeout=3) == second.result(timeout=3) == pdf()
    assert start.call_count == 1


def test_cache_is_bounded_by_bytes_and_entry_count(converter, monkeypatch):
    monkeypatch.setattr(preview, "MAX_CACHE_ENTRIES", 2)
    for content in (b"first", b"second", b"third", b"second"):
        preview.order_document_preview(content, "订单.xlsx")
    assert len(preview._cache) == 2 and converter[1].call_count == 3
    preview.order_document_preview(b"first", "订单.xlsx")
    assert converter[1].call_count == 4
    monkeypatch.setattr(preview, "MAX_CACHE_BYTES", len(pdf()))
    preview.order_document_preview(b"fourth", "订单.xlsx")
    assert len(preview._cache) == 1
    assert sum(map(len, preview._cache.values())) <= preview.MAX_CACHE_BYTES


def test_different_orders_reuse_the_private_converter_profile(converter):
    _, start, _, calls = converter
    preview.order_document_preview(b"first order", "订单.xlsx")
    preview.order_document_preview(b"second order", "另一订单.xlsx")
    profiles = [
        next(arg for arg in command if arg.startswith("-env:UserInstallation="))
        for command, _, _ in calls
    ]
    assert start.call_count == 2
    assert profiles[0] == profiles[1]
    # Only the converter settings persist; each order still has a fresh workspace.
    assert calls[0][1]["cwd"] != calls[1][1]["cwd"]
    assert all(not Path(options["cwd"]).exists() for _, options, _ in calls)
    profile = profile_path(calls[0][0])
    assert profile.is_dir()
    preview.close_order_previews()
    assert not profile.exists()
