"""
Search API routes
"""

from datetime import date
from fastapi import APIRouter, BackgroundTasks, Depends, Query
from typing import Optional, List
import asyncio
import threading
import time
import os
import re
import logging

from app.models.schemas import (
    SearchRequest, SearchResponse, SearchProgress,
    SearchSource, Paper
)
from app.core.config import get_settings
from app.services.search_service import SearchService

router = APIRouter()
logger = logging.getLogger("research_rover")

# Global progress tracking
search_progress_state = {
    "stage": 0,
    "sub_stage": 0,
    "message": "Not started",
    "timestamp": time.time(),
    "status": "idle",
    "progress": 0
}

# Store results from the most recently completed search so the frontend
# can retrieve them after the background task finishes.
_last_results: List[Paper] = []
_last_csv_filename: str = ""
_last_search_source: str = "pubmed"

# Handle to the running search task and a cooperative cancel flag, so a
# POST /search/cancel can both interrupt the asyncio task and stop the
# blocking PubMed fetch loop running in the thread pool.
_current_search_task: Optional["asyncio.Task"] = None
_cancel_event: Optional[threading.Event] = None


@router.get("/progress", response_model=SearchProgress)
async def get_search_progress():
    """Get current search progress"""
    return SearchProgress(**search_progress_state)


@router.post("/cancel")
async def cancel_search():
    """
    Cancel the in-flight search, if any.

    Sets a cooperative cancel flag (stops the PubMed fetch loop between
    pages) and cancels the background asyncio task (frees it from the
    blocking thread-pool call immediately). Safe to call when nothing is
    running — it's a no-op.
    """
    global search_progress_state, _current_search_task, _cancel_event, _last_results, _last_csv_filename

    running = (
        search_progress_state.get("status") == "searching"
        or (_current_search_task is not None and not _current_search_task.done())
    )

    if _cancel_event is not None:
        _cancel_event.set()
    if _current_search_task is not None and not _current_search_task.done():
        _current_search_task.cancel()

    if running:
        _last_results = []
        _last_csv_filename = ""
        search_progress_state = {
            "stage": 0,
            "sub_stage": 0,
            "message": "Search cancelled",
            "timestamp": time.time(),
            "status": "cancelled",
            "progress": 0,
        }
        logger.info("Search cancelled by user request")

    return {"cancelled": running, "message": "Search cancelled" if running else "No active search"}


@router.get("/results", response_model=SearchResponse)
async def get_search_results(
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, description="Results per page"),
):
    """Return paginated results from the most recently completed search."""
    global _last_results, _last_csv_filename, _last_search_source
    total = len(_last_results)
    total_pages = (total + per_page - 1) // per_page if total > 0 else 0
    start = (page - 1) * per_page
    end = min(start + per_page, total)
    return SearchResponse(
        results=_last_results[start:end],
        csv_filename=_last_csv_filename,
        total_results=total,
        current_page=page,
        total_pages=total_pages,
        per_page=per_page,
        search_source=_last_search_source,
    )


