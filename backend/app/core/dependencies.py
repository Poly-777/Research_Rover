"""
FastAPI dependencies
"""

from functools import lru_cache
from sentence_transformers import SentenceTransformer
import google.generativeai as genai
from app.core.config import get_settings
import logging

logger = logging.getLogger("research_rover")

@lru_cache()
def get_sentence_model() -> SentenceTransformer:
    """Get cached sentence transformer model"""
    settings = get_settings()
    
    try:
        logger.info(f"Loading sentence model: {settings.EMBEDDING_MODEL}")
        model = SentenceTransformer(settings.EMBEDDING_MODEL)
        logger.info("Sentence model loaded successfully")
        return model
    except Exception as e:
        logger.error(f"Failed to load sentence model: {e}")
        raise RuntimeError(f"Failed to load sentence model: {e}")

@lru_cache()
def get_reranker():
    """
    Get the cached MedCPT semantic re-ranker (one per process).

    Construction is cheap — the heavy model weights load lazily on the first
    rerank() call, and the re-ranker fails open if they can't be loaded, so
    this never blocks startup or breaks search.
    """
    from app.services.reranker_service import MedCPTReRanker

    settings = get_settings()
    if not settings.RERANK_ENABLED:
        logger.info("Semantic re-ranking disabled (RERANK_ENABLED=False)")
        return None

    logger.info("Initializing MedCPT re-ranker (weights load on first use)")
    return MedCPTReRanker(
        query_model=settings.RERANK_QUERY_MODEL,
        article_model=settings.RERANK_ARTICLE_MODEL,
        max_candidates=settings.RERANK_MAX_CANDIDATES,
    )


@lru_cache()
def get_llm_instance():
    """Get cached LLM instance"""
    settings = get_settings()
    
    if not settings.GOOGLE_GENAI_API_KEY:
        logger.error("Google Generative AI API key not found")
        return None
    
    try:
        genai.configure(api_key=settings.GOOGLE_GENAI_API_KEY)
        
        instruction = """You are an expert Academic Writer specializing in making complex information accessible and easy to understand.

**Core Responsibilities:**
1. **Answer from Context:** Respond to questions *strictly* based on the provided context documents. Do not use external knowledge. If the answer isn't in the context, state so clearly.
2. **Paraphrase & Synthesize:** Accurately rephrase information in your own words. Synthesize findings where appropriate. Do NOT copy text directly.
3. **Cite Accurately:** Provide citations (e.g., [1], [2][4]) at the end of the sentence or group of sentences supported by the cited source(s). Every piece of information must be cited.

**Formatting for Readability:**
* **Adapt Format:** Structure your response based on the query type and answer length.
* **Use Bullet Points:** For lists, multiple steps, distinct points, or breaking down complex information, use bullet points (`*` or `-`) for clarity.
* **Use Bold Text:** Highlight **key terms**, main findings, important entities, or definitions using bold formatting (`**term**`).
* **Paragraphs:** For short, direct answers or introductory/concluding remarks, well-structured paragraphs are suitable.
* **Goal:** Ensure the final answer is not only accurate and well-cited but also highly readable and easy to scan.

**Clarity:** Define all pronouns clearly. Avoid ambiguity.
"""
        
        model = genai.GenerativeModel(settings.GEMINI_MODEL, system_instruction=instruction)
        logger.info("LLM instance created successfully")
        return model
        
    except Exception as e:
        logger.error(f"Error creating LLM instance: {e}")
        return None