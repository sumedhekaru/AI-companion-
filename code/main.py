from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
import logging
import uuid
from typing import Dict, Any
import os
from dotenv import load_dotenv
from tts import synthesize_speech  # Your existing TTS function
from llm import stream_chat_response
from config import SSE_POLL_INTERVAL_SECONDS, SSE_QUEUE_LOG_INTERVAL
import base64

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Ensure submodule loggers (like llm.py) also log at INFO level
logging.getLogger("llm").setLevel(logging.INFO)

app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Serve favicon at root
@app.get("/favicon.ico")
async def favicon():
    return FileResponse("static/favicon.ico")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store streaming sessions
active_streams: Dict[str, Dict[str, Any]] = {}

# Global session ID tracker
current_session_id: str = None

def get_or_create_session(requested_id: str = None) -> str:
    """Get existing session or create new one."""
    global current_session_id
    
    if requested_id and current_session_id == requested_id:
        return current_session_id  # Reuse existing
    
    if not current_session_id:
        current_session_id = str(uuid.uuid4())  # Create new
    
    return current_session_id

# Global TTS processor instance
tts_processor = None

@app.on_event("startup")
async def startup_event():
    """Initialize TTS model on startup to avoid first-request delays."""
    global tts_processor
    try:
        logger.info("🎵 Preloading TTS model on startup...")
        from tts import KokoroTTSProcessor, set_tts_processor
        tts_processor = KokoroTTSProcessor()
        set_tts_processor(tts_processor)  # Set global instance for tts.py
        logger.info("✅ TTS model preloaded successfully!")
    except Exception as e:
        logger.error(f"❌ Failed to preload TTS model: {e}")
        tts_processor = None

