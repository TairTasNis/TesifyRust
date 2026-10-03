from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from fastapi import Request
import yt_dlp
import os
import sys
import threading
import subprocess
import time
import aiohttp
import asyncio

import traceback
import json
from pydantic import BaseModel
import shutil
from collections import deque

# Буфер логов (последние 500 строк) и время запуска
log_buffer: deque = deque(maxlen=500)
server_start_time = time.time()

class _DualWriter:
    """Пишет в файл и одновременно копирует в буфер логов."""
    def __init__(self, fileobj):
        self._f = fileobj
    def write(self, text):
        if text and text.strip():
            log_buffer.append({'time': time.strftime('%H:%M:%S'), 'level': 'INFO', 'msg': text.rstrip()})
        return self._f.write(text)
    def flush(self):
        return self._f.flush()
    def __getattr__(self, name):
        return getattr(self._f, name)

# Перенаправляем вывод для записи логов в файл
if getattr(sys, 'frozen', False):
    log_dir = os.path.dirname(sys.executable)
    log_file = os.path.join(log_dir, "tesify_error.log")
    fsock = open(log_file, 'w', encoding='utf-8')
    sys.stdout = _DualWriter(fsock)
    sys.stderr = _DualWriter(fsock)
else:
    # В режиме разработки дублируем вывод в буфер, консоль остаётся
    sys.stdout = _DualWriter(sys.__stdout__)
    sys.stderr = _DualWriter(sys.__stderr__)

# Конфигурация
config_file = "tesify_config.json"
def load_config():
    if os.path.exists(config_file):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {"download_dir": "downloads"}

def save_config(cfg):
    with open(config_file, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=4)

config = load_config()
DOWNLOAD_DIR = config.get("download_dir", "downloads")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

def ensure_download_dir():
    global DOWNLOAD_DIR
    if not os.path.exists(DOWNLOAD_DIR):
        try:
            os.makedirs(DOWNLOAD_DIR)
        except Exception as e:
            print(f"Не удалось создать {DOWNLOAD_DIR}: {e}")
            DOWNLOAD_DIR = "downloads"
            if not os.path.exists(DOWNLOAD_DIR):
                os.makedirs(DOWNLOAD_DIR)
ensure_download_dir()

app.mount("/files", StaticFiles(directory=DOWNLOAD_DIR), name="files")

# --- Механизм автоматического закрытия сервера при закрытии окна ---
last_ping_time = time.time()

@app.get("/api/health")
async def health_check():
    global last_ping_time
    last_ping_time = time.time()
    return {"status": "ok"}

@app.post("/api/shutdown")
async def shutdown_server():
    if not getattr(sys, 'frozen', False):
        print("Shutdown request ignored (Dev Mode)")
        return {"status": "ignored"}
    def terminate():
        time.sleep(0.5)
        os._exit(0)
    threading.Thread(target=terminate).start()
    return {"status": "shutting down"}

@app.get("/api/server-status")
async def get_server_status():
    uptime = int(time.time() - server_start_time)
    h = uptime // 3600
    m = (uptime % 3600) // 60
    s = uptime % 60
    return {
        "status": "online",
        "uptime_seconds": uptime,
        "uptime_str": f"{h:02d}:{m:02d}:{s:02d}",
        "last_ping_ago": round(time.time() - last_ping_time, 1),
        "pid": os.getpid()
    }

@app.get("/api/logs")
async def get_logs(n: int = 100):
    logs = list(log_buffer)[-n:]
    return {"logs": logs, "total": len(log_buffer)}

def monitor_health():
    # Ждем 5 секунд перед началом мониторинга, чтобы фронтенд успел загрузиться
    time.sleep(5)
    while True:
        global last_ping_time
        # Если пинга не было более 120 секунд - окно закрыто
        if time.time() - last_ping_time > 120:
            print("Окно приложения закрыто. Завершение работы сервера...")
            os._exit(0)
        time.sleep(5)

# Запускаем мониторинг в отдельном потоке (только если это упакованное приложение)
if getattr(sys, 'frozen', False):
    threading.Thread(target=monitor_health, daemon=True).start()
