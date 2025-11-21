"""
Text-to-Speech module using Kokoro for high-quality local TTS processing.

Provides natural-sounding, offline text-to-speech functionality using the Kokoro engine
from the realtime-tts library.
"""

import logging
import asyncio
import io
import time
import threading
from typing import Optional
from RealtimeTTS import TextToAudioStream, KokoroEngine
import numpy as np
from config import tts_config

logger = logging.getLogger(__name__)

class KokoroTTSProcessor:
    """
    High-quality local TTS processor using Kokoro engine.
    
    Features:
    - Natural, human-like voices
    - Offline processing (no internet required)
    - Fast synthesis for real-time applications
    - Streaming capabilities for low latency
    - Multiple voice options
    """
    
    def __init__(self):
        self.engine = None
        self.stream = None
        self.current_voice = tts_config.voice  # Use config default
        self.speed = tts_config.speed  # Use config default
        self.finished_event = threading.Event()
        self.audio_chunks = []
        self._init_engine()
    
    def _init_engine(self) -> None:
        """Initialize the Kokoro TTS engine."""
        try:
            # Initialize Kokoro engine first with normal speed
            self.engine = KokoroEngine(
                voice=self.current_voice,
                default_speed=self.speed,
                trim_silence=True,
                silence_threshold=0.01,
                extra_start_ms=25,
                extra_end_ms=15,
                fade_in_ms=15,
                fade_out_ms=10,
            )
            
            # Then initialize TextToAudioStream with the Kokoro engine
            self.stream = TextToAudioStream(
                self.engine,
                muted=True,  # Don't play audio directly
                on_audio_stream_stop=self._on_audio_stream_stop,
            )
            
            logger.info(f"🔊 Kokoro TTS engine initialized with voice: {self.current_voice}")
            
        except Exception as e:
            logger.error(f"🔊 Failed to initialize Kokoro TTS engine: {e}")
            self.engine = None
            self.stream = None
    
    def _on_audio_stream_stop(self) -> None:
        """Callback when audio stream stops."""
        self.finished_event.set()
    
    def get_available_voices(self) -> list:
        """Get list of available Kokoro voices from config."""
        return tts_config.available_voices
    
    def set_voice(self, voice_id: str) -> bool:
        """Set the TTS voice by ID."""
        try:
            # Reinitialize Kokoro engine with new voice
            self.engine = KokoroEngine(
                voice=voice_id,
                default_speed=self.speed,
                trim_silence=True,
                silence_threshold=0.01,
                extra_start_ms=25,
                extra_end_ms=15,
                fade_in_ms=15,
                fade_out_ms=10,
            )
            
            # Reinitialize TextToAudioStream with new engine
            self.stream = TextToAudioStream(
                self.engine,
                muted=True,
                on_audio_stream_stop=self._on_audio_stream_stop,
            )
            
            self.current_voice = voice_id
            logger.info(f"🔊 Voice changed to: {voice_id}")
            return True
        except Exception as e:
            logger.error(f"🔊 Failed to set voice {voice_id}: {e}")
            return False
    
    def set_speed(self, speed: float) -> bool:
        """Set speech speed. Typical range: 0.5-2.0."""
        try:
            # Reinitialize Kokoro engine with new speed
            self.engine = KokoroEngine(
                voice=self.current_voice,
                default_speed=speed,
                trim_silence=True,
                silence_threshold=0.01,
                extra_start_ms=25,
                extra_end_ms=15,
                fade_in_ms=15,
                fade_out_ms=10,
            )
            
            # Reinitialize TextToAudioStream with new engine
            self.stream = TextToAudioStream(
                self.engine,
                muted=True,
                on_audio_stream_stop=self._on_audio_stream_stop,
            )
            
            self.speed = speed
            logger.info(f"🔊 Speech speed set to {speed}")
            return True
        except Exception as e:
            logger.error(f"🔊 Failed to set speech speed {speed}: {e}")
            return False
    
    def synthesize_sync(self, text: str) -> Optional[bytes]:
        """
        Synthesize speech synchronously and return audio bytes.
        
        Args:
            text: Text to synthesize
            
        Returns:
            Audio bytes in WAV format or None if failed
        """
        if not self.stream:
            logger.error("🔊 TTS stream not initialized")
            return None
        
        if not text or not text.strip():
            logger.warning("🔊 Empty text provided for TTS")
            return None
        
        try:
            # Feed text to the stream
            self.stream.feed(text)
            logger.info(f"🔊 Fed text to stream: '{text[:50]}...'")
            
            # Create a temporary WAV file to capture the output
            import tempfile
            import os
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                temp_filename = temp_file.name
            
            # Use streaming mode for faster synthesis
            self.stream.play(
                log_synthesized_text=False,
                output_wavfile=temp_filename,
                fast_sentence_fragment=tts_config.fast_sentence_fragment,  # Enable streaming for faster response
                minimum_sentence_length=tts_config.minimum_sentence_length,     # Start synthesis early
                minimum_first_fragment_length=tts_config.minimum_first_fragment_length,  # Start with very short fragments
                comma_silence_duration=tts_config.comma_silence_duration,    # Reduced silence for faster flow
                sentence_silence_duration=tts_config.sentence_silence_duration, # Reduced sentence pauses
                default_silence_duration=tts_config.default_silence_duration,  # Reduced default silence
                force_first_fragment_after_words=tts_config.force_first_fragment_after_words,  # Force early synthesis
            )
            
            logger.info("🔊 Streaming synthesis completed")
            
            # Read the generated WAV file
            if os.path.exists(temp_filename):
                with open(temp_filename, 'rb') as f:
                    wav_bytes = f.read()
                
                # Clean up temp file
                os.unlink(temp_filename)
                
                logger.info(f"🔊 Kokoro TTS synthesis completed: {len(text)} chars -> {len(wav_bytes)} bytes")
                return wav_bytes
            else:
                logger.error("🔊 No output file generated")
                return None
                
        except Exception as e:
            logger.error(f"🔊 Kokoro TTS synthesis failed: {e}")
            return None
    
    async def synthesize_async(self, text: str) -> Optional[bytes]:
        """
        Synthesize speech asynchronously and return audio bytes.
        
        Args:
            text: Text to synthesize
            
        Returns:
            Audio bytes in WAV format or None if failed
        """
        import asyncio
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.synthesize_sync, text)
    
    def synthesize_stream(self, text: str):
        """
        Generator that yields audio chunks for streaming.
        
        Args:
            text: Text to synthesize
            
        Yields:
            Audio chunks as bytes
        """
        if not self.engine:
            logger.error("🔊 TTS engine not initialized")
            return
        
        if not text or not text.strip():
            logger.warning("🔊 Empty text provided for TTS")
            return
        
        try:
            self.engine.feed(text)
            
            for chunk in self.engine.stream():
                if chunk is not None:
                    # Convert float32 chunk to int16 bytes
                    chunk_int16 = (chunk * 32767).astype(np.int16)
                    yield chunk_int16.tobytes()
                    
        except Exception as e:
            logger.error(f"🔊 Kokoro TTS streaming failed: {e}")

