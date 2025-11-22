// AI Companion - RealtimeTTS Edition Frontend

// Configuration
const CONFIG = {
    ENABLE_CONSOLE_LOGS: true,
    SILENCE_TIMEOUT_MS: 2000,
    MAX_MESSAGE_LENGTH: 1000
};

// Global state
let websocket = null;
let recognition = null;
let isListening = false;
let currentText = '';
let messageBubble = null;
let silenceTimer = null;
let ttsEnabled = true;
let isAISpeaking = false;

// DOM elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const ttsToggle = document.getElementById('ttsToggle');
const clearBtn = document.getElementById('clearBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🚀 AI Companion RealtimeTTS Edition loaded');
    
    initializeWebSocket();
    initializeSpeechRecognition();
    
    startBtn.addEventListener('click', startListening);
    stopBtn.addEventListener('click', stopListening);
    ttsToggle.addEventListener('change', toggleTTS);
    clearBtn.addEventListener('click', clearConversation);
});

// WebSocket connection
function initializeWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/chat`;
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔌 Connecting to WebSocket:', wsUrl);
    
    websocket = new WebSocket(wsUrl);
    
    websocket.onopen = () => {
        if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔌 WebSocket connected');
        updateStatus('Ready');
    };
    
    websocket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔌 WebSocket received:', data.type);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('🔌 WebSocket parse error:', error, event.data);
        }
    };
    
    websocket.onerror = (error) => {
        console.error('🔌 WebSocket error:', error);
        updateStatus('Connection Error');
    };
    
    websocket.onclose = () => {
        if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔌 WebSocket disconnected');
        updateStatus('Disconnected');
        // Reconnect after 3 seconds
        setTimeout(initializeWebSocket, 3000);
    };
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'text':
            handleTextMessage(data.content);
            break;
        case 'audio':
            handleAudioChunk(data);
            break;
        case 'audio_complete':
            handleAudioComplete(data);
            break;
        case 'error':
            handleError(data);
            break;
    }
}

// Handle text messages from AI
function handleTextMessage(text) {
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('📝 Received AI text:', text);
    
    // Add AI message
    addMessage(text, 'assistant');
    
    // Add to conversation history
    conversationHistory.push({
        role: "assistant",
        content: text
    });
}

// Handle audio chunks
let audioQueue = [];
let isPlayingAudio = false;

function handleAudioChunk(data) {
    if (!ttsEnabled) return;
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) {
        console.log(`🎵 Received audio chunk ${data.chunk_index}: ${data.audio.length} chars`);
    }
    
    // Convert hex string back to bytes
    const audioHex = data.audio;
    const audioBytes = new Uint8Array(audioHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    
    // Add to queue
    audioQueue.push({
        index: data.chunk_index,
        audio: audioBytes
    });
    
    // Start playing if not already playing
    if (!isPlayingAudio) {
        playNextAudioChunk();
    }
}

// Play audio chunks sequentially
async function playNextAudioChunk() {
    if (audioQueue.length === 0) {
        isPlayingAudio = false;
        isAISpeaking = false;
        updateStatus('Ready');
        return;
    }
    
    isPlayingAudio = true;
    isAISpeaking = true;
    updateStatus('AI Speaking...');
    
    const chunk = audioQueue.shift();
    
    try {
        // Create audio blob and play
        const audioBlob = new Blob([chunk.audio], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        const audio = new Audio(audioUrl);
        
        audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            playNextAudioChunk(); // Play next chunk
        };
        
        audio.onerror = (error) => {
            console.error('🎵 Audio playback error:', error);
            URL.revokeObjectURL(audioUrl);
            playNextAudioChunk(); // Continue with next chunk
        };
        
        await audio.play();
        
    } catch (error) {
        console.error('🎵 Audio chunk error:', error);
        playNextAudioChunk(); // Continue with next chunk
    }
}

// Handle audio completion
function handleAudioComplete(data) {
    if (CONFIG.ENABLE_CONSOLE_LOGS) {
        console.log(`🎵 Audio streaming complete: ${data.total_chunks} chunks`);
    }
}

// Handle errors
function handleError(data) {
    console.error('❌ Server error:', data.message);
    addMessage(`Error: ${data.message}`, 'assistant');
    updateStatus('Error');
}

// Speech recognition
function initializeSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.error('🎤 Speech recognition not supported');
        updateStatus('Speech Recognition Not Supported');
        return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    
    recognition.onstart = () => {
        if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🎤 Recognition started');
    };
    
    recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            
            // Filter out low-confidence results (likely background noise/AI audio)
            const confidence = event.results[i][0].confidence;
            if (confidence < 0.7) {
                if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔇 Low confidence audio filtered out:', confidence);
                continue;
            }
            
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }
        
        // If AI is speaking and user makes ANY sound, interrupt immediately
        if (isAISpeaking && finalTranscript) {
            if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🛑 User sound detected - interrupting AI');
            stopAIAudio();
            handleSpeech(finalTranscript, true);
            return;
        }
        
        // Normal processing when AI is not speaking
        if (!isAISpeaking) {
            if (finalTranscript) {
                handleSpeech(finalTranscript, true);
            } else if (interimTranscript) {
                handleSpeech(interimTranscript, false);
            }
        }
    };
    
    recognition.onerror = (event) => {
        console.error('🎤 Recognition error:', event.error);
        updateStatus(`Recognition Error: ${event.error}`);
        stopListening();
    };
    
    recognition.onend = () => {
        if (isListening) {
            // Restart if we're supposed to be listening
            setTimeout(() => recognition.start(), 100);
        }
    };
}

// Handle speech input
function handleSpeech(text, isFinal) {
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
    
    // Create user bubble immediately for streaming display
    if (!messageBubble) {
        messageBubble = addMessage('', 'user', true);
    }
    
    if (isFinal) {
        currentText += (currentText ? ' ' : '') + text.trim();
        
        // Update user bubble in real-time as they speak
        updateBubble(currentText);
        
        // Start silence timer - will send to backend when complete
        startSilenceTimer();
    } else {
        // Interim results - update bubble for real-time display
        const displayText = currentText + ' ' + text.replace('[PARTIAL] ', '').trim();
        updateBubble(displayText);
    }
}

// Start listening
function startListening() {
    if (!recognition) {
        console.error('🎤 Speech recognition not available');
        return;
    }
    
    isListening = true;
    currentText = '';
    messageBubble = null;
    
    startBtn.disabled = true;
    stopBtn.disabled = false;
    
    recognition.start();
    updateStatus('Listening...');
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🎤 Started listening');
}

// Stop listening
function stopListening() {
    isListening = false;
    
    startBtn.disabled = false;
    stopBtn.disabled = true;
    
    if (recognition) {
        recognition.stop();
    }
    
    updateStatus('Ready');
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🎤 Stopped listening');
}

// Stop AI audio
function stopAIAudio() {
    audioQueue = [];
    isPlayingAudio = false;
    isAISpeaking = false;
    updateStatus('Ready');
}

// Silence timer
function startSilenceTimer() {
    silenceTimer = setTimeout(() => {
        sendMessage();
    }, CONFIG.SILENCE_TIMEOUT_MS);
}

// Send message to backend
function sendMessage() {
    if (!currentText.trim()) return;
    
    updateStatus('Processing...');
    
    // Finalize user message bubble
    if (messageBubble) {
        messageBubble.innerHTML = currentText;
        messageBubble.classList.remove('recording');
    }
    
    // Send via WebSocket
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
            message: currentText.trim()
        }));
        
        // Add to conversation history
        conversationHistory.push({
            role: "user",
            content: currentText.trim()
        });
        
        if (CONFIG.ENABLE_CONSOLE_LOGS) {
            console.log('📤 Message sent:', currentText.trim());
        }
    } else {
        console.error('🔌 WebSocket not connected');
        updateStatus('Connection Error');
    }
    
    // Reset for next message
    currentText = '';
    messageBubble = null;
    silenceTimer = null;
}

// Update message bubble
function updateBubble(text) {
    if (messageBubble) {
        messageBubble.innerHTML = text + '<span class="processing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
        
        // Auto-scroll
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
}

// Add message to chat
function addMessage(text, sender, isRecording = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = text;
    
    contentDiv.appendChild(textDiv);
    
    if (isRecording) {
        contentDiv.classList.add('recording');
    }
    
    messageDiv.appendChild(contentDiv);
    messagesEl.appendChild(messageDiv);
    
    // Auto-scroll
    messagesEl.scrollTop = messagesEl.scrollHeight;
    
    return contentDiv;
}

// Toggle TTS
function toggleTTS() {
    ttsEnabled = ttsToggle.classList.contains('active');
    
    if (ttsEnabled) {
        ttsToggle.classList.add('active');
        ttsToggle.textContent = '🔊 TTS On';
    } else {
        ttsToggle.classList.remove('active');
        ttsToggle.textContent = '🔇 TTS Off';
        stopAIAudio();
    }
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔊 TTS toggled:', ttsEnabled);
}

// Clear conversation
function clearConversation() {
    messagesEl.innerHTML = '';
    conversationHistory = [];
    currentText = '';
    messageBubble = null;
    stopAIAudio();
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🗑️ Conversation cleared');
}

// Update status
function updateStatus(text) {
    statusEl.textContent = text;
}

// Conversation history
let conversationHistory = [];
