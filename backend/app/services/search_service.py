"""
Search service for handling paper searches
"""

import asyncio
import csv
import json
import os
import sys
import re
from datetime import date
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional, Dict, Any
import logging
import pandas as pd

from app.models.schemas import Paper, SearchSource
from app.core.config import Settings

from app.services.pubmed_service import PubMedService

logger = logging.getLogger("research_rover")

# Dedicated executor so PubMed's blocking sleep() calls don't exhaust
# the default thread pool and hang the server under concurrent requests
_pubmed_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="pubmed")


class SearchService:
    """Service for handling research paper searches"""

    def __init__(self, settings: Settings):
        self.settings = settings
        # Set after a PubMed search if ESpell corrected the query and the
        # corrected spelling produced the results. None otherwise.
        self.last_corrected_query: Optional[str] = None

    def _improve_pubmed_query(self, query: str) -> str:
        """
        Lightly normalise the query for PubMed.
        Only expands well-known abbreviations; does NOT lowercase the whole
        query (PubMed is case-insensitive anyway) and does NOT strip stop
        words (they can be meaningful inside quoted phrases).
        """
        abbreviations = {
            'ml':  'machine learning',
            'ai':  'artificial intelligence',
            'dl':  'deep learning',
            'nlp': 'natural language processing',
            'cv':  'computer vision',
            'iot': 'internet of things',
            'ehr': 'electronic health records',
            'emr': 'electronic medical records',
        }

        improved = query
        for abbrev, full_term in abbreviations.items():
            # Word-boundary replacement, case-insensitive
            pattern = r'(?<![a-zA-Z])' + re.escape(abbrev) + r'(?![a-zA-Z])'
            improved = re.sub(pattern, full_term, improved, flags=re.IGNORECASE)

        if len(improved.strip()) < 3:
            return query
        return improved

    async def search_papers(
        self,
        query: str,
        max_results: int = 10,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        search_source: SearchSource = SearchSource.CORE,
        use_raw_query: bool = False,
        cancel_event: Optional[Any] = None,
    ) -> List[Dict[str, Any]]:
        """Search for papers using the specified source"""
        try:
            if search_source == SearchSource.PUBMED:
                return await self._search_pubmed(
                    query, max_results, start_date, end_date, use_raw_query, cancel_event
                )
            else:
                return await self._search_core(query, max_results, start_date, end_date)
        except Exception as e:
            logger.error(f"Error in search_papers: {e}")
            raise

    async def _search_core(
        self,
        query: str,
        max_results: int,
        start_date: Optional[date],
        end_date: Optional[date]
    ) -> List[Dict[str, Any]]:
        logger.warning("CORE search not implemented yet, returning empty results")
        return []

    async def _search_pubmed(
        self,
        query: str,
        max_results: int,
        start_date: Optional[date],
        end_date: Optional[date],
        use_raw_query: bool = False,
        cancel_event: Optional[Any] = None,
    ) -> List[Dict[str, Any]]:
        """Search using PubMed API"""
        try:
            email   = self.settings.EMAIL or 'user@example.com'
            api_key = self.settings.PUBMED_API_KEY

            # Only apply abbreviation expansion when not in raw mode
            improved_query = query if use_raw_query else self._improve_pubmed_query(query)

            logger.info(f"PubMed search - Email: {email}")
            logger.info(f"PubMed search - API key present: {bool(api_key)}")
            logger.info(f"PubMed search - Original query: {query}")
            logger.info(f"PubMed search - Improved query: {improved_query}")
            logger.info(f"PubMed search - Max results: {max_results}")
            logger.info(f"PubMed search - Date range: {start_date}-{end_date}")
            logger.info(f"PubMed search - Raw query mode: {use_raw_query}")

            if not api_key:
                logger.error("PubMed API key not found in settings")
                return []

            loop = asyncio.get_event_loop()
            self.last_corrected_query = None

            def run_pubmed_search():
                searcher = PubMedService(email=email, api_key=api_key)
                df = searcher.search_and_retrieve_optimized(
                    query=improved_query,
                    start_date=start_date,
                    end_date=end_date,
                    max_results=max_results,
                    use_raw_query=use_raw_query,
                    cancel_event=cancel_event,
                )
                return df.to_dict('records'), searcher.last_corrected_query

            # Use dedicated executor to avoid blocking the default pool
            results, corrected = await loop.run_in_executor(
                _pubmed_executor, run_pubmed_search
            )
            self.last_corrected_query = corrected
            return results or []

        except Exception as e:
            logger.error(f"Unexpected error during PubMed search: {e}")
            return []

    async def save_results_to_csv(
        self,
        results: List[Dict[str, Any]],
        csv_path: str
    ) -> List[Paper]:
        """Save search results to CSV and return processed papers"""
        try:
            if not results:
                return []

            logger.info(f"Converting {len(results)} results to DataFrame")
            df = pd.DataFrame(results)

            required_columns = ['Title', 'DOI', 'Abstract', 'Source', 'Download_URL',
                                 'Year_Published', 'Reference']
            for col in required_columns:
                if col not in df.columns:
                    if col in ('Title',):
                        df[col] = 'Unknown Title'
                    elif col == 'Reference':
                        df[col] = df.apply(
                            lambda row: (
                                f"{row.get('Title','Unknown')}. "
                                f"{row.get('Source','Unknown Journal')}. "
                                f"{row.get('Year_Published','Unknown Year')}."
                            ), axis=1
                        )
                    else:
                        df[col] = ''

            logger.info(f"DataFrame shape: {df.shape}")
            df.to_csv(csv_path, index=False, encoding='utf-8-sig')
            logger.info(f"CSV saved to {csv_path}")

            papers = []
            for result in results:
                try:
                    # --- FIX: read Authors directly (already a list from pubmed_service) ---
                    authors = result.get('Authors', [])
                    if isinstance(authors, str):
                        # Fallback: parse string representation
                        try:
                            import ast
                            authors = ast.literal_eval(authors)
                        except Exception:
                            authors = [a.strip() for a in authors.split(';') if a.strip()]
                    if not isinstance(authors, list):
                        authors = []

                    # Keywords
                    kw_raw = result.get('Keywords', [])
                    if isinstance(kw_raw, str):
                        try:
                            import ast
                            keywords = ast.literal_eval(kw_raw)
                        except Exception:
                            if ';' in kw_raw:
                                keywords = [k.strip() for k in kw_raw.split(';') if k.strip()]
                            else:
                                keywords = [k.strip() for k in kw_raw.split(',') if k.strip()]
                    elif isinstance(kw_raw, list):
                        keywords = kw_raw
                    else:
                        keywords = []

                    source = str(result.get('Source', 'Unknown')).strip() or 'Unknown'
                    title  = str(result.get('Title',  'Unknown')).strip() or 'Unknown'

                    # --- FIX: use 'DOI' key (matches pubmed_service output) ---
                    doi = str(result.get('DOI', '') or result.get('Doi', '')).strip()

                    paper = Paper(
                        source=source,
                        title=title,
                        download_url=result.get('Download_URL', ''),
                        year=str(result.get('Year_Published', 'Unknown')),
                        keywords=keywords,
                        doi=doi,
                        authors=authors,
                        abstract=result.get('Abstract', '')
                    )
                    papers.append(paper)

                except Exception as e:
                    logger.warning(f"Error processing paper, using fallback: {e}")
                    try:
                        fallback = Paper(
                            source=str(result.get('Source', 'Unknown')).strip() or 'Unknown',
                            title=str(result.get('Title',  'Unknown')).strip() or 'Unknown',
                            download_url=str(result.get('Download_URL', '')).strip(),
                            year=str(result.get('Year_Published', 'Unknown')).strip() or 'Unknown',
                            keywords=[],
                            doi=str(result.get('DOI', '') or result.get('Doi', '')).strip(),
                            authors=[],
                            abstract=str(result.get('Abstract', '')).strip()
                        )
                        papers.append(fallback)
                    except Exception as fe:
                        logger.error(f"Fallback also failed: {fe} — skipping paper")
                        continue

            logger.info(f"Paper processing: {len(results)} -> {len(papers)} papers")
            return papers

        except Exception as e:
            logger.error(f"Error saving results to CSV: {e}")
            raise

    async def load_papers_from_csv(self, csv_path: str) -> List[Paper]:
        """Load papers from CSV file"""
        papers = []
        try:
            with open(csv_path, 'r', encoding='utf-8-sig') as file:
                reader = csv.DictReader(file)
                for row in reader:
                    try:
                        paper = Paper(
                            source=str(row.get('Source', '')).strip() or 'Unknown',
                            title=str(row.get('Title', '')).strip() or 'Unknown',
                            download_url=str(row.get('Download_URL', '')).strip() or '',
                            year=str(row.get('Year_Published', '')).strip() or 'Unknown',
                            keywords=self._process_keywords(row.get('Keywords', '')),
                            doi=str(row.get('DOI', '') or row.get('Doi', '')).strip() or '',
                            authors=self._process_authors(row.get('Authors', '')),
                            abstract=str(row.get('Abstract', '')).strip() or ''
                        )
                        papers.append(paper)
                    except Exception as e:
                        logger.warning(f"Error processing CSV row: {e}")
                        continue
        except Exception as e:
            logger.error(f"Error reading CSV file {csv_path}: {e}")
            raise
        return papers

    def _process_keywords(self, keyword_value: Any) -> List[str]:
        if isinstance(keyword_value, list):
            return keyword_value
        elif isinstance(keyword_value, str):
            kw = keyword_value.strip()
            if not kw:
                return []
            if kw.startswith('[') and kw.endswith(']'):
                try:
                    return json.loads(kw.replace("'", '"'))
                except Exception:
                    return [k.strip() for k in kw.strip('[]').split(',') if k.strip()]
            return [k.strip() for k in kw.split(',') if k.strip()]
        return []

    def _process_authors(self, authors_value: Any) -> List[str]:
        if isinstance(authors_value, list):
            return authors_value
        elif isinstance(authors_value, str):
            s = authors_value.strip()
            if not s:
                return []
            for sep in [';', ',', '|']:
                if sep in s:
                    return [a.strip() for a in s.split(sep) if a.strip()]
            return [s]
        return []