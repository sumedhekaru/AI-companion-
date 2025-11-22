// AI Companion - JavaScript with Speech Recognition
// Immediate bubble feedback and ChatGPT-style sidebar

// Configuration thresholds
const CONFIG = {
    SILENCE_TIMEOUT_MS: 3000,
    SPEECH_RECOGNITION_LANG: "en-US",
    MAX_MESSAGE_LENGTH: 1000,
    ANIMATION_SPEED_MS: 200,
    ENABLE_CONSOLE_LOGS: true,
    ENABLE_DEBUG_BUBBLE_LOGS: false
};

let isListening = false;
let currentText = "";
let messageBubble = null;
let silenceTimer = null;
let ttsEnabled = true;
let conversationHistory = []; // Store conversation for memory

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const ttsToggle = document.getElementById('ttsToggle');
const clearBtn = document.getElementById('clearBtn');

document.addEventListener('DOMContentLoaded', () => {
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🚀 AI Companion loaded');
    updateStatus('Ready');
    
    startBtn.addEventListener('click', startListening);
    stopBtn.addEventListener('click', stopListening);
    ttsToggle.addEventListener('change', toggleTTS);
    clearBtn.addEventListener('click', clearConversation);
    
    loadSettings();
});

function updateStatus(text) {
    statusEl.textContent = text;
}

function addMessage(text, sender, isRecording = false) {
    if (CONFIG.ENABLE_DEBUG_BUBBLE_LOGS) {
        console.log('🫧 Creating message bubble:', text, sender, isRecording);
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    if (isRecording) {
        messageDiv.classList.add('recording');
        messageDiv.innerHTML = text + '<span class="processing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
    } else {
        messageDiv.textContent = text;
    }
    
    messagesEl.appendChild(messageDiv);
    
    // Force auto-scroll with multiple methods
    setTimeout(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
        
        // Fallback method
        messagesEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
        
        // Another fallback
        messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 100);
    
    if (CONFIG.ENABLE_DEBUG_BUBBLE_LOGS) {
        console.log('✅ Message bubble added to DOM');
    }
    
    return messageDiv;
}

function loadSettings() {
    const savedTTS = localStorage.getItem('ttsEnabled');
    
    if (savedTTS !== null) {
        ttsEnabled = savedTTS === 'true';
        ttsToggle.checked = ttsEnabled;
    }
}

function saveSettings() {
    localStorage.setItem('ttsEnabled', ttsEnabled);
}

function toggleTTS() {
    ttsEnabled = ttsToggle.checked;
    saveSettings();
}

function clearConversation() {
    messagesEl.innerHTML = '';
    currentText = '';
    messageBubble = null;
    conversationHistory = []; // Clear memory
    console.log('🗑️ Conversation and memory cleared');
}

function checkWebKitSupport() {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

function startListening() {
    if (isListening) return;
    
    if (!checkWebKitSupport()) {
        updateStatus('Speech recognition not supported');
        addMessage('Speech recognition is not supported in this browser. Please use Chrome or Safari.', 'assistant');
        return;
    }
    
    isListening = true;
    currentText = "";
    
    startBtn.disabled = true;
    stopBtn.disabled = false;
    updateStatus('Listening...');
    
    // Create bubble immediately when button is clicked
    messageBubble = addMessage('', 'user', true);
    
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = CONFIG.SPEECH_RECOGNITION_LANG;
    
    recognition.onstart = () => {
        if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🎤 Recognition started');
    };
    
    recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }
        
        if (finalTranscript) {
            handleSpeech(finalTranscript, true);
        } else if (interimTranscript) {
            handleSpeech(interimTranscript, false);
        }
    };
    
    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        updateStatus(`Error: ${event.error}`);
        stopListening();
    };
    
    recognition.onend = () => {
        if (isListening) {
            setTimeout(() => recognition.start(), 100);
        }
    };
    
    recognition.start();
    window.currentRecognition = recognition;
}

function handleSpeech(text, isFinal) {
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
    
    // Create new bubble immediately for subsequent messages
    if (!messageBubble) {
        messageBubble = addMessage('', 'user', true);
    }
    
    if (isFinal) {
        currentText += (currentText ? ' ' : '') + text.trim();
        
        // Check message length
        if (currentText.length > CONFIG.MAX_MESSAGE_LENGTH) {
            currentText = currentText.substring(0, CONFIG.MAX_MESSAGE_LENGTH);
            updateBubble(currentText + '... (truncated)');
        } else {
            updateBubble(currentText);
        }
        
        silenceTimer = setTimeout(() => {
            sendToAI();
        }, CONFIG.SILENCE_TIMEOUT_MS);
    } else {
        if (messageBubble) {
            const displayText = currentText + ' ' + text.replace('[PARTIAL] ', '').trim();
            
            // Check interim text length
            if (displayText.length > CONFIG.MAX_MESSAGE_LENGTH) {
                updateBubble(displayText.substring(0, CONFIG.MAX_MESSAGE_LENGTH) + '...');
            } else {
                updateBubble(displayText);
            }
        }
    }
}

function updateBubble(text) {
    if (messageBubble) {
        messageBubble.innerHTML = text + '<span class="processing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>';
        
        // Force auto-scroll during bubble updates
        setTimeout(() => {
            messagesEl.scrollTop = messagesEl.scrollHeight;
            messageBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 50);
    }
}

async function sendToAI() {
    if (!currentText.trim()) return;
    
    updateStatus('Processing...');
    
    if (messageBubble) {
        messageBubble.innerHTML = currentText;
        messageBubble.classList.remove('recording');
    }
    
    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: currentText,
                conversation_history: conversationHistory, // Send memory to backend
                tts: ttsEnabled
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Add user message to memory
            conversationHistory.push({"role": "user", "content": currentText});
            
            // Add AI response to memory
            conversationHistory.push({"role": "assistant", "content": data.response});
            
            // Keep only last 10 messages to avoid context limit
            if (conversationHistory.length > 20) { // 10 user + 10 assistant
                conversationHistory = conversationHistory.slice(-20);
            }
            
            addMessage(data.response, 'assistant');
            
            if (ttsEnabled && data.audio) {
                if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔊 Playing TTS audio');
            }
            
            updateStatus('Ready');
        } else {
            addMessage('Sorry, I had trouble processing that. Please try again.', 'assistant');
            updateStatus('Error');
        }
    } catch (error) {
        addMessage('Sorry, I\'m having connection issues. Please try again.', 'assistant');
        updateStatus('Connection Error');
    }
    
    currentText = '';
    messageBubble = null;
    silenceTimer = null;
}

function stopListening() {
    if (!isListening) return;
    
    isListening = false;
    
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
    
    if (window.currentRecognition) {
        window.currentRecognition.stop();
        window.currentRecognition = null;
    }
    
    if (currentText.trim()) {
        sendToAI();
    }
    
    startBtn.disabled = false;
    stopBtn.disabled = true;
    updateStatus('Ready');
    
    if (messageBubble) {
        messageBubble.classList.remove('recording');
    }
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🛑 Speech recognition stopped');
}

console.log('📱 AI Companion script with sidebar loaded');
