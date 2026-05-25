"""
Pydantic models for request/response schemas
"""

from datetime import date
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any, Union
from enum import Enum
import re

class SearchSource(str, Enum):
    """Available search sources"""
    CORE = "core"
    PUBMED = "pubmed"

class SearchRequest(BaseModel):
    """Search request model"""
    query: str = Field(..., min_length=1, max_length=500, description="Search query")
    page: int = Field(1, ge=1, description="Page number")
    per_page: int = Field(10, ge=1, description="Results per page")
    max_results: int = Field(10, ge=1, description="Maximum results to fetch")
    start_date: Optional[date] = Field(None, description="Start date filter")
    end_date: Optional[date] = Field(None, description="End date filter")
    search_source: SearchSource = Field(SearchSource.CORE, description="Search source")
    use_raw_query: bool = Field(True, description="Pass query directly to PubMed without synonym/MeSH expansion")
    
    @validator('end_date')
    def validate_date_range(cls, v, values):
        if v and 'start_date' in values and values['start_date']:
            if v < values['start_date']:
                raise ValueError('end_date must be greater than or equal to start_date')
        return v

class Paper(BaseModel):
    """Paper model"""
    source: str = Field(..., description="Paper source")
    title: str = Field(..., description="Paper title")
    download_url: Optional[str] = Field(None, description="Download URL")
    year: Optional[str] = Field(None, description="Publication year")
    keywords: List[str] = Field(default_factory=list, description="Paper keywords")
    doi: Optional[str] = Field(None, description="DOI")
    authors: Optional[List[str]] = Field(default_factory=list, description="Authors")
    abstract: Optional[str] = Field(None, description="Abstract")

class SearchResponse(BaseModel):
    """Search response model"""
    results: List[Paper]
    csv_filename: str
    total_results: int
    current_page: int
    total_pages: int
    per_page: int
    search_source: str

class SearchProgress(BaseModel):
    """Search progress model"""
    stage: int = Field(..., description="Current stage (0-4, -1 for error)")
    sub_stage: int = Field(0, description="Sub-stage within current stage")
    message: str = Field(..., description="Progress message")
    timestamp: float = Field(..., description="Timestamp")
    status: str = Field("idle", description="Status: idle, searching, completed, error, cancelled")
    progress: int = Field(0, description="Progress percentage (0-100)")

class EmbeddingProgress(BaseModel):
    """Embedding progress model"""
    stage: int = Field(..., description="Current stage (0-3, -1 for error)")
    message: str = Field(..., description="Progress message")
    timestamp: float = Field(..., description="Timestamp")

class ChatRequest(BaseModel):
    """Chat request model"""
    message: str = Field(..., min_length=1, max_length=1000, description="Chat message")
    filename: Optional[str] = Field(None, description="CSV filename for context")

class ChatResponse(BaseModel):
    """Chat response model"""
    response: str = Field(..., description="AI response")
    sources: List[Dict[str, Any]] = Field(default_factory=list, description="Source citations")
    query: str = Field(..., description="Original query")

class FileInfo(BaseModel):
    """File information model"""
    filename: str
    size: int
    created_at: float
    file_type: str

class ErrorResponse(BaseModel):
    """Error response model"""
    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(None, description="Error details")
    code: Optional[str] = Field(None, description="Error code")

class SuccessResponse(BaseModel):
    """Generic success response"""
    message: str = Field(..., description="Success message")
    data: Optional[Dict[str, Any]] = Field(None, description="Additional data")

class PaginatedResponse(BaseModel):
    """Paginated response model"""
    results: List[Paper]
    total_results: int
    current_page: int
    total_pages: int
    per_page: int


class AnalysisRequest(BaseModel):
    """Analysis generation request model"""
    filename: str = Field(..., description="CSV filename to analyze")
    top_keywords: int = Field(100, ge=1, le=500, description="Maximum number of keywords to include in the matrix")
    minimum_frequency: int = Field(1, ge=1, description="Minimum frequency required for a keyword to be included")
    refresh: bool = Field(True, description="Rebuild analysis artifacts even if cached versions exist")


class KeywordFrequencyItem(BaseModel):
    """Keyword frequency entry"""
    keyword: str = Field(..., description="Normalized keyword")
    frequency: int = Field(..., ge=0, description="Number of papers containing the keyword")
    percentage: float = Field(..., ge=0, description="Share of papers containing the keyword")


class AnalysisPaperRecord(BaseModel):
    """Normalized paper metadata record used for analysis"""
    paper_id: str
    title: str
    source: str
    year: Optional[str] = None
    doi: Optional[str] = None
    authors: List[str] = Field(default_factory=list)
    keywords: List[str] = Field(default_factory=list)
    abstract: Optional[str] = None
    download_url: Optional[str] = None


class KeywordMatrixRow(BaseModel):
    """Single row in the keyword presence matrix"""
    paper_id: str
    title: str
    source: str
    year: Optional[str] = None
    keywords: List[str] = Field(default_factory=list)
    values: Dict[str, int] = Field(default_factory=dict)


class CoOccurrenceEdge(BaseModel):
    """Weighted keyword co-occurrence edge"""
    source: str
    target: str
    weight: int = Field(..., ge=0)


class CentralityScore(BaseModel):
    """Centrality values for a keyword node"""
    keyword: str
    degree_centrality: float = Field(..., ge=0)
    closeness_centrality: float = Field(..., ge=0)
    betweenness_centrality: float = Field(..., ge=0)
    eigenvector_centrality: float = Field(..., ge=0)
    clustering_coefficient: float = Field(..., ge=0)


class AnalysisSummary(BaseModel):
    """Summary for generated analysis artifacts"""
    filename: str
    source_file: str
    total_papers: int
    papers_with_keywords: int
    unique_keywords: int
    top_keywords_limit: int
    minimum_frequency: int
    normalized_metadata_file: str
    keyword_frequency_file: str
    keyword_presence_matrix_file: str
    summary_file: str
    generated_at: float
    keyword_frequency: List[KeywordFrequencyItem] = Field(default_factory=list)
    matrix_keywords: List[str] = Field(default_factory=list)
    matrix_rows: int = 0
    matrix_columns: int = 0
    cooccurrence_edges: List[CoOccurrenceEdge] = Field(default_factory=list)
    centrality_scores: List[CentralityScore] = Field(default_factory=list)


class AnalysisSourceInfo(BaseModel):
    """CSV source file available for analysis"""
    filename: str
    size: int
    created_at: float
    paper_count: int = 0
    has_keywords: bool = False


class KeywordMatrixResponse(BaseModel):
    """Keyword matrix response with a preview of the generated matrix"""
    filename: str
    matrix_keywords: List[str] = Field(default_factory=list)
    rows: List[KeywordMatrixRow] = Field(default_factory=list)
    total_rows: int = 0
    total_columns: int = 0
    truncated: bool = False
