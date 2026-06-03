"""
Embeddings API routes for vector search functionality
"""

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Body
from typing import Optional
import os
import time
import threading
import logging

from app.models.schemas import EmbeddingProgress, SuccessResponse, ErrorResponse, EmbeddingOptions
from app.core.config import get_settings
from app.core.dependencies import get_sentence_model
from app.services.embedding_service import EmbeddingService

router = APIRouter()
logger = logging.getLogger("research_rover")

# Global embedding progress tracking
embedding_progress_state = {
    "stage": 0,
    "message": "Not started",
    "timestamp": time.time()
}

# Cooperative cancel flag for the in-flight embedding job. The background task
# checks it at loop boundaries (between papers, before building/saving) so a
# POST /cancel can stop it mid-run.
_embedding_cancel_event: Optional[threading.Event] = None

@router.get("/progress", response_model=EmbeddingProgress)
async def get_embedding_progress():
    """Get current embedding creation progress"""
    return EmbeddingProgress(**embedding_progress_state)

@router.post("/cancel")
async def cancel_embeddings():
    """Cancel the in-flight embedding job, if any."""
    global embedding_progress_state, _embedding_cancel_event

    running = embedding_progress_state.get("stage", -1) in (0, 1, 2)
    if _embedding_cancel_event is not None:
        _embedding_cancel_event.set()
    if running:
        embedding_progress_state = {
            "stage": -1,
            "message": "Embedding creation cancelled",
            "timestamp": time.time()
        }
        logger.info("Embedding creation cancelled by user request")

    return {
        "cancelled": running,
        "message": "Embedding creation cancelled" if running else "No active embedding job"
    }

@router.post("/{filename}", response_model=SuccessResponse)
async def create_embeddings(
    filename: str,
    background_tasks: BackgroundTasks,
    options: Optional[EmbeddingOptions] = Body(None),
    settings = Depends(get_settings),
    sentence_model = Depends(get_sentence_model)
):
    """
    Create embeddings and FAISS index for the specified CSV file
    """
    global embedding_progress_state, _embedding_cancel_event
    
    try:
        csv_path = os.path.join(settings.DATA_FOLDER, filename)
        
        if not os.path.exists(csv_path):
            raise HTTPException(status_code=404, detail="CSV file not found")
        
        # Reset progress
        embedding_progress_state = {
            "stage": 0,
            "message": "Loading data and initializing embedding model",
            "timestamp": time.time()
        }
        
        # Check if embeddings already exist
        base_filename = filename.replace(".csv", "")
        json_doi_mapped_file = f"{base_filename}_paper_data_doi_mapped_hdbscan.json"
        metadata_file = f"{base_filename}_paper_chunk_metadata_hdbscan.json"
        faiss_index_file = f"{base_filename}_paper_chunks_hdbscan.index"
        
        json_doi_mapped_path = os.path.join(settings.DATA_FOLDER, json_doi_mapped_file)
        metadata_path = os.path.join(settings.DATA_FOLDER, metadata_file)
        faiss_index_path = os.path.join(settings.DATA_FOLDER, faiss_index_file)

        force = options.force if options is not None and options.force is not None else False

        # Skip rebuild only when not forcing — force lets users upgrade an
        # abstracts-only index to full-text (or vice versa) by overwriting.
        if (not force and
            os.path.exists(faiss_index_path) and
            os.path.exists(metadata_path) and
            os.path.exists(json_doi_mapped_path)):

            embedding_progress_state = {
                "stage": 3,
                "message": "Embeddings already exist",
                "timestamp": time.time()
            }

            return SuccessResponse(
                message="Embeddings already exist for this file"
            )
        
        # Resolve scraping options: per-request override, else settings defaults.
        scrape_full_text = (
            options.scrape_full_text
            if options is not None and options.scrape_full_text is not None
            else settings.SCRAPE_FULL_TEXT
        )
        max_scrape = (
            options.max_scrape
            if options is not None and options.max_scrape is not None
            else settings.SCRAPE_MAX_PAPERS
        )

        # Initialize embedding service
        embedding_service = EmbeddingService(settings, sentence_model)

        # Fresh cancel flag for this job.
        _embedding_cancel_event = threading.Event()

        # Create embeddings in background
        background_tasks.add_task(
            embedding_service.create_embeddings_async,
            csv_path,
            embedding_progress_state,
            scrape_full_text,
            max_scrape,
            _embedding_cancel_event,
        )
        
        return SuccessResponse(
            message="Embedding creation started. Check progress endpoint for updates."
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting embedding creation: {e}")
        embedding_progress_state = {
            "stage": -1,
            "message": f"Error: {str(e)}",
            "timestamp": time.time()
        }
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{filename}", response_model=SuccessResponse)
async def delete_embeddings(
    filename: str,
    settings = Depends(get_settings)
):
    """
    Delete embeddings and related files for the specified CSV file
    """
    try:
        base_filename = filename.replace(".csv", "")
        
        files_to_delete = [
            f"{base_filename}_paper_data_doi_mapped_hdbscan.json",
            f"{base_filename}_paper_chunk_metadata_hdbscan.json",
            f"{base_filename}_paper_chunks_hdbscan.index"
        ]
        
        deleted_files = []
        
        for file_to_delete in files_to_delete:
            file_path = os.path.join(settings.DATA_FOLDER, file_to_delete)
            if os.path.exists(file_path):
                os.remove(file_path)
                deleted_files.append(file_to_delete)
        
        if not deleted_files:
            raise HTTPException(status_code=404, detail="No embedding files found")
        
        return SuccessResponse(
            message=f"Deleted embedding files: {', '.join(deleted_files)}"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting embeddings: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete embeddings")

@router.get("/{filename}/status")
async def get_embedding_status(
    filename: str,
    settings = Depends(get_settings)
):
    """
    Check if embeddings exist for the specified CSV file
    """
    try:
        base_filename = filename.replace(".csv", "")
        
        files_to_check = [
            f"{base_filename}_paper_data_doi_mapped_hdbscan.json",
            f"{base_filename}_paper_chunk_metadata_hdbscan.json",
            f"{base_filename}_paper_chunks_hdbscan.index"
        ]
        
        existing_files = []
        
        for file_to_check in files_to_check:
            file_path = os.path.join(settings.DATA_FOLDER, file_to_check)
            if os.path.exists(file_path):
                existing_files.append({
                    "filename": file_to_check,
                    "size": os.path.getsize(file_path),
                    "created_at": os.path.getctime(file_path)
                })
        
        return {
            "filename": filename,
            "embeddings_exist": len(existing_files) == len(files_to_check),
            "files": existing_files,
            "total_files": len(files_to_check)
        }
        
    except Exception as e:
        logger.error(f"Error checking embedding status: {e}")
        raise HTTPException(status_code=500, detail="Failed to check embedding status")