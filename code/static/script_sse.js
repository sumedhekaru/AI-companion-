// AI Companion - Server-Sent Events Edition

// Configuration
const CONFIG = {
    ENABLE_CONSOLE_LOGS: true,
    SILENCE_TIMEOUT_MS: 2000,
    MAX_MESSAGE_LENGTH: 1000
};

// Global state
let eventSource = null;
let recognition = null;
let isListening = false;
let currentText = '';
let messageBubble = null;
let silenceTimer = null;
let ttsEnabled = true;
let isAISpeaking = false;
let currentSessionId = null;

// DOM elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const ttsToggle = document.getElementById('ttsToggle');
const clearBtn = document.getElementById('clearBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🚀 AI Companion SSE Edition loaded');
    
    initializeSpeechRecognition();
    
    startBtn.addEventListener('click', startListening);
    stopBtn.addEventListener('click', stopListening);
    ttsToggle.addEventListener('change', toggleTTS);
    clearBtn.addEventListener('click', clearConversation);
});

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
            const confidence = event.results[i][0].confidence;
            
            // Filter out low-confidence results
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

// Start SSE stream for real-time text
function startSSEStream(sessionId) {
    if (eventSource) {
        eventSource.close();
    }
    
    const sseUrl = `/stream/${sessionId}`;
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🧵 Starting SSE stream:', sseUrl);
    
    eventSource = new EventSource(sseUrl);
    
    eventSource.onopen = () => {
        if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🧵 SSE stream connected');
    };
    
    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🧵 SSE received:', data.type);
            handleSSEMessage(data);
        } catch (error) {
            console.error('🧵 SSE parse error:', error, event.data);
        }
    };
    
    eventSource.onerror = (error) => {
        console.error('🧵 SSE error:', error);
        updateStatus('Stream Error');
    };
}

// Handle SSE messages
let aiMessageBubble = null;
let aiCurrentText = '';

function handleSSEMessage(data) {
    switch (data.type) {
        case 'connected':
            if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🧵 SSE connected:', data.session_id);
            // Reset AI bubble state for new conversation
            aiMessageBubble = null;
            aiCurrentText = '';
            break;
            
        case 'text':
            // Update AI message bubble in real-time
            if (!aiMessageBubble) {
                aiMessageBubble = addMessage('', 'assistant', false);
            }
            
            aiCurrentText = data.content;
            aiMessageBubble.querySelector('.message-text').textContent = aiCurrentText;
            messagesEl.scrollTop = messagesEl.scrollHeight;
            
            if (CONFIG.ENABLE_CONSOLE_LOGS) {
                console.log(`🧵 AI text updated: "${data.content}"`);
            }
            break;
            
        case 'audio':
            // Play audio chunk immediately
            console.log('🔊 FRONTEND: Received SSE audio chunk at', new Date().toISOString());
            if (ttsEnabled) {
                playAudioChunk(data.chunk);
            }
            break;
            
        case 'complete':
            if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🧵 SSE streaming complete');
            // Finalize AI message
            if (aiMessageBubble) {
                aiMessageBubble.classList.remove('recording');
            }
            break;
            
        case 'error':
            console.error('🧵 SSE error:', data.message);
            addMessage(`Error: ${data.message}`, 'assistant');
            break;
    }
}

// Send message to backend
async function sendMessage() {
    if (!currentText.trim()) return;
    
    updateStatus('Processing...');
    
    // Reset AI bubble state for new conversation
    aiMessageBubble = null;
    aiCurrentText = '';
    
    // Generate session ID for this conversation
    currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Start SSE stream BEFORE sending message
    startSSEStream(currentSessionId);
    
    // Finalize user message bubble
    if (messageBubble) {
        messageBubble.innerHTML = currentText;
        messageBubble.classList.remove('recording');
    }
    
    try {
        // Send message via HTTP POST
        const response = await fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: currentText.trim(),
                session_id: currentSessionId,
                tts: ttsEnabled
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (CONFIG.ENABLE_CONSOLE_LOGS) {
            console.log('✅ Received response:', data);
            console.log('🔊 Audio chunks:', data.audio_chunks?.length || 0);
        }
        
        // Handle TTS audio
        if (ttsEnabled && data.audio_chunks && data.audio_chunks.length > 0) {
            playAudioChunks(data.audio_chunks);
        }
        
        updateStatus('Ready');
        
    } catch (error) {
        console.error('❌ Send message error:', error);
        updateStatus('Error');
        
        // Close SSE stream on error
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
    }
    
    // Reset for next message
    currentText = '';
    messageBubble = null;
    silenceTimer = null;
}

// Frontend audio queue for sequential playback
let frontendAudioQueue = [];
let isPlayingAudio = false;

// Play individual audio chunk immediately
async function playAudioChunk(audioBase64) {
    if (!ttsEnabled) return;
    
    console.log('🔊 FRONTEND: Queuing audio chunk for sequential playback');
    
    // Add to frontend queue for sequential playback
    frontendAudioQueue.push(audioBase64);
    
    // Start playback if not already playing
    if (!isPlayingAudio) {
        playNextAudioChunk();
    }
}

// Play next chunk from queue when previous finishes
async function playNextAudioChunk() {
    if (frontendAudioQueue.length === 0) {
        isPlayingAudio = false;
        isAISpeaking = false;  // Reset speech recognition flag
        
        // Restart speech recognition when audio is completely finished
        if (recognition && !isListening) {
            recognition.start();
            isListening = true;
            console.log('🎤 Speech recognition restarted after audio playback');
        }
        
        updateStatus('Ready');
        return;
    }
    
    isPlayingAudio = true;
    isAISpeaking = true;  // Sync with speech recognition flag
    
    // Stop speech recognition completely to prevent feedback
    if (recognition && isListening) {
        isListening = false;  // Prevent auto-restart in onend handler
        recognition.stop();
        console.log('🛑 Speech recognition stopped to prevent feedback');
    }
    
    updateStatus('AI Speaking...');
    
    try {
        const audioBase64 = frontendAudioQueue.shift(); // Get next chunk
        
        // Convert base64 to audio
        const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
        const audioBlob = new Blob([audioBytes], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        const audio = new Audio(audioUrl);
        
        audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            console.log('🔊 FRONTEND: Audio chunk finished, playing next');
            // Play next chunk when this one finishes
            playNextAudioChunk();
        };
        
        audio.onerror = (error) => {
            console.error('🎵 Audio chunk playback error:', error);
            URL.revokeObjectURL(audioUrl);
            // Continue with next chunk even if error
            playNextAudioChunk();
        };
        
        console.log('🔊 FRONTEND: Playing audio chunk');
        await audio.play();
        
    } catch (error) {
        console.error('🎵 Audio chunk error:', error);
        // Continue with next chunk even if error
        playNextAudioChunk();
    }
}

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
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('� Started listening');
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
    // Audio interruption logic would go here
    isAISpeaking = false;
    updateStatus('Ready');
}

// Silence timer
function startSilenceTimer() {
    silenceTimer = setTimeout(() => {
        sendMessage();
    }, CONFIG.SILENCE_TIMEOUT_MS);
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
    currentText = '';
    messageBubble = null;
    aiMessageBubble = null;
    aiCurrentText = '';
    stopAIAudio();
    
    // Close SSE stream
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🗑️ Conversation cleared');
}

// Update status
function updateStatus(text) {
    statusEl.textContent = text;
}
