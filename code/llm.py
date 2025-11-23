# LLM (Large Language Model) Functions for AI Companion

import openai
import logging
from typing import AsyncGenerator, List, Dict
from system_prompts import get_system_prompt
from config import OPENAI_API_KEY, LLM_MODEL, LLM_MAX_TOKENS, LLM_TEMPERATURE

logger = logging.getLogger(__name__)

"""LLM utilities backed by OpenAI, configured via config.py."""

# Single OpenAI client instance - initialized once when module loads.
# The actual API key is validated lazily in stream_chat_response so that
# application startup does not crash if the key is missing.
client: openai.OpenAI | None = None

def build_messages(message: str, conversation_history: List[Dict[str, str]] = None, 
                  system_prompt_type: str = "default") -> List[Dict[str, str]]:
    """Build message list for OpenAI API with conversation history."""
    messages = []
    
    # Add system prompt
    system_prompt = get_system_prompt(system_prompt_type)
    messages.append({"role": "system", "content": system_prompt})
    
    # Add conversation history
    if conversation_history:
        messages.extend(conversation_history)
    
    # Add current user message
    messages.append({"role": "user", "content": message})
    
    # Manage context window (keep last 10 messages to stay within token limits)
    if len(messages) > 10:
        # Keep system prompt and last 9 messages
        system_messages = [msg for msg in messages if msg["role"] == "system"]
        conversation_messages = [msg for msg in messages if msg["role"] != "system"]
        recent_messages = conversation_messages[-9:]
        messages = system_messages + recent_messages
    
    return messages

async def stream_chat_response(message: str, conversation_history: List[Dict[str, str]] = None,
                              model: str = LLM_MODEL, max_tokens: int = LLM_MAX_TOKENS, 
                              temperature: float = LLM_TEMPERATURE, system_prompt_type: str = "default") -> AsyncGenerator[str, None]:
    """Stream chat response with memory support - yields chunks for real-time display."""
    try:
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not set in config.py / environment")

        global client
        if client is None:
            client = openai.OpenAI(api_key=OPENAI_API_KEY)

        logger.info(f"🤖 Starting streaming response with {len(conversation_history or [])} history messages")
        
        messages = build_messages(message, conversation_history, system_prompt_type)
        
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True
        )
        
        full_text = ""
        
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                content = chunk.choices[0].delta.content
                full_text += content
                yield content
        
        logger.info(f"🤖 Streaming complete: {full_text[:100]}...")
        
    except Exception as e:
        logger.error(f"❌ Streaming completion error: {e}")
        raise

