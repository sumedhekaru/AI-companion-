import asyncio
import io
import logging
import os
import time
from pathlib import Path
from typing import AsyncGenerator, Optional

import torch
import numpy as np
import whisper
from pydub import AudioSegment

from config import SpeechToTextConfig

# Apply OpenMP setting from config
if SpeechToTextConfig.kmp_duplicate_lib_ok:
    os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

logger = logging.getLogger(__name__)

# Load Whisper model using config
MODEL = whisper.load_model(SpeechToTextConfig.whisper_model, device=SpeechToTextConfig.device)

# Ensure recordings directory exists
SpeechToTextConfig.recordings_dir.mkdir(exist_ok=True)


class StreamingTranscriber:
    """
    In‑memory streaming transcriber that buffers audio chunks and
    transcribes when silence is detected or on a fixed interval.
    Results are pushed to an asyncio queue for consumption.
    """
    def __init__(self, cfg: SpeechToTextConfig = None):
        self.cfg = cfg or SpeechToTextConfig()
        self.silence_ms = 800  # Wait longer for silence to allow buffer to grow
        self.max_buffer_ms = 2000  # Cap delay at 2 seconds
        self.min_buffer_bytes = 16000  # ~1 second at 16 kHz
        self.buffer = io.BytesIO()
        self.last_chunk_time = None
        self._transcription_task = None
        self.result_queue: asyncio.Queue[str] = asyncio.Queue()

    async def add_chunk(self, chunk: bytes) -> None:
        """
        Add an audio chunk; schedule transcription after silence or max buffer time.
        Results will be pushed to self.result_queue.
        """
        now = time.time()
        self.last_chunk_time = now
        self.buffer.write(chunk)
        logger.debug(f"🔊 Added chunk of {len(chunk)} bytes.")

        # Only schedule a new transcription task if one isn’t already running
        if self._transcription_task is None or self._transcription_task.done():
            logger.debug("🔊 Scheduling new transcription task.")
            self._transcription_task = asyncio.create_task(self._transcribe_after_silence_or_max_time())
        else:
            logger.debug("🔊 Transcription task already running; skipping.")

    async def flush(self) -> None:
        """
        Force transcription of whatever is buffered and clear it.
        Results will be pushed to self.result_queue.
        """
        if self._transcription_task and not self._transcription_task.done():
            self._transcription_task.cancel()
            self._transcription_task = None
        await self._transcribe_buffer()

    async def _transcribe_after_silence_or_max_time(self):
        """
        Wait for silence or max buffer time, then transcribe.
        """
        silence_deadline = self.silence_ms / 1000.0
        max_deadline = self.max_buffer_ms / 1000.0
        start_time = time.time()
        while True:
            await asyncio.sleep(0.1)
            elapsed = time.time() - start_time
            silence_elapsed = time.time() - (self.last_chunk_time or start_time)
            if silence_elapsed >= silence_deadline or elapsed >= max_deadline:
                if silence_elapsed >= silence_deadline:
                    logger.info("🔊 Silence detected; transcribing buffer.")
                else:
                    logger.info("🔊 Max buffer time reached; transcribing buffer.")
                await self._transcribe_buffer()
                break

    async def _transcribe_buffer(self):
        """
        Transcribe the current buffer (raw PCM) and clear it; push results to queue.
        """
        audio_bytes = self.buffer.getvalue()
        logger.info(f"🔊 Transcribing {len(audio_bytes)} bytes of PCM.")
        self.buffer.seek(0)
        self.buffer.truncate(0)
        if not audio_bytes or len(audio_bytes) < self.min_buffer_bytes:
            logger.warning(f"🔊 Skipping short audio ({len(audio_bytes)} bytes < {self.min_buffer_bytes}).")
            return
        # Write a proper WAV file from raw PCM (int16 LE, 16kHz mono)
        wav_path = self.cfg.recordings_dir / "temp_audio.wav"
        with wav_path.open("wb") as wav_f:
            wav_f.write(b"RIFF")
            wav_f.write((36 + len(audio_bytes)).to_bytes(4, "little"))
            wav_f.write(b"WAVE")
            wav_f.write(b"fmt ")
            wav_f.write((16).to_bytes(4, "little"))  # Subchunk1Size
            wav_f.write((1).to_bytes(2, "little"))   # AudioFormat (PCM)
            wav_f.write((1).to_bytes(2, "little"))   # NumChannels (mono)
            wav_f.write((16000).to_bytes(4, "little")) # SampleRate
            wav_f.write((32000).to_bytes(4, "little")) # ByteRate
            wav_f.write((2).to_bytes(2, "little"))   # BlockAlign
            wav_f.write((16).to_bytes(2, "little"))  # BitsPerSample
            wav_f.write(b"data")
            wav_f.write(len(audio_bytes).to_bytes(4, "little"))
            wav_f.write(audio_bytes)
        try:
            result = MODEL.transcribe(str(wav_path), language="en")
            for segment in result["segments"]:
                txt = segment["text"].strip()
                if txt:
                    logger.info(f"🔊 Enqueue transcript: {txt}")
                    await self.result_queue.put(txt)
        except Exception as e:
            logger.error(f"🔊 Transcription failed: {e}")
            await self.result_queue.put("[Transcription error]")
        finally:
            wav_path.unlink(missing_ok=True)
