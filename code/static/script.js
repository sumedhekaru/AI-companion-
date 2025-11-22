// Frontend configuration (mirrors SpeechToTextConfig in Python)
const CONFIG = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  FRAME_SIZE: 1024, // Reduced from 4096 for faster processing
  RMS_THRESHOLD: 0.02, // Will be updated from config
  
  // Silence detection for DONE signal
  SILENCE_THRESHOLD: 0.01,  // RMS threshold below which audio is considered "silent"
  SILENCE_TIMEOUT_MS: 3000, // Time in milliseconds of silence before sending DONE signal (will be updated from config)
  
  // Latency optimizations
  SPEECH_DEBOUNCE_MS: 50, // Reduced from 200ms for faster speech detection
  DONE_DELAY_MS: 500, // Delay before sending DONE to let Vosk process final word
  
  // TTS configuration
  TTS_VOICE: "af_heart", // Default Kokoro voice
  TTS_SPEED: 1.0, // Default speech speed
  TTS_ENABLED: true, // Enable/disable TTS
};

// Conversation management
let currentConversationId = null;
let conversations = [];

// DOM elements
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const messagesEl = document.getElementById("messages");
const recordingIndicator = document.getElementById("recordingIndicator");
const sidebarEl = document.getElementById("sidebar");
const sidebarToggleBtn = document.getElementById("sidebarToggle");
const toggleSidebarBtn = document.getElementById("toggleSidebar");
const newChatBtn = document.getElementById("newChat");
const conversationListEl = document.getElementById("conversationList");

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
let isTTSEnabled = CONFIG.TTS_ENABLED;

function updateStatus(text) {
  statusEl.textContent = text;
}

// Sidebar functions
function toggleSidebar() {
  sidebarEl.classList.toggle('collapsed');
}

function createNewConversation() {
  currentConversationId = generateConversationId();
  clearMessages();
  loadConversations();
}

function generateConversationId() {
  return 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function clearMessages() {
  messagesEl.innerHTML = '';
}

function loadConversations() {
  // TODO: Load from backend when conversation storage is implemented
  // For now, show placeholder
  conversationListEl.innerHTML = `
    <div class="conversation-item active">
      New Conversation
      <div class="conversation-date">Just now</div>
    </div>
  `;
}

function selectConversation(conversationId) {
  // Remove active class from all conversations
  document.querySelectorAll('.conversation-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Add active class to selected conversation
  const selectedItem = document.querySelector(`[data-conversation-id="${conversationId}"]`);
  if (selectedItem) {
    selectedItem.classList.add('active');
  }
  
  currentConversationId = conversationId;
  // TODO: Load conversation messages from backend
  clearMessages();
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
        finishProcessing(currentUserMessage);
        
        // Trigger LLM response
        setTimeout(() => {
          getStreamingAIResponse(currentUserMessage);
          
          // Reset state for next turn after triggering streaming
          currentUserMessage = "";
          isProcessing = false;
          processingMessageEl = null;
        }, 500);
        
        // Don't reset state yet - wait until after LLM response
        // currentUserMessage will be reset in getAIResponse after successful call
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
    
    // Update STT configuration from backend
    CONFIG.SILENCE_TIMEOUT_MS = config.stt.frontend_silence_timeout_ms;
    CONFIG.RMS_THRESHOLD = config.stt.frontend_rms_threshold;
    CONFIG.SILENCE_THRESHOLD = config.stt.frontend_silence_threshold;
    
    console.log('🔊 Loaded configuration from backend:', config);
    return config;
  } catch (error) {
    console.error('🔊 Failed to load configuration:', error);
    // Use defaults if config loading fails
    return null;
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
        // Voice is now set by backend config
      }),
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
  updateTTSButton();
  return isTTSEnabled;
}

function updateTTSButton() {
  const toggleTTSBtn = document.getElementById('toggleTTS');
  if (toggleTTSBtn) {
    toggleTTSBtn.textContent = isTTSEnabled ? '🔊 TTS ON' : '🔇 TTS OFF';
    toggleTTSBtn.style.background = isTTSEnabled ? '#17a2b8' : '#6c757d';
  }
}

async function getLLMResponse(userMessage) {
  try {
    updateStatus("Thinking...");
    
    const response = await fetch('/llm/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: userMessage,
        conversation_id: currentConversationId
      }),
    });

    const data = await response.json();
    
    if (data.response) {
      updateStatus("Ready");
      return data.response;
    } else {
      updateStatus("LLM error");
      return "I apologize, but I'm having trouble processing that right now.";
    }
  } catch (error) {
    console.error('LLM error:', error);
    updateStatus("LLM error");
    return "I apologize, but I'm having trouble connecting right now. Please try again.";
  }
}

