# Speech-to-Text configuration
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, List
import os

@dataclass
class SpeechToTextConfig:
    """Configuration for real-time speech-to-text streaming."""

    # Audio capture settings - optimized for 100ms latency
    sample_rate: int = 16000  # Hz; Vosk expects 16 kHz
    channels: int = 1  # Mono
    frame_size: int = 1024  # Reduced from 4096 for ~64ms chunks instead of ~256ms

    # Frontend audio level filter (RMS threshold)
    # Only send audio to backend if RMS > this value. Helps filter background noise.
    # Typical range: 0.005–0.02. Lower values capture quieter speech but may let in noise.
    frontend_rms_threshold: float = 0.1

    # Frontend silence detection for triggering DONE signal
    # RMS threshold below which audio is considered "silent"
    # Typical range: 0.005–0.02. We'll experiment to find optimal value.
    frontend_silence_threshold: float = 0.01
    
    # Time in milliseconds of silence before sending DONE signal
    # Typical range: 3000–7000ms. We'll experiment to find optimal timing.
    frontend_silence_timeout_ms: int = 5000

    # Temporary files directory
    recordings_dir: Path = Path(__file__).parent / "recordings"

    # Suppress OpenMP duplicate library warnings on macOS
    kmp_duplicate_lib_ok: bool = True

@dataclass 
class TextToSpeechConfig:
    """Configuration for text-to-speech synthesis."""
    
    # TTS Engine settings
    engine: str = "kokoro"
    voice: str = "af_heart"  # Default voice: Heart (American Female)
    speed: float = 1.0  # Normal speech speed
    enabled: bool = True  # TTS enabled by default
    
    # Natural speech settings (no artificial chunking)
    fast_sentence_fragment: bool = False  # Disable artificial fragmenting
    minimum_sentence_length: int = 20    # Wait for complete sentences
    minimum_first_fragment_length: int = 10  # Don't start with tiny fragments
    comma_silence_duration: float = 0.3    # Natural comma pauses
    sentence_silence_duration: float = 0.6 # Natural sentence pauses
    default_silence_duration: float = 0.3  # Natural pause duration
    force_first_fragment_after_words: int = 15  # Wait for substantial content
    
    # Available Kokoro voices
    available_voices: List[Dict[str, str]] = None
    
    def __post_init__(self):
        """Initialize available voices if not provided."""
        if self.available_voices is None:
            # Available Kokoro voice examples for reference
            # Executive/Professional: bm_george (British Male), am_michael (American Male)
            # Friendly/Approachable: af_heart (American Female), af_sarah (American Female)
            # Clear/Articulate: bf_emma (British Female), am_adam (American Male)
            self.available_voices = [
                {"id": "af_heart", "name": "American Female - Heart", "gender": "female", "language": "en-US"},
                {"id": "af_sarah", "name": "American Female - Sarah", "gender": "female", "language": "en-US"},
                {"id": "af_nicole", "name": "American Female - Nicole", "gender": "female", "language": "en-US"},
                {"id": "af_sky", "name": "American Female - Sky", "gender": "female", "language": "en-US"},
                {"id": "am_adam", "name": "American Male - Adam", "gender": "male", "language": "en-US"},
                {"id": "am_michael", "name": "American Male - Michael", "gender": "male", "language": "en-US"},
                {"id": "bf_emma", "name": "British Female - Emma", "gender": "female", "language": "en-GB"},
                {"id": "bf_isabella", "name": "British Female - Isabella", "gender": "female", "language": "en-GB"},
                {"id": "bm_george", "name": "British Male - George", "gender": "male", "language": "en-GB"},
                {"id": "bm_lewis", "name": "British Male - Lewis", "gender": "male", "language": "en-GB"},
            ]
        
        # Override with environment variables if set
        self.voice = os.getenv("TTS_VOICE", self.voice)
        self.speed = float(os.getenv("TTS_SPEED", self.speed))
        self.enabled = os.getenv("TTS_ENABLED", "true").lower() == "true"

@dataclass
class LLMConfig:
    """Configuration for Language Model settings."""
    
    provider: str = "openai"
    model: str = "gpt-4o"
    temperature: float = 0.7
    max_tokens: int = 1000
    
    def __post_init__(self):
        """Override with environment variables if set."""
        self.model = os.getenv("LLM_MODEL", self.model)
        self.temperature = float(os.getenv("LLM_TEMPERATURE", self.temperature))

@dataclass
class ServerConfig:
    """Configuration for server settings."""
    
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    
    def __post_init__(self):
        """Override with environment variables if set."""
        self.log_level = os.getenv("LOG_LEVEL", self.log_level)

# Global configuration instances
stt_config = SpeechToTextConfig()
tts_config = TextToSpeechConfig()
llm_config = LLMConfig()
server_config = ServerConfig()

def get_tts_config_dict() -> Dict[str, Any]:
    """Get TTS configuration as a dictionary."""
    return {
        "engine": tts_config.engine,
        "voice": tts_config.voice,
        "speed": tts_config.speed,
        "enabled": tts_config.enabled,
        "available_voices": tts_config.available_voices,
        "streaming": {
            "fast_sentence_fragment": tts_config.fast_sentence_fragment,
            "minimum_sentence_length": tts_config.minimum_sentence_length,
            "minimum_first_fragment_length": tts_config.minimum_first_fragment_length,
            "comma_silence_duration": tts_config.comma_silence_duration,
            "sentence_silence_duration": tts_config.sentence_silence_duration,
            "default_silence_duration": tts_config.default_silence_duration,
            "force_first_fragment_after_words": tts_config.force_first_fragment_after_words,
        }
    }

def get_stt_config_dict() -> Dict[str, Any]:
    """Get STT configuration as a dictionary."""
    return {
        "sample_rate": stt_config.sample_rate,
        "channels": stt_config.channels,
        "frame_size": stt_config.frame_size,
        "frontend_rms_threshold": stt_config.frontend_rms_threshold,
        "frontend_silence_threshold": stt_config.frontend_silence_threshold,
        "frontend_silence_timeout_ms": stt_config.frontend_silence_timeout_ms,
    }

def get_llm_config_dict() -> Dict[str, Any]:
    """Get LLM configuration as a dictionary."""
    return {
        "provider": llm_config.provider,
        "model": llm_config.model,
        "temperature": llm_config.temperature,
        "max_tokens": llm_config.max_tokens
    }
