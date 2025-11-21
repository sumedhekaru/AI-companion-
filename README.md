# AI Companion - Real-time Speech-to-Text

A fast, real-time speech-to-text application using Vosk for ultra-low latency transcription (~200ms response time).

## Features

- **Real-time streaming**: Text appears as you speak
- **Ultra-low latency**: ~200ms response time with Vosk
- **Local processing**: No internet required for STT
- **Web-based interface**: Simple HTML/JavaScript frontend
- **WebSocket streaming**: Efficient audio chunk processing
- **Silence detection**: Smart transcription triggering
- **Text-to-speech**: Multiple TTS engines supported

## Quick Start

### 1. Clone and Setup

```bash
git clone <repository-url>
cd AI-companion
```

### 2. Create Virtual Environment

```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Download Vosk Model (One-time setup)

```bash
mkdir -p code/models
cd code/models
curl -L -o vosk-model-small-en-us-0.15.zip https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip vosk-model-small-en-us-0.15.zip
rm vosk-model-small-en-us-0.15.zip
```

### 5. Run the Application

```bash
cd code
python main.py
```

### 6. Open Browser

Navigate to: http://localhost:8000

## Architecture

### Backend (FastAPI)
- **FastAPI**: Web framework with WebSocket support
- **Vosk**: Real-time speech recognition engine
- **WebSocket**: Low-latency audio streaming
- **AsyncIO**: Concurrent processing

### Frontend (HTML/JavaScript)
- **Web Audio API**: Microphone capture
- **WebSocket**: Real-time audio transmission
- **Simple UI**: Live transcription display

### Audio Pipeline

```
Microphone → Web Audio API → WebSocket Chunks → Vosk STT → Text Output
```

## Configuration

Edit `code/config.py` to adjust settings:

```python
@dataclass
class SpeechToTextConfig:
    # Silence detection (ms)
    silence_ms: int = 300
    
    # Maximum buffer time (ms)
    max_buffer_ms: int = 800
    
    # Minimum audio bytes for transcription
    min_buffer_bytes: int = 4000
    
    # Audio settings
    sample_rate: int = 16000
    channels: int = 1
```

## Performance

- **Latency**: ~200ms (Vosk) vs 4-13s (Whisper)
- **CPU Usage**: Low to moderate
- **Memory**: ~40MB for small Vosk model
- **Accuracy**: Good for English, slightly less than Whisper

## Model Options

### Vosk Models (Recommended for speed)
- `vosk-model-small-en-us-0.15` (40MB) - Fast, good accuracy
- `vosk-model-en-us-0.22` (1.8GB) - Better accuracy, slower
- Other language models available at [vosk models](https://alphacephei.com/vosk/models)

### Alternative STT (Slower)
- OpenAI Whisper API (cloud-based)
- Google Speech-to-Text (cloud-based)
- Faster-whisper (local, but slower than Vosk)

## Troubleshooting

### Port Already in Use
```bash
lsof -ti:8000 | xargs kill -9
```

### Vosk Model Not Found
- Ensure model is in `code/models/vosk-model-small-en-us-0.15/`
- Check directory permissions
- Download model again if corrupted

### No Audio Input
- Check browser microphone permissions
- Ensure microphone is working
- Try different browser (Chrome/Edge recommended)

### High Latency
- Reduce `max_buffer_ms` in config
- Check CPU usage
- Ensure no other processes using audio

## Development

### Project Structure
```
AI-companion/
├── code/
│   ├── main.py              # FastAPI server
│   ├── stt_vosk.py          # Vosk STT implementation
│   ├── config.py            # Configuration settings
│   ├── static/
│   │   ├── index.html       # Frontend UI
│   │   └── script.js        # WebSocket client
│   └── models/              # Vosk model directory
├── requirements.txt         # Python dependencies
├── .gitignore              # Git ignore rules
└── README.md               # This file
```

### Adding New Features
- **New STT engines**: Implement in separate file like `stt_new_engine.py`
- **TTS integration**: Use existing `realtimetts` package
- **LLM integration**: Use existing OpenAI/Ollama setup
- **UI improvements**: Modify `static/index.html` and `static/script.js`

## License

MIT License - feel free to use and modify.

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request
