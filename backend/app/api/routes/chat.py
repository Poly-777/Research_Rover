"""
Chat API routes for AI-powered paper analysis
"""

from fastapi import APIRouter, HTTPException, Depends
import os
import json
import faiss
import logging
from typing import Dict, Any

from app.models.schemas import ChatRequest, ChatResponse, ErrorResponse
from app.core.config import get_settings
from app.core.dependencies import get_sentence_model, get_llm_instance
from app.services.chat_service import ChatService

router = APIRouter()
logger = logging.getLogger("research_rover")

@router.post("/{filename}", response_model=ChatResponse)
async def chat_with_papers(
    filename: str,
    request: ChatRequest,
    settings = Depends(get_settings),
    sentence_model = Depends(get_sentence_model),
    llm = Depends(get_llm_instance)
):
    """
    Chat with AI about the papers in the specified CSV file
    """
    try:
        if not request.message:
            raise HTTPException(status_code=400, detail="Message parameter is required")
        
        if llm is None:
            raise HTTPException(status_code=500, detail="LLM instance is not initialized")
        
        # Initialize chat service
        chat_service = ChatService(settings, sentence_model, llm)
        
        # Generate response
        response = await chat_service.generate_response(filename, request.message)
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/", response_model=ChatResponse)
async def chat_with_papers_body(
    request: ChatRequest,
    settings = Depends(get_settings),
    sentence_model = Depends(get_sentence_model),
    llm = Depends(get_llm_instance)
):
    """
    Chat with AI about papers (alternative endpoint with filename in body)
    """
    try:
        if not request.message:
            raise HTTPException(status_code=400, detail="Message parameter is required")
        
        if not request.filename:
            raise HTTPException(status_code=400, detail="Filename parameter is required")
        
        if llm is None:
            raise HTTPException(status_code=500, detail="LLM instance is not initialized")
        
        # Initialize chat service
        chat_service = ChatService(settings, sentence_model, llm)
        
        # Generate response
        response = await chat_service.generate_response(request.filename, request.message)
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))