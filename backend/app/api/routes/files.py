"""
File management API routes
"""

from fastapi import APIRouter, HTTPException, Depends, Query, UploadFile, File
from fastapi.responses import FileResponse
from typing import List, Optional
import os
import logging

from app.models.schemas import (
    PaginatedResponse, FileInfo, ErrorResponse, SuccessResponse
)
from app.core.config import get_settings
from app.services.search_service import SearchService

router = APIRouter()
logger = logging.getLogger("research_rover")

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    settings=Depends(get_settings)
):
    """Upload a CSV file to the data folder"""
    try:
        if not file.filename or not file.filename.endswith('.csv'):
            raise HTTPException(status_code=400, detail="Only CSV files are allowed")

        os.makedirs(settings.DATA_FOLDER, exist_ok=True)
        safe_name = os.path.basename(file.filename)
        file_path = os.path.join(settings.DATA_FOLDER, safe_name)

        content = await file.read()
        with open(file_path, 'wb') as f:
            f.write(content)

        logger.info(f"Uploaded file: {safe_name} ({len(content)} bytes)")
        return {"message": f"File {safe_name} uploaded successfully", "filename": safe_name}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading file: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload file")


@router.get("/download/{filename}")
async def download_file(
    filename: str,
    settings = Depends(get_settings)
):
    """Download a file from the data folder"""
    try:
        # Sanitize filename
        filename = "_".join(filename.split("%20"))
        file_path = os.path.join(settings.DATA_FOLDER, filename)
        
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")
        
        return FileResponse(
            path=file_path,
            filename=filename,
            media_type='application/octet-stream'
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading file {filename}: {e}")
        raise HTTPException(status_code=500, detail="Failed to download file")

@router.get("/csv/{filename}/data", response_model=List[dict])
async def get_csv_data(
    filename: str,
    settings = Depends(get_settings)
):
    """Get CSV data as JSON"""
    try:
        csv_path = os.path.join(settings.DATA_FOLDER, filename)
        
        if not os.path.exists(csv_path):
            raise HTTPException(status_code=404, detail="CSV file not found")
        
        search_service = SearchService(settings)
        papers = await search_service.load_papers_from_csv(csv_path)
        
        # Convert to dict format for response
        return [paper.dict() for paper in papers]
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error reading CSV {filename}: {e}")
        raise HTTPException(status_code=500, detail="Error processing CSV file")

@router.get("/csv/{filename}/paginated", response_model=PaginatedResponse)
async def get_paginated_csv_data(
    filename: str,
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, le=100, description="Results per page"),
    settings = Depends(get_settings)
):
    """Get paginated CSV data"""
    try:
        csv_path = os.path.join(settings.DATA_FOLDER, filename)
        
        if not os.path.exists(csv_path):
            raise HTTPException(status_code=404, detail="CSV file not found")
        
        # Check if file is empty
        if os.path.getsize(csv_path) == 0:
            raise HTTPException(status_code=404, detail="CSV file is empty")
        
        search_service = SearchService(settings)
        papers = await search_service.load_papers_from_csv(csv_path)
        
        if not papers:
            raise HTTPException(status_code=404, detail="No valid data found in CSV")
        
        # Calculate pagination
        total_results = len(papers)
        total_pages = max(1, (total_results + per_page - 1) // per_page)
        start_idx = min((page - 1) * per_page, total_results)
        end_idx = min(start_idx + per_page, total_results)
        
        return PaginatedResponse(
            results=papers[start_idx:end_idx],
            total_results=total_results,
            current_page=page,
            total_pages=total_pages,
            per_page=per_page
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting paginated CSV data: {e}")
        raise HTTPException(status_code=500, detail="Error processing CSV file")

@router.get("/list", response_model=List[FileInfo])
async def list_files(
    settings = Depends(get_settings)
):
    """List all files in the data folder"""
    try:
        files = []
        
        if os.path.exists(settings.DATA_FOLDER):
            for filename in os.listdir(settings.DATA_FOLDER):
                file_path = os.path.join(settings.DATA_FOLDER, filename)
                if os.path.isfile(file_path):
                    stat = os.stat(file_path)
                    file_info = FileInfo(
                        filename=filename,
                        size=stat.st_size,
                        created_at=stat.st_ctime,
                        file_type=os.path.splitext(filename)[1] or 'unknown'
                    )
                    files.append(file_info)
        
        return files
        
    except Exception as e:
        logger.error(f"Error listing files: {e}")
        raise HTTPException(status_code=500, detail="Error listing files")

@router.delete("/{filename}", response_model=SuccessResponse)
async def delete_file(
    filename: str,
    settings = Depends(get_settings)
):
    """Delete a file from the data folder"""
    try:
        file_path = os.path.join(settings.DATA_FOLDER, filename)
        
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="File not found")
        
        os.remove(file_path)
        
        return SuccessResponse(
            message=f"File {filename} deleted successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting file {filename}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete file")