# Global TTS processor instance
_tts_processor: Optional[KokoroTTSProcessor] = None

def get_tts_processor() -> KokoroTTSProcessor:
    """Get or create the global TTS processor instance."""
    global _tts_processor
    if _tts_processor is None:
        _tts_processor = KokoroTTSProcessor()
    return _tts_processor

async def synthesize_speech(text: str) -> Optional[bytes]:
    """
    Convenience function to synthesize speech asynchronously.
    
    Args:
        text: Text to synthesize
        
    Returns:
        Audio bytes in WAV format or None if failed
    """
    processor = get_tts_processor()
    return await processor.synthesize_async(text)

if __name__ == "__main__":
    # Test TTS functionality
    import sys
    
    logging.basicConfig(level=logging.INFO)
    
    processor = KokoroTTSProcessor()
    
    # List available voices
    voices = processor.get_available_voices()
    print("Available Kokoro voices:")
    for voice in voices:
        print(f"  {voice['id']}: {voice['name']} ({voice['gender']})")
    
    # Test synthesis
    test_text = "Hello! This is a test of the Kokoro text-to-speech system with natural sounding voices."
    
    async def test_synthesis():
        audio_bytes = await processor.synthesize_async(test_text)
        
        if audio_bytes:
            print(f"✅ Kokoro TTS synthesis successful: {len(audio_bytes)} bytes")
            
            # Save to file for testing
            with open("test_kokoro_output.wav", "wb") as f:
                f.write(audio_bytes)
            print("💾 Saved to test_kokoro_output.wav")
        else:
            print("❌ Kokoro TTS synthesis failed")
    
    # Run async test
    asyncio.run(test_synthesis())
