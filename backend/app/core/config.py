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
    
    class Config:
        env_file = ".env"
        case_sensitive = True

@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()