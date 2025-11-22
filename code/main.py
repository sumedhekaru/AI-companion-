from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
import asyncio
import logging
from realtimetts import TextToAudioStream
from realtimetts.engine import KokoroEngine
import openai
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize OpenAI
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    logger.error("OPENAI_API_KEY not found in environment variables")

app = FastAPI()

# Initialize RealtimeTTS with Kokoro
def get_tts_stream():
    """Get RealtimeTTS stream with Kokoro engine."""
    engine = KokoroEngine(
        voice="af_heart",
        speed=1.0,
        trim_silence=True,
        silence_threshold=0.01,
        extra_start_ms=25,
        extra_end_ms=50
    )
    
    stream = TextToAudioStream(
        engine,
        on_audio_stream_start=lambda: logger.info("🎵 Audio stream started"),
        on_audio_stream_stop=lambda: logger.info("🎵 Audio stream stopped"),
        on_audio_chunk=lambda chunk: logger.info(f"🎵 Audio chunk: {len(chunk)} bytes")
    )
    
    return stream

@app.get("/")
async def root():
    """Serve the chat interface."""
    try:
        html_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
        with open(html_path, "r") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(content="<h1>Error: index.html not found</h1>", status_code=404)

@app.websocket("/ws/chat")
async def websocket_endpoint(websocket: WebSocket):
    """Real-time chat with streaming text and audio using RealtimeTTS."""
    await websocket.accept()
    logger.info("🔌 WebSocket connected")
    
    try:
        # Get TTS stream
        tts_stream = get_tts_stream()
        
        while True:
            # Receive message from client
            data = await websocket.receive_json()
            message = data.get("message", "")
            
            if not message:
                continue
                
            logger.info(f"🎤 Received message: {message}")
            
            # Start TTS stream immediately
            tts_stream.feed(message)
            
            # Generate LLM response
            response = await generate_llm_response(message)
            logger.info(f"🤖 LLM response: {response}")
            
            # Send text immediately
            await websocket.send_json({
                "type": "text",
                "content": response
            })
            
            # Stream audio using RealtimeTTS
            await stream_audio_via_websocket(tts_stream, websocket, response)
            
    except WebSocketDisconnect:
        logger.info("🔌 WebSocket disconnected")
    except Exception as e:
        logger.error(f"🔌 WebSocket error: {e}")
        await websocket.send_json({
            "type": "error",
            "message": str(e)
        })

async def generate_llm_response(message: str) -> str:
    """Generate response from OpenAI."""
    try:
        client = openai.OpenAI(api_key=OPENAI_API_KEY)
        
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a helpful AI assistant. Be concise and friendly."},
                {"role": "user", "content": message}
            ],
            max_tokens=500,
            temperature=0.7
        )
        
        return response.choices[0].message.content
        
    except Exception as e:
        logger.error(f"❌ LLM error: {e}")
        return f"Error generating response: {e}"

async def stream_audio_via_websocket(tts_stream, websocket, text: str):
    """Stream audio using RealtimeTTS and send via WebSocket."""
    try:
        logger.info(f"🎵 Starting audio stream for: {text[:50]}...")
        
        # Start streaming
        tts_stream.feed(text)
        
        # Create generator for audio chunks
        async def audio_generator():
            for chunk in tts_stream.stream():
                yield chunk
        
        # Stream audio chunks
        chunk_count = 0
        for chunk in tts_stream.stream():
            chunk_count += 1
            logger.info(f"🎵 Sending audio chunk {chunk_count}: {len(chunk)} bytes")
            
            await websocket.send_json({
                "type": "audio",
                "chunk_index": chunk_count,
                "audio": chunk.hex()  # Send as hex string
            })
        
        # Send completion signal
        await websocket.send_json({
            "type": "audio_complete",
            "total_chunks": chunk_count
        })
        
        logger.info(f"🎵 Audio streaming complete: {chunk_count} chunks sent")
        
    except Exception as e:
        logger.error(f"🎵 Audio streaming error: {e}")
        await websocket.send_json({
            "type": "error",
            "message": f"Audio streaming error: {e}"
        })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
