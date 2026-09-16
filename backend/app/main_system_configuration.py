"""One encrypted configuration, optimistic writes, and saved-configuration testing."""
from dataclasses import replace
from urllib.parse import urlsplit

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import actor_name, require_admin
from .config import settings
from .database import SessionLocal, get_db
from .models import MainSystemConfiguration, User, utcnow

router = APIRouter(prefix="/api/main-system/configuration", tags=["main system configuration"],
                   dependencies=[Depends(require_admin)])


def cipher():
    try:
        return Fernet(settings.main_system_config_key.encode())
    except (ValueError, TypeError):
        raise HTTPException(503, "配置加密密钥未就绪，请联系部署管理员") from None


def origin(url):
    parsed = urlsplit(url)
    return f"{parsed.scheme}://{parsed.hostname}:{parsed.port or 443}"


def allowed_origins():
    values = [v.strip().rstrip('/') for v in settings.main_system_allowed_origins.split(',') if v.strip()]
    if settings.main_system_base_url:
        values.append(settings.main_system_base_url)
    return values


def validate_target(url):
    try:
        replace(settings, main_system_base_url=url, main_system_token="validation-placeholder")
        if url and origin(url) not in {origin(item) for item in allowed_origins()}:
            raise HTTPException(422, "该地址不在服务端允许的主系统地址白名单中")
    except ValueError:
        raise HTTPException(422, "请输入有效的 HTTPS 地址，不含账号、查询参数或空白") from None


def decode(row):
    if not row.token_ciphertext:
        return ""
    try:
        return cipher().decrypt(row.token_ciphertext.encode()).decode()
    except InvalidToken:
        raise HTTPException(503, "保存的令牌无法解密，请恢复配置密钥或重新填写令牌") from None


def effective_settings(fallback=None):
    fallback = fallback or settings
    with SessionLocal() as db:
        row = db.get(MainSystemConfiguration, 1)
        if row is None:
            return fallback
        if not row.enabled:
            return replace(fallback, main_system_base_url="", main_system_token="")
        validate_target(row.base_url)
        return replace(fallback, main_system_base_url=row.base_url, main_system_token=decode(row),
                       main_system_timeout_seconds=float(row.timeout_seconds))


def public_config(row):
    try:
        cipher()
        key_ready = True
    except HTTPException:
        key_ready = False
    return {
        "enabled": row.enabled if row else bool(settings.main_system_base_url),
        "base_url": row.base_url if row else settings.main_system_base_url,
        "timeout_seconds": float(row.timeout_seconds) if row else settings.main_system_timeout_seconds,
        "has_token": bool(row.token_ciphertext) if row else bool(settings.main_system_token),
        "version": row.version if row else 0,
        "source": "database" if row else "environment",
        "key_ready": key_ready, "allowed_origins": allowed_origins(),
        "updated_by": row.updated_by if row else None,
        "updated_at": row.updated_at.isoformat() + 'Z' if row else None,
        "last_test_at": row.last_test_at.isoformat() + 'Z' if row and row.last_test_at else None,
        "last_test_ok": row.last_test_ok if row else None,
        "last_test_message": row.last_test_message if row else None,
    }


class ConfigurationSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = Field(strict=True)
    base_url: str = Field(max_length=500)
    token: str = Field(default="", max_length=4096, repr=False)
    timeout_seconds: float = Field(ge=0.1, le=30, multiple_of=0.1)
    expected_version: int = Field(ge=0)

    @field_validator('base_url')
    @classmethod
    def clean_url(cls, value):
        return value.strip().rstrip('/')


