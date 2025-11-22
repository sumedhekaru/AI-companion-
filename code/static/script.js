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

// Global state for audio and interruption
let isAISpeaking = false;
let currentAudioElement = null;
let recognition = null;
let isListening = false;
let currentText = "";
let messageBubble = null;
let silenceTimer = null;
let ttsEnabled = true;
let conversationHistory = []; // Store conversation for memory
let websocket = null; // WebSocket connection

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const ttsToggle = document.getElementById('ttsToggle');
const clearBtn = document.getElementById('clearBtn');

document.addEventListener('DOMContentLoaded', () => {
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🚀 AI Companion loaded');
    
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
            sendMessage();
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

function initializeWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/chat`;
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔌 Connecting to WebSocket:', wsUrl);
    
    websocket = new WebSocket(wsUrl);
    
    websocket.onopen = () => {
        if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔌 WebSocket connected successfully');
        updateStatus('Ready');
    };
    
    websocket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔌 WebSocket received:', data.type, data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('🔌 WebSocket parse error:', error, event.data);
        }
    };
    
    websocket.onerror = (error) => {
        console.error('🔌 WebSocket error:', error);
        updateStatus('WebSocket Error');
        
        // Fallback to HTTP if WebSocket fails
        if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔄 Falling back to HTTP due to WebSocket error');
        useHTTPFallback = true;
    };
    
    websocket.onclose = (event) => {
        if (CONFIG.ENABLE_CONSOLE_LOGS) {
            console.log('🔌 WebSocket disconnected:', event.code, event.reason);
        }
        updateStatus('Ready');
        
        // Don't auto-reconnect if it was a normal closure
        if (event.code !== 1000) {
            // Schedule reconnection for abnormal closures
            setTimeout(() => {
                if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔄 Attempting WebSocket reconnection...');
                initializeWebSocket();
            }, 2000);
        }
    };
}

let useHTTPFallback = false;

function handleWebSocketMessage(data) {
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔌 WebSocket received:', data.type);
    
    switch (data.type) {
        case 'audio_chunk':
            handleAudioChunk(data);
            break;
        case 'complete':
            handleStreamComplete(data);
            break;
        case 'error':
            handleStreamError(data);
            break;
        case 'synthesis_error':
            handleSynthesisError(data);
            break;
        case 'text_response':
            handleTextResponse(data);
            break;
    }
}

function handleAudioChunk(data) {
    if (CONFIG.ENABLE_CONSOLE_LOGS) {
        console.log(`🔊 Received audio chunk ${data.chunk_index}:`, data.text.substring(0, 30) + '...');
    }
    
    // Create or update assistant message bubble with text
    if (!messageBubble) {
        messageBubble = addMessage('', 'assistant', false);
    }
    updateMessageText(messageBubble, data.text);
    
    // Play audio chunk immediately
    if (data.audio) {
        playAudioChunk(data.audio, data.chunk_index);
    }
}

function handleStreamComplete(data) {
    if (CONFIG.ENABLE_CONSOLE_LOGS) {
        console.log(`🔊 Stream complete: ${data.total_chunks} chunks`);
    }
    
    // Update final response text
    if (messageBubble) {
        updateMessageText(messageBubble, data.full_response);
    }
    
    // Add to conversation history
    conversationHistory.push({
        role: "assistant", 
        content: data.full_response
    });
    
    updateStatus('Ready');
    messageBubble = null;
}

function handleStreamError(data) {
    console.error('🔊 Stream error:', data.message);
    
    if (messageBubble) {
        updateMessageText(messageBubble, `Error: ${data.message}`);
    }
    
    updateStatus('Error');
    messageBubble = null;
}

function handleSynthesisError(data) {
    console.warn('🔊 Synthesis error for chunk:', data.chunk_index, data.text);
    // Continue with next chunks even if one fails
}

function handleTextResponse(data) {
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔊 Text response received');
    
    addMessage(data.response, 'assistant');
    
    conversationHistory.push({
        role: "assistant", 
        content: data.response
    });
    
    updateStatus('Ready');
}

let audioQueue = [];
let isPlayingAudio = false;

function playAudioChunk(audioBase64, chunkIndex) {
    audioQueue.push({ audio: audioBase64, index: chunkIndex });
    
    if (!isPlayingAudio) {
        playNextAudioChunk();
    }
}

function playNextAudioChunk() {
    if (audioQueue.length === 0) {
        isPlayingAudio = false;
        return;
    }
    
    isPlayingAudio = true;
    isAISpeaking = true;
    updateStatus('AI Speaking...');
    
    const chunk = audioQueue.shift();
    
    try {
        const binaryString = atob(chunk.audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i <binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        const blob = new Blob([bytes], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        
        currentAudioElement = audio;
        
        audio.addEventListener('ended', () => {
            URL.revokeObjectURL(audioUrl);
            currentAudioElement = null;
            // Play next chunk immediately
            playNextAudioChunk();
        });
        
        audio.addEventListener('error', (e) => {
            console.error(`🔊 Audio chunk ${chunk.index} playback error:`, e);
            URL.revokeObjectURL(audioUrl);
            currentAudioElement = null;
            // Continue with next chunk
            playNextAudioChunk();
        });
        
        audio.play().then(() => {
            if (CONFIG.ENABLE_CONSOLE_LOGS) {
                console.log(`🔊 Playing audio chunk ${chunk.index}`);
            }
        }).catch(error => {
            console.error(`🔊 Audio chunk ${chunk.index} playback error:`, error);
            URL.revokeObjectURL(audioUrl);
            currentAudioElement = null;
            playNextAudioChunk();
        });
        
    } catch (error) {
        console.error(`🔊 Audio chunk ${chunk.index} processing error:`, error);
        playNextAudioChunk();
    }
}

function updateMessageText(messageBubble, text) {
    const textEl = messageBubble.querySelector('.message-text');
    if (textEl) {
        textEl.textContent = text;
    }
}

async function sendMessage(message) {
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
                message: currentText.trim(),
                conversation_history: conversationHistory,
                tts: ttsEnabled
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('✅ Received response:', data);
            
            addMessage(data.response, 'assistant');
            
            // Handle TTS audio
            if (ttsEnabled) {
                if (data.audio_chunks && data.audio_chunks.length > 0) {
                    // Multiple audio chunks from sentence-by-sentence streaming
                    console.log(`🔊 TTS enabled and ${data.audio_chunks.length} sentence audio chunks available, playing...`);
                    
                    if (data.streaming) {
                        // Streaming response - first chunk sent immediately
                        console.log('🔊 Streaming response detected - playing first chunk immediately!');
                        playTTSChunksSequentially(data.audio_chunks);
                    } else {
                        // Complete response - all chunks ready
                        console.log('🔊 Complete response with all sentence chunks ready');
                        playTTSChunksSequentially(data.audio_chunks);
                    }
                } else {
                    console.log('🔊 TTS enabled but no audio chunks available');
                }
            } else {
                console.log('🔊 TTS is disabled');
            }
            
            // Add assistant response to conversation history
            conversationHistory.push({
                role: "assistant", 
                content: data.response
            });
            
        } else {
            console.error('❌ Server error:', response.status, data);
            addMessage(`Error: ${data.detail || 'Unknown error'}`, 'assistant');
        }
        
        currentText = '';
        updateStatus('Ready');
        
    } catch (error) {
        console.error('❌ Network error:', error);
        updateStatus('Connection Error');
        
        if (messageBubble) {
            messageBubble.innerHTML = currentText + ' <span style="color: red;">❌</span>';
        }
    }
    
    currentText = '';
    messageBubble = null;
    silenceTimer = null;
}

async function sendViaWebSocket() {
    // Send message via WebSocket
    websocket.send(JSON.stringify({
        message: currentText.trim(),
        conversation_history: conversationHistory,
        tts: ttsEnabled
    }));
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) {
        console.log('🔌 Message sent via WebSocket:', currentText.trim());
    }
}

async function sendViaHTTP() {
    const response = await fetch('/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: currentText.trim(),
            conversation_history: conversationHistory,
            tts: ttsEnabled
        })
    });
    
    if (response.ok) {
        const data = await response.json();
        
        if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('✅ HTTP Response received:', data);
        
        if (data.streaming && data.session_id) {
            // Hybrid mode: HTTP response + WebSocket audio streaming
            if (CONFIG.ENABLE_CONSOLE_LOGS) {
                console.log('🔄 Using hybrid mode - connecting to audio WebSocket:', data.websocket_url);
            }
            
            // Connect to audio WebSocket for this session
            await connectToAudioWebSocket(data.session_id);
            
            // Show processing message
            if (messageBubble) {
                updateMessageText(messageBubble, data.response);
            }
            
        } else {
            // Traditional HTTP response
            addMessage(data.response, 'assistant');
            
            if (ttsEnabled && data.audio_chunks && data.audio_chunks.length > 0) {
                console.log(`🔊 TTS enabled and ${data.audio_chunks.length} audio chunks available, playing...`);
                playTTSChunksSequentially(data.audio_chunks);
            }
            
            updateStatus('Ready');
        }
        
    } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
}

async function connectToAudioWebSocket(sessionId) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/audio/${sessionId}`;
    
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔌 Connecting to audio WebSocket:', wsUrl);
    
    const audioWebSocket = new WebSocket(wsUrl);
    
    audioWebSocket.onopen = () => {
        if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔌 Audio WebSocket connected for session:', sessionId);
    };
    
    audioWebSocket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔌 Audio WebSocket received:', data.type, data);
            handleAudioWebSocketMessage(data);
        } catch (error) {
            console.error('🔌 Audio WebSocket parse error:', error, event.data);
        }
    };
    
    audioWebSocket.onerror = (error) => {
        console.error('🔌 Audio WebSocket error:', error);
        updateStatus('Audio WebSocket Error');
    };
    
    audioWebSocket.onclose = (event) => {
        if (CONFIG.ENABLE_CONSOLE_LOGS) {
            console.log('🔌 Audio WebSocket disconnected:', event.code, event.reason);
        }
    };
}

