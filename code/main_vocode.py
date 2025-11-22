import asyncio
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
import os
from dotenv import load_dotenv
from vocode.helpers import create_streaming_microphone_input_and_speaker_output
from vocode.logging import configure_pretty_logging
from vocode.streaming.agent.chat_gpt_agent import ChatGPTAgent
from vocode.streaming.models.agent import ChatGPTAgentConfig
from vocode.streaming.models.message import BaseMessage
from vocode.streaming.models.synthesizer import AzureSynthesizerConfig
from vocode.streaming.models.transcriber import DeepgramTranscriberConfig, PunctuationEndpointingConfig
from vocode.streaming.streaming_conversation import StreamingConversation
from vocode.streaming.synthesizer.azure_synthesizer import AzureSynthesizer
from vocode.streaming.transcriber.deepgram_transcriber import DeepgramTranscriber
import json

# Load environment variables
load_dotenv()

# Configure logging
configure_pretty_logging()
logger = logging.getLogger(__name__)

app = FastAPI()

# Configuration
class Settings:
    openai_api_key: str = os.getenv("OPENAI_API_KEY")
    azure_speech_key: str = os.getenv("AZURE_SPEECH_KEY")
    azure_speech_region: str = os.getenv("AZURE_SPEECH_REGION", "eastus")
    deepgram_api_key: str = os.getenv("DEEPGRAM_API_KEY")

settings = Settings()

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
    """Vocode-powered voice chat WebSocket."""
    await websocket.accept()
    logger.info("🔌 Vocode WebSocket connected")
    
    try:
        # Create Vocode streaming conversation
        microphone_input, speaker_output = create_streaming_microphone_input_and_speaker_output(
            use_default_devices=False,
        )
        
        conversation = StreamingConversation(
            output_device=speaker_output,
            transcriber=DeepgramTranscriber(
                DeepgramTranscriberConfig.from_input_device(
                    microphone_input,
                    endpointing_config=PunctuationEndpointingConfig(),
                    api_key=settings.deepgram_api_key,
                ),
            ),
            agent=ChatGPTAgent(
                ChatGPTAgentConfig(
                    openai_api_key=settings.openai_api_key,
                    initial_message=BaseMessage(text="Hello! I'm ready to help you."),
                    prompt_preamble="""You are a helpful AI assistant having a pleasant voice conversation. 
                    Be concise, friendly, and natural in your responses."""
                )
            ),
            synthesizer=AzureSynthesizer(
                AzureSynthesizerConfig.from_output_device(speaker_output),
                azure_speech_key=settings.azure_speech_key,
                azure_speech_region=settings.azure_speech_region,
            ),
        )
        
        await conversation.start()
        logger.info("🎤 Vocode conversation started")
        
        # Send initial message to client
        await websocket.send_json({
            "type": "status",
            "message": "Vocode conversation ready"
        })
        
        # Handle conversation
        while conversation.is_active():
            try:
                # Get audio from microphone
                chunk = await microphone_input.get_audio()
                conversation.receive_audio(chunk)
                
                # Send any text updates to client
                # (Vocode handles audio internally, but we can send status updates)
                await websocket.send_json({
                    "type": "heartbeat",
                    "active": True
                })
                
                await asyncio.sleep(0.1)  # Small delay to prevent overwhelming
                
            except Exception as e:
                logger.error(f"🎤 Audio processing error: {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": str(e)
                })
                break
                
    except WebSocketDisconnect:
        logger.info("🔌 WebSocket disconnected")
        if 'conversation' in locals():
            await conversation.terminate()
    except Exception as e:
        logger.error(f"🔌 WebSocket error: {e}")
        await websocket.send_json({
            "type": "error",
            "message": f"Setup error: {e}"
        })
        if 'conversation' in locals():
            await conversation.terminate()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