@app.post("/chat")
async def chat_endpoint(request: dict):
    """Process chat message and return audio chunks."""
    
    global active_streams
    
    try:
        message = request.get("message", "")
        browser_session_id = request.get("session_id")
        session_id = get_or_create_session(browser_session_id)

        print("browser_session_id: ", browser_session_id)
        print("final session_id: ", session_id)
        tts_enabled = request.get("tts", True)
        
        logger.info(f"🎤 Received message: {message}")
            
        # Initialize session data before starting background task
        if session_id not in active_streams:
            active_streams[session_id] = {
                "message": message,
                "status": "initializing",
                "text": "",
                "audio_queue": [],
                "conversation_history": []
            }
        else:
            active_streams[session_id]["message"] = message
            active_streams[session_id]["status"] = "streaming"
            active_streams[session_id]["text"] = ""
            active_streams[session_id]["audio_queue"] = []
        
        # Start streaming LLM response in background
        asyncio.create_task(stream_llm_response(session_id, message))
        
        # Return immediately - streaming will handle TTS and text display
        if tts_enabled:
            return {
                "response": "Processing...",  # Placeholder, real response via SSE
                "tts": True,
                "audio_chunks": [],  # SSE will handle audio
                "session_id": session_id
            }
        else:
            return {
                "response": "Processing...",  # Placeholder, real response via SSE
                "tts": False,
                "audio_chunks": [],
                "session_id": session_id
            }
            
    except Exception as e:
        logger.error(f"❌ Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

async def stream_llm_response(session_id: str, message: str):
    """Stream LLM response via SSE and use FIFO queue for audio synthesis."""
    global active_streams
    try:
        logger.info(f" Starting SSE stream for session {session_id}")
        
        # Store session info with conversation history
        existing_history = active_streams.get(session_id, {}).get("conversation_history", [])
        
        active_streams[session_id] = {
            "message": message,
            "status": "streaming",
            "text": "",
            "audio_queue": [],
            "conversation_history": existing_history
        }
        
        # Create FIFO queue for this session
        text_queue = asyncio.Queue()
        
        # Start background TTS synthesis task
        synthesis_task = asyncio.create_task(process_text_queue_for_tts_sse(session_id, text_queue))
        
        # Stream LLM response using LLM module with memory
        accumulated_text = ""
        sentence_buffer = ""
        
        # Get conversation history from session
        conversation_history = active_streams[session_id]["conversation_history"]
        
        # Pass session_id through to the LLM layer for logging/DB usage
        async for content in stream_chat_response(message, conversation_history, session_id=session_id):
            accumulated_text += content
            sentence_buffer += content
            
            # Send text chunk via SSE
            active_streams[session_id]["text"] = accumulated_text
            
            logger.info(f"🧵 SSE chunk: '{content}'")
            
            # Check if we have a complete sentence (better boundary detection)
            # Only process if we have meaningful content and proper sentence ending
            if (content.endswith(('.', '!', '?')) and 
                len(sentence_buffer.strip()) > 10 and 
                not sentence_buffer.strip().endswith(('..', '...', '....'))):
                # Put sentence in FIFO queue (non-blocking)
                await text_queue.put(sentence_buffer.strip())
                logger.info(f"🧵 Put sentence in queue: '{sentence_buffer[:30]}...'")
                sentence_buffer = ""  # Reset for next sentence
            elif len(sentence_buffer) > 150:  # Longer buffer for better context
                # Put long fragment in queue
                await text_queue.put(sentence_buffer.strip())
                logger.info(f"🧵 Put long fragment in queue: '{sentence_buffer[:30]}...'")
                sentence_buffer = ""  # Reset for next sentence
        
        # Update conversation history with the complete exchange
        user_message = {"role": "user", "content": message}
        assistant_message = {"role": "assistant", "content": accumulated_text}
        
        # Add new messages to history
        active_streams[session_id]["conversation_history"].extend([user_message, assistant_message])
        
        logger.info(f"🧵 Updated conversation history: {len(active_streams[session_id]['conversation_history'])} messages")
        
        # Put any remaining text in queue
        if sentence_buffer.strip():
            await text_queue.put(sentence_buffer.strip())
            logger.info(f"🧵 Put final sentence in queue: '{sentence_buffer[:30]}...'")
        
        # Send sentinel to signal completion
        await text_queue.put(None)
        
        # Wait for synthesis to complete
        await synthesis_task
        
        # Mark as complete
        active_streams[session_id]["status"] = "complete"
        logger.info(f"🧵 SSE stream complete for session {session_id}")
        
    except Exception as e:
        logger.error(f"🧵 SSE stream error: {e}")
        # Only set error if session still exists (prevents KeyError)
        if session_id in active_streams:
            active_streams[session_id]["status"] = "error"
            active_streams[session_id]["error"] = str(e)

async def process_text_queue_for_tts_sse(session_id: str, text_queue: asyncio.Queue):
    """Process text from FIFO queue and send audio chunks via SSE."""
    global active_streams
    try:
        logger.info(f"🎵 Starting TTS synthesis for session {session_id}")
        
        all_sentences = []
        chunk_count = 0
        
        while True:
            text_chunk = await text_queue.get()
            
            if text_chunk is None:  # Sentinel value - LLM streaming complete
                logger.info(f"🎵 Text queue processing complete for {session_id}")
                break
                
            all_sentences.append(text_chunk)
            logger.info(f"🎵 Got text chunk: '{text_chunk[:30]}...'")
            
            # Sequential synthesis - process immediately as it arrives
            print(f"🎵 SYNTHESIZING: '{text_chunk}'")
            
            # Add delay to prevent TTS engine overload (configurable)
            from config import TTSConfig
            await asyncio.sleep(TTSConfig.default_silence_duration)
            
            # Synthesize audio chunk
            audio_bytes = await synthesize_speech(text_chunk)
            
            if audio_bytes:
                audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                chunk_count += 1
                
                # Append audio chunk to queue instead of overwriting
                active_streams[session_id]["audio_queue"].append(audio_base64)
                logger.info(f"🎵 ✅ Chunk {chunk_count} synthesized and queued: {len(audio_bytes)} bytes | Queue size: {len(active_streams[session_id]['audio_queue'])}")
                logger.info(f"🎵 TIMESTAMP: Chunk queued at {asyncio.get_event_loop().time()}")
            else:
                logger.warning(f"🎵 ❌ Chunk synthesis failed: '{text_chunk[:30]}...'")
        
        logger.info(f"🎵 Complete: {chunk_count} chunks from {len(all_sentences)} sentences")
        
    except Exception as e:
        logger.error(f"🎵 TTS synthesis error for {session_id}: {e}")
        # Only set error if session still exists (prevents KeyError)
        if session_id in active_streams:
            active_streams[session_id]["status"] = "error"
            active_streams[session_id]["error"] = str(e)

@app.get("/stream/{session_id}")
async def stream_endpoint(session_id: str):
    """SSE endpoint for real-time text streaming."""
    global active_streams
    async def event_stream():
        try:
            # Send initial connection event
            yield f"data: {json.dumps({'type': 'connected', 'session_id': session_id})}\n\n"
            logger.info(f"🧵 SSE STREAM STARTED for session {session_id}")
            
            # Initialize session data if not exists (silences warnings)
            if session_id not in active_streams:
                active_streams[session_id] = {
                    "message": "",
                    "status": "waiting",
                    "text": "",
                    "audio_queue": [],
                    "conversation_history": []
                }
                logger.info(f"🧵 Initialized session data for {session_id}")
            
            # Stream text updates
            last_text = ""
            loop_count = 0
            while True:
                loop_count += 1
                if session_id in active_streams:
                    stream_data = active_streams[session_id]
                    
                    # Log queue state every N loops (configurable)
                    if loop_count % SSE_QUEUE_LOG_INTERVAL == 0:
                        queue_size = len(stream_data.get("audio_queue", []))
                        logger.info(f"🧵 SSE LOOP {loop_count}: Queue size={queue_size}, Status={stream_data.get('status')}")
                    
                    # Send text updates
                    if "text" in stream_data and stream_data["text"] != last_text:
                        last_text = stream_data["text"]
                        yield f"data: {json.dumps({'type': 'text', 'content': last_text})}\n\n"
                    
                    # Send audio chunks from queue
                    if "audio_queue" in stream_data and stream_data["audio_queue"]:
                        # Get first chunk from queue
                        audio_chunk = stream_data["audio_queue"].pop(0)
                        logger.info(f"🧵 SSE sending audio chunk | Queue size before: {len(stream_data['audio_queue']) + 1}")
                        logger.info(f"🧵 TIMESTAMP: SSE sent chunk at {asyncio.get_event_loop().time()}")
                        yield f"data: {json.dumps({'type': 'audio', 'chunk': audio_chunk})}\n\n"
                        logger.info(f"🧵 SSE sent audio chunk, {len(stream_data['audio_queue'])} remaining")
                    
                    # Send completion event
                    if stream_data["status"] == "complete":
                        # Check if queue is empty before completing
                        queue_size = len(stream_data.get("audio_queue", []))
                        if queue_size == 0:
                            logger.info(f"🧵 SSE STREAM COMPLETE: Queue empty, status complete")
                            yield f"data: {json.dumps({'type': 'complete'})}\n\n"
                            break
                        else:
                            logger.info(f"🧵 SSE STREAM WAITING: Status complete but {queue_size} chunks remaining")
                    
                    # Send error event
                    if stream_data["status"] == "error":
                        yield f"data: {json.dumps({'type': 'error', 'message': stream_data.get('error', 'Unknown error')})}\n\n"
                        break
                else:
                    logger.warning(f"🧵 SSE LOOP {loop_count}: Session {session_id} not found in active_streams")
                    break
                
                await asyncio.sleep(SSE_POLL_INTERVAL_SECONDS)  # Small delay, configurable
                
        except Exception as e:
            logger.error(f"🧵 SSE error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            # Clean up streaming state, but preserve conversation history
            if session_id in active_streams:
                # Reset streaming fields but keep conversation history
                active_streams[session_id]["status"] = "completed"
                active_streams[session_id]["text"] = ""
                active_streams[session_id]["audio_queue"] = []
                # conversation_history is preserved
    
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }
    )

@app.get("/")
async def root():
    """Serve the chat interface."""
    try:
        html_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
        with open(html_path, "r") as f:
            from fastapi.responses import HTMLResponse
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        from fastapi.responses import HTMLResponse
        return HTMLResponse(content="<h1>Error: index.html not found</h1>", status_code=404)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
