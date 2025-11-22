// AI Companion - Server-Sent Events Edition

// Configuration
const CONFIG = {
    ENABLE_CONSOLE_LOGS: true,
    SILENCE_TIMEOUT_MS: 2000,
    MAX_MESSAGE_LENGTH: 1000
};

// Global state (cross-cutting only)
let ttsEnabled = true;
let isAISpeaking = false;

// SSE module state
let eventSource = null;
let currentSessionId = null;
let aiMessageBubble = null;
let aiCurrentText = '';

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
            // Use marked.parse for AI responses to render Markdown
            const textElement = aiMessageBubble.querySelector('.message-text');
            textElement.innerHTML = marked.parse(aiCurrentText);
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
    
    // Use Markdown for AI responses, plain text for user messages
    if (sender === 'assistant') {
        textDiv.innerHTML = marked.parse(text);
    } else {
        textDiv.textContent = text; // Security: Use textContent for user input
    }
    
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
