# AI Companion - Real-time Voice Chat System

A modern real-time voice chat application with browser-based speech recognition, AI-powered conversations, and natural text-to-speech synthesis.

## Features

- **Browser-based STT**: Uses Web Speech API - no server-side models needed
- **Real-time streaming**: Server-Sent Events for instant text and audio delivery
- **AI conversations**: Powered by OpenAI GPT models
- **Natural TTS**: High-quality Kokoro voice synthesis
- **Modular architecture**: Clean separation of STT, TTS, and SSE modules
- **Zero model downloads**: Start chatting immediately
- **Cross-platform**: Works in any modern browser

## Quick Start

### 1. Clone and Setup

```bash
git clone <repository-url>
cd AI-companion
```

### 2. Automated Setup

```bash
chmod +x setup.sh
./setup.sh
```

### 3. Manual Setup (Alternative)

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate (or .\venv\Scripts\Activate.ps1)

# Install dependencies
pip install -r requirements.txt
```

### 4. Configure Environment

Create `.env` file in project root:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

### 5. Run the Application

```bash
cd code
python main.py
```

### 6. Open Browser

Navigate to: http://localhost:8001

## Architecture

### Backend (FastAPI)
- **FastAPI**: Modern web framework with SSE support
- **OpenAI**: GPT model for conversations
- **Kokoro TTS**: High-quality voice synthesis
- **Server-Sent Events**: Real-time streaming protocol

### Frontend (Modular JavaScript)
- **stt.js**: Speech recognition and user input handling
- **tts.js**: Audio playback and TTS control
- **script_sse.js**: SSE communication and UI management
- **Web Speech API**: Browser-based speech recognition

### Audio Pipeline

```
Microphone → Web Speech API → STT Module → OpenAI LLM → Kokoro TTS → Audio Output
```

## Project Structure

```
AI-companion/
├── code/
│   ├── main.py              # FastAPI server with SSE/LLM/TTS pipeline
│   ├── tts.py               # Kokoro TTS synthesis
│   ├── config.py            # Backend config: LLM, SSE, and TTS settings
│   ├── static/
│   │   ├── index.html       # Main UI
│   │   ├── stt.js           # Speech-to-Text module
│   │   ├── tts.js           # Text-to-Speech module
│   │   ├── script_sse.js    # SSE communication module
│   │   └── style.css        # UI styling
├── requirements.txt         # Minimal dependencies
├── setup.sh                # Automated setup script
└── README.md               # This file
```

## Configuration

### Backend Configuration (code/config.py)

The backend configuration lives in `code/config.py` and is imported by `main.py`, `llm.py`, and `tts.py`.

Key settings:

```python
# LLM Settings
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")  # from .env
LLM_MODEL = "gpt-3.5-turbo"
LLM_MAX_TOKENS = 500
LLM_TEMPERATURE = 0.7
LLM_MAX_HISTORY_MESSAGES = 10

# Streaming / SSE Settings
SSE_POLL_INTERVAL_SECONDS = 0.1
SSE_QUEUE_LOG_INTERVAL = 10

# TTS Settings
class TTSConfig:
    voice = "af_heart"
    speed = 1.0
    fast_sentence_fragment = False
    minimum_sentence_length = 0
    minimum_first_fragment_length = 0
    comma_silence_duration = 0.3
    sentence_silence_duration = 0.5
    default_silence_duration = 0.2
    force_first_fragment_after_words = 0

