"""
Logging configuration
"""

import logging
import sys
from pathlib import Path

def setup_logging() -> logging.Logger:
    """Setup application logging"""
    
    # Create logs directory
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)
    
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[
            logging.FileHandler(logs_dir / "research_rover.log"),
            logging.StreamHandler(sys.stdout)
        ]
    )
    
    # Get logger
    logger = logging.getLogger("research_rover")
    
    # Set specific log levels
    logging.getLogger("uvicorn").setLevel(logging.INFO)
    logging.getLogger("fastapi").setLevel(logging.INFO)
    
    return logger