function handleAudioWebSocketMessage(data) {
    if (CONFIG.ENABLE_CONSOLE_LOGS) console.log('🔌 Audio WebSocket received:', data.type);
    
    switch (data.type) {
        case 'audio_chunk':
            handleAudioChunk(data);
            break;
        case 'text_update':
            handleTextUpdate(data);
            break;
        case 'complete':
            handleStreamComplete(data);
            break;
        case 'error':
            handleStreamError(data);
            break;
    }
}

function handleTextUpdate(data) {
    if (CONFIG.ENABLE_CONSOLE_LOGS) {
        console.log('📝 Text update:', data.current_response);
    }
    
    // Update the message bubble with current text
    if (messageBubble) {
        updateMessageText(messageBubble, data.current_response);
    }
}

function playTTSChunksSequentially(audioChunks) {
    if (!audioChunks || audioChunks.length === 0) {
        console.error('🔊 No audio chunks to play');
        return;
    }
    
    console.log(`🔊 Starting to play ${audioChunks.length} audio chunks sequentially`);
    isAISpeaking = true;
    updateStatus('AI Speaking...');
    
    let currentChunkIndex = 0;
    
    function playNextChunk() {
        if (currentChunkIndex >= audioChunks.length) {
            console.log('🔊 All chunks played');
            isAISpeaking = false;
            updateStatus('Ready');
            return;
        }
        
        try {
            const base64Audio = audioChunks[currentChunkIndex];
            console.log(`🔊 Playing chunk ${currentChunkIndex + 1}/${audioChunks.length}`);
            
            // Decode base64 to binary
            const binaryString = atob(base64Audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Create blob and audio element
            const blob = new Blob([bytes], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(blob);
            const audio = new Audio(audioUrl);
            
            currentAudioElement = audio;
            
            audio.addEventListener('ended', () => {
                console.log(`🔊 Chunk ${currentChunkIndex + 1} ended`);
                URL.revokeObjectURL(audioUrl);
                currentAudioElement = null;
                currentChunkIndex++;
                // Play next chunk after a small delay
                setTimeout(playNextChunk, 100);
            });
            
            audio.addEventListener('error', (e) => {
                console.error(`🔊 Chunk ${currentChunkIndex + 1} playback error:`, e);
                URL.revokeObjectURL(audioUrl);
                currentAudioElement = null;
                currentChunkIndex++;
                // Continue with next chunk even if current fails
                setTimeout(playNextChunk, 100);
            });
            
            // Try to play audio
            audio.play().then(() => {
                console.log(`🔊 Chunk ${currentChunkIndex + 1} play() succeeded`);
            }).catch(error => {
                console.error(`🔊 Chunk ${currentChunkIndex + 1} playback error:`, error);
                URL.revokeObjectURL(audioUrl);
                currentAudioElement = null;
                currentChunkIndex++;
                // Continue with next chunk
                setTimeout(playNextChunk, 100);
            });
            
        } catch (error) {
            console.error(`🔊 Chunk ${currentChunkIndex + 1} processing error:`, error);
            currentAudioElement = null;
            currentChunkIndex++;
            // Continue with next chunk
            setTimeout(playNextChunk, 100);
        }
    }
    
    // Start playing the first chunk
    playNextChunk();
}

function stopAIAudio() {
    if (currentAudioElement) {
        console.log('🛑 Stopping AI audio');
        currentAudioElement.pause();
        currentAudioElement.currentTime = 0;
        currentAudioElement = null;
    }
    isAISpeaking = false;
    updateStatus('Ready');
}

function playTTSAudio(base64Audio) {
    try {
        if (!base64Audio) {
            console.error('🔊 No base64 audio data provided');
            return;
        }
        
        console.log('🔊 Received base64 audio, length:', base64Audio.length);
        isAISpeaking = true;
        updateStatus('AI Speaking...');
        
        // Decode base64 to binary
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Create blob and audio element
        const blob = new Blob([bytes], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        
        currentAudioElement = audio;
        
        audio.addEventListener('ended', () => {
            console.log('🔊 Audio playback finished');
            URL.revokeObjectURL(audioUrl);
            currentAudioElement = null;
            isAISpeaking = false;
            updateStatus('Ready');
        });
        
        audio.addEventListener('error', (e) => {
            console.error('🔊 Audio playback error:', e);
            URL.revokeObjectURL(audioUrl);
            currentAudioElement = null;
            isAISpeaking = false;
            updateStatus('Ready');
        });
        
        // Play the audio
        audio.play().then(() => {
            console.log('🔊 Audio play() succeeded');
        }).catch(error => {
            console.error('🔊 Audio playback error:', error);
            URL.revokeObjectURL(audioUrl);
            currentAudioElement = null;
            isAISpeaking = false;
            updateStatus('Ready');
            console.error('🔊 TTS playback error:', error);
            console.error('🔊 Playback error name:', error.name);
            console.error('🔊 Playback error message:', error.message);
        });
        
    } catch (error) {
        console.error('🔊 TTS audio processing error:', error);
        console.error('🔊 Processing error stack:', error.stack);
    }
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
        sendMessage();
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
