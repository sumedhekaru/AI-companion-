# Speech-to-Text configuration
from dataclasses import dataclass
from pathlib import Path

@dataclass
class SpeechToTextConfig:
    """Configuration for real-time speech-to-text streaming."""

    # Whisper model
    # Options: "tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en", "large", "large-v2", "large-v3"
    # Smaller models are faster but less accurate. English-specific models (e.g., "base.en") only support English.
    whisper_model: str = "small"

    # Device to run Whisper on
    # "cuda" if available for GPU acceleration, otherwise "cpu"
    device: str = "cpu"

    # Silence detection: wait this many milliseconds of audio below the frontend RMS threshold before transcribing.
    # Lower values reduce latency but may split sentences. Typical range: 100–800 ms.
    silence_ms: int = 100

    # Maximum buffer time: transcribe after this many milliseconds even if silence is not detected.
    # Prevents very long transcription delays. Typical range: 2000–5000 ms.
    max_buffer_ms: int = 3000

    # Minimum audio bytes required to attempt transcription.
    # Helps avoid hallucinations on very short buffers. 8000 bytes ≈ 0.5 s at 16 kHz.
    min_buffer_bytes: int = 8000

    # Frontend audio level filter (RMS threshold).
    # Only send audio to backend if RMS > this value. Helps filter background noise.
    # Typical range: 0.005–0.02. Lower values capture quieter speech but may let in noise.
    frontend_rms_threshold: float = 0.01

    # Audio capture settings
    sample_rate: int = 16000  # Hz; Whisper expects 16 kHz
    channels: int = 1  # Mono
    frame_size: int = 4096  # Frames per Web Audio API callback

    # Temporary files directory
    recordings_dir: Path = Path(__file__).parent / "recordings"

    # Suppress OpenMP duplicate library warnings on macOS
    kmp_duplicate_lib_ok: bool = True
