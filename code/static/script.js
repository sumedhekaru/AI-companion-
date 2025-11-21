// Frontend configuration (mirrors SpeechToTextConfig in Python)
const CONFIG = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  FRAME_SIZE: 1024, // Reduced from 4096 for faster processing
  RMS_THRESHOLD: 0, // Temporarily disable to debug
  
  // Silence detection for DONE signal
  SILENCE_THRESHOLD: 0.01,  // RMS threshold below which audio is considered "silent"
  SILENCE_TIMEOUT_MS: 5000, // Time in milliseconds of silence before sending DONE signal
  
  // Latency optimizations
  SPEECH_DEBOUNCE_MS: 50, // Reduced from 200ms for faster speech detection
  DONE_DELAY_MS: 500, // Delay before sending DONE to let Vosk process final word
  
  // TTS configuration
  TTS_VOICE: "af_heart", // Default Kokoro voice
  TTS_SPEED: 1.0, // Default speech speed
  TTS_ENABLED: true, // Enable/disable TTS
};

const statusEl = document.getElementById("status");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const messagesEl = document.getElementById("messages");
const recordingIndicator = document.getElementById("recordingIndicator");

let ws = null;
let mediaRecorder = null;
let mediaStream = null;
let currentUserMessage = "";
let isProcessing = false;
let processingMessageEl = null;

// Silence detection variables
let frontendSilenceTimer = null;
let lastAudioTime = null;
let isSpeechActive = false; // Track if we're currently in a speech session

// Pre-buffer for capturing first words
let preBuffer = [];
const PRE_BUFFER_SIZE = 10; // Keep last 10 chunks before speech detection

// TTS variables
let availableVoices = [];
let currentTTSVoice = CONFIG.TTS_VOICE;
let isTTSEnabled = CONFIG.TTS_ENABLED;

function updateStatus(text) {
  statusEl.textContent = text;
}

function addMessage(content, role, showProcessing = false) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  
  if (showProcessing) {
    div.innerHTML = content + '<span class="processing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
    isProcessing = true;
    processingMessageEl = div;
  } else {
    div.textContent = content;
  }
  
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function updateProcessingMessage(content) {
  if (processingMessageEl && isProcessing) {
    processingMessageEl.innerHTML = content + '<span class="processing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function finishProcessing(finalContent) {
  if (processingMessageEl && isProcessing) {
    processingMessageEl.innerHTML = finalContent;
    processingMessageEl.classList.remove('recording');
    isProcessing = false;
    processingMessageEl = null;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

// Frontend silence detection functions
function startFrontendSilenceTimer() {
  // Clear any existing timer
  if (frontendSilenceTimer) {
    clearTimeout(frontendSilenceTimer);
  }
  
  // Only set timer if we're in an active speech session
  if (isSpeechActive) {
    frontendSilenceTimer = setTimeout(() => {
      console.log("Silence detected - waiting before sending DONE");
      // Add delay to let Vosk process final word
      setTimeout(() => {
        console.log("Sending DONE after delay");
        sendDoneSignal();
      }, CONFIG.DONE_DELAY_MS);
    }, CONFIG.SILENCE_TIMEOUT_MS);
  }
}

function resetFrontendSilenceTimer() {
  if (frontendSilenceTimer) {
    clearTimeout(frontendSilenceTimer);
    frontendSilenceTimer = null;
  }
  lastAudioTime = Date.now();
  
  // Only restart timer if speech is active
  if (isSpeechActive) {
    startFrontendSilenceTimer();
  }
}

function stopFrontendSilenceTimer() {
  if (frontendSilenceTimer) {
    clearTimeout(frontendSilenceTimer);
    frontendSilenceTimer = null;
  }
}

function sendDoneSignal() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send("DONE");
    console.log("DONE sent");
    
    // End the current speech session
    endSpeechSession();
    
    // Trigger LLM response after a short delay to let backend process
    setTimeout(() => {
      if (currentUserMessage.trim()) {
        console.log("Triggering LLM response");
        finishProcessing(currentUserMessage);
        
        // Trigger LLM response
        setTimeout(() => {
          simulateLLMResponse();
        }, 500);
        
        // Reset state for next turn
        currentUserMessage = "";
        isProcessing = false;
        processingMessageEl = null;
      }
    }, 1500); // Wait 1.5 seconds for backend to process DONE
  }
}

function endSpeechSession() {
  isSpeechActive = false;
  stopFrontendSilenceTimer();
  console.log("Speech session ended");
}

// Load configuration from backend
async function loadConfig() {
  try {
    const response = await fetch('/config');
    const config = await response.json();
    
    // Update TTS configuration from backend
    CONFIG.TTS_VOICE = config.tts.voice;
    CONFIG.TTS_SPEED = config.tts.speed;
    CONFIG.TTS_ENABLED = config.tts.enabled;
    availableVoices = config.tts.available_voices;
    
    console.log('🔊 Loaded configuration from backend:', config);
    return config;
  } catch (error) {
    console.error('🔊 Failed to load configuration:', error);
    // Use defaults if config loading fails
    return null;
  }
}

// Load TTS voices from backend
async function loadTTSVoices() {
  try {
    const response = await fetch('/tts/voices');
    const data = await response.json();
    
    availableVoices = data.voices || [];
    console.log(`🔊 Loaded ${availableVoices.length} TTS voices`);
    return availableVoices;
  } catch (error) {
    console.error('🔊 Failed to load TTS voices:', error);
    return [];
  }
}

// TTS functions
async function playTTSAudio(text) {
  if (!isTTSEnabled || !text || !text.trim()) {
    return;
  }

  try {
    updateStatus("Generating speech...");
    
    const response = await fetch('/tts/synthesize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text,
        voice: currentTTSVoice,
        speed: CONFIG.TTS_SPEED
      })
    });

    const data = await response.json();
    
    if (data.audio) {
      // Decode base64 audio and play
      const audioBytes = atob(data.audio);
      const audioArray = new Uint8Array(audioBytes.length);
      for (let i = 0; i < audioBytes.length; i++) {
        audioArray[i] = audioBytes.charCodeAt(i);
      }
      
      // Create audio context and play
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(audioArray.buffer);
      
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      
      source.onended = () => {
        updateStatus("Listening...");
      };
      
      source.start(0);
      updateStatus("Playing speech...");
      console.log('TTS audio playing');
    } else {
      console.error('TTS synthesis failed:', data.error);
      updateStatus("TTS failed");
    }
  } catch (error) {
    console.error('TTS playback error:', error);
    updateStatus("TTS error");
  }
}

