# LLM (Large Language Model) Functions for AI Companion

import openai
import logging
import asyncio
import json
from typing import AsyncGenerator, List, Dict
from system_prompts import get_system_prompt
from config import (
    OPENAI_API_KEY,
    LLM_MODEL,
    LLM_MAX_TOKENS,
    LLM_TEMPERATURE,
    LLM_MAX_HISTORY_MESSAGES,
    SUMMARIZER_MODEL,
    SUMMARIZER_MAX_TOKENS,
    SUMMARIZER_TEMPERATURE,
)

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
    
    # Manage context window using configured maximum history size
    if len(messages) > LLM_MAX_HISTORY_MESSAGES:
        # Keep system prompt and last N-1 non-system messages
        system_messages = [msg for msg in messages if msg["role"] == "system"]
        conversation_messages = [msg for msg in messages if msg["role"] != "system"]
        keep_count = max(LLM_MAX_HISTORY_MESSAGES - 1, 1)
        recent_messages = conversation_messages[-keep_count:]
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
        
        ai_summarizer(message, full_text)
        logger.info(f"🤖 Streaming complete: {full_text[:100]}...")
        
    except Exception as e:
        logger.error(f"❌ Streaming completion error: {e}")
        raise


async def _ai_summarizer_task(user_message: str, assistant_message: str) -> None:
    """Background summarization task for future logging/analytics.

    Uses a dedicated summarizer model to generate:
      - user_short: brief summary of the user message
      - assistant_short: brief summary of the assistant message
      - turn_summary: 1-2 sentence summary of the overall exchange

    For now, results are only logged; DB integration will be added later.
    """
    try:
        logger.info("🧠 ai_summarizer task started")

        if not OPENAI_API_KEY:
            logger.warning("🧠 Summarizer skipped: OPENAI_API_KEY not set")
            return

        global client
        if client is None:
            client = openai.OpenAI(api_key=OPENAI_API_KEY)

        system_prompt = (
            "You are a summarization helper. Given a user message and an assistant "
            "message, you must return a compact JSON object with three keys: "
            "'user_short', 'assistant_short', and 'turn_summary'. "
            "Each value should be a short, human-readable sentence or two. "
            "Respond with JSON only, no extra text."
        )

        user_content = {
            "user_message": user_message,
            "assistant_message": assistant_message,
        }

        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    "Summarize the following exchange and return JSON with keys "
                    "'user_short', 'assistant_short', 'turn_summary'.\n\n" +
                    json.dumps(user_content, ensure_ascii=False)
                ),
            },
        ]

        loop = asyncio.get_event_loop()

        def _call_summarizer():
            return client.chat.completions.create(
                model=SUMMARIZER_MODEL,
                messages=messages,
                max_tokens=SUMMARIZER_MAX_TOKENS,
                temperature=SUMMARIZER_TEMPERATURE,
            )

        response = await loop.run_in_executor(None, _call_summarizer)

        content = response.choices[0].message.content if response.choices else None
        if not content:
            logger.warning("🧠 Summarizer returned empty content")
            return

        logger.info("🧠 Summarizer raw content: %r", content)

        try:
            summary_data = json.loads(content)
        except json.JSONDecodeError:
            logger.warning("🧠 Summarizer response was not valid JSON: %s", content)
            return

        logger.info("🧠 Summarizer result: %s", summary_data)
    except Exception as e:
        logger.error(f"🧠 ai_summarizer task error: {e}")


def ai_summarizer(user_message: str, assistant_message: str) -> None:
    """Schedule a non-blocking background task for future summarization.

    This helper is intended to be called soon after streaming completes.
    It schedules an async task and returns immediately without waiting
    for the work to finish.
    """
    try:
        loop = asyncio.get_event_loop()
        # If we're already in an event loop (FastAPI/uvicorn), schedule task.
        if loop.is_running():
            asyncio.create_task(_ai_summarizer_task(user_message, assistant_message))
        else:
            # Fallback for direct script usage
            loop.run_until_complete(_ai_summarizer_task(user_message, assistant_message))
    except RuntimeError:
        # No running loop; create one just for this task (debug/testing only)
        asyncio.run(_ai_summarizer_task(user_message, assistant_message))

