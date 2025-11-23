"""
AI Companion - Configuration
Frontend thresholds and settings
"""

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# LLM Settings
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")  # Load from .env file
LLM_MODEL = "gpt-3.5-turbo"  # OpenAI model to use
LLM_MAX_TOKENS = 500  # Maximum tokens in response
LLM_TEMPERATURE = 0.7  # Creativity level (0.0-1.0)
LLM_MAX_HISTORY_MESSAGES = 10  # Max non-system messages to keep in history

# Streaming / SSE Settings
SSE_POLL_INTERVAL_SECONDS = 0.1  # How often to poll for new SSE data
SSE_QUEUE_LOG_INTERVAL = 10      # How many loops between queue state logs

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
    
    # Audio boundary settings to prevent artifacts (currently unused in backend)
    # Placeholder attributes can be added here in the future if needed.

# Global TTS config instance
tts_config = TTSConfig()