function toggleTTS() {
  isTTSEnabled = !isTTSEnabled;
  console.log('TTS enabled:', isTTSEnabled);
  return isTTSEnabled;
}

function setTTSVoice(voiceId) {
  currentTTSVoice = voiceId;
  console.log('TTS voice changed to:', voiceId);
}

function simulateLLMResponse() {
  // Add "thinking" indicator
  const thinkingMsg = addMessage("", "assistant", true);
  thinkingMsg.classList.add('recording');
  
  // Simulate LLM processing delay
  setTimeout(() => {
    const responses = [
      "That's interesting! Tell me more about that.",
      "I understand. How does that make you feel?",
      "Thanks for sharing! What would you like to discuss next?",
      "That's a great point. Let me think about that...",
      "I appreciate you explaining that. Could you elaborate?",
      "Fascinating! What are your thoughts on this?",
      "I see. That gives me a better perspective.",
      "Thank you for that insight. What's on your mind?"
    ];
    
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    finishProcessing(randomResponse);
    
    // Play TTS audio for the response
    setTimeout(() => {
      playTTSAudio(randomResponse);
    }, 500); // Small delay before TTS
    
    // Return to monitoring mode after LLM response (no speech session active)
    setTimeout(() => {
      if (!isTTSEnabled) {
        updateStatus("Listening...");
      }
      // Don't restart silence timer here - wait for actual speech
    }, 500);
  }, 1500); // Simulate 1.5 second "thinking" time
}

