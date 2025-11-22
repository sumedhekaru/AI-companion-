"""
AI Companion - Configuration
Frontend thresholds and settings
"""

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Speech Recognition Settings
SILENCE_TIMEOUT_MS = 3000  # 3 seconds of silence before sending to AI
SPEECH_RECOGNITION_LANG = "en-US"  # Language for speech recognition

# UI Settings
MAX_MESSAGE_LENGTH = 1000  # Maximum characters per message
ANIMATION_SPEED_MS = 200  # Animation speed for UI transitions

# Debug Settings
ENABLE_CONSOLE_LOGS = True  # Enable/disable console logging
ENABLE_DEBUG_BUBBLE_LOGS = False  # Enable detailed bubble creation logs

# LLM Settings
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")  # Load from .env file
LLM_MODEL = "gpt-3.5-turbo"  # OpenAI model to use
LLM_MAX_TOKENS = 500  # Maximum tokens in response
LLM_TEMPERATURE = 0.7  # Creativity level (0.0-1.0)

# TTS Settings
class TTSConfig:
    """Configuration for Kokoro TTS engine."""
    
    # Voice settings
    voice = "af_heart"  # Kokoro voice identifier (af_heart, af_sky, etc.)
    speed = 1.0  # Speech speed multiplier
    
    # Streaming optimization settings
    fast_sentence_fragment = True  # Enable streaming for faster response
    minimum_sentence_length = 5    # Start synthesis early
    minimum_first_fragment_length = 2  # Start with very short fragments
    comma_silence_duration = 0.1   # Reduced silence for faster flow
    sentence_silence_duration = 0.2  # Reduced sentence pauses
    default_silence_duration = 0.1   # Reduced default silence
    force_first_fragment_after_words = 3  # Force early synthesis

# Global TTS config instance
tts_config = TTSConfig()
