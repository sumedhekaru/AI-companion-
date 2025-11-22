import asyncio
import logging
from datetime import datetime
from pathlib import Path
import base64
import json
import logging
import base64
import asyncio
import uuid
from typing import Dict, Any, Optional
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, PlainTextResponse
from pydantic import BaseModel

from stt_vosk import VoskStreamingTranscriber
from tts import get_tts_processor
from config import get_tts_config_dict, get_stt_config_dict, get_llm_config_dict, get_server_config_dict
from llm import get_conversation_manager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Minimal Audio Stream Demo")

RECORDINGS_DIR = Path(__file__).parent / "recordings"
RECORDINGS_DIR.mkdir(exist_ok=True)

# Global variables for WebSocket connections
active_connections: Dict[str, WebSocket] = {}

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Pydantic models for API requests
class UserMessage(BaseModel):
    text: str

class TTSRequest(BaseModel):
    text: str
    voice: str = "af_heart"  # Default Kokoro voice
    speed: float = 1.0

class TTSVoiceResponse(BaseModel):
    voices: list

class ConfigResponse(BaseModel):
    tts: Dict[str, Any]
    stt: Dict[str, Any]
    llm: Dict[str, Any]

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


# TTS Endpoints
class TTSRequest(BaseModel):
    text: str


# LLM Endpoints
class LLMRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None


class LLMResponse(BaseModel):
    response: str
    conversation_id: str


@app.websocket("/ws/stream")
async def websocket_stream_tts(websocket: WebSocket):
    """WebSocket for streaming TTS audio in real-time."""
    await websocket.accept()
    logger.info("🎵 Streaming TTS WebSocket connected")
    
    try:
        while True:
            # Receive user message
            data = await websocket.receive_text()
            request = json.loads(data)
            user_message = request.get("message", "")
            
            if not user_message:
                continue
            
            logger.info(f"🎵 Received message for streaming: {user_message[:50]}...")
            
            # Get conversation manager and stream response
            conversation_manager = get_conversation_manager()
            
            async for sentence in conversation_manager.get_ai_response_stream(user_message):
                if sentence.strip():
                    logger.info(f"🎵 Streaming sentence: {sentence[:30]}...")
                    
                    # Synthesize sentence to audio
                    processor = get_tts_processor()
                    audio_bytes = await processor.synthesize_async(sentence)
                    
                    # Send audio chunk to frontend
                    audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                    await websocket.send_text(json.dumps({
                        "type": "audio",
                        "text": sentence,
                        "audio": audio_base64
                    }))
            
            # Send end signal
            await websocket.send_text(json.dumps({"type": "end"}))
            
    except WebSocketDisconnect:
        logger.info("🎵 Streaming TTS WebSocket disconnected")
    except Exception as e:
        logger.error(f"🎵 Streaming TTS error: {e}")
        await websocket.close()

@app.post("/llm/chat", response_model=LLMResponse)
async def chat_with_llm(request: LLMRequest):
    """Send message to LLM and get response."""
    try:
        conversation_manager = get_conversation_manager()
        
        # Get AI response
        ai_response = await conversation_manager.get_ai_response(request.message)
        
        logger.info(f"🤖 LLM response: {ai_response[:50]}...")
        
        return {
            "response": ai_response,
            "conversation_id": request.conversation_id or "default"
        }
        
    except Exception as e:
        logger.error(f"🤖 LLM chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/llm/clear")
async def clear_conversation():
    """Clear the conversation history."""
    try:
        conversation_manager = get_conversation_manager()
        conversation_manager.clear_conversation()
        logger.info("🤖 Conversation cleared")
        return {"success": True}
        
    except Exception as e:
        logger.error(f"🤖 Clear conversation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tts/synthesize")
async def synthesize_tts(request: TTSRequest):
    """Synthesize speech from text and return audio as base64."""
    try:
        processor = get_tts_processor()
        
        # Synthesize speech (voice is set by config)
        logger.info(f"🔊 Synthesizing TTS: {request.text[:50]}...")
        audio_bytes = await processor.synthesize_async(request.text)
        
        if audio_bytes:
            # Encode as base64 for JSON transport
            audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
            logger.info(f"🔊 TTS synthesis successful: {len(audio_bytes)} bytes")
            return {
                "audio": audio_b64,
                "format": "wav",
                "sample_rate": 24000,  # Correct Kokoro sample rate
                "channels": 1
            }
        else:
            logger.error("🔊 TTS synthesis returned empty audio")
            return {"error": "TTS synthesis failed"}
            
    except Exception as e:
        logger.error(f"🔊 TTS synthesis error: {e}")
        return {"error": str(e)}


# Configuration Endpoints
class ConfigResponse(BaseModel):
    tts: Dict[str, Any]
    stt: Dict[str, Any]
    llm: Dict[str, Any]


@app.get("/config", response_model=ConfigResponse)
async def get_config():
    """Get current configuration."""
    try:
        return {
            "tts": get_tts_config_dict(),
            "stt": get_stt_config_dict(),
            "llm": get_llm_config_dict()
        }
    except Exception as e:
        logger.error(f"🔊 Failed to get config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
