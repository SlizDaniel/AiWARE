"""Karta 04 — seam STT→pipeline: fixtura audio → oczekiwana transkrypcja.

Błąd API STT (timeout/limit) → sygnał „STT niedostępny” (503), aplikacja żyje,
a pole tekstowe pozostaje drogą wprowadzenia komendy (fallback, brak śmierci sesji).
"""
import asyncio
import io
import json
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest
from fastapi.testclient import TestClient

from app import stt as stt_module
from app.main import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(db_path=tmp_path / "test.db")
    with TestClient(app) as c:
        yield c


def wav_fixture() -> bytes:
    """Minimalny poprawny WAV (1 s ciszy) — fixtura audio dla seamu STT."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 16000)
    return buf.getvalue()


class WhisperStub(BaseHTTPRequestHandler):
    """Lokalny odpowiednik API zgodnego z Whisper — pozwala testować realny klient."""
    payload = {"text": "wzięliśmy paletę kartonów"}
    delay_s = 0.0
    auth = ""

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        WhisperStub.auth = self.headers.get("Authorization", "")
        if self.delay_s:
            time.sleep(self.delay_s)
        body = json.dumps(self.payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture()
def whisper_stub():
    server = HTTPServer(("127.0.0.1", 0), WhisperStub)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def test_audio_fixture_transcribes_to_pipeline_text(client, monkeypatch):
    expected = "wzięliśmy paletę kartonów"
    monkeypatch.setattr(stt_module, "transcribe", lambda data, filename: expected)

    r = client.post(
        "/api/stt?filename=audio.wav",
        content=wav_fixture(),
        headers={"Content-Type": "audio/wav"},
    )
    assert r.status_code == 200
    assert r.json()["text"] == expected

    # transkrypcja od razu gra w istniejącym pipeline'ie tekstu (karta 01)
    pipeline = client.post("/api/command", json={"text": expected}).json()
    assert pipeline["type"] == "proposal"
    assert pipeline["proposal"]["tool"] == "update_stock"


def test_real_whisper_client_sends_multipart_and_parses_text(client, monkeypatch, whisper_stub):
    """Realna ścieżka klienta (multipart, language=pl, parsowanie) bez sieci zewnętrznej."""
    monkeypatch.setenv("STT_API_KEY", "test-key")
    monkeypatch.setenv("STT_BASE_URL", whisper_stub)

    r = client.post(
        "/api/stt?filename=audio.wav",
        content=wav_fixture(),
        headers={"Content-Type": "audio/wav"},
    )
    assert r.status_code == 200
    assert r.json()["text"] == "wzięliśmy paletę kartonów"
    assert "Bearer test-key" == WhisperStub.auth  # klucz poszedł w nagłówku


def test_empty_stt_base_url_falls_back_to_default(client, monkeypatch):
    # docker-compose przekazuje puste stringi — kod musi traktować je jak brak zmiennej
    monkeypatch.setenv("STT_API_KEY", "test-key")
    monkeypatch.setenv("STT_BASE_URL", "")
    monkeypatch.setenv("STT_MODEL", "")

    captured = {}

    class Response:
        status_code = 200

        def json(self):
            return {"text": "ile mamy?"}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["model"] = kwargs["data"]["model"]
        return Response()

    monkeypatch.setattr(stt_module.httpx, "post", fake_post)

    r = client.post(
        "/api/stt?filename=audio.wav",
        content=wav_fixture(),
        headers={"Content-Type": "audio/wav"},
    )
    assert r.status_code == 200
    assert captured["url"] == f"{stt_module.DEFAULT_BASE_URL}/audio/transcriptions"
    assert captured["model"] == stt_module.DEFAULT_MODEL


def test_stt_api_error_signals_unavailable_and_session_survives(client, monkeypatch):
    def timeout(data, filename):
        raise stt_module.STTUnavailable("API STT nie odpowiada (timeout/limit).")

    monkeypatch.setattr(stt_module, "transcribe", timeout)

    r = client.post(
        "/api/stt?filename=audio.wav",
        content=wav_fixture(),
        headers={"Content-Type": "audio/wav"},
    )
    assert r.status_code == 503
    assert "STT" in r.json()["detail"]

    # brak śmierci aplikacji: sesja żyje, pipeline tekstowy działa dalej
    assert client.get("/api/health").json()["status"] == "ok"
    answer = client.post("/api/command", json={"text": "ile mamy?"}).json()
    assert answer["type"] == "answer"


def test_stt_recovers_after_network_recovery(client, monkeypatch):
    """Karta 04: „po odzyskaniu sieci działa ponownie” — błąd, potem sukces."""
    calls = iter([
        stt_module.STTUnavailable("API STT nieosiągalne."),
        "wzięliśmy paletę kartonów",
    ])

    def flaky(data, filename):
        result = next(calls)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(stt_module, "transcribe", flaky)

    first = client.post(
        "/api/stt?filename=audio.webm",
        content=b"\x00\x00\x00\x00",
        headers={"Content-Type": "audio/webm"},
    )
    assert first.status_code == 503

    second = client.post(
        "/api/stt?filename=audio.webm",
        content=b"\x00\x00\x00\x00",
        headers={"Content-Type": "audio/webm"},
    )
    assert second.status_code == 200
    assert second.json()["text"] == "wzięliśmy paletę kartonów"


def test_stt_without_api_key_signals_unavailable(client, monkeypatch):
    # demo bez kluczy: realna ścieżka kodu (bez mocka) musi dać jawnie 503, nie crash
    monkeypatch.delenv("STT_API_KEY", raising=False)

    r = client.post(
        "/api/stt?filename=audio.webm",
        content=b"\x00\x00\x00\x00",
        headers={"Content-Type": "audio/webm"},
    )
    assert r.status_code == 503
    assert "STT" in r.json()["detail"]


def test_slow_stt_does_not_block_other_endpoints(client, monkeypatch, whisper_stub):
    """Synchroniczne wywołanie STT w handlerze async blokowałoby wspólny event loop
    (WS, /api/command, health) na czas oczekiwania — to musi iść w wątku.

    Dyskryminator: health ma skończyć się WYRAŹNIE przed STT. Gdy handler blokuje
    pętlę, health dobiega końca dopiero po STT (bo pętla stała w miejscu).
    """
    WhisperStub.delay_s = 2.0
    monkeypatch.setenv("STT_API_KEY", "test-key")
    monkeypatch.setenv("STT_BASE_URL", whisper_stub)

    async def scenario():
        transport = httpx.ASGITransport(app=client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            stt_task = asyncio.create_task(
                ac.post(
                    "/api/stt?filename=audio.wav",
                    content=wav_fixture(),
                    headers={"Content-Type": "audio/wav"},
                )
            )
            await asyncio.sleep(0.05)  # daj STT wejść w handler
            health_task = asyncio.create_task(ac.get("/api/health"))
            health = await health_task  # to poleci od razu tylko przy wolnej pętli
            health_done_at = time.monotonic()
            stt = await stt_task
            stt_done_at = time.monotonic()
            return stt.status_code, health.json()["status"], health_done_at, stt_done_at

    status, health_status, health_done_at, stt_done_at = asyncio.run(scenario())
    assert status == 200
    assert health_status == "ok"
    assert health_done_at < stt_done_at - 0.5  # blokujący handler: health kończy się PO STT