async def _perform_search_with_progress(
    request: SearchRequest, settings, cancel_event: Optional[threading.Event] = None
):
    """Perform search in the background with progress tracking."""
    global search_progress_state, _last_results, _last_csv_filename, _last_search_source

    def _cancelled() -> bool:
        return cancel_event is not None and cancel_event.is_set()

    def _mark_cancelled():
        global search_progress_state, _last_results, _last_csv_filename
        search_progress_state = {
            "stage": 0,
            "sub_stage": 0,
            "message": "Search cancelled",
            "timestamp": time.time(),
            "status": "cancelled",
            "progress": 0,
        }
        _last_results = []
        _last_csv_filename = ""

    try:
        logger.info(f"Starting background search: {request.query}")

        # Ensure data folder exists
        search_progress_state = {
            "stage": 0,
            "sub_stage": 0,
            "message": "Initializing search",
            "timestamp": time.time(),
            "status": "searching",
            "progress": 5
        }

        os.makedirs(settings.DATA_FOLDER, exist_ok=True)
        await asyncio.sleep(0.3)

        search_service = SearchService(settings)

        search_progress_state = {
            "stage": 1,
            "sub_stage": 0,
            "message": f"Querying {'PubMed' if request.search_source == SearchSource.PUBMED else 'CORE'} API",
            "timestamp": time.time(),
            "status": "searching",
            "progress": 15
        }

        await asyncio.sleep(0.5)

        results = await search_service.search_papers(
            query=request.query,
            max_results=request.max_results,
            start_date=request.start_date,
            end_date=request.end_date,
            search_source=request.search_source,
            use_raw_query=request.use_raw_query,
            cancel_event=cancel_event,
            sort_mode=request.sort_mode,
        )

        # The fetch loop honours the cancel flag between PubMed pages, so it
        # may return partial/empty results after a cancel — discard them.
        if _cancelled():
            logger.info("Search cancelled — discarding results")
            _mark_cancelled()
            return

        if not results:
            search_progress_state = {
                "stage": 4,
                "sub_stage": 0,
                "message": "Search completed — no results found",
                "timestamp": time.time(),
                "status": "completed",
                "progress": 100
            }
            _last_results = []
            _last_csv_filename = ""
            return

        corrected = getattr(search_service, "last_corrected_query", None)
        found_message = f"Found {len(results)} papers, extracting metadata"
        if corrected:
            found_message = (
                f"Showing results for \"{corrected}\" "
                f"(corrected from \"{request.query}\") — "
                f"found {len(results)} papers, extracting metadata"
            )

        search_progress_state = {
            "stage": 2,
            "sub_stage": 0,
            "message": found_message,
            "timestamp": time.time(),
            "status": "searching",
            "progress": 60
        }

        await asyncio.sleep(0.5)

        csv_filename = f'{re.sub(r"[^a-zA-Z0-9]", "_", request.query)}.csv'
        csv_path = os.path.join(settings.DATA_FOLDER, csv_filename)

        search_progress_state = {
            "stage": 3,
            "sub_stage": 0,
            "message": "Processing and saving paper data",
            "timestamp": time.time(),
            "status": "searching",
            "progress": 80
        }

        await asyncio.sleep(0.5)

        processed_results = await search_service.save_results_to_csv(results, csv_path)

        if not os.path.exists(csv_path):
            search_progress_state = {
                "stage": -1,
                "sub_stage": 0,
                "message": "Failed to create CSV file",
                "timestamp": time.time(),
                "status": "error",
                "progress": 0
            }
            return

        # Store results for GET /results
        _last_results = processed_results
        _last_csv_filename = csv_filename
        _last_search_source = request.search_source.value

        complete_message = f"Search complete — {len(processed_results)} papers saved"
        if corrected:
            complete_message = (
                f"Showing results for \"{corrected}\" "
                f"(corrected from \"{request.query}\") — "
                f"{len(processed_results)} papers saved"
            )

        search_progress_state = {
            "stage": 4,
            "sub_stage": 0,
            "message": complete_message,
            "timestamp": time.time(),
            "status": "completed",
            "progress": 100
        }

    except asyncio.CancelledError:
        logger.info("Background search task cancelled")
        _mark_cancelled()
        raise
    except Exception as e:
        logger.error(f"Background search error: {str(e)}")
        search_progress_state = {
            "stage": -1,
            "sub_stage": 0,
            "message": f"Error: {str(e)}",
            "timestamp": time.time(),
            "status": "error",
            "progress": 0
        }


@router.post("/", response_model=SearchResponse)
async def search_papers(
    request: SearchRequest,
    background_tasks: BackgroundTasks,
    settings=Depends(get_settings)
):
    """
    Start a paper search. Returns immediately; poll GET /search/progress for
    status and call GET /search/results when status == "completed".
    """
    global search_progress_state, _last_results, _last_csv_filename
    global _current_search_task, _cancel_event

    logger.info(f"Starting search: {request.query}")

    # Cancel any search still running before starting a new one.
    if _cancel_event is not None:
        _cancel_event.set()
    if _current_search_task is not None and not _current_search_task.done():
        _current_search_task.cancel()

    # Reset state immediately so the frontend sees "searching" from the first poll
    _last_results = []
    _last_csv_filename = ""
    search_progress_state = {
        "stage": 0,
        "sub_stage": 0,
        "message": "Initializing search",
        "timestamp": time.time(),
        "status": "searching",
        "progress": 0
    }

    # Fresh cancel flag for this search; fire it in the background — do NOT await it
    _cancel_event = threading.Event()
    _current_search_task = asyncio.create_task(
        _perform_search_with_progress(request, settings, _cancel_event)
    )

    # Return immediately so the HTTP connection is freed
    return SearchResponse(
        results=[],
        csv_filename="",
        total_results=0,
        current_page=1,
        total_pages=0,
        per_page=request.per_page,
        search_source=request.search_source.value,
    )


@router.get("/", response_model=SearchResponse)
async def search_papers_get(
    query: str = Query(..., description="Search query"),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(10, ge=1, description="Results per page"),
    max_results: int = Query(10, ge=1, description="Maximum results"),
    start_date: Optional[date] = Query(None, description="Start date"),
    end_date: Optional[date] = Query(None, description="End date"),
    search_source: SearchSource = Query(SearchSource.CORE, description="Search source"),
    use_raw_query: bool = Query(False, description="Pass query directly to PubMed"),
    sort_mode: str = Query("relevance", description="Ordering: 'relevance' or 'recency'"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    settings=Depends(get_settings)
):
    """Search for research papers (GET method for compatibility)"""
    request = SearchRequest(
        query=query,
        page=page,
        per_page=per_page,
        max_results=max_results,
        start_date=start_date,
        end_date=end_date,
        search_source=search_source,
        use_raw_query=use_raw_query,
        sort_mode=sort_mode,
    )
    return await search_papers(request, background_tasks, settings)
