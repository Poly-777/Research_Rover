"""
Embedding service for creating and managing vector embeddings
"""

import os
import sys
import time
import asyncio
import faiss
import json
import pandas as pd
from typing import Dict, Any, Optional
import logging
from crawl4ai import AsyncWebCrawler
import numpy as np
from app.core.config import Settings

# Import original embedding functions
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'backend'))

from features.embedding_and_indexing import (
    build_faiss_index,
    save_metadata_list,
    save_doi_mapped_json,
    load_data,
)

logger = logging.getLogger("research_rover")

class EmbeddingService:
    """Service for handling embedding creation and management"""
    
    def __init__(self, settings: Settings, sentence_model):
        self.settings = settings
        self.sentence_model = sentence_model
    
    async def extract_full_text_to_json(
        self,
        csv_path: str,
        progress_state: Optional[Dict[str, Any]] = None,
        scrape_full_text: bool = True,
        max_scrape: int = 0,
        cancel_event=None,
    ) -> str:
        """
        Extract full text from URLs in CSV and save to a JSON file mapping
        unique_id -> full_text.

        URLs are fetched concurrently (bounded by SCRAPE_CONCURRENCY) with
        per-domain serialization so we stay polite to any single host without
        a global fixed delay. When scrape_full_text is False (or no URLs are
        present) we skip the network entirely and fall back to abstracts, which
        makes this stage near-instant.
        """
        df = load_data(csv_path)

        # Seed every paper with its abstract as default text, and collect the
        # URLs worth scraping.
        full_text_mapping: Dict[str, str] = {}
        to_fetch = []  # (unique_id, url)
        for index, row in df.iterrows():
            doi = str(row.get('Doi') or row.get('DOI') or '')
            unique_id = doi if doi and doi != 'nan' and doi != 'Unknown DOI' else f"paper_{index}"
            abstract = str(row.get('Abstract', ''))
            full_text_mapping[unique_id] = abstract if abstract and abstract != 'nan' else ''

            url = str(row.get('Download_URL', ''))
            if scrape_full_text and url and url != 'nan' and url.startswith('http'):
                to_fetch.append((unique_id, url))

        if max_scrape and max_scrape > 0:
            to_fetch = to_fetch[:max_scrape]

        base_filename = os.path.basename(csv_path).replace(".csv", "")
        full_text_json_path = os.path.join(
            self.settings.DATA_FOLDER,
            f"{base_filename}_full_text_mapping.json"
        )

        # Fast path: nothing to scrape — write abstracts and return.
        if not to_fetch:
            logger.info("Skipping full-text scraping (disabled or no URLs); using abstracts only.")
            with open(full_text_json_path, 'w', encoding='utf-8') as f:
                json.dump(full_text_mapping, f, indent=2, ensure_ascii=False)
            return full_text_json_path

        total_urls = len(to_fetch)
        timeout = getattr(self.settings, 'SCRAPE_TIMEOUT', 10)
        concurrency = max(1, getattr(self.settings, 'SCRAPE_CONCURRENCY', 10))
        logger.info(f"Scraping full text for {total_urls} URLs (concurrency={concurrency}, timeout={timeout}s)...")

        import requests
        from bs4 import BeautifulSoup
        from urllib.parse import urlparse

        session = requests.Session()
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                          '(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        })

        def extract_single_url(url: str):
            """Blocking fetch + parse for one URL; returns cleaned text or None."""
            try:
                response = session.get(url, timeout=timeout)
                response.raise_for_status()
                soup = BeautifulSoup(response.content, 'html.parser')
                for element in soup(['script', 'style', 'nav', 'header', 'footer', 'aside']):
                    element.decompose()
                content_selectors = [
                    'article', '.article-content', '.paper-content',
                    '.full-text', 'main', '.content', '.abstract',
                    '#abstract', '.abstract-content'
                ]
                full_text = ""
                for selector in content_selectors:
                    elements = soup.select(selector)
                    if elements:
                        full_text = ' '.join(elem.get_text(strip=True) for elem in elements)
                        break
                if not full_text:
                    full_text = soup.get_text(strip=True)
                full_text = ' '.join(full_text.split())  # normalize whitespace
                if full_text and len(full_text.split()) > 100:
                    return full_text
                return None
            except Exception as e:
                logger.error(f"Error extracting from {url}: {e}")
                return None

        loop = asyncio.get_event_loop()
        semaphore = asyncio.Semaphore(concurrency)
        domain_locks: Dict[str, asyncio.Lock] = {}
        completed = 0
        extracted_count = 0

        def domain_lock_for(url: str) -> asyncio.Lock:
            host = urlparse(url).netloc
            lock = domain_locks.get(host)
            if lock is None:
                lock = asyncio.Lock()
                domain_locks[host] = lock
            return lock

        async def fetch_one(unique_id: str, url: str):
            nonlocal completed, extracted_count
            # Bail out fast on cancel — skip the network call for remaining URLs.
            if cancel_event is not None and cancel_event.is_set():
                completed += 1
                return
            # Per-domain lock first (so same-host requests queue without holding
            # a concurrency slot), then the global semaphore caps total parallelism.
            async with domain_lock_for(url):
                async with semaphore:
                    full_text = await loop.run_in_executor(None, extract_single_url, url)
            if full_text:
                full_text_mapping[unique_id] = full_text
                extracted_count += 1
            completed += 1
            if progress_state is not None:
                progress_state.update({
                    "stage": 1,
                    "message": f"Extracting full text {completed} of {total_urls}",
                    "percent": round(5 + (completed / max(total_urls, 1)) * 45, 1),
                    "timestamp": time.time()
                })

        await asyncio.gather(*(fetch_one(uid, url) for uid, url in to_fetch))
        session.close()

        logger.info(f"✅ Full text extraction completed: {extracted_count}/{total_urls} successful extractions")

        with open(full_text_json_path, 'w', encoding='utf-8') as f:
            json.dump(full_text_mapping, f, indent=2, ensure_ascii=False)

        logger.info(f"📄 Full text mapping saved to {full_text_json_path}")
        return full_text_json_path
    
    def load_csv_data_clean(self, csv_path: str):
        """
        Load CSV data without adding Full_Text column (clean approach)
        """
        logger.info(f"Loading CSV data from {csv_path}...")
        try:
            df = pd.read_csv(csv_path)
            
            # Ensure required columns exist with proper defaults (NO Full_Text column)
            required_columns = {'Title', 'Abstract'}
            missing_columns = required_columns - set(df.columns)
            
            if missing_columns:
                logger.warning(f"Missing columns: {missing_columns}. Adding defaults...")
                
                if 'Title' not in df.columns:
                    df['Title'] = 'Unknown Title'
                    logger.info("Added Title column with default values")
                
                if 'Abstract' not in df.columns:
                    df['Abstract'] = ''
                    logger.info("Added Abstract column with empty values")
            
            # Ensure other expected columns exist
            expected_columns = ['Abstract', 'DOI', 'Title', 'Reference', 'Source', 'Download_URL', 'Year_Published']
            for col in expected_columns:
                if col not in df.columns:
                    if col == 'Reference':
                        df[col] = ''
                    elif col == 'Year_Published':
                        df[col] = 0
                    else:
                        df[col] = ''
                    logger.info(f"Added missing column: {col}")
            
            # Handle data types properly
            df['Abstract'] = df['Abstract'].fillna('').astype(str)
            if 'DOI' in df.columns:
                df['DOI'] = df['DOI'].fillna('').astype(str)
            if 'Doi' in df.columns:
                df['Doi'] = df['Doi'].fillna('').astype(str)
            if 'DOI' not in df.columns and 'Doi' in df.columns:
                df['DOI'] = df['Doi']
            if 'Doi' not in df.columns and 'DOI' in df.columns:
                df['Doi'] = df['DOI']
            if 'DOI' not in df.columns:
                df['DOI'] = 'Unknown DOI'
            if 'Doi' not in df.columns:
                df['Doi'] = df['DOI']
            df['Title'] = df['Title'].fillna('Unknown Title').astype(str)
            df['Reference'] = df['Reference'].fillna('').astype(str)
            df['Source'] = df['Source'].fillna('').astype(str)
            df['Download_URL'] = df['Download_URL'].fillna('').astype(str)
            df['Year_Published'] = df['Year_Published'].fillna(0)
            
            logger.info(f"✅ CSV data loaded successfully: {len(df)} rows, {len(df.columns)} columns")
            return df
            
        except Exception as e:
            logger.error(f"Error loading CSV data: {e}")
            raise

    def process_data_with_json_mapping(self, csv_path: str, full_text_json_path: str, sentence_model, progress_state: Optional[Dict[str, Any]] = None, cancel_event=None):
        """
        Process data using JSON mapping for full text instead of modifying CSV
        """
        import nltk
        from nltk.tokenize import sent_tokenize
        import hdbscan
        import numpy as np

        try:
            nltk.data.find('tokenizers/punkt_tab')
        except LookupError:
            logger.info("NLTK 'punkt_tab' not found, downloading...")
            nltk.download('punkt_tab', quiet=True)
        
        # Load CSV data without Full_Text column
        df = self.load_csv_data_clean(csv_path)
        
        # Load full text mapping if available
        full_text_mapping = {}
        if full_text_json_path and os.path.exists(full_text_json_path):
            try:
                with open(full_text_json_path, 'r', encoding='utf-8') as f:
                    full_text_mapping = json.load(f)
                logger.info(f"📄 Loaded full text mapping with {len(full_text_mapping)} entries")
            except Exception as e:
                logger.warning(f"Failed to load full text mapping: {e}")
        
        logger.info("Processing data with JSON mapping and generating embeddings...")
        all_vectors = []
        all_chunk_metadata = []
        doc_chunk_counter = {}
        total_papers = len(df)

        for index, row in df.iterrows():
            if cancel_event is not None and cancel_event.is_set():
                logger.info("Embedding processing cancelled mid-run")
                return None, None
            if progress_state is not None:
                progress_state.update({
                    "stage": 2,
                    "message": f"Generating embeddings for paper {index + 1} of {total_papers} ({len(all_vectors)} chunks so far)",
                    "percent": round(50 + (index / max(total_papers, 1)) * 45, 1),
                    "timestamp": time.time()
                })

            doi = str(row.get('Doi') or row.get('DOI') or 'Unknown DOI')
            
            # Create unique ID (same logic as extraction)
            unique_id = doi if doi and doi != 'nan' and doi != 'Unknown DOI' else f"paper_{index}"
            
            # Get full text from mapping, fallback to abstract
            full_text = full_text_mapping.get(unique_id, '')
            if not full_text.strip():
                abstract = str(row.get('Abstract', ''))
                full_text = abstract if abstract and abstract != 'nan' else ''
            
            if not full_text.strip():
                logger.warning(f"No text content available for {unique_id}, skipping")
                continue
            
            # Tokenize sentences
            try:
                sentences = sent_tokenize(full_text)
                if not sentences:
                    continue
            except Exception as e:
                logger.error(f"Error tokenizing sentences for {unique_id}: {e}. Skipping.")
                continue
            
            # Encode all sentences
            try:
                sentence_embeddings = sentence_model.encode(sentences, show_progress_bar=False, batch_size=64)
                sentence_embeddings = sentence_embeddings.astype('float32')
                faiss.normalize_L2(sentence_embeddings)
            except Exception as e:
                logger.error(f"Error encoding sentences for {unique_id}: {e}. Skipping.")
                continue
            
            # Perform semantic chunking with HDBSCAN
            chunk_indices_lists = self.semantic_chunking_hdbscan(sentences, sentence_embeddings)
            if not chunk_indices_lists:
                continue
            
            # Split oversized chunks
            final_chunk_indices_lists = self.split_oversized_chunks(chunk_indices_lists, sentences)
            if not final_chunk_indices_lists:
                continue
            
            # Reset chunk counter for new document
            doc_chunk_counter[doi] = 0
            
            # Generate embeddings for final chunks
            for chunk_indices in final_chunk_indices_lists:
                if not chunk_indices:
                    continue
                
                # Compute chunk embedding as mean of sentence embeddings
                chunk_embedding = np.mean(sentence_embeddings[chunk_indices], axis=0)
                chunk_text = " ".join([sentences[i] for i in chunk_indices])
                
                metadata = {
                    "text": chunk_text,
                    "paperTitle": str(row.get('Title', '')),
                    "doi": doi,
                    "source": str(row.get('Source', '')),
                    "yearPublished": int(row.get('Year_Published', 0)) if pd.notna(row.get('Year_Published')) else 0,
                    "chunk_index_in_doc": doc_chunk_counter[doi]
                }
                
                all_vectors.append(chunk_embedding)
                all_chunk_metadata.append(metadata)
                doc_chunk_counter[doi] += 1
            
            if (index + 1) % 50 == 0:
                logger.info(f"  Processed {index + 1}/{len(df)} papers...")
        
        if not all_vectors:
            logger.error("No vectors were generated.")
            return None, None
        
        logger.info(f"✅ Generated {len(all_vectors)} chunks from {len(df)} papers")
        return np.array(all_vectors).astype('float32'), all_chunk_metadata
    
    def semantic_chunking_hdbscan(self, sentences: list, embeddings, min_cluster_size=3):
        """Semantic chunking using HDBSCAN"""
        import hdbscan
        import numpy as np
        
        if len(sentences) < min_cluster_size:
            return [list(range(len(sentences)))]
        
        try:
            clusterer = hdbscan.HDBSCAN(min_cluster_size=min_cluster_size, metric='euclidean', allow_single_cluster=True)
            labels = clusterer.fit_predict(embeddings)
        except Exception as e:
            logger.warning(f"HDBSCAN clustering failed: {e}. Using single chunk.")
            return [list(range(len(sentences)))]
        
        # Group sentence indices by cluster labels
        chunks_dict = {}
        for i, label in enumerate(labels):
            cluster_label = str(label) if label != -1 else f"noise_{i}"
            if cluster_label not in chunks_dict:
                chunks_dict[cluster_label] = []
            chunks_dict[cluster_label].append(i)
        
        # Sort clusters for consistency
        sorted_keys = sorted(chunks_dict.keys(), key=lambda k: int(k) if k.isdigit() or (k.startswith('-') and k[1:].isdigit()) else float('inf'))
        return [chunks_dict[label] for label in sorted_keys]
    
    def split_oversized_chunks(self, chunk_indices_lists: list, sentences: list, max_tokens: int = 800):
        """Split chunks that exceed max_tokens"""
        final_chunks = []
        for chunk_indices in chunk_indices_lists:
            chunk_tokens = sum(len(sentences[i].split()) for i in chunk_indices)
            if chunk_tokens <= max_tokens:
                final_chunks.append(chunk_indices)
            else:
                logger.info(f"  Splitting oversized chunk ({chunk_tokens} tokens)")
                current_sub_chunk_indices = []
                current_tokens = 0
                for idx in chunk_indices:
                    sentence_tokens = len(sentences[idx].split())
                    if current_tokens + sentence_tokens > max_tokens:
                        if current_sub_chunk_indices:
                            final_chunks.append(current_sub_chunk_indices)
                        if sentence_tokens > max_tokens:
                            logger.warning(f"   Single sentence exceeds max tokens ({sentence_tokens}/{max_tokens})")
                            final_chunks.append([idx])
                        else:
                            current_sub_chunk_indices = [idx]
                            current_tokens = sentence_tokens
                    else:
                        current_sub_chunk_indices.append(idx)
                        current_tokens += sentence_tokens
                if current_sub_chunk_indices:
                    final_chunks.append(current_sub_chunk_indices)
        return [c for c in final_chunks if c]
    
    async def create_embeddings_async(
        self,
        csv_path: str,
        progress_state: Dict[str, Any],
        scrape_full_text: bool = True,
        max_scrape: int = 0,
        cancel_event=None,
    ):
        """
        Create embeddings asynchronously with progress tracking
        """
        start_time = time.time()

        def _cancelled() -> bool:
            return cancel_event is not None and cancel_event.is_set()

        def _mark_cancelled():
            progress_state.update({
                "stage": -1,
                "message": "Embedding creation cancelled",
                "timestamp": time.time()
            })
            logger.info("Embedding creation cancelled")
        
        try:
            # Update progress
            progress_state.update({
                "stage": 1,
                "message": "Loading embedding model",
                "percent": 2.0,
                "timestamp": time.time()
            })
            
            # Generate file paths
            base_filename = os.path.basename(csv_path).replace(".csv", "")
            json_doi_mapped_path = os.path.join(
                self.settings.DATA_FOLDER, 
                f"{base_filename}_paper_data_doi_mapped_hdbscan.json"
            )
            metadata_path = os.path.join(
                self.settings.DATA_FOLDER, 
                f"{base_filename}_paper_chunk_metadata_hdbscan.json"
            )
            faiss_index_path = os.path.join(
                self.settings.DATA_FOLDER, 
                f"{base_filename}_paper_chunks_hdbscan.index"
            )
            
            # Extract full text from URLs (parallel; skipped when disabled)
            progress_state.update({
                "stage": 1,
                "message": "Extracting full text from paper URLs" if scrape_full_text
                           else "Preparing abstracts (full-text scraping disabled)",
                "percent": 5.0,
                "timestamp": time.time()
            })

            # Extract full text to JSON mapping (cleaner approach)
            try:
                logger.info("🔍 EXTRACTING FULL TEXT FROM URLs TO JSON MAPPING (cleaner approach)")
                full_text_json_path = await self.extract_full_text_to_json(
                    csv_path, progress_state,
                    scrape_full_text=scrape_full_text,
                    max_scrape=max_scrape,
                    cancel_event=cancel_event,
                )
            except Exception as e:
                logger.warning(f"Full text extraction failed: {e}, will use abstracts during processing")
                full_text_json_path = None

            if _cancelled():
                _mark_cancelled()
                return

            # Update progress
            progress_state.update({
                "stage": 2,
                "message": "Processing data and generating embeddings",
                "percent": 50.0,
                "timestamp": time.time()
            })

            # Process data and generate vectors using JSON mapping
            loop = asyncio.get_event_loop()
            all_vectors, all_chunk_metadata = await loop.run_in_executor(
                None,
                self.process_data_with_json_mapping,
                csv_path,
                full_text_json_path,
                self.sentence_model,
                progress_state,
                cancel_event
            )

            if _cancelled():
                _mark_cancelled()
                return

            if all_vectors is None or all_chunk_metadata is None:
                progress_state.update({
                    "stage": -1,
                    "message": "Failed to process data",
                    "timestamp": time.time()
                })
                return
            
            if _cancelled():
                _mark_cancelled()
                return

            # Build FAISS index
            progress_state.update({
                "stage": 2,
                "message": f"Building FAISS index from {len(all_vectors)} chunks",
                "percent": 96.0,
                "timestamp": time.time()
            })
            faiss_index = await loop.run_in_executor(
                None,
                build_faiss_index,
                all_vectors
            )
            
            if faiss_index is None:
                progress_state.update({
                    "stage": -1,
                    "message": "Failed to build FAISS index",
                    "timestamp": time.time()
                })
                return
            
            # Save files
            progress_state.update({
                "stage": 2,
                "message": "Saving index and metadata to disk",
                "percent": 98.0,
                "timestamp": time.time()
            })
            try:
                # Save FAISS index
                await loop.run_in_executor(
                    None,
                    faiss.write_index,
                    faiss_index,
                    faiss_index_path
                )
                
                # Save metadata
                await loop.run_in_executor(
                    None,
                    save_metadata_list,
                    all_chunk_metadata,
                    metadata_path
                )
                
                # Save DOI mapped JSON
                await loop.run_in_executor(
                    None,
                    save_doi_mapped_json,
                    all_chunk_metadata,
                    json_doi_mapped_path
                )
                
            except Exception as e:
                progress_state.update({
                    "stage": -1,
                    "message": f"Failed to save files: {str(e)}",
                    "timestamp": time.time()
                })
                return
            
            # Update progress - complete
            end_time = time.time()
            progress_state.update({
                "stage": 3,
                "message": f"Embeddings created successfully in {end_time - start_time:.2f} seconds",
                "percent": 100.0,
                "timestamp": time.time()
            })
            
            logger.info(f"Embeddings created successfully for {csv_path} in {end_time - start_time:.2f} seconds")
            
        except Exception as e:
            logger.error(f"Error creating embeddings: {e}")
            progress_state.update({
                "stage": -1,
                "message": f"Error: {str(e)}",
                "timestamp": time.time()
            })
    
    def create_embeddings_sync(self, csv_path: str) -> bool:
        """
        Create embeddings synchronously (for testing or direct calls)
        """
        try:
            # Generate file paths
            base_filename = os.path.basename(csv_path).replace(".csv", "")
            json_doi_mapped_path = os.path.join(
                self.settings.DATA_FOLDER, 
                f"{base_filename}_paper_data_doi_mapped_hdbscan.json"
            )
            metadata_path = os.path.join(
                self.settings.DATA_FOLDER, 
                f"{base_filename}_paper_chunk_metadata_hdbscan.json"
            )
            faiss_index_path = os.path.join(
                self.settings.DATA_FOLDER, 
                f"{base_filename}_paper_chunks_hdbscan.index"
            )
            
            # Extract full text to JSON mapping
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                full_text_json_path = loop.run_until_complete(self.extract_full_text_to_json(csv_path))
                loop.close()
            except Exception as e:
                logger.warning(f"Full text extraction failed: {e}, will use abstracts during processing")
                full_text_json_path = None
            
            # Process data and generate vectors using JSON mapping
            all_vectors, all_chunk_metadata = self.process_data_with_json_mapping(
                csv_path, full_text_json_path, self.sentence_model
            )
            
            if all_vectors is None or all_chunk_metadata is None:
                return False
            
            # Build FAISS index
            faiss_index = build_faiss_index(all_vectors)
            
            if faiss_index is None:
                return False
            
            # Save files
            faiss.write_index(faiss_index, faiss_index_path)
            save_metadata_list(all_chunk_metadata, metadata_path)
            save_doi_mapped_json(all_chunk_metadata, json_doi_mapped_path)
            
            return True
            
        except Exception as e:
            logger.error(f"Error creating embeddings synchronously: {e}")
            return False
