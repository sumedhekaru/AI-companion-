// Text-to-Speech (TTS) Functions for AI Companion

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

// Play next audio chunk from queue
async function playNextAudioChunk() {
    if (frontendAudioQueue.length === 0) {
        isPlayingAudio = false;
        isAISpeaking = false;  // Reset speech recognition flag
        // Restart speech recognition when audio is completely finished
        if (recognition && !isListening) {
            recognition.start();
            isListening = true;
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

// Stop AI audio
function stopAIAudio() {
    frontendAudioQueue = [];
    isPlayingAudio = false;
    isAISpeaking = false;
    updateStatus('Ready');
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
