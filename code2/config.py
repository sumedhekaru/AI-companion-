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
    fast_sentence_fragment = False  # Disable fragmentation - we use complete sentences
    minimum_sentence_length = 0     # Not used - we provide complete sentences
    minimum_first_fragment_length = 0  # Not used - we provide complete sentences
    comma_silence_duration = 0.3   # More natural pause at commas
    sentence_silence_duration = 0.5  # More natural pause at sentences
    default_silence_duration = 0.2   # Slightly longer default pause
    force_first_fragment_after_words = 0  # Not used - we provide complete sentences
    
    # Audio boundary settings to prevent artifacts
    add_silence_at_end = True  # Add silence to prevent abrupt endings
    end_silence_duration = 0.1  # 100ms silence at chunk end to prevent clicks

# Global TTS config instance
tts_config = TTSConfig()
