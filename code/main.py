"""
AI Companion - FastAPI Backend
Chat interface with speech recognition, sidebar, and real LLM with TTS
"""

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
import logging
import asyncio
from openai import OpenAI
from config import OPENAI_API_KEY, LLM_MODEL, LLM_MAX_TOKENS, LLM_TEMPERATURE, tts_config
import base64
import json
from tts import synthesize_speech, get_tts_processor
from llm import get_conversation_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize OpenAI client (v1.0+ syntax)
client = OpenAI(api_key=OPENAI_API_KEY)

app = FastAPI(title="AI Companion")
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/favicon.ico")
async def favicon():
    """Return empty favicon to prevent 404 errors."""
    return Response(status_code=204)  # No Content

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

async def collect_llm_text_stream(message: str, conversation_history: list, text_queue: asyncio.Queue):
    """Collect text from LLM stream and put into queue."""
    try:
        logger.info("🧵 Starting LLM text collector...")
        
        # Get conversation manager and set up with history
        conversation_manager = get_conversation_manager()
        conversation_manager.clear_conversation()
        
        for msg in conversation_history[-20:]:
            if msg.get("role") == "user":
                conversation_manager.add_user_message(msg.get("content", ""))
            elif msg.get("role") == "assistant":
                conversation_manager.add_assistant_message(msg.get("content", ""))
        
        logger.info("🧵 Conversation manager setup complete")
        
        # Stream LLM and collect sentences
        sentence_count = 0
        queue_contents = []
        
        async for sentence in conversation_manager.get_ai_response_stream(message):
            if sentence.strip():
                sentence_count += 1
                clean_sentence = sentence.strip()
                queue_contents.append(clean_sentence)
                
                logger.info(f"🧵 Got sentence {sentence_count}: '{sentence[:30]}...'")
                print(f"🧵 QUEUE ADD: '{clean_sentence}'")
                print(f"📋 TEXT QUEUE ({sentence_count} items): {queue_contents}")
                print("-" * 50)
                
                await text_queue.put(clean_sentence)
        
        # Signal completion
        logger.info(f"🧵 LLM streaming complete - {sentence_count} sentences collected")
        print(f"📋 FINAL TEXT QUEUE: {queue_contents}")
        await text_queue.put(None)  # Sentinel value to indicate completion
        
    except Exception as e:
        logger.error(f"🧵 Error in LLM text collector: {e}")
        await text_queue.put(None)  # Signal completion even on error

async def process_text_queue_for_tts_realtime(text_queue: asyncio.Queue, websocket: WebSocket):
    """Process text from queue with sequential TTS synthesis and real-time WebSocket streaming."""
    try:
        logger.info("🎵 Starting real-time sequential TTS processor...")
        
        # Get shared TTS processor (load once)
        processor = get_tts_processor()
        logger.info("🎵 TTS processor loaded and ready")
        
        all_sentences = []
        chunk_count = 0
        
        while True:
            text_chunk = await text_queue.get()
            
            if text_chunk is None:  # Sentinel value - LLM streaming complete
                logger.info("🎵 Text queue processing complete")
                # Send completion signal
                await websocket.send_json({
                    "type": "complete",
                    "total_chunks": chunk_count,
                    "full_response": " ".join(all_sentences)
                })
                break
                
            all_sentences.append(text_chunk)
            logger.info(f"🎵 Got text chunk: '{text_chunk[:30]}...'")
            
            # Sequential synthesis - process immediately as it arrives
            print(f"🎵 SYNTHESIZING: '{text_chunk}'")
            audio_base64 = await synthesize_chunk(processor, text_chunk, chunk_count)
            
            if audio_base64:
                chunk_count += 1
                
                # Send chunk immediately via WebSocket
                await websocket.send_json({
                    "type": "audio_chunk",
                    "chunk_index": chunk_count,
                    "audio": audio_base64,
                    "text": text_chunk,
                    "is_final": False
                })
                
                logger.info(f"🎵 ✅ Chunk {chunk_count} synthesized and streamed: {len(audio_base64)} chars")
            else:
                logger.warning(f"🎵 ❌ Chunk synthesis failed: '{text_chunk[:30]}...'")
                # Send error chunk but continue
                await websocket.send_json({
                    "type": "synthesis_error",
                    "chunk_index": chunk_count + 1,
                    "text": text_chunk,
                    "error": "TTS synthesis failed"
                })
        
        logger.info(f"🎵 Real-time streaming complete: {chunk_count} chunks sent")
            
    except Exception as e:
        logger.error(f"🎵 Error in real-time TTS processor: {e}")
        await websocket.send_json({
            "type": "error",
            "message": f"TTS processing error: {e}"
        })