tts_config = TTSConfig()
```

You usually only need to edit:

- `OPENAI_API_KEY` in `.env`
- `LLM_MODEL`, `LLM_MAX_TOKENS`, `LLM_TEMPERATURE`, `LLM_MAX_HISTORY_MESSAGES`
- `TTSConfig.voice` / `TTSConfig.speed` and silence timings if you want different pacing.

### Frontend Configuration (static/config.js)

The browser-side behavior and thresholds are configured in `code/static/config.js`:

```javascript
// Frontend configuration for AI Companion
window.CONFIG = {
    ENABLE_CONSOLE_LOGS: true,
    SILENCE_TIMEOUT_MS: 3000,
    MAX_MESSAGE_LENGTH: 1000,
    STT_CONFIDENCE_THRESHOLD: 0.7,
    STT_RESTART_DELAY_MS: 100
};
```

This object is loaded before `stt.js` and `script_sse.js`, which read from `window.CONFIG` to control:

- Silence timeout before sending an utterance
- STT confidence threshold and restart delay
- Console logging verbosity

## Dependencies

### Essential Packages
- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `openai` - AI model integration
- `realtimetts[kokoro]` - TTS engine
- `python-dotenv` - Environment management
- `numpy` - Data processing

### Browser Requirements
- **Chrome** (recommended) - Full support on Windows/macOS/Linux
- **Edge** (recommended) - Full support on Windows/macOS/Linux  
- **Firefox** - Limited Web Speech API support on all platforms
- **Safari** - Limited Web Speech API support (macOS/iOS only)

**Note:** The system uses Web Speech API, which works across all operating systems with supported browsers. Chrome/Edge provide the best experience on Windows, macOS, and Linux.

## Performance

- **Latency**: ~500ms total (speech recognition + AI response + TTS)
- **CPU Usage**: Low (browser handles STT)
- **Memory**: ~50MB (no local STT models)
- **Setup Time**: ~30 seconds

## Troubleshooting

### Port Already in Use
```bash
lsof -ti:8001 | xargs kill -9
```

### OpenAI API Key Issues
- Ensure `.env` file exists with valid API key
- Check OpenAI account credits and API access
- Verify key permissions for chat completions

### Microphone Not Working
- Check browser microphone permissions
- Ensure HTTPS for production (HTTP required for localhost)
- Try Chrome/Edge for best Web Speech API support

### TTS Not Playing
- Check browser audio permissions
- Ensure TTS toggle is enabled in UI
- Verify Kokoro model downloaded automatically

### SSE Connection Issues
- Check browser console for connection errors
- Verify server is running on correct port
- Check firewall settings

## Development

### Adding New Features

#### New TTS Voices
```python
# In tts.py, modify voice_name in config.py
voice_name: str = "af_bella"  # Available: af_sky, af_bella, af_sarah
```

#### Custom LLM Integration
```python
# In main.py, modify the chat completion call
response = await openai.ChatCompletion.create(
    model="gpt-4",  # or other models
    messages=[...],
    # Custom parameters
)
```

#### UI Customization
- Modify `static/style.css` for visual changes
- Update `static/index.html` for layout changes
- Extend JavaScript modules for new interactions

### Testing

```bash
# Run with debug logging
python main.py --log-level DEBUG

# Test individual components
python -c "from tts import synthesize_speech; print('TTS OK')"
python -c "import openai; print('OpenAI OK')"
```

## Browser Compatibility

| Feature | Chrome | Edge | Firefox | Safari |
|---------|--------|------|---------|--------|
| Speech Recognition | ✅ | ✅ | ⚠️ | ⚠️ |
| Audio Playback | ✅ | ✅ | ✅ | ✅ |
| SSE Streaming | ✅ | ✅ | ✅ | ✅ |

## Security Notes

- **Environment variables**: Never commit `.env` files
- **API keys**: Keep OpenAI keys secure
- **HTTPS required**: For production deployment
- **CORS settings**: Configure for your domain

## Deployment

### Docker (Recommended)
```dockerfile
FROM python:3.11
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
```

### Environment Variables
```env
OPENAI_API_KEY=your_key
HOST=0.0.0.0
PORT=8001
```

## License

MIT License - feel free to use and modify.

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

## Support

- Create GitHub issues for bugs
- Check browser console for errors
- Review server logs for backend issues
- Ensure all dependencies are installed correctly
