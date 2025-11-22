import asyncio
import json
import logging
import time
from pathlib import Path

try:
    import vosk
except ImportError:
    print("Install vosk: pip install vosk")
    exit(1)

from config import SpeechToTextConfig

logger = logging.getLogger(__name__)

class VoskStreamingTranscriber:
    """
    Real-time speech-to-text using Vosk with WebSocket streaming.
    """
    
    def __init__(self, config: SpeechToTextConfig = None):
        """Initialize Vosk streaming transcriber."""
        self.config = config or SpeechToTextConfig()
        self.model_path = self.config.model_path
        self.model = None
        self.recognizer = None
        self.result_queue: asyncio.Queue[str] = asyncio.Queue()
        self._first_chunk_time = None
        self._init_model()
    
    def _init_model(self):
        """Initialize Vosk model and recognizer"""
        try:
            if not self.model_path.exists():
                logger.info(f"🔊 Downloading Vosk model {self.config.model_name} to {self.model_path}")
                self.model_path.parent.mkdir(exist_ok=True)
                # Download model - this is a placeholder
                # In practice, download from: https://alphacephei.com/vosk/models
                logger.error("Please download Vosk model manually")
                return
            
            self.model = vosk.Model(str(self.model_path))
            self.recognizer = vosk.KaldiRecognizer(self.model, 16000)
            logger.info(f"🔊 Vosk model loaded successfully: {self.config.model_name}")
        except Exception as e:
            logger.error(f"🔊 Failed to load Vosk model: {e}")
    
    async def add_chunk(self, chunk: bytes) -> None:
        """Process audio chunk immediately with partial results for speed"""
        if not self.recognizer:
            return
        
        if self._first_chunk_time is None:
            self._first_chunk_time = time.time()
            logger.info("🔊 First chunk received - starting Vosk latency timer")
        
        # Process chunk immediately and check for partial results
        if self.recognizer.AcceptWaveform(chunk):
            result = json.loads(self.recognizer.Result())
            text = result.get('text', '').strip()
            if text:
                latency = time.time() - self._first_chunk_time
                logger.info(f"🔊 Vosk latency: {latency:.2f}s")
                logger.info(f"🔊 Enqueue transcript: {text}")
                await self.result_queue.put(text)
                self._first_chunk_time = None  # Reset for next utterance
        else:
            # Send partial results for real-time feedback (speed optimization)
            partial = json.loads(self.recognizer.PartialResult())
            partial_text = partial.get('partial', '').strip()
            if partial_text and len(partial_text) > 2:  # Only send substantial partials
                await self.result_queue.put(f"[PARTIAL] {partial_text}")
    
    async def flush(self) -> None:
        """Get final result"""
        if not self.recognizer:
            return
        
        final_result = json.loads(self.recognizer.FinalResult())
        text = final_result.get('text', '').strip()
        if text:
            await self.result_queue.put(text)
        self._first_chunk_time = None
