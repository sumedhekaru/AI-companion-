# Speech-to-Text configuration
from dataclasses import dataclass
from pathlib import Path

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
