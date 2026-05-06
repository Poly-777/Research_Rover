"""
Analysis API routes for metadata-driven keyword analytics.
"""

import logging
import os
import time
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.config import get_settings
from app.models.schemas import (
    AnalysisRequest,
    AnalysisSourceInfo,
    AnalysisSummary,
    KeywordMatrixResponse,
    SuccessResponse,
)
from app.services.analysis_service import AnalysisService

router = APIRouter()
logger = logging.getLogger("research_rover")


@router.get("/files", response_model=List[AnalysisSourceInfo])
async def list_analysis_files(settings=Depends(get_settings)):
    """List CSV files that can be used as analysis sources."""
    try:
        service = AnalysisService(settings)
        sources = service.list_analysis_sources()
        return [AnalysisSourceInfo(**source) for source in sources]
    except Exception as e:
        logger.error("Error listing analysis files: %s", e)
        raise HTTPException(status_code=500, detail="Failed to list analysis files")


@router.post("/generate", response_model=AnalysisSummary)
async def generate_analysis(
    request: AnalysisRequest,
    settings=Depends(get_settings),
):
    """Generate phases 1-5 analysis artifacts for a CSV file."""
    try:
        service = AnalysisService(settings)
        result = service.build_analysis_artifacts(
            filename=request.filename,
            top_keywords=request.top_keywords,
            minimum_frequency=request.minimum_frequency,
            refresh=request.refresh,
        )
        return AnalysisSummary(**result)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Error generating analysis for %s: %s", request.filename, e)
        raise HTTPException(status_code=500, detail="Failed to generate analysis")


@router.get("/{filename}/summary", response_model=AnalysisSummary)
async def get_analysis_summary(
    filename: str,
    refresh: bool = Query(False, description="Regenerate artifacts if summary is missing"),
    settings=Depends(get_settings),
):
    """Load a cached analysis summary, or generate one if requested."""
    try:
        service = AnalysisService(settings)
        if refresh:
            result = service.build_analysis_artifacts(filename=filename, refresh=True)
        else:
            try:
                result = service.load_analysis_summary(filename)
            except FileNotFoundError:
                result = service.build_analysis_artifacts(filename=filename, refresh=True)
        return AnalysisSummary(**result)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Error loading analysis summary for %s: %s", filename, e)
        raise HTTPException(status_code=500, detail="Failed to load analysis summary")


@router.get("/{filename}/matrix", response_model=KeywordMatrixResponse)
async def get_keyword_matrix(
    filename: str,
    preview_rows: int = Query(25, ge=1, le=100, description="Number of rows to preview"),
    settings=Depends(get_settings),
):
    """Return a preview of the keyword presence matrix."""
    try:
        service = AnalysisService(settings)
        result = service.load_keyword_matrix(filename, preview_rows=preview_rows)
        return KeywordMatrixResponse(**result)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Error loading keyword matrix for %s: %s", filename, e)
        raise HTTPException(status_code=500, detail="Failed to load keyword matrix")


@router.post("/{filename}/regenerate", response_model=SuccessResponse)
async def regenerate_analysis(
    filename: str,
    top_keywords: int = Query(100, ge=1, le=500),
    minimum_frequency: int = Query(1, ge=1),
    settings=Depends(get_settings),
):
    """Convenience endpoint to rebuild analysis artifacts for a CSV file."""
    try:
        service = AnalysisService(settings)
        service.build_analysis_artifacts(
            filename=filename,
            top_keywords=top_keywords,
            minimum_frequency=minimum_frequency,
            refresh=True,
        )
        return SuccessResponse(
            message=f"Analysis regenerated for {filename}",
            data={
                "filename": filename,
                "generated_at": time.time(),
            },
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Error regenerating analysis for %s: %s", filename, e)
        raise HTTPException(status_code=500, detail="Failed to regenerate analysis")