@router.get("")
def get_configuration(response: Response, db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    return public_config(db.get(MainSystemConfiguration, 1))


@router.put("")
def save_configuration(payload: ConfigurationSave, response: Response,
                       user: User = Depends(require_admin), db: Session = Depends(get_db)):
    response.headers['Cache-Control'] = 'no-store'
    validate_target(payload.base_url)
    encryptor = cipher()
    if payload.enabled and not payload.base_url:
        raise HTTPException(422, "启用前请填写主系统地址")
    try:
        with db.begin():
            row = db.scalar(select(MainSystemConfiguration).where(MainSystemConfiguration.id == 1).with_for_update())
            if (row.version if row else 0) != payload.expected_version:
                raise HTTPException(409, "配置已被更新，请重新加载后再保存")
            old_url = row.base_url if row else settings.main_system_base_url
            # Never forward an existing credential to a changed base URL, even
            # when both origins are allowlisted. Explicitly supply a new token.
            if old_url != payload.base_url and not payload.token:
                if (row and row.token_ciphertext) or (not row and settings.main_system_token):
                    raise HTTPException(422, "更换主系统地址时必须重新填写访问令牌")
            token = payload.token or (decode(row) if row else settings.main_system_token)
            if token and any(ord(c) < 33 or ord(c) > 126 for c in token):
                raise HTTPException(422, "令牌不能包含空格、换行或非 ASCII 字符")
            if payload.enabled and not token:
                raise HTTPException(422, "启用前请填写访问令牌")
            if row is None:
                row = MainSystemConfiguration(id=1, version=0)
                db.add(row)
            row.enabled, row.base_url = payload.enabled, payload.base_url
            row.token_ciphertext = encryptor.encrypt(token.encode()).decode() if token else None
            row.timeout_seconds, row.version = payload.timeout_seconds, row.version + 1
            row.updated_by, row.updated_at = actor_name(user), utcnow()
            row.last_test_at = row.last_test_ok = row.last_test_message = None
            db.flush()
            result = public_config(row)
        return result
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "配置已被更新，请重新加载后再保存") from None


class ConfigurationTest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    serial_no: str = Field(min_length=1, max_length=80)
    expected_version: int = Field(ge=0)


@router.post("/test")
def test_configuration(payload: ConfigurationTest, response: Response, db: Session = Depends(get_db)):
    from . import main_system
    response.headers['Cache-Control'] = 'no-store'
    row = db.get(MainSystemConfiguration, 1)
    if row is None or row.version != payload.expected_version:
        raise HTTPException(409, "请先保存当前配置，再执行测试")
    validate_target(row.base_url)
    if not row.base_url or not row.token_ciphertext:
        raise HTTPException(422, "测试前请填写地址和访问令牌并保存")
    serial_no = payload.serial_no.strip()
    if not serial_no:
        raise HTTPException(422, "请输入测试流水号")
    connection = replace(settings, main_system_base_url=row.base_url, main_system_token=decode(row),
                         main_system_timeout_seconds=float(row.timeout_seconds))
    db.commit()
    data = None
    try:
        record = main_system.fetch_serial(serial_no, connection=connection)
        data = {**record.model_dump(mode="json"), "snapshot_hash": main_system.snapshot_hash(record)}
        ok, message = True, "查询成功" if record.active else "查询成功，流水号已停用"
    except HTTPException as exc:
        messages = {404:"主系统未找到该流水号", 502:"主系统连接、鉴权或返回格式异常，请核对接口规范",
                    503:"主系统暂不可用或请求受限", 504:"主系统请求超时"}
        details = {"main system credentials were rejected": "主系统认证失败，访问令牌无效或已过期",
                   "main system credentials lack read permission": "认证凭证无资料读取权限，请联系主系统管理员授权",
                   "main system response does not match the serial-material contract": "主系统返回字段不符合约定，请核对接口规范"}
        ok, message = False, details.get(str(exc.detail), messages.get(exc.status_code, "测试失败，请检查配置"))
    at = utcnow()
    changed = db.execute(update(MainSystemConfiguration).where(MainSystemConfiguration.id == 1,
        MainSystemConfiguration.version == payload.expected_version).values(
            last_test_at=at, last_test_ok=ok, last_test_message=message))
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "测试期间配置已改变，请重新加载后测试")
    db.commit()
    return {"ok": ok, "message": message, "tested_at": at.isoformat() + 'Z', "data": data}