async function startStreaming() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    updateStatus("Already streaming.");
    return;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error("Microphone permission denied", err);
    updateStatus("Microphone permission denied.");
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    updateStatus("Listening...");
    recordingIndicator.style.display = "inline";
    stopBtn.disabled = false;
    startBtn.disabled = true;

    // Reset current message state but keep conversation history
    currentUserMessage = "";
    isProcessing = false;
    processingMessageEl = null;

    // Start frontend silence detection (monitoring mode)
    resetFrontendSilenceTimer();

    // Create Web Audio context to capture raw PCM
    const audioContext = new AudioContext({ sampleRate: CONFIG.SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = audioContext.createScriptProcessor(CONFIG.FRAME_SIZE, CONFIG.CHANNELS, CONFIG.CHANNELS);

    processor.onaudioprocess = (event) => {
      if (ws?.readyState === WebSocket.OPEN) {
        const inputBuffer = event.inputBuffer.getChannelData(0);
        // Compute RMS to detect audio level
        let sum = 0;
        for (let i = 0; i < inputBuffer.length; i++) {
          sum += inputBuffer[i] * inputBuffer[i];
        }
        const rms = Math.sqrt(sum / inputBuffer.length);
        
        // Convert audio chunk to PCM for buffering
        const pcm = new Int16Array(inputBuffer.length);
        for (let i = 0; i < inputBuffer.length; i++) {
          pcm[i] = Math.max(-32768, Math.min(32767, inputBuffer[i] * 32768));
        }
        
        // Check for speech vs silence
        if (rms > CONFIG.SILENCE_THRESHOLD) {
          // Speech detected
          
          // If not already in speech session, start one (with debounce to prevent false triggers)
          if (!isSpeechActive) {
            // Require sustained speech to start a session (prevent false triggers)
            setTimeout(() => {
              if (!isSpeechActive && rms > CONFIG.SILENCE_THRESHOLD) {
                startSpeechSession(preBuffer);
              }
            }, CONFIG.SPEECH_DEBOUNCE_MS); // 50ms debounce for faster response
          } else {
            // Already in speech session - reset silence timer and send audio
            resetFrontendSilenceTimer();
            
            // Only send if audio level is above threshold
            if (rms > CONFIG.RMS_THRESHOLD) {
              ws.send(pcm.buffer);
            }
          }
        }
        
        // Always maintain pre-buffer (even in silence)
        if (rms > CONFIG.RMS_THRESHOLD) {
          preBuffer.push(pcm.buffer);
          if (preBuffer.length > PRE_BUFFER_SIZE) {
            preBuffer.shift(); // Remove oldest chunk
          }
        }
      }
    };

function startSpeechSession(buffer = []) {
  if (!isSpeechActive) {
    isSpeechActive = true;
    updateStatus("Transcribing...");
    addMessage("", "user", true);
    processingMessageEl = messagesEl.querySelector(".message.user:last-of-type");
    processingMessageEl.classList.add('recording');
    isProcessing = true;
    
    // Send pre-buffer first to capture first words
    buffer.forEach(chunk => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });
    
    resetFrontendSilenceTimer();
    console.log("Speech session started");
    
    // Clear pre-buffer after use
    preBuffer = [];
  }
}

    source.connect(processor);
    processor.connect(audioContext.destination);
    // Keep references to stop later
    window._audioCtx = audioContext;
    window._processor = processor;
    window._source = source;
  };

  ws.onmessage = (event) => {
    const msg = event.data;
    console.log("Server:", msg);
    
    // Handle control/status messages
    if (msg.match(/^(Received|Stopping|Transcribing|Transcription)/)) {
      return;
    }
    
    // Handle partial results for real-time feedback
    if (msg.startsWith("[PARTIAL]")) {
      const partialText = msg.replace("[PARTIAL] ", "").trim();
      if (partialText && isProcessing && processingMessageEl) {
        // Show partial text with different styling for real-time feedback
        processingMessageEl.innerHTML = partialText + '<span class="processing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
        processingMessageEl.classList.add('partial');
      }
      return;
    }
    
    // Handle final transcription results
    if (msg) {
      // Update the existing processing message
      currentUserMessage += (currentUserMessage ? " " : "") + msg;
      
      if (isProcessing && processingMessageEl) {
        // Update with final text (remove partial styling)
        processingMessageEl.classList.remove('partial');
        updateProcessingMessage(currentUserMessage);
      }
    }
  };

  ws.onerror = (event) => {
    console.error("WebSocket error", event);
    updateStatus("WebSocket error.");
  };

  ws.onclose = () => {
    updateStatus("Connection closed.");
    recordingIndicator.style.display = "none";
    stopFrontendSilenceTimer();
    // Finish any ongoing processing
    if (isProcessing && currentUserMessage) {
      finishProcessing(currentUserMessage);
    }
    cleanup();
  };
}

function cleanup() {
  if (window._processor) {
    window._processor.disconnect();
    window._processor = null;
  }
  if (window._source) {
    window._source.disconnect();
    window._source = null;
  }
  if (window._audioCtx) {
    window._audioCtx.close();
    window._audioCtx = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send("STOP");
    ws.close();
  }
  ws = null;

  startBtn.disabled = false;
  stopBtn.disabled = true;
}

startBtn.addEventListener("click", startStreaming);
stopBtn.addEventListener("click", () => {
  updateStatus("Stopping...");
  recordingIndicator.style.display = "none";
  stopFrontendSilenceTimer();
  
  // Finish any ongoing processing
  if (isProcessing && currentUserMessage) {
    finishProcessing(currentUserMessage);
    
    // If there's a user message, trigger LLM response immediately
    if (currentUserMessage.trim()) {
      setTimeout(() => {
        simulateLLMResponse();
      }, 500); // Small delay to show final transcription
    }
  }
  
  cleanup();
});

// Initialize TTS on page load
window.addEventListener('load', async () => {
  // Load configuration from backend first
  await loadConfig();
  await loadTTSVoices();
  setupTTSControls();
  console.log('TTS system initialized with configuration from backend');
});

function setupTTSControls() {
  const voiceSelect = document.getElementById('voiceSelect');
  const toggleTTSBtn = document.getElementById('toggleTTS');
  
  // Populate voice dropdown
  voiceSelect.innerHTML = '';
  availableVoices.forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.id;
    option.textContent = `${voice.name} (${voice.gender})`;
    if (voice.id === currentTTSVoice) {
      option.selected = true;
    }
    voiceSelect.appendChild(option);
  });
  
  // Voice selection handler
  voiceSelect.addEventListener('change', (e) => {
    setTTSVoice(e.target.value);
  });
  
  // TTS toggle handler
  toggleTTSBtn.addEventListener('click', () => {
    const enabled = toggleTTS();
    toggleTTSBtn.textContent = enabled ? '🔊 TTS ON' : '🔇 TTS OFF';
    toggleTTSBtn.style.background = enabled ? '#17a2b8' : '#6c757d';
  });
}