# -------------------------------------------------------------------

# НОВОЕ: Поиск по YouTube
@app.get("/search")
async def search_youtube(q: str):
    try:
        ydl_opts = {
            'format': 'bestaudio/best',
            'noplaylist': True,
            'extract_flat': True, # Быстрый поиск без скачивания
            'quiet': True
        }
        
        # Если это ссылка на счетчик
        is_url = q.startswith("http://") or q.startswith("https://")
        search_query = q if is_url else f"ytsearch10:{q}"

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(search_query, download=False)
            
            results = []
            entries = [info] if is_url and 'entries' not in info else info.get('entries', [])
            
            for entry in entries:
                if entry:
                    results.append({
                        "id": entry.get('id'),
                        "title": entry.get('title'),
                        "uploader": entry.get('uploader'),
                        "duration": entry.get('duration'),
                        "thumbnail": entry.get('thumbnails', [{}])[0].get('url') if entry.get('thumbnails') else None
                    })
                
            return {"results": results}
            
    except Exception as e:
        print(f"Search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# НОВОЕ: Перевод текста
@app.get("/api/translate")
async def translate_text(text: str, target: str = 'ru', source: str = 'auto'):
    try:
        from deep_translator import GoogleTranslator
        translator = GoogleTranslator(source=source, target=target)
        # deep_translator limitations: Google Translate may have 5000 chars limit per request
        if len(text) > 4900:
            parts = [text[i:i+4900] for i in range(0, len(text), 4900)]
            translated = ""
            for p in parts:
                translated += translator.translate(p) + " "
            return {"translatedText": translated.strip()}
        
        translated = translator.translate(text)
        return {"translatedText": translated}
    except Exception as e:
        print(f"Translation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# НОВОЕ: Импорт из Spotify (без API ключей)
@app.get("/api/spotify")
async def extract_spotify(url: str):
    import re
    import json
    import asyncio
    import urllib.parse
    try:
        # Пытаемся получить тип и ID из ссылки 
        match = re.search(r"(playlist|album|track)/([a-zA-Z0-9]+)", url)
        if not match:
            raise HTTPException(status_code=400, detail="Invalid Spotify URL")
            
        sType, sId = match.groups()
        
        async with aiohttp.ClientSession() as session:
            if sType == "playlist":
                # Обход ограничения в 100 треков с помощью GraphQL API и токена web player'а
                # Получаем анонимный токен из безопасного виджета
                async with session.get("https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M", headers={"User-Agent": "Mozilla/5.0"}) as resp:
                    html = await resp.text()
                
                m_token = re.search(r'\"accessToken\":\"([^\"]+)\"', html)
                if not m_token:
                    raise HTTPException(status_code=500, detail="Could not retrieve Spotify token")
                token = m_token.group(1)
                
                tracks_out = []
                offset = 0
                limit = 100
                sha = "9c53fb83f35c6a177be88bf1b67cb080b853e86b576ed174216faa8f9164fc8f"
                
                while True:
                    vars_json = json.dumps({
                        "uri": f"spotify:playlist:{sId}",
                        "offset": offset,
                        "limit": limit,
                        "enableWatchFeedEntrypoint": False
                    }, separators=(',', ':'))
                    exts_json = json.dumps({"persistedQuery": {"version": 1, "sha256Hash": sha}}, separators=(',', ':'))
                    
                    api_url = f"https://api-partner.spotify.com/pathfinder/v1/query?operationName=fetchPlaylist&variables={urllib.parse.quote(vars_json)}&extensions={urllib.parse.quote(exts_json)}"
                    
                    async with session.get(api_url, headers={"Authorization": f"Bearer {token}", "User-Agent": "Mozilla/5.0"}) as r:
                        if r.status != 200:
                            break
                        res_data = await r.json()
                        
                    items = res_data.get('data', {}).get('playlistV2', {}).get('content', {}).get('items', [])
                    if not items:
                        break
                        
                    for track_wrapper in items:
                        item_v2 = track_wrapper.get('itemV2', {})
                        if not item_v2:
                            continue
                        t_data = item_v2.get('data', {})
                        if not t_data or t_data.get('__typename') != 'Track':
                            continue
                            
                        # Парсинг данных трека
                        t_id = t_data.get('uri', '').split(':')[-1]
                        title = t_data.get('name', '')
                        artists = [a.get('profile', {}).get('name', '') for a in t_data.get('artists', {}).get('items', [])]
                        
                        cover_url = ""
                        try:
                            cover_url = t_data.get('albumOfTrack', {}).get('coverArt', {}).get('sources', [])[0].get('url', '')
                        except:
                            pass
                            
                        duration = t_data.get('playcast', {}).get('durationMs', 0)
                        if not duration and t_data.get('duration'):
                            duration = t_data.get('duration', {}).get('totalMilliseconds', 0)
                        if not duration and t_data.get('trackDuration'):
                            duration = t_data.get('trackDuration', {}).get('totalMilliseconds', 0)
                            
                        tracks_out.append({
                            "id": f"spotify-{t_id}",
                            "title": title,
                            "artist": ", ".join(artists) if artists else "",
                            "thumbnail": cover_url,
                            "url": "",
                            "spotifyId": t_id,
                            "durationMs": duration
                        })
                        
                    # Проверяем, нужно ли получать следующую страницу
                    total = res_data.get('data', {}).get('playlistV2', {}).get('content', {}).get('totalCount', 0)
                    offset += limit
                    if offset >= total:
                        break

            else:
                # Обработка альбомов и синглов через Embed API
                embed_url = f"https://open.spotify.com/embed/{sType}/{sId}"
                async with session.get(embed_url, headers={"User-Agent": "Mozilla/5.0"}) as resp:
                    if resp.status != 200:
                        raise HTTPException(status_code=resp.status, detail="Spotify block / Not Found")
                    html = await resp.text()
                    
                m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
                if not m:
                    raise HTTPException(status_code=500, detail="No data found in embed")
                    
                data = json.loads(m.group(1))
                entity = data['props']['pageProps']['state']['data']['entity']
                tracks_out = []

                if sType == "album":
                    t_list = entity.get('trackList', [])
                    cover_url = ""
                    if "coverArt" in entity and "sources" in entity["coverArt"] and len(entity["coverArt"]["sources"]) > 0:
                        cover_url = entity["coverArt"]["sources"][0]["url"]
                    elif "visualIdentity" in entity and "image" in entity["visualIdentity"] and len(entity["visualIdentity"]["image"]) > 0:
                        cover_url = entity["visualIdentity"]["image"][0]["url"]

                    async def fetch_track_cover(s, tid, fallback):
                        try:
                            async with s.get(f"https://open.spotify.com/oembed?url=spotify:track:{tid}", headers={"User-Agent": "Mozilla/5.0"}) as r:
                                if r.status == 200:
                                    d = await r.json()
                                    return d.get("thumbnail_url", fallback)
                        except:
                            pass
                        return fallback

                    tasks = [fetch_track_cover(session, t['uri'].split(':')[-1], cover_url) for t in t_list]
                    covers = await asyncio.gather(*tasks)

                    for i, t in enumerate(t_list):
                        tracks_out.append({
                            "id": f"spotify-{t['uri'].split(':')[-1]}",
                            "title": t.get("title", ""),
                            "artist": t.get("subtitle", ""),
                            "thumbnail": covers[i],
                            "url": "",
                            "spotifyId": t['uri'].split(':')[-1],
                            "durationMs": t.get("duration", 0)
                        })
                else:
                    # track
                    cover_url = ""
                    if "visualIdentity" in entity and "image" in entity["visualIdentity"] and len(entity["visualIdentity"]["image"]) > 0:
                        cover_url = entity["visualIdentity"]["image"][0]["url"]
                    tracks_out.append({
                        "id": f"spotify-{entity['id']}",
                        "title": entity.get("title", ""),
                        "artist": ", ".join([a["name"] for a in entity.get("artists", [])]) if "artists" in entity else entity.get("subtitle", ""),
                        "thumbnail": cover_url,
                        "url": "",
                        "spotifyId": entity['id'],
                        "durationMs": entity.get("duration", 0)
                    })

        return {"tracks": tracks_out}
    except HTTPException as e:
        raise e
    except Exception as e:
        print("Spotify extract error:", e)
        raise HTTPException(status_code=500, detail=str(e))

# Кэш прямых ссылок для проксирования
stream_url_cache = {}
STREAM_FORMAT = 'bestaudio[ext=m4a][protocol=https]/bestaudio[ext=webm][protocol=https]/bestaudio[protocol=https]/best[ext=mp4][protocol=https]'

def extract_stream_source(id):
    options = {'format': STREAM_FORMAT, 'quiet': True, 'no_warnings': True, 'noplaylist': True}
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(id, download=False)
    if not info.get('url'):
        raise ValueError('Stream URL not found')
    source = {'url': info['url'], 'headers': info.get('http_headers', {}), 'ext': info.get('ext')}
    stream_url_cache[id] = source
    return source

# НОВОЕ: Получение прямой ссылки на аудиопоток (Стриминг)
@app.get("/stream")
async def get_stream_url(id: str, mode: str = "stream"):
    try:
        # Если режим скачивания (ищем локальный файл)
        filename = f"{id}.mp3"
        local_path = os.path.join(DOWNLOAD_DIR, filename)
        
        if mode == "download" and os.path.exists(local_path):
            return {"url": f"http://127.0.0.1:8000/local_files/{filename}"}

        await asyncio.to_thread(extract_stream_source, id)

        # Если выбран режим загрузки, но файла нет - скачиваем в фоне
        if mode == "download":
            def bg_download():
                d_opts = {
                    'format': 'bestaudio/best',
                    'outtmpl': f'{DOWNLOAD_DIR}/%(id)s.%(ext)s',
                    'postprocessors': [{
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '192',
                    }],
                    'quiet': True,
                    'no_warnings': True
                }
                try:
                    with yt_dlp.YoutubeDL(d_opts) as d_ydl:
                        d_ydl.extract_info(id, download=True)
                except Exception as e:
                    print(f"BG Download error: {e}")
            
            threading.Thread(target=bg_download, daemon=True).start()

        # Вместо прямой ссылки возвращаем ссылку на наш локальный прокси
        return {"url": f"http://127.0.0.1:8000/proxy_stream?id={id}"}

    except Exception as e:
        print(f"Stream error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/proxy_stream")
async def proxy_stream(id: str, request: Request, retry: str = None):
    stream_url = stream_url_cache.get(id)
    
    async def get_fresh_url():
        return await asyncio.to_thread(extract_stream_source, id)

    if not stream_url or retry:
        try:
            stream_url = await get_fresh_url()
        except Exception as e:
            raise HTTPException(status_code=404, detail="Stream not found")

    headers = dict(stream_url.get('headers', {}))
    range_header = request.headers.get("Range")
    if range_header:
        headers["Range"] = range_header

    session = aiohttp.ClientSession()
    try:
        # Не закрываем сессию до завершения стриминга
        resp = await session.get(stream_url['url'], headers=headers)
        
        # Если ссылка протухла (обычно дает 403 или 410), получаем новую и пробуем еще раз
        if resp.status >= 400:
            resp.close()
            stream_url = await get_fresh_url()
            headers = dict(stream_url.get('headers', {}))
            if range_header:
                headers['Range'] = range_header
            resp = await session.get(stream_url['url'], headers=headers)
            if resp.status >= 400:
                 resp.close()
                 await session.close()
                 raise HTTPException(status_code=500, detail="Upstream returned error")
            
        content_type = resp.headers.get('Content-Type', '')
        if any(marker in content_type for marker in ('text/', 'json', 'mpegurl')):
            resp.close()
            raise HTTPException(status_code=502, detail='Upstream did not return a playable audio file')
    except Exception as e:
        await session.close()
        raise HTTPException(status_code=500, detail="Cannot connect to stream")

    async def generate():
        try:
            async for chunk in resp.content.iter_chunked(8192):
                yield chunk
        finally:
            resp.close()
            await session.close()

    response_headers = {}
    for k, v in resp.headers.items():
        if k.lower() in ("content-type", "content-length", "content-range", "accept-ranges"):
            response_headers[k] = v

    if not content_type or 'application/octet-stream' in content_type:
        content_type = {'m4a': 'audio/mp4', 'mp4': 'audio/mp4', 'webm': 'audio/webm', 'opus': 'audio/ogg'}.get(stream_url.get('ext'), 'audio/mpeg')
        response_headers['Content-Type'] = content_type

    return StreamingResponse(
        content=generate(),
        status_code=resp.status,
        headers=response_headers,
        media_type=content_type
    )

@app.get("/local_files/{filename}")
async def serve_local_file(filename: str):
    path = os.path.join(DOWNLOAD_DIR, filename)
    if os.path.exists(path) and ".." not in filename:
        return FileResponse(path)
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/api/info")
async def get_system_info():
    install_dir = os.path.dirname(os.path.abspath(sys.executable)) if getattr(sys, 'frozen', False) else os.path.abspath('.')
    return {
        "version": "Release 1.0",
        "install_dir": install_dir,
        "download_dir": os.path.abspath(DOWNLOAD_DIR)
    }

class DownloadDirReq(BaseModel):
    path: str

@app.post("/api/settings/download_dir")
async def set_download_dir(req: DownloadDirReq):
    global DOWNLOAD_DIR, config
    new_dir = req.path
    os.makedirs(new_dir, exist_ok=True)
    DOWNLOAD_DIR = new_dir
    config["download_dir"] = new_dir
    save_config(config)
    return {"status": "success", "download_dir": new_dir}

@app.get("/api/settings/downloads")
async def get_downloads_list():
    try:
        files = []
        total_size = 0
        if os.path.exists(DOWNLOAD_DIR):
            for f in os.listdir(DOWNLOAD_DIR):
                path = os.path.join(DOWNLOAD_DIR, f)
                if os.path.isfile(path):
                    size = os.path.getsize(path)
                    files.append({"name": f, "size": size})
                    total_size += size
        return {"files": files, "total_size_bytes": total_size, "dir": os.path.abspath(DOWNLOAD_DIR)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/settings/downloads/{filename}")
async def delete_download(filename: str):
    path = os.path.join(DOWNLOAD_DIR, filename)
    if os.path.exists(path) and ".." not in filename.replace('\\', '/'):
        os.remove(path)
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="File not found")

@app.delete("/api/settings/downloads_all")
async def delete_all_downloads():
    if os.path.exists(DOWNLOAD_DIR):
        for f in os.listdir(DOWNLOAD_DIR):
            path = os.path.join(DOWNLOAD_DIR, f)
            if os.path.isfile(path) and f.endswith('.mp3'):
                os.remove(path)
    return {"status": "success"}

def sanitize_filename(name: str) -> str:
    if not name:
        return ""
    cleaned = re.sub(r'[\\/*?:"<>|]', '', name)
    return cleaned.strip()

@app.get("/download")
async def download_audio(id: str = None, url: str = None, title: str = "Track", artist: str = "Artist"):
    try:
        safe_title = sanitize_filename(title) or "Track"
        safe_artist = sanitize_filename(artist) or "Artist"
        
        target_name = f"{safe_title} - {safe_artist}"
        filename = f"{target_name}.mp3"
        target_path = os.path.join(DOWNLOAD_DIR, filename)

        from urllib.parse import quote
        if os.path.exists(target_path):
            return {
                "status": "success",
                "title": title,
                "artist": artist,
                "filename": filename,
                "download_url": f"http://127.0.0.1:8000/local_files/{quote(filename)}"
            }

        target_url = url
        if not target_url and id:
            target_url = f"https://www.youtube.com/watch?v={id}"
            
        if not target_url:
            raise HTTPException(status_code=400, detail="Missing id or url parameter")

        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(DOWNLOAD_DIR, f'{target_name}.%(ext)s'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'quiet': False,
            'no_warnings': True
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(target_url, download=True)
            return {
                "status": "success",
                "title": title,
                "artist": artist,
                "filename": filename,
                "download_url": f"http://127.0.0.1:8000/local_files/{quote(filename)}"
            }
            
    except Exception as e:
        print(f"Download error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Подключение фронтенда из папки dist (для PyInstaller)
is_frozen = getattr(sys, 'frozen', False)

if is_frozen:
    base_dir = sys._MEIPASS
    dist_dir = os.path.join(base_dir, "dist")
    assets_dir = os.path.join(dist_dir, "assets")
    
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    NO_CACHE_HEADERS = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    }

    @app.get("/")
    async def serve_index():
        index_path = os.path.join(dist_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path, headers=NO_CACHE_HEADERS)
        return {"detail": "Not Found", "message": f"Index file not found at {index_path}"}

    @app.get("/{catchall:path}")
    async def serve_spa(catchall: str):
        index_path = os.path.join(dist_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path, headers=NO_CACHE_HEADERS)
        return {"detail": "Not Found"}

else:
    # В режиме разработки FastAPI просто работает как API, а фронтенд крутится на Vite
    @app.get("/")
    async def process_dev():
        return {"message": "Server is running in dev mode. Go to http://localhost:5173"}

if __name__ == "__main__":
    try:
        import uvicorn
        
        def open_app_window():
            time.sleep(1.5)
            if is_frozen:
                url = "http://127.0.0.1:8000"
            else:
                url = "http://localhost:5173"
                
            try:
                if os.name == 'nt':
                    cache_dir = os.path.join(os.path.dirname(sys.executable) if is_frozen else os.getcwd(), "browser_cache")
                    os.makedirs(cache_dir, exist_ok=True)

                    edge_paths = [
                        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                    ]
                    chrome_paths = [
                        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                    ]

                    launched = False
                    for browser_path in edge_paths + chrome_paths:
                        if os.path.exists(browser_path):
                            # Ensure browser cache is outside of Vite's root, or we use a temp dir.
                            # Changing to %temp% so Vite doesn't rebuild on browser actions.
                            import tempfile
                            safe_cache_dir = os.path.join(tempfile.gettempdir(), "Tesify_Browser_Cache")
                            os.makedirs(safe_cache_dir, exist_ok=True)
                            
                            subprocess.Popen([
                                browser_path,
                                f'--app={url}',
                                '--disable-cache',
                                '--disk-cache-size=1',
                                f'--user-data-dir={safe_cache_dir}',
                            ])
                            launched = True
                            break

                    if not launched:
                        import webbrowser
                        webbrowser.open(url)
            except Exception as e:
                print(f"Не удалось открыть окно приложения: {e}")

        def start_vite():
            if not is_frozen:
                print("Запуск Vite сервера разработки...")
                try:
                    # Запускаем npm run dev в фоне
                    startupinfo = None
                    if os.name == 'nt':
                        startupinfo = subprocess.STARTUPINFO()
                        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                    subprocess.Popen(['npm', 'run', 'dev'], shell=True, startupinfo=startupinfo)
                except Exception as e:
                    print(f"Ошибка при запуске Vite: {e}")

        print("Запуск...")
        if not is_frozen:
            start_vite()
            
        if is_frozen:
            threading.Thread(target=open_app_window, daemon=True).start()
            
        while True:
            try:
                print("Запуск FastAPI/Uvicorn...")
                uvicorn.run(app, host="0.0.0.0", port=8000)
                print("Сервер остановлен, перезапуск через 5 секунд...")
                time.sleep(5)
            except Exception as e:
                print(f"Критическая ошибка Uvicorn: {e}")
                traceback.print_exc()
                print("Перезапуск сервера через 5 секунд...")
                time.sleep(5)
                
    except Exception as e:
        print(f"Критическая ошибка: {e}")
        traceback.print_exc()
        if getattr(sys, 'frozen', False):
            sys.stdout.flush()
            sys.stderr.flush()
