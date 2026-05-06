"""
Research Rover FastAPI Backend
Modern, async-first research paper management API
"""

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import uvicorn
import os
from pathlib import Path

from app.core.config import get_settings
from app.core.dependencies import get_sentence_model, get_llm_instance
from app.api.routes import search, chat, files, embeddings, analysis
from app.core.logging import setup_logging

# Setup logging
logger = setup_logging()

# Global state for models
app_state = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    logger.info("Starting Research Rover API...")
    
    # Initialize models and services
    settings = get_settings()
    
    # Create data directory
    os.makedirs(settings.DATA_FOLDER, exist_ok=True)
    
    logger.info("Research Rover API started successfully")
    yield
    
    logger.info("Shutting down Research Rover API...")

# Create FastAPI app
app = FastAPI(
    title="Research Rover API",
    description="Modern research paper management and analysis API",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(search.router, prefix="/api/v1/search", tags=["search"])
app.include_router(chat.router, prefix="/api/v1/chat", tags=["chat"])
app.include_router(files.router, prefix="/api/v1/files", tags=["files"])
app.include_router(embeddings.router, prefix="/api/v1/embeddings", tags=["embeddings"])
app.include_router(analysis.router, prefix="/api/v1/analysis", tags=["analysis"])

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "Research Rover API v2.0", "status": "healthy"}

@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "version": "2.0.0",
        "services": {
            "api": "running",
            "models": "loaded"
        }
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
