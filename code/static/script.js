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
let silenceTimer = null;

// Silence detection variables
let frontendSilenceTimer = null;
let lastAudioTime = null;
let isSpeechActive = false; // Track if we're currently in a speech session

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
    
    // Start silence timer after finishing processing
    startSilenceTimer();
  }
}

function startSilenceTimer() {
  // Clear any existing timer
  if (silenceTimer) {
    clearTimeout(silenceTimer);
  }
  
  // Set timer for 5 seconds of silence
  silenceTimer = setTimeout(() => {
    if (currentUserMessage.trim()) {
      simulateLLMResponse();
    }
  }, 5000);
}

function resetSilenceTimer() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
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
      console.log("Silence detected - sending DONE");
      sendDoneSignal();
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
    
    // Return to monitoring mode after LLM response (no speech session active)
    setTimeout(() => {
      updateStatus("Listening...");
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
    resetSilenceTimer();

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
        
        // Check for speech vs silence
        if (rms > CONFIG.SILENCE_THRESHOLD) {
          // Speech detected
          
          // If not already in speech session, start one (with debounce to prevent false triggers)
          if (!isSpeechActive) {
            // Require sustained speech to start a session (prevent false triggers)
            setTimeout(() => {
              if (!isSpeechActive && rms > CONFIG.SILENCE_THRESHOLD) {
                startSpeechSession();
              }
            }, CONFIG.SPEECH_DEBOUNCE_MS); // 50ms debounce for faster response
          } else {
            // Already in speech session - reset silence timer
            resetFrontendSilenceTimer();
          }
          
          // Only send if audio level is above threshold and we're in a speech session
          if (isSpeechActive && rms > CONFIG.RMS_THRESHOLD) {
            // Convert float32 [-1,1] to int16 little-endian
            const pcm = new Int16Array(inputBuffer.length);
            for (let i = 0; i < inputBuffer.length; i++) {
              pcm[i] = Math.max(-32768, Math.min(32767, inputBuffer[i] * 32768));
            }
            ws.send(pcm.buffer);
          }
        }
        // If rms <= SILENCE_THRESHOLD, we're in silence - timer will handle session end
      }
    };

function startSpeechSession() {
  if (!isSpeechActive) {
    isSpeechActive = true;
    updateStatus("Transcribing...");
    addMessage("", "user", true);
    processingMessageEl = messagesEl.querySelector(".message.user:last-of-type");
    processingMessageEl.classList.add('recording');
    isProcessing = true;
    resetFrontendSilenceTimer();
    console.log("Speech session started");
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
      // Reset silence timer when we get new transcription
      resetSilenceTimer();
      
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
    resetSilenceTimer();
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
  resetSilenceTimer();
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
