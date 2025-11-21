// Frontend configuration (mirrors SpeechToTextConfig in Python)
const CONFIG = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  FRAME_SIZE: 4096,
  RMS_THRESHOLD: 0, // Temporarily disable to debug
};

const statusEl = document.getElementById("status");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const messagesEl = document.getElementById("messages");

let ws = null;
let mediaRecorder = null;
let mediaStream = null;
let currentUserMessage = "";

function updateStatus(text) {
  statusEl.textContent = text;
}

function addMessage(content, role) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.textContent = content;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
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
    updateStatus("Streaming audio...");
    stopBtn.disabled = false;
    startBtn.disabled = true;

    // Clear previous messages
    messagesEl.innerHTML = "";
    currentUserMessage = "";

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
        // Only send if audio level is above threshold
        if (rms > CONFIG.RMS_THRESHOLD) {
          // Convert float32 [-1,1] to int16 little-endian
          const pcm = new Int16Array(inputBuffer.length);
          for (let i = 0; i < inputBuffer.length; i++) {
            pcm[i] = Math.max(-32768, Math.min(32767, inputBuffer[i] * 32768));
          }
          ws.send(pcm.buffer);
        }
      }
    };

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
    // If the message looks like transcription (not a control/status message), display it
    if (msg && !msg.match(/^(Received|Stopping|Transcribing|Transcription)/)) {
      currentUserMessage += (currentUserMessage ? " " : "") + msg;
      // Update the last user message or create it if it doesn't exist
      let lastUserMsg = messagesEl.querySelector(".message.user:last-of-type");
      if (!lastUserMsg) {
        addMessage(currentUserMessage, "user");
      } else {
        lastUserMsg.textContent = currentUserMessage;
      }
    }
  };

  ws.onerror = (event) => {
    console.error("WebSocket error", event);
    updateStatus("WebSocket error.");
  };

  ws.onclose = () => {
    updateStatus("Connection closed.");
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
  cleanup();
});