// Audio streaming queue
let audioQueue = [];
let isPlayingAudio = false;
let currentAIMessage = null;

async function getStreamingAIResponse(userMessage) {
  try {
    updateStatus("Thinking...");
    
    // Connect to streaming WebSocket
    const ws = new WebSocket('ws://localhost:8000/ws/stream');
    
    ws.onopen = () => {
      console.log('🎵 Streaming TTS WebSocket connected');
      // Send user message
      ws.send(JSON.stringify({ message: userMessage }));
    };
    
    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'audio') {
        // Create or update AI message
        if (!currentAIMessage) {
          // First sentence - create new message
          currentAIMessage = addMessage(data.text, "assistant");
        } else {
          // Subsequent sentences - append to existing message
          currentAIMessage.textContent += data.text;
        }
        
        // Add audio to queue
        audioQueue.push(data.audio);
        
        // Start playing if not already playing
        if (!isPlayingAudio) {
          playAudioQueue();
        }
        
        updateStatus("Speaking...");
        
      } else if (data.type === 'end') {
        // Streaming complete - reset current message
        currentAIMessage = null;
        updateStatus("Ready");
        ws.close();
      }
    };
    
    ws.onerror = (error) => {
      console.error('🎵 Streaming WebSocket error:', error);
      updateStatus("Streaming error");
      currentAIMessage = null;
      ws.close();
    };
    
  } catch (error) {
    console.error('🎵 Streaming AI response error:', error);
    updateStatus("Streaming error");
    currentAIMessage = null;
  }
}

async function playAudioQueue() {
  if (audioQueue.length === 0) {
    isPlayingAudio = false;
    return;
  }
  
  isPlayingAudio = true;
  
  while (audioQueue.length > 0) {
    const audioBase64 = audioQueue.shift();
    await playAudioFromBase64(audioBase64);
  }
  
  isPlayingAudio = false;
}

async function playAudioFromBase64(audioBase64) {
  try {
    // Decode base64 to binary
    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Create audio blob and play
    const audioBlob = new Blob([bytes], { type: 'audio/wav' });
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    
    // Wait for audio to finish playing
    await new Promise((resolve) => {
      audio.onended = resolve;
      audio.play();
    });
    
    // Clean up
    URL.revokeObjectURL(audioUrl);
    
  } catch (error) {
    console.error('🎵 Audio playback error:', error);
  }
}

async function getAIResponse(userMessage) {
  // Add "thinking" indicator
  const thinkingMsg = addMessage("", "assistant", true);
  thinkingMsg.classList.add('recording');
  
  try {
    // Get real LLM response
    const aiResponse = await getLLMResponse(userMessage);
    
    // Update the thinking message with real response
    finishProcessing(aiResponse);
    
    // Reset state for next turn after successful LLM response
    currentUserMessage = "";
    isProcessing = false;
    processingMessageEl = null;
    
    // Play TTS if enabled
    if (isTTSEnabled) {
      await playTTSAudio(aiResponse);
    }
    
  } catch (error) {
    console.error('🤖 AI response error:', error);
    finishProcessing("I apologize, but I'm having trouble processing that right now. Please try again.");
  }
}

async function startStreaming() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    updateStatus("Already streaming.");
    return;
  }

  // Clear any lingering state to prevent message reuse
  currentUserMessage = "";
  isProcessing = false;
  processingMessageEl = null;
  currentAIMessage = null;

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
        getAIResponse(currentUserMessage);
      }, 500); // Small delay to show final transcription
    }
  }
  
  cleanup();
});

// Initialize app on page load
window.addEventListener('load', async () => {
  // Load configuration from backend first
  await loadConfig();
  setupSidebarControls();
  setupTTSControls();
  console.log('AI Companion initialized with sidebar and TTS');
});

function setupTTSControls() {
  const toggleTTSBtn = document.getElementById('toggleTTS');
  
  // Set initial TTS state from config
  isTTSEnabled = CONFIG.TTS_ENABLED;
  updateTTSButton();
  
  // Add click handler for TTS toggle
  toggleTTSBtn.addEventListener('click', toggleTTS);
  
  console.log('TTS controls initialized');
}

function setupSidebarControls() {
  // Add event listeners for sidebar
  sidebarToggleBtn.addEventListener('click', toggleSidebar);
  toggleSidebarBtn.addEventListener('click', toggleSidebar);
  newChatBtn.addEventListener('click', createNewConversation);
  
  // Initialize with a new conversation
  createNewConversation();
  
  console.log('Sidebar controls initialized');
}
