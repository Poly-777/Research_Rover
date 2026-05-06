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

try:
    from features.embedding_and_indexing import (
        process_data_generate_vectors_and_metadata,
        build_faiss_index,
        save_metadata_list,
        save_doi_mapped_json,
        load_data
    )
except ImportError as e:
    logging.warning(f"Could not import original embedding functions: {e}")

logger = logging.getLogger("research_rover")

class EmbeddingService:
    """Service for handling embedding creation and management"""
    
    def __init__(self, settings: Settings, sentence_model):
        self.settings = settings
        self.sentence_model = sentence_model
    
    async def extract_full_text_to_json(self, csv_path: str) -> str:
        """
        Extract full text from URLs in CSV and save to separate JSON file mapping unique_id -> full_text
        """
        logger.info("Loading CSV and extracting full text from URLs using crawl4ai...")
        df = load_data(csv_path)
        
        # Create full text mapping dictionary
        full_text_mapping = {}
        extracted_count = 0
        total_urls = 0
        
        # Run crawl4ai in executor to avoid async context issues
        loop = asyncio.get_event_loop()
        
        def extract_single_url(url, doi, title, abstract):
            """Extract full text from a single URL using requests + BeautifulSoup as fallback"""
            try:
                import requests
                from bs4 import BeautifulSoup
                import time
                
                # Simple HTTP request approach as fallback
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
                
                response = requests.get(url, headers=headers, timeout=10)
                response.raise_for_status()
                
                soup = BeautifulSoup(response.content, 'html.parser')
                
                # Remove unwanted elements
                for element in soup(['script', 'style', 'nav', 'header', 'footer', 'aside']):
                    element.decompose()
                
                # Try to find main content areas
                content_selectors = [
                    'article', '.article-content', '.paper-content', 
                    '.full-text', 'main', '.content', '.abstract',
                    '#abstract', '.abstract-content'
                ]
                
                full_text = ""
                for selector in content_selectors:
                    elements = soup.select(selector)
                    if elements:
                        full_text = ' '.join([elem.get_text(strip=True) for elem in elements])
                        break
                
                # If no specific content found, get all text
                if not full_text:
                    full_text = soup.get_text(strip=True)
                
                # Clean up the text
                full_text = ' '.join(full_text.split())  # Normalize whitespace
                
                if full_text and len(full_text.split()) > 100:
                    return full_text, len(full_text.split())
                
                return None, 0
                    
            except Exception as e:
                logger.error(f"Error in simple extraction for {url}: {e}")
                return None, 0
        
        for index, row in df.iterrows():
            url = str(row.get('Download_URL', ''))
            doi = str(row.get('Doi') or row.get('DOI') or '')
            title = str(row.get('Title', ''))
            
            # Create unique ID for the paper (use DOI if available, otherwise use index)
            unique_id = doi if doi and doi != 'nan' and doi != 'Unknown DOI' else f"paper_{index}"
            
            # Initialize with abstract as default
            abstract = str(row.get('Abstract', ''))
            default_text = abstract if abstract and abstract != 'nan' else ''
            full_text_mapping[unique_id] = default_text
            
            # Skip if no URL
            if not url or url == 'nan' or not url.startswith('http'):
                continue
            
            total_urls += 1
            
            try:
                logger.info(f"Extracting full text for DOI: {doi} from URL: {url}")
                
                # Run extraction in thread pool to avoid async context issues
                full_text, word_count = await loop.run_in_executor(
                    None, extract_single_url, url, doi, title, abstract
                )
                
                if full_text:
                    full_text_mapping[unique_id] = full_text
                    extracted_count += 1
                    logger.info(f"Successfully extracted {word_count} words from {url}")
                else:
                    logger.warning(f"Failed to extract content from {url}, keeping abstract")
                    
            except Exception as e:
                logger.error(f"Error extracting from {url} (DOI: {doi}): {e}")
            
            # Add delay to be respectful to servers
            await asyncio.sleep(1.0)
        
        logger.info(f"✅ Full text extraction completed: {extracted_count}/{total_urls} successful extractions using crawl4ai")
        
        # Save full text mapping to JSON file
        base_filename = os.path.basename(csv_path).replace(".csv", "")
        full_text_json_path = os.path.join(
            self.settings.DATA_FOLDER,
            f"{base_filename}_full_text_mapping.json"
        )
        
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

    def process_data_with_json_mapping(self, csv_path: str, full_text_json_path: str, sentence_model):
        """
        Process data using JSON mapping for full text instead of modifying CSV
        """
        from nltk.tokenize import sent_tokenize
        import hdbscan
        import numpy as np
        
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
        
        for index, row in df.iterrows():
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
        progress_state: Dict[str, Any]
    ):
        """
        Create embeddings asynchronously with progress tracking
        """
        start_time = time.time()
        
        try:
            # Update progress
            progress_state.update({
                "stage": 1,
                "message": "Loading embedding model",
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
            
            # Update progress
            progress_state.update({
                "stage": 2,
                "message": "Processing data and generating embeddings",
                "timestamp": time.time()
            })
            
            # Extract full text from URLs using crawl4ai (same as original backend)
            progress_state.update({
                "stage": 1,
                "message": "Extracting full text from paper URLs",
                "timestamp": time.time()
            })
            
            # Extract full text to JSON mapping (cleaner approach)
            try:
                logger.info("🔍 EXTRACTING FULL TEXT FROM URLs TO JSON MAPPING (cleaner approach)")
                full_text_json_path = await self.extract_full_text_to_json(csv_path)
            except Exception as e:
                logger.warning(f"Full text extraction failed: {e}, will use abstracts during processing")
                full_text_json_path = None
            
            # Update progress
            progress_state.update({
                "stage": 2,
                "message": "Processing data and generating embeddings",
                "timestamp": time.time()
            })
            
            # Process data and generate vectors using JSON mapping
            loop = asyncio.get_event_loop()
            all_vectors, all_chunk_metadata = await loop.run_in_executor(
                None,
                self.process_data_with_json_mapping,
                csv_path,
                full_text_json_path,
                self.sentence_model
            )
            
            if all_vectors is None or all_chunk_metadata is None:
                progress_state.update({
                    "stage": -1,
                    "message": "Failed to process data",
                    "timestamp": time.time()
                })
                return
            
            # Build FAISS index
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