@app.websocket("/ws/audio/{session_id}")
async def websocket_audio_stream(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for streaming audio chunks for a specific session."""
    await websocket.accept()
    logger.info(f"🔌 Audio WebSocket connected for session {session_id}")
    
    try:
        # Check if session exists
        if session_id not in active_sessions:
            await websocket.send_json({
                "type": "error",
                "message": f"Session {session_id} not found"
            })
            return
        
        # Stream audio chunks as they become available
        last_chunk_count = 0
        
        while True:
            session_data = active_sessions.get(session_id)
            
            if not session_data:
                break
                
            if session_data["status"] == "error":
                await websocket.send_json({
                    "type": "error",
                    "message": session_data["message"]
                })
                break
                
            if session_data["status"] == "complete":
                # Send all remaining chunks and complete signal
                for chunk in session_data["audio_chunks"][last_chunk_count:]:
                    await websocket.send_json({
                        "type": "audio_chunk",
                        "chunk_index": chunk["chunk_index"],
                        "audio": chunk["audio"],
                        "text": chunk["text"],
                        "is_final": False
                    })
                
                await websocket.send_json({
                    "type": "complete",
                    "total_chunks": session_data["total_chunks"],
                    "full_response": session_data["full_response"]
                })
                break
                
            if session_data["status"] == "streaming":
                # Send new chunks
                current_chunks = session_data["audio_chunks"]
                new_chunks = current_chunks[last_chunk_count:]
                
                for chunk in new_chunks:
                    await websocket.send_json({
                        "type": "audio_chunk",
                        "chunk_index": chunk["chunk_index"],
                        "audio": chunk["audio"],
                        "text": chunk["text"],
                        "is_final": False
                    })
                    last_chunk_count += 1
                
                # Send current text update
                await websocket.send_json({
                    "type": "text_update",
                    "current_response": session_data["current_response"],
                    "chunks_ready": last_chunk_count
                })
            
            # Wait a bit before checking again
            await asyncio.sleep(0.1)
        
    except WebSocketDisconnect:
        logger.info(f"🔌 Audio WebSocket disconnected for session {session_id}")
    except Exception as e:
        logger.error(f"🔌 Audio WebSocket error for session {session_id}: {e}")
        await websocket.send_json({
            "type": "error",
            "message": f"WebSocket error: {e}"
        })

@app.websocket("/ws/chat")
async def websocket_chat_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time chat with streaming TTS."""
    await websocket.accept()
    logger.info("🔌 WebSocket connection established")
    
    try:
        # Receive initial message
        data = await websocket.receive_json()
        message = data.get("message", "")
        conversation_history = data.get("conversation_history", [])
        tts_enabled = data.get("tts", True)
        
        logger.info(f"🔌 WebSocket received: {message[:50]}...")
        logger.info(f"🔌 TTS enabled: {tts_enabled}")
        
        if not OPENAI_API_KEY:
            await websocket.send_json({
                "type": "error",
                "message": "OpenAI API key not configured"
            })
            return
        
        if len(message.strip()) < 5:
            await websocket.send_json({
                "type": "error", 
                "message": "Message too short"
            })
            return
        
        if tts_enabled:
            # Test TTS processor first
            try:
                processor = get_tts_processor()
                test_audio = await processor.synthesize_async("test")
                if not test_audio:
                    await websocket.send_json({
                        "type": "error",
                        "message": "TTS processor test failed"
                    })
                    return
            except Exception as e:
                await websocket.send_json({
                    "type": "error",
                    "message": f"TTS processor error: {e}"
                })
                return
            
            # Create text queue and start real-time processing
            text_queue = asyncio.Queue()
            
            # Start LLM text collector
            collector_task = asyncio.create_task(
                collect_llm_text_stream(message, conversation_history, text_queue)
            )
            
            # Start real-time TTS processor with WebSocket
            processor_task = asyncio.create_task(
                process_text_queue_for_tts_realtime(text_queue, websocket)
            )
            
            # Wait for both to complete
            await collector_task
            await processor_task
            
        else:
            # Non-TTS mode via WebSocket
            messages = [
                {"role": "system", "content": "You are a helpful AI assistant. Be concise and friendly."}
            ]
            messages.extend(conversation_history[-20:])
            messages.append({"role": "user", "content": message})
            
            response = client.chat.completions.create(
                model=LLM_MODEL,
                messages=messages,
                max_tokens=LLM_MAX_TOKENS,
                temperature=LLM_TEMPERATURE
            )
            
            ai_response = response.choices[0].message.content
            
            await websocket.send_json({
                "type": "text_response",
                "response": ai_response.strip(),
                "tts": False
            })
        
    except WebSocketDisconnect:
        logger.info("🔌 WebSocket disconnected")
    except Exception as e:
        logger.error(f"🔌 WebSocket error: {e}")
        await websocket.send_json({
            "type": "error",
            "message": f"WebSocket error: {e}"
        })

async def process_text_queue_for_tts(text_queue: asyncio.Queue):
    """Process text from queue with sequential TTS synthesis (immediate first chunk)."""
    try:
        logger.info("🎵 Starting sequential text queue processor for TTS...")
        
        # Get shared TTS processor (load once)
        processor = get_tts_processor()
        logger.info("🎵 TTS processor loaded and ready")
        
        all_sentences = []
        audio_chunks = []
        
        while True:
            text_chunk = await text_queue.get()
            
            if text_chunk is None:  # Sentinel value - LLM streaming complete
                logger.info("🎵 Text queue processing complete")
                break
                
            all_sentences.append(text_chunk)
            logger.info(f"🎵 Got text chunk: '{text_chunk[:30]}...'")
            
            # Sequential synthesis - process immediately as it arrives
            print(f"🎵 SYNTHESIZING: '{text_chunk}'")
            audio_base64 = await synthesize_chunk(processor, text_chunk, len(audio_chunks))
            
            if audio_base64:
                audio_chunks.append(audio_base64)
                logger.info(f"🎵 ✅ Chunk {len(audio_chunks)} synthesized and ready")
            else:
                logger.warning(f"🎵 ❌ Chunk synthesis failed: '{text_chunk[:30]}...'")
                # Continue with next chunks even if one fails
        
        # Prepare final response
        full_response = " ".join(all_sentences)
        
        logger.info(f"🎵 Sequential synthesis complete: {len(audio_chunks)} audio chunks ready")
        print(f"🎵 FINAL RESULT: {len(audio_chunks)} chunks from {len(all_sentences)} sentences")
        
        return JSONResponse({
            "response": full_response.strip(),
            "tts": True,
            "audio_chunks": audio_chunks,
            "streaming": True,
            "total_chunks": len(audio_chunks)
        })
            
    except Exception as e:
        logger.error(f"🎵 Error in sequential text queue processor: {e}")
        return JSONResponse({
            "response": f"Error processing TTS: {e}",
            "tts": False,
            "audio_chunks": []
        })

async def synthesize_chunk(processor, text: str, chunk_index: int):
    """Synthesize a single text chunk sequentially."""
    try:
        logger.info(f"🎵 Synthesizing chunk {chunk_index + 1}: '{text}'")
        audio_bytes = await processor.synthesize_async(text)
        
        if audio_bytes:
            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
            logger.info(f"🎵 ✅ Chunk {chunk_index + 1} synthesized: {len(audio_bytes)} bytes")
            return audio_base64
        else:
            logger.warning(f"🎵 ❌ Chunk {chunk_index + 1}: No audio generated")
            return None
            
    except Exception as e:
        logger.error(f"🎵 ❌ Chunk {chunk_index + 1} synthesis error: {e}")
        return None

# Session management for WebSocket connections
active_sessions = {}

async def stream_llm_and_audio_websocket(message: str, conversation_history: list, session_id: str):
    """Background task that streams LLM and audio via WebSocket."""
    try:
        logger.info(f"🧵 Starting background streaming for session {session_id}")
        
        # Create text queue and process
        text_queue = asyncio.Queue()
        
        # Start LLM text collector
        collector_task = asyncio.create_task(
            collect_llm_text_stream(message, conversation_history, text_queue)
        )
        
        # Start TTS processor
        processor_task = asyncio.create_task(
            process_text_queue_for_tts_realtime(text_queue, session_id)
        )
        
        # Wait for completion
        await collector_task
        final_result = await processor_task
        
        logger.info(f"🧵 Background streaming complete for session {session_id}")
        
    except Exception as e:
        logger.error(f"🧵 Error in background streaming for session {session_id}: {e}")

async def process_text_queue_for_tts_realtime(text_queue: asyncio.Queue, session_id: str):
    """Process text from queue and store audio chunks for WebSocket delivery."""
    try:
        logger.info(f"🎵 Starting real-time TTS processor for session {session_id}")
        
        # Get shared TTS processor
        processor = get_tts_processor()
        logger.info(f"🎵 TTS processor ready for session {session_id}")
        
        all_sentences = []
        audio_chunks = []
        chunk_count = 0
        
        while True:
            text_chunk = await text_queue.get()
            
            if text_chunk is None:  # Sentinel value - LLM streaming complete
                logger.info(f"🎵 Text queue processing complete for session {session_id}")
                
                # Store final results in session
                active_sessions[session_id] = {
                    "status": "complete",
                    "full_response": " ".join(all_sentences),
                    "audio_chunks": audio_chunks,
                    "total_chunks": len(audio_chunks)
                }
                break
                
            all_sentences.append(text_chunk)
            logger.info(f"🎵 Got text chunk for session {session_id}: '{text_chunk[:30]}...'")
            
            # Sequential synthesis
            print(f"🎵 SYNTHESIZING: '{text_chunk}'")
            audio_base64 = await synthesize_chunk(processor, text_chunk, chunk_count)
            
            if audio_base64:
                chunk_count += 1
                audio_chunks.append({
                    "chunk_index": chunk_count,
                    "audio": audio_base64,
                    "text": text_chunk,
                    "is_final": False
                })
                
                logger.info(f"🎵 ✅ Chunk {chunk_count} ready for session {session_id}: {len(audio_base64)} chars")
                
                # Store intermediate results for immediate WebSocket delivery
                active_sessions[session_id] = {
                    "status": "streaming",
                    "current_response": " ".join(all_sentences),
                    "audio_chunks": audio_chunks.copy(),
                    "latest_chunk": audio_chunks[-1]
                }
            else:
                logger.warning(f"🎵 ❌ Chunk synthesis failed for session {session_id}: '{text_chunk[:30]}...'")
        
        logger.info(f"🎵 Real-time streaming complete for session {session_id}: {chunk_count} chunks")
            
    except Exception as e:
        logger.error(f"🎵 Error in real-time TTS processor for session {session_id}: {e}")
        active_sessions[session_id] = {
            "status": "error",
            "message": f"TTS processing error: {e}"
        }

@app.post("/chat")
async def chat_endpoint(request: Request):
    """Process chat messages with streaming LLM responses and TTS."""
    
    try:
        data = await request.json()
        message = data.get("message", "")
        conversation_history = data.get("conversation_history", [])
        tts_enabled = data.get("tts", True)
        
        logger.info(f"🎤 Received message: {message}")
        logger.info(f"🎤 TTS enabled: {tts_enabled}")
        logger.info(f"🎤 Conversation history length: {len(conversation_history)}")
        
        # Handle very short/fragment messages
        if len(message.strip()) < 5:
            logger.info(f"🚫 Message too short ({len(message.strip())} chars): '{message}' - skipping TTS")
            return JSONResponse({
                "response": "Could you please provide a more complete message?",
                "tts": False,
                "audio_chunks": []
            })
        
        if not OPENAI_API_KEY:
            logger.error("🎤 OpenAI API key not configured")
            return JSONResponse(
                {"response": "Error: OpenAI API key not configured. Please check your .env file."}, 
                status_code=500
            )
        
        logger.info(f"Using OpenAI model: {LLM_MODEL}")
        logger.info(f"API key starts with: {OPENAI_API_KEY[:10]}...")
        
        if tts_enabled:
            # Test TTS processor first
            try:
                print("🔧 Testing TTS processor...")
                processor = get_tts_processor()
                test_audio = await processor.synthesize_async("test")
                if test_audio:
                    print(f"🔧 TTS processor test OK: {len(test_audio)} bytes")
                else:
                    print("🔧 TTS processor test FAILED: returned None")
            except Exception as e:
                print(f"🔧 TTS processor test ERROR: {e}")
                return JSONResponse({
                    "response": f"TTS processor error: {e}",
                    "tts": False,
                    "audio_chunks": []
                })
            
            # LLM streaming with text queue
            logger.info("🧵 Starting LLM streaming with text queue...")
            
            # Create text queue for this message
            text_queue = asyncio.Queue()
            
            # Start LLM text collector
            collector_task = asyncio.create_task(
                collect_llm_text_stream(message, conversation_history, text_queue)
            )
            
            # Start text processor for TTS
            processor_task = asyncio.create_task(
                process_text_queue_for_tts(text_queue)
            )
            
            # Wait for both to complete
            await collector_task
            final_result = await processor_task
            
            logger.info("🧵 LLM streaming with text queue complete")
            return final_result
        
        else:
            logger.info("🔊 TTS IS DISABLED - using non-TTS path")
            # Non-streaming mode (no TTS)
            messages = [
                {"role": "system", "content": "You are a helpful AI assistant. Be concise and friendly. Remember the context of our conversation."}
            ]
            messages.extend(conversation_history[-20:])
            messages.append({"role": "user", "content": message})
            
            response = client.chat.completions.create(
                model=LLM_MODEL,
                messages=messages,
                max_tokens=LLM_MAX_TOKENS,
                temperature=LLM_TEMPERATURE
            )
            
            ai_response = response.choices[0].message.content
            
            return JSONResponse({
                "response": ai_response.strip(),
                "tts": tts_enabled,
                "audio_chunks": []  # Empty array for consistency
            })
        
    except Exception as e:
        logger.error(f"❌ Error in chat endpoint: {e}")
        return JSONResponse(
            {"response": f"Error: {str(e)}", "tts": False, "audio_chunks": []},
            status_code=500
        )

@app.post("/chat-stream")
async def chat_stream_endpoint(request: Request):
    """True streaming endpoint using Server-Sent Events (SSE) - exactly like reference WebSocket."""
    try:
        data = await request.json()
        message = data.get("message", "")
        conversation_history = data.get("conversation_history", [])
        tts_enabled = data.get("tts", True)
        
        logger.info(f"🎵 SSE Stream request: {message} (tts: {tts_enabled})")
        
        if not OPENAI_API_KEY:
            async def error_generator():
                yield f"data: {json.dumps({'error': 'OpenAI API key not configured'})}\n\n"
            return StreamingResponse(error_generator(), media_type="text/plain")
        
        # Get conversation manager and set up with history
        conversation_manager = get_conversation_manager()
        conversation_manager.clear_conversation()
        
        for msg in conversation_history[-20:]:
            if msg.get("role") == "user":
                conversation_manager.add_user_message(msg.get("content", ""))
            elif msg.get("role") == "assistant":
                conversation_manager.add_assistant_message(msg.get("content", ""))
        
        async def stream_generator():
            """Generate streaming events exactly like reference WebSocket."""
            try:
                full_response = ""
                
                if tts_enabled:
                    # Stream with TTS (exact reference pattern)
                    async for sentence in conversation_manager.get_ai_response_stream(message):
                        if sentence.strip():
                            full_response += sentence + " "
                            logger.info(f"🎵 SSE streaming sentence: '{sentence[:30]}...'")
                            
                            # Synthesize sentence to audio
                            try:
                                from tts import get_tts_processor
                                processor = get_tts_processor()
                                audio_bytes = await processor.synthesize_async(sentence)
                                
                                if audio_bytes:
                                    audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                                    
                                    # Send audio chunk immediately (exactly like reference WebSocket)
                                    event_data = {
                                        "type": "audio",
                                        "text": sentence,
                                        "audio": audio_base64,
                                        "response_so_far": full_response.strip()
                                    }
                                    yield f"data: {json.dumps(event_data)}\n\n"
                                    logger.info(f"🎵 SSE sent audio chunk: {len(audio_bytes)} bytes")
                                else:
                                    logger.warning("🎵 TTS synthesis returned None")
                                    
                            except Exception as tts_error:
                                logger.error(f"🎵 SSE TTS error: {tts_error}")
                    # Send end signal
                    end_data = {
                        "type": "end",
                        "response": full_response.strip()
                    }
                    yield f"data: {json.dumps(end_data)}\n\n"
                    logger.info("🎵 SSE stream complete")
                    
                else:
                    # Stream text only
                    async for sentence in conversation_manager.get_ai_response_stream(message):
                        if sentence.strip():
                            full_response += sentence + " "
                            
                            event_data = {
                                "type": "text",
                                "text": sentence,
                                "response_so_far": full_response.strip()
                            }
                            yield f"data: {json.dumps(event_data)}\n\n"
                    
                    # Send end signal
                    end_data = {
                        "type": "end",
                        "response": full_response.strip()
                    }
                    yield f"data: {json.dumps(end_data)}\n\n"
                    
            except Exception as e:
                logger.error(f"SSE Generator error: {e}")
                error_data = {"error": str(e)}
                yield f"data: {json.dumps(error_data)}\n\n"
        
        return StreamingResponse(
            stream_generator(),
            media_type="text/plain",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
            }
        )
        
    except Exception as e:
        logger.error(f"SSE Stream setup error: {e}")
        async def error_generator():
            error_data = {"error": str(e)}
            yield f"data: {json.dumps(error_data)}\n\n"
        return StreamingResponse(error_generator(), media_type="text/plain")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
