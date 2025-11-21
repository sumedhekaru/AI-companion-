import asyncio
import logging
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from stt_vosk import VoskStreamingTranscriber
from config import SpeechToTextConfig

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


app = FastAPI(title="Minimal Audio Stream Demo")

RECORDINGS_DIR = Path(__file__).parent / "recordings"
RECORDINGS_DIR.mkdir(exist_ok=True)

# Mount static files directory
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def root() -> str:
    """Serve a tiny client that streams microphone audio over WebSocket."""

    return (Path(__file__).parent / "static" / "index.html").read_text()


@app.websocket("/ws")
async def audio_stream(ws: WebSocket):
    await ws.accept()
    transcriber = VoskStreamingTranscriber()
    bytes_received = 0
    result_task = asyncio.create_task(_queue_reader(ws, transcriber.result_queue))
    try:
        while True:
            # Wait for either a WebSocket message or a cancellation
            receive_task = asyncio.create_task(ws.receive())
            done, pending = await asyncio.wait(
                [receive_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            # Cancel any unfinished tasks
            for task in pending:
                task.cancel()
            # Process the received message
            message = await receive_task

            if message.get("type") == "websocket.disconnect":
                break

            text_data = message.get("text")
            if text_data is not None:
                if text_data.upper() == "STOP":
                    try:
                        await ws.send_text("Stopping stream.")
                    except RuntimeError:
                        pass
                    break
                elif text_data.upper() == "DONE":
                    # Frontend detected silence - flush final transcription
                    logger.info("🔊 DONE received - flushing transcription")
                    await transcriber.flush()
                    # Continue listening for more audio
                    continue
                else:
                    logger.info(f"🔊 Control message: {text_data}")
                continue

            chunk = message.get("bytes")
            if chunk:
                bytes_received += len(chunk)
                if bytes_received % (64 * 1024) < len(chunk):
                    try:
                        await ws.send_text(f"Received {bytes_received} bytes so far")
                    except RuntimeError:
                        pass
                await transcriber.add_chunk(chunk)
            else:
                logger.info("🔊 Received non-binary message; ignoring.")

    except WebSocketDisconnect:
        pass
    finally:
        # Flush any remaining buffered audio
        await transcriber.flush()
        # Stop the queue reader task
        result_task.cancel()
        try:
            await result_task
        except asyncio.CancelledError:
            pass


async def _queue_reader(ws: WebSocket, queue: asyncio.Queue[str]):
    """
    Continuously read transcription results from the queue and send them to the client.
    Also forwards end-of-message signals (silence/max buffer) so the frontend can trigger LLM.
    """
    while True:
        try:
            txt = await queue.get()
            logger.info(f"🔊 Transcript: {txt}")
            try:
                await ws.send_text(txt)
            except RuntimeError:
                break
        except asyncio.CancelledError:
            break


class UserMessage(BaseModel):
    text: str


def dummy_llm_reply(user_text: str) -> str:
    # Placeholder: return a simple echo for now
    return f"You said: {user_text}"


@app.post("/chat")
async def chat(msg: UserMessage):
    reply = dummy_llm_reply(msg.text)
    return {"reply": reply}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
