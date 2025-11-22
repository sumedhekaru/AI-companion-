# LLM (Large Language Model) Functions for AI Companion

import openai
import logging
import asyncio
from typing import AsyncGenerator, Dict, Any, List
from system_prompts import get_system_prompt

logger = logging.getLogger(__name__)

class LLMClient:
    """Handles all OpenAI API interactions with memory support."""
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.client = openai.OpenAI(api_key=api_key)
        self.max_context_messages = 10  # Keep last 10 messages to stay within token limits
    
    def _manage_context_window(self, messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
        """Manage context window to prevent token limit issues."""
        if len(messages) <= self.max_context_messages:
            return messages
        
        # Keep system prompt and last N messages
        system_messages = [msg for msg in messages if msg["role"] == "system"]
        conversation_messages = [msg for msg in messages if msg["role"] != "system"]
        
        # Keep last messages within limit
        recent_messages = conversation_messages[-(self.max_context_messages - len(system_messages)):]
        
        return system_messages + recent_messages
    
    async def get_chat_completion(self, message: str, conversation_history: List[Dict[str, str]] = None, 
                                 model: str = "gpt-3.5-turbo", max_tokens: int = 500, 
                                 temperature: float = 0.7, system_prompt_type: str = "default") -> str:
        """Get a single chat completion with memory support."""
        try:
            logger.info(f"🤖 Getting chat completion from {model} with {len(conversation_history or [])} history messages")
            
            # Build message history
            messages = []
            
            # Add system prompt
            system_prompt = get_system_prompt(system_prompt_type)
            messages.append({"role": "system", "content": system_prompt})
            
            # Add conversation history
            if conversation_history:
                messages.extend(conversation_history)
            
            # Add current user message
            messages.append({"role": "user", "content": message})
            
            # Manage context window
            messages = self._manage_context_window(messages)
            
            response = self.client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature
            )
            
            ai_response = response.choices[0].message.content
            logger.info(f"🤖 Received response: {ai_response[:100]}...")
            
            return ai_response
            
        except Exception as e:
            logger.error(f"❌ Chat completion error: {e}")
            raise
    
    async def stream_chat_completion(self, message: str, conversation_history: List[Dict[str, str]] = None,
                                   model: str = "gpt-4.1-nano", max_tokens: int = 500, 
                                   temperature: float = 0.7, system_prompt_type: str = "default") -> AsyncGenerator[str, None]:
        """Stream chat completion token by token with memory support."""
        try:
            logger.info(f"🤖 Starting streaming completion from {model} with {len(conversation_history or [])} history messages")
            
            # Build message history
            messages = []
            
            # Add system prompt
            system_prompt = get_system_prompt(system_prompt_type)
            messages.append({"role": "system", "content": system_prompt})
            
            # Add conversation history
            if conversation_history:
                messages.extend(conversation_history)
            
            # Add current user message
            messages.append({"role": "user", "content": message})
            
            # Manage context window
            messages = self._manage_context_window(messages)
            
            response = self.client.chat.completions.create(
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

# Global LLM client instance
llm_client = None

def initialize_llm(api_key: str):
    """Initialize the global LLM client."""
    global llm_client
    llm_client = LLMClient(api_key)
    logger.info("🤖 LLM client initialized")

def get_llm_client() -> LLMClient:
    """Get the global LLM client instance."""
    if llm_client is None:
        raise ValueError("LLM client not initialized. Call initialize_llm() first.")
    return llm_client

async def get_chat_response(message: str, conversation_history: List[Dict[str, str]] = None, 
                          model: str = "gpt-3.5-turbo", system_prompt_type: str = "default") -> str:
    """Convenience function to get a chat response with memory."""
    client = get_llm_client()
    return await client.get_chat_completion(message, conversation_history, model, system_prompt_type=system_prompt_type)

async def stream_chat_response(message: str, conversation_history: List[Dict[str, str]] = None,
                              model: str = "gpt-4.1-nano", system_prompt_type: str = "default") -> AsyncGenerator[str, None]:
    """Convenience function to stream chat response with memory."""
    client = get_llm_client()
    async for chunk in client.stream_chat_completion(message, conversation_history, model, system_prompt_type=system_prompt_type):
        yield chunk
