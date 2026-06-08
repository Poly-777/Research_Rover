"""
Application configuration management
"""

from pydantic_settings import BaseSettings
from functools import lru_cache
import os
from typing import Set

class Settings(BaseSettings):
    """Application settings"""
    
    # API Configuration
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "Research Rover API"
    VERSION: str = "2.0.0"
    
    # Directories
    DATA_FOLDER: str = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'data'))
    
    # Model Configuration
    EMBEDDING_MODEL: str = 'all-mpnet-base-v2'
    GEMINI_MODEL: str = 'gemini-2.5-flash'

    # ── Semantic re-ranking (retrieve-then-rerank) ──────────────────────
    # PubMed retrieves the candidate set; MedCPT (NCBI's PubMed-trained
    # bi-encoder) re-scores those candidates against the user's query so the
    # ordering reflects semantic relevance instead of the API's default
    # chronological order. Fails open: if the model can't load, search still
    # works and falls back to PubMed's order.
    RERANK_ENABLED: bool = True
    RERANK_QUERY_MODEL: str = 'ncbi/MedCPT-Query-Encoder'
    RERANK_ARTICLE_MODEL: str = 'ncbi/MedCPT-Article-Encoder'
    # Cap how many candidates we re-rank to keep CPU latency bounded; beyond
    # this, papers keep their original (most-recent) order after the ranked block.
    RERANK_MAX_CANDIDATES: int = 300
    
    # API Keys (from environment variables)
    GOOGLE_GENAI_API_KEY: str = ""
    EMAIL: str = "user@example.com"
    PUBMED_API_KEY: str = ""
    
    # Search Configuration
    DEFAULT_MAX_RESULTS: int = 10
    DEFAULT_PER_PAGE: int = 10
    MAX_PER_PAGE: int = 100
    
    # File Configuration
    MAX_FILE_SIZE: int = 100 * 1024 * 1024  # 100MB
    ALLOWED_EXTENSIONS: Set[str] = {".csv", ".json", ".zip"}
    
    # Embedding Configuration
    CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 50

    # Full-text scraping (embedding Stage 1) — concurrency + politeness controls
    SCRAPE_FULL_TEXT: bool = True   # default: scrape paper URLs for richer text
    SCRAPE_CONCURRENCY: int = 10    # max simultaneous fetches across all domains
    SCRAPE_TIMEOUT: int = 10        # per-request timeout (seconds)
    SCRAPE_MAX_PAPERS: int = 0      # 0 = no cap on how many URLs to scrape
    
    class Config:
        env_file = ".env"
        case_sensitive = True

@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()