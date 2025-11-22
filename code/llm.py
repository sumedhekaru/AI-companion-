"""
LLM integration for AI Companion.
Supports OpenAI with plans for multi-provider expansion.
"""

import os
import logging
from typing import List, Dict, Optional, Any
from pathlib import Path
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables from the correct location
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path)

logger = logging.getLogger(__name__)

class OpenAIClient:
    """OpenAI LLM client for chat completions."""
    
    def __init__(self, model: str = "gpt-3.5-turbo", temperature: float = 0.7):
        """Initialize OpenAI client."""
        self.model = model
        self.temperature = temperature
        
        # Get API key from environment
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY environment variable not set")
        
        # Initialize OpenAI client (v1.0+ syntax)
        self.client = OpenAI(api_key=api_key)
        logger.info(f"🤖 OpenAI client initialized with model: {model}")
    
    def chat_stream(self, messages: List[Dict[str, str]], max_tokens: int = 1000):
        """
        Stream chat messages from OpenAI and yield text chunks.
        
        Args:
            messages: List of message dictionaries with 'role' and 'content'
            max_tokens: Maximum tokens for response
            
        Yields:
            Text chunks from OpenAI streaming response
        """
        try:
            # Create streaming chat completion
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                max_tokens=max_tokens,
                stream=True
            )
            
            for chunk in response:
                if chunk.choices[0].delta.content is not None:
                    yield chunk.choices[0].delta.content
                    
        except Exception as e:
            logger.error(f"🤖 OpenAI streaming error: {e}")
            yield "I apologize, but I'm having trouble connecting right now. Please try again."
    
    def chat(self, messages: List[Dict[str, str]], max_tokens: int = 1000) -> str:
        """
        Send chat messages to OpenAI and get response.
        
        Args:
            messages: List of message dictionaries with 'role' and 'content'
            max_tokens: Maximum tokens for response
            
        Returns:
            AI response text
        """
        try:
            # Create chat completion (v1.0+ syntax)
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                max_tokens=max_tokens,
                stream=False
            )
            
            # Extract response text
            ai_response = response.choices[0].message.content
            logger.info(f"🤖 OpenAI response: {ai_response[:50]}...")
            
            return ai_response.strip()
            
        except Exception as e:
            logger.error(f"🤖 OpenAI API error: {e}")
            return "I apologize, but I'm having trouble connecting right now. Please try again."
    
    async def chat_async(self, messages: List[Dict[str, str]], max_tokens: int = 1000) -> str:
        """
        Async version of chat method.
        
        Args:
            messages: List of message dictionaries with 'role' and 'content'
            max_tokens: Maximum tokens for response
            
        Returns:
            AI response text
        """
        import asyncio
        
        # Run synchronous chat in executor
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.chat, messages, max_tokens)

class ConversationManager:
    """Manages conversation state and context for LLM interactions."""
    
    def __init__(self, system_prompt_type: str = "default"):
        """Initialize conversation manager."""
        from system_prompts import get_system_prompt
        
        self.system_prompt = get_system_prompt(system_prompt_type)
        self.messages = [{"role": "system", "content": self.system_prompt}]
        self.llm_client = OpenAIClient()
        
        logger.info(f"💬 Conversation manager initialized with {system_prompt_type} prompt")
    
    def add_user_message(self, content: str) -> None:
        """Add a user message to the conversation."""
        self.messages.append({"role": "user", "content": content})
        logger.info(f"💬 Added user message: {content[:50]}...")
    
    def add_assistant_message(self, content: str) -> None:
        """Add an assistant message to the conversation."""
        self.messages.append({"role": "assistant", "content": content})
        logger.info(f"💬 Added assistant message: {content[:50]}...")
    
    async def get_ai_response_stream(self, user_message: str):
        """
        Get streaming AI response for user message.
        
        Args:
            user_message: The user's input message
            
        Yields:
            Sentences as they're completed from OpenAI stream
        """
        # Add user message
        self.add_user_message(user_message)
        
        # Stream OpenAI response and buffer into sentences
        text_buffer = ""
        
        for chunk in self.llm_client.chat_stream(self.messages):
            text_buffer += chunk
            
            # Check for sentence boundaries
            sentences = self._extract_sentences(text_buffer)
            
            if sentences:
                # Yield complete sentences and keep remainder in buffer
                for sentence in sentences[:-1]:  # All but last (incomplete)
                    yield sentence.strip()
                
                text_buffer = sentences[-1]  # Keep incomplete sentence
        
        # Yield any remaining text
        if text_buffer.strip():
            yield text_buffer.strip()
        
        # Add complete response to conversation history
        complete_response = text_buffer
        self.add_assistant_message(complete_response)
    
    def _extract_sentences(self, text):
        """
        Extract complete sentences from text buffer.
        
        Args:
            text: Text buffer to extract sentences from
            
        Returns:
            List of sentences (last one may be incomplete)
        """
        import re
        
        # Split on sentence boundaries
        sentences = re.split(r'(?<=[.!?])\s+', text)
        
        # Filter out empty strings
        sentences = [s for s in sentences if s.strip()]
        
        return sentences
    
    async def get_ai_response(self, user_message: str) -> str:
        """
        Get AI response for user message.
        
        Args:
            user_message: The user's input message
            
        Returns:
            AI response text
        """
        # Add user message
        self.add_user_message(user_message)
        
        # Get AI response
        ai_response = await self.llm_client.chat_async(self.messages)
        
        # Add assistant message
        self.add_assistant_message(ai_response)
        
        return ai_response
    
    def get_conversation_history(self) -> List[Dict[str, str]]:
        """Get the full conversation history."""
        return self.messages.copy()
    
    def clear_conversation(self) -> None:
        """Clear the conversation and reset with system prompt."""
        self.messages = [{"role": "system", "content": self.system_prompt}]
        logger.info("💬 Conversation cleared")
    
    def set_system_prompt_type(self, prompt_type: str) -> None:
        """Change the system prompt type."""
        from system_prompts import get_system_prompt
        
        self.system_prompt = get_system_prompt(prompt_type)
        self.messages[0] = {"role": "system", "content": self.system_prompt}
        logger.info(f"💬 System prompt changed to: {prompt_type}")

# Global conversation manager instance
_conversation_manager: Optional[ConversationManager] = None

def get_conversation_manager() -> ConversationManager:
    """Get or create the global conversation manager."""
    global _conversation_manager
    if _conversation_manager is None:
        _conversation_manager = ConversationManager()
    return _conversation_manager

def reset_conversation_manager() -> None:
    """Reset the global conversation manager."""
    global _conversation_manager
    _conversation_manager = None
