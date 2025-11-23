# LLM (Large Language Model) Functions for AI Companion

import openai
import logging
from typing import AsyncGenerator, List, Dict
from system_prompts import get_system_prompt
import os

logger = logging.getLogger(__name__)

# Single OpenAI client instance - initialized once when module loads
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY environment variable not set")

client = openai.OpenAI(api_key=OPENAI_API_KEY)

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
                              model: str = "gpt-4.1-nano", max_tokens: int = 500, 
                              temperature: float = 0.7, system_prompt_type: str = "default") -> AsyncGenerator[str, None]:
    """Stream chat response with memory support - yields chunks for real-time display."""
    try:
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

