# Session ID Implementation Plan

## 🎯 Goal
Implement ChatGPT-style session management with permanent conversation IDs and working memory.

## 📋 Microstep Implementation Plan

### **Step 1: Backend Session ID Generation**
- [ ] Modify `chat_endpoint` to generate session_id when none provided
- [ ] Return session_id in all chat responses
- [ ] Ensure session_id format matches ChatGPT (UUID format)

### **Step 2: Frontend Session ID Storage**
- [ ] Create global `currentSessionId` variable
- [ ] Remove automatic session ID generation in `sendMessage()`
- [ ] Send `session_id: currentSessionId || null` in requests

### **Step 3: Frontend Session ID Persistence**
- [ ] Store session_id from backend response
- [ ] Add console logging for session ID tracking

### **Step 4: URL Management**
- [ ] Implement URL update to `/c/{session_id}` without page reload
- [ ] Use `history.pushState()` for URL changes
- [ ] Extract session_id from URL on page load

### **Step 5: URL Session Recovery**
- [ ] On page load, check URL for session_id
- [ ] If found, set `currentSessionId` from URL
- [ ] If not found, generate temporary session_id

### **Step 6: New Conversation Button**
- [ ] Add "New Conversation" button to UI
- [ ] On click: reset `currentSessionId = null`
- [ ] Update URL to `/` (no session ID)

### **Step 7: Memory Testing & Validation**
- [ ] Test conversation memory across multiple messages
- [ ] Test page refresh preserves session
- [ ] Test new conversation button works
- [ ] Verify ChatGPT-style URLs work correctly

## 🔧 Technical Details

### **Backend Changes:**
```python
# chat_endpoint changes
session_id = request.get("session_id", str(uuid.uuid4()))
# Return session_id in response
return {"response": ai_response, "session_id": session_id}
```

### **Frontend Changes:**
```javascript
// Global session storage
let currentSessionId = null;

// URL management
function updateSessionURL(sessionId) {
    const url = sessionId ? `/c/${sessionId}` : '/';
    history.pushState({}, '', url);
}

// URL recovery
function getSessionFromURL() {
    const path = window.location.pathname;
    if (path.startsWith('/c/')) {
        return path.split('/')[2];
    }
    return null;
}
```

## 🎯 Success Criteria
- [ ] Memory works across multiple messages
- [ ] Session ID persists in URL like ChatGPT
- [ ] Page refresh preserves conversation
- [ ] New conversation button works
- [ ] No session ID regeneration bugs

## 🧪 Test Cases
1. **First message**: No session_id → Backend creates → URL updates
2. **Second message**: Uses stored session_id → Memory works
3. **Page refresh**: Session recovered from URL → Memory preserved
4. **New conversation**: Session reset → Fresh start

## 📝 Notes
- Keep existing SSE streaming functionality
- Maintain TTS audio synthesis
- No breaking changes to existing features
- Future-ready for sidebar implementation
