import asyncio
import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
HOST = os.environ.get("TELEGRAM_GATEWAY_HOST", "0.0.0.0")
PORT = int(os.environ.get("TELEGRAM_GATEWAY_PORT", "5090"))
DATA_DIR = Path(os.environ.get("TELEGRAM_DATA_DIR", "./data"))
DB_PATH = DATA_DIR / "gateway.sqlite3"
MAX_FILE_BYTES = int(os.environ.get("TELEGRAM_MAX_FILE_BYTES", str(50 * 1024 * 1024)))
PAIRING_TTL = 10 * 60

app = FastAPI(title="Tesify Telegram Gateway", version="1.0.0")
db_lock = asyncio.Lock()
poller_task: Optional[asyncio.Task] = None


def db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS pairings (
          id TEXT PRIMARY KEY, code TEXT NOT NULL, client_id TEXT NOT NULL,
          chat_id INTEGER, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, pairing_id TEXT NOT NULL, chat_id INTEGER NOT NULL,
          message_id INTEGER NOT NULL, total INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        """
    )
    return conn


def now() -> int:
    return int(time.time())


async def telegram(method: str, **kwargs):
    if not TOKEN:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(f"https://api.telegram.org/bot{TOKEN}/{method}", **kwargs)
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"):
            raise RuntimeError(payload.get("description", "Telegram API error"))
        return payload["result"]


def require_token():
    if not TOKEN:
        raise HTTPException(503, "Telegram gateway is not configured")


class ClientRequest(BaseModel):
    client_id: str


class JobRequest(BaseModel):
    pairing_id: str
    total: int


class ProgressRequest(BaseModel):
    completed: int
    total: int
    current: str = ""
    speed: str = ""
    eta: str = "—"
    state: str = "uploading"


def progress_text(completed: int, total: int, current: str, speed: str, eta: str, state: str) -> str:
    if state == "done":
        title = "✅ Отправка завершена"
    elif state == "error":
        title = "⚠️ Отправка завершена с ошибками"
    else:
        title = "📥 Отправка треков"
    lines = [title, f"Готово: {completed} из {total}"]
    if current:
        lines.append(f"Текущий трек: {current}")
    if speed:
        lines.append(f"Скорость: {speed}")
    if eta and eta != "—":
        lines.append(f"ETA: {eta}")
    return "\n".join(lines)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "tesify-telegram-gateway"}


@app.post("/v1/pairing/start")
async def pairing_start(request: ClientRequest):
    require_token()
    client_id = request.client_id.strip()
    if len(client_id) < 12 or len(client_id) > 128:
        raise HTTPException(400, "Invalid client id")
    pairing_id = secrets.token_urlsafe(24)
    code = f"{secrets.randbelow(1_000_000):06d}"
    created, expires = now(), now() + PAIRING_TTL
    async with db_lock:
        conn = db()
        conn.execute("DELETE FROM pairings WHERE expires_at < ?", (created,))
        conn.execute("INSERT INTO pairings VALUES (?, ?, ?, NULL, ?, ?)", (pairing_id, code, client_id, created, expires))
        conn.commit(); conn.close()
    return {"pairing_id": pairing_id, "code": code, "expires_at": expires, "bot_username": ""}


@app.get("/v1/pairing/{pairing_id}")
async def pairing_status(pairing_id: str):
    async with db_lock:
        conn = db(); row = conn.execute("SELECT * FROM pairings WHERE id = ?", (pairing_id,)).fetchone(); conn.close()
    if not row:
        raise HTTPException(404, "Pairing not found")
    return {"status": "paired" if row["chat_id"] else ("expired" if row["expires_at"] < now() else "pending"), "chat_id": row["chat_id"]}


@app.post("/v1/jobs/start")
async def job_start(request: JobRequest):
    require_token()
    async with db_lock:
        conn = db(); row = conn.execute("SELECT * FROM pairings WHERE id = ?", (request.pairing_id,)).fetchone(); conn.close()
    if not row or not row["chat_id"]:
        raise HTTPException(409, "Telegram account is not paired")
    total = max(1, min(request.total, 1000))
    message = await telegram("sendMessage", json={"chat_id": row["chat_id"], "text": progress_text(0, total, "Подготовка...", "", "—", "uploading")})
    job_id = secrets.token_urlsafe(20)
    async with db_lock:
        conn = db(); conn.execute("INSERT INTO jobs VALUES (?, ?, ?, ?, 0, ?, ?)", (job_id, request.pairing_id, row["chat_id"], message["message_id"], total, now())); conn.commit(); conn.close()
    return {"job_id": job_id, "message_id": message["message_id"]}


@app.post("/v1/jobs/{job_id}/progress")
async def job_progress(job_id: str, request: ProgressRequest):
    async with db_lock:
        conn = db(); row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone(); conn.close()
    if not row:
        raise HTTPException(404, "Job not found")
    completed = max(0, min(request.completed, row["total"]))
    await telegram("editMessageText", json={"chat_id": row["chat_id"], "message_id": row["message_id"], "text": progress_text(completed, row["total"], request.current, request.speed, request.eta, request.state)})
    async with db_lock:
        conn = db(); conn.execute("UPDATE jobs SET completed = ? WHERE id = ?", (completed, job_id)); conn.commit(); conn.close()
    return {"status": "ok"}


@app.post("/v1/jobs/{job_id}/upload")
async def job_upload(job_id: str, file: UploadFile = File(...), title: str = Form("Track"), artist: str = Form("Artist"), index: int = Form(1)):
    require_token()
    async with db_lock:
        conn = db(); row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone(); conn.close()
    if not row:
        raise HTTPException(404, "Job not found")
    content = await file.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(413, "File is too large")
    await telegram("sendAudio", files={"audio": (file.filename or "track.mp3", content, "audio/mpeg")}, data={"chat_id": str(row["chat_id"]), "title": title[:128], "performer": artist[:128]})
    return {"status": "sent", "index": index}


async def bot_poller():
    offset = 0
    while True:
        try:
            updates = await telegram("getUpdates", json={"timeout": 25, "offset": offset, "allowed_updates": ["message"]})
            for update in updates:
                offset = max(offset, update["update_id"] + 1)
                message = update.get("message") or {}
                chat = message.get("chat") or {}
                text = (message.get("text") or "").strip()
                if not text or not chat.get("id"):
                    continue
                if text == "/start":
                    await telegram("sendMessage", json={"chat_id": chat["id"], "text": "Введите шестизначный код из приложения Tesify."})
                    continue
                if text.isdigit() and len(text) == 6:
                    async with db_lock:
                        conn = db(); row = conn.execute("SELECT * FROM pairings WHERE code = ? AND expires_at >= ? AND chat_id IS NULL ORDER BY created_at DESC LIMIT 1", (text, now())).fetchone()
                        if row:
                            conn.execute("UPDATE pairings SET chat_id = ? WHERE id = ?", (chat["id"], row["id"])); conn.commit()
                        conn.close()
                    await telegram("sendMessage", json={"chat_id": chat["id"], "text": "✅ Telegram подключён к Tesify. Можете вернуться в приложение." if row else "Код не найден или уже истёк."})
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(5)


@app.on_event("startup")
async def startup():
    require_token()
    global poller_task
    poller_task = asyncio.create_task(bot_poller())


@app.on_event("shutdown")
async def shutdown():
    if poller_task:
        poller_task.cancel()
