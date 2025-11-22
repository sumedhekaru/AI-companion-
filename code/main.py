"""
AI Companion - FastAPI Backend
Chat interface with speech recognition, sidebar, and real LLM
"""

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
import logging
from openai import OpenAI
from config import OPENAI_API_KEY, LLM_MODEL, LLM_MAX_TOKENS, LLM_TEMPERATURE

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize OpenAI client (v1.0+ syntax)
client = OpenAI(api_key=OPENAI_API_KEY)

app = FastAPI(title="AI Companion")
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve the chat interface."""
    try:
        import os
        html_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
        with open(html_path, "r") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(content="<h1>Error: index.html not found</h1>", status_code=404)

@app.post("/chat")
async def chat_endpoint(request: Request):
    """Process chat messages with real LLM and conversation memory."""
    try:
        data = await request.json()
        message = data.get("message", "")
        conversation_history = data.get("conversation_history", [])
        tts_enabled = data.get("tts", True)
        
        logger.info(f"Message: {message} (history length: {len(conversation_history)}, tts: {tts_enabled})")
        
        # Debug: Check if API key is loaded
        if not OPENAI_API_KEY:
            logger.error("OpenAI API key is not loaded!")
            return JSONResponse(
                {"response": "Error: OpenAI API key not configured. Please check your .env file."}, 
                status_code=500
            )
        
        logger.info(f"Using OpenAI model: {LLM_MODEL}")
        logger.info(f"API key starts with: {OPENAI_API_KEY[:10]}...")
        
        # Build messages array with conversation history
        messages = [
            {"role": "system", "content": "You are a helpful AI assistant. Be concise and friendly. Remember the context of our conversation."}
        ]
        
        # Add conversation history (up to last 20 messages)
        messages.extend(conversation_history[-20:])
        
        # Add current message
        messages.append({"role": "user", "content": message})
        
        # Call OpenAI API (v1.0+ syntax)
        response = client.chat.completions.create(
            model=LLM_MODEL,
            messages=messages,
            max_tokens=LLM_MAX_TOKENS,
            temperature=LLM_TEMPERATURE
        )
        
        ai_response = response.choices[0].message.content
        logger.info(f"OpenAI response: {ai_response[:100]}...")
        
        return JSONResponse({
            "response": ai_response.strip(),
            "tts": tts_enabled,
            "audio": None
        })
        
    except Exception as e:
        logger.error(f"Chat error: {e}")
        logger.error(f"Error type: {type(e).__name__}")
        return JSONResponse(
            {"response": f"Sorry, I had trouble processing that. Error: {str(e)}"}, 
            status_code=500
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
