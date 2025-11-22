// Speech-to-Text (STT) Functions for AI Companion

// STT module state
let recognition = null;
let isListening = false;
let currentText = '';
let messageBubble = null;
let silenceTimer = null;

// Session management
let currentSessionId = null; // Will be generated once and reused

// Initialize session ID when module loads
function initializeSession() {
    if (!currentSessionId) {
        currentSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log('🆔 Session initialized:', currentSessionId);
    }
}

// Initialize speech recognition
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

// Silence timer - triggers after speech stops
function startSilenceTimer() {
    silenceTimer = setTimeout(() => {
        sendMessage();
    }, CONFIG.SILENCE_TIMEOUT_MS);
}

// Send message to backend - final step of speech pipeline
async function sendMessage() {
    if (!currentText.trim()) return;
    
    updateStatus('Processing...');
    
    // Reset AI bubble state for new conversation
    aiMessageBubble = null;
    aiCurrentText = '';
    
    // Ensure session is initialized (reuse existing session ID)
    initializeSession();
    
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
