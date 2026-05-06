"""
Chat service for AI-powered paper analysis
"""

import os
import json
import faiss
import asyncio
import sys
from typing import List, Dict, Any, Optional
import logging

from app.models.schemas import ChatResponse
from app.core.config import Settings

# Import original functions
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'backend'))

try:
    from features.embedding_and_indexing import search_faiss
    from utils.result_processor import get_context_from_result
except ImportError as e:
    logging.warning(f"Could not import original chat functions: {e}")

logger = logging.getLogger("research_rover")

class ChatService:
    """Service for handling AI chat with research papers"""
    
    def __init__(self, settings: Settings, sentence_model, llm):
        self.settings = settings
        self.sentence_model = sentence_model
        self.llm = llm
    
    async def generate_response(self, filename: str, query: str) -> ChatResponse:
        """
        Generate AI response based on paper context or general knowledge if embeddings don't exist
        """
        try:
            # Get file paths
            base_filename = filename.replace(".csv", "")
            faiss_index_path = os.path.join(
                self.settings.DATA_FOLDER, 
                f"{base_filename}_paper_chunks_hdbscan.index"
            )
            metadata_path = os.path.join(
                self.settings.DATA_FOLDER, 
                f"{base_filename}_paper_chunk_metadata_hdbscan.json"
            )
            
            # Check if embedding files exist
            if not os.path.exists(faiss_index_path) or not os.path.exists(metadata_path):
                logger.info("Embeddings not found. Providing general response without paper context.")
                # Generate response without paper context
                response_text = await self._generate_general_response(query)
                return ChatResponse(
                    response=response_text,
                    sources=[],
                    query=query
                )
            
            # Load FAISS index and metadata
            faiss_index = faiss.read_index(faiss_index_path)
            
            with open(metadata_path, 'r', encoding='utf-8') as f:
                all_chunk_metadata = json.load(f)
            
            # Decompose query into sub-queries
            sub_queries = await self._decompose_query(query)
            
            # Search for each sub_query (matching original backend logic)
            all_results_raw = []
            search_k_per_query = 5  # How many results to fetch per sub-query
            
            for sub_q in sub_queries:
                try:
                    # Call search function (matching original backend)
                    loop = asyncio.get_event_loop()
                    results = await loop.run_in_executor(
                        None,
                        search_faiss,
                        sub_q,
                        self.sentence_model,
                        faiss_index,
                        all_chunk_metadata,
                        search_k_per_query
                    )
                    if results:
                        all_results_raw.extend(results)
                        logger.info(f"Retrieved {len(results)} results for sub-query: '{sub_q}'")
                except Exception as e:
                    logger.error(f"Error searching for sub-query '{sub_q}': {e}")
            
            # Deduplicate results (matching original backend logic)
            unique_results_map = {}
            for result in all_results_raw:
                # Determine a unique key for the chunk
                chunk_key = result.get('chunk_id')
                # Fallback using DOI and text hash (more robust than text alone)
                if chunk_key is None:
                    text_hash = hash(result.get('text', ''))
                    doi = result.get('doi', 'Unknown DOI')
                    chunk_key = (doi, text_hash)  # Tuple as key
                
                if chunk_key not in unique_results_map:
                    unique_results_map[chunk_key] = result
                else:
                    # Keep the result with the smaller distance (higher relevance)
                    if result.get('distance', float('inf')) < unique_results_map[chunk_key].get('distance', float('inf')):
                        unique_results_map[chunk_key] = result
            
            search_results = list(unique_results_map.values())
            # Sort final unique results by distance for consistent context ordering
            search_results.sort(key=lambda x: x.get('distance', float('inf')))
            logger.info(f"Total unique results after deduplication: {len(search_results)}")
            
            if not search_results:
                logger.info("No relevant documents found for the query.")
                return ChatResponse(
                    response="I cannot answer the question based on the provided context, as no relevant documents were found.",
                    sources=[],
                    query=query
                )
            
            if search_results:
                logger.info(f"Search results found: {len(search_results)}")
                # Process Search Results and Prepare Context (matching original backend)
                llm_context_string, final_paper_titles, final_download_urls = get_context_from_result(search_results, filename)
                
                # Generate AI response using original backend prompt
                response_text = await self._generate_ai_response_original(query, llm_context_string)
                
                # Return response in original format
                return ChatResponse(
                    response=response_text,
                    sources=self._create_sources_from_papers(final_paper_titles, final_download_urls),
                    query=query
                )
            
        except Exception as e:
            logger.error(f"Error generating chat response: {e}")
            raise
    
    async def _decompose_query(self, query: str) -> List[str]:
        """
        Decompose complex queries into simpler sub-queries (matching original backend logic)
        """
        try:
            decomposition_prompt = f"""
Given the user query: '{query}', break it down into distinct, self-contained questions or search terms that cover all aspects of the original query.
List each distinct question/term on a new line.
If the query is already simple and focused, just return the original query on a single line.
Example:
User query: What is machine learning, why is it important in healthcare and what are its setbacks/limitations?
Output:
What is machine learning?
Why is machine learning important in healthcare?
What are the setbacks/limitations of machine learning in healthcare?

User query: Tell me about FAISS.
Output:
Tell me about FAISS.

User query: {query}
Output:"""
            
            logger.info(f"Decomposing query: {query}")
            
            try:
                loop = asyncio.get_event_loop()
                decomposition_response = await loop.run_in_executor(
                    None,
                    lambda: self.llm.generate_content(decomposition_prompt)
                )
                
                # Parse response (matching original backend logic)
                response_text = ""
                if hasattr(decomposition_response, 'text'):
                    response_text = decomposition_response.text
                elif hasattr(decomposition_response, 'parts') and decomposition_response.parts:
                    response_text = decomposition_response.parts[0].text
                else:
                    logger.warning(f"Unexpected LLM response structure for decomposition: {decomposition_response}")
                
                if response_text:
                    sub_queries = [q.strip() for q in response_text.split('\n') if q.strip()]
                
                if not sub_queries:  # Fallback if decomposition fails or returns empty
                    logger.warning("Query decomposition returned empty, using original query.")
                    sub_queries = [query]
                else:
                    # Limit the number of sub-queries to avoid excessive searching
                    max_sub_queries = 5
                    if len(sub_queries) > max_sub_queries:
                        logger.warning(f"Too many sub-queries ({len(sub_queries)}), limiting to {max_sub_queries}.")
                        sub_queries = sub_queries[:max_sub_queries]
                    logger.info(f"Decomposed into sub-queries: {sub_queries}")
                
                return sub_queries
                
            except Exception as e:
                logger.error(f"Error during query decomposition: {e}. Falling back to original query.")
                return [query]  # Fallback
            
        except Exception as e:
            logger.warning(f"Query decomposition failed: {e}")
            return [query]
    
    async def _generate_ai_response_original(self, query: str, llm_context_string: str) -> str:
        """
        Generate AI response using the original backend's prompt and logic
        """
        try:
            llm_prompt = f"""
Your task is to answer the following question based ONLY on the context documents provided below.

Instructions:
- Answer the question solely using the information present in the 'Context Documents' section.
- Do not use any external knowledge or prior assumptions.

- **Identify Intent for Paper Lists**:
    - If the user's query explicitly asks for a list of papers that discuss a specific topic, methodology, or concept (e.g., "Which papers discuss agile methodology?", "List papers on software testing frameworks", "What are the papers related to blockchain in IoT?"), your primary goal is to identify and list the **titles** of those relevant papers found within the 'Context Documents'.
    - In such cases, provide a concise list of paper titles. If no relevant papers are found in the context, clearly state that.

- **Paraphrase and Synthesize:**
    - **Do NOT copy sentences directly** from the context documents.
    - Rephrase the information accurately in your own words, preserving the original meaning.
    - Synthesize information from multiple sources where appropriate to provide a cohesive answer.

- **Citation Requirements:**
    - You MUST cite the source(s) for every piece of information presented in your answer.
    - Use the index number provided in brackets (e.g., [1], [2]) corresponding to the source document listed in the 'Context Documents' (e.g., `[1] [Source Title: ...]`).
    - **Place the citation(s) ONLY at the end of the sentence, or at the end of a sequence of sentences, that are directly supported by that source(s).**
    - **Citation Placement Example:** If sentence A and sentence B are both based *only* on source [1], and sentence C is based *only* on source [4], the correct format is: "Sentence A. Sentence B.[1] Sentence C.[4]".
    - **Multiple Sources Example:** If a statement synthesizes information from sources [1] and [3], cite it as: "Synthesized statement.[1][3]".

- **Clarity:** Define pronouns clearly (e.g., avoid ambiguous "it" or "they"). Refer back to specific entities mentioned in the context.

- **Structure for Multi-Part Questions:**
    - **Identify Sub-Questions:** Analyze the main question to see if it contains multiple distinct parts or sub-questions (e.g., asking "what" and "how", or asking about multiple different items).
    - **Address Sequentially:** If sub-questions are identified, structure your answer to address each one separately and in the order they appear in the question.
    - **Use Paragraphs:** **Use distinct paragraphs for the answer to each sub-question.** This separation is crucial for clarity.
    - **Example:** For a query like "What is machine learning and how does it affect the healthcare industry?", first provide a paragraph explaining machine learning (citing relevant sources), and then provide a *separate, second* paragraph explaining its effects on healthcare (citing relevant sources).

- **Completeness:** Ensure all identified parts (sub-questions) of the question are addressed if possible within the context. If a part cannot be answered from the context, state so clearly for that specific part before moving to the next, or at the end if it's the last part.

- **Unknown Answer:** If the *entire* answer (or a specific sub-part) cannot be found within the provided context documents, explicitly state: "I cannot answer [the question / this part of the question] based on the provided context."

- **Conciseness:** Be direct and avoid unnecessary waffle within each section.


Context Documents:
{llm_context_string}

Question:
{query}

Answer (Paraphrased text based *only* on the context above. **Address sub-questions in separate paragraphs.** Citations MUST be placed at the end of the sentence or group of sentences they support, like sentence1. sentence2.[1] sentence3.[4]):
"""
            
            logger.info("Sending prompt to LLM.")
            loop = asyncio.get_event_loop()
            llm_response = await loop.run_in_executor(
                None,
                lambda: self.llm.generate_content(llm_prompt)
            )
            
            # Parse response (matching original backend logic)
            if hasattr(llm_response, 'text'):
                response_text = llm_response.text
            elif hasattr(llm_response, 'parts') and llm_response.parts:
                response_text = llm_response.parts[0].text
            else:
                logger.error(f"Unexpected LLM response structure: {llm_response}")
                response_text = "Error: Could not parse LLM response."
            
            logger.info("LLM response received.")
            return response_text.strip()
            
        except Exception as e:
            logger.error(f"Error calling LLM: {e}")
            return f"LLM generation failed: {e}"
    
    async def _generate_general_response(self, query: str) -> str:
        """
        Generate general AI response when no paper context is available
        """
        try:
            prompt = f"""
The user is asking a question but no research paper embeddings are available yet. Please provide a helpful, informative response based on your general knowledge.

User Question: {query}

Please provide a comprehensive and accurate answer. If this is a research-specific question, you can mention that more detailed information could be available once research papers are indexed and embeddings are created.
"""
            
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: self.llm.generate_content(prompt)
            )
            
            if response and response.text:
                return response.text.strip()
            else:
                return "I apologize, but I couldn't generate a response at this time. Please try again or create embeddings from your research papers for more detailed answers."
                
        except Exception as e:
            logger.error(f"Error generating general response: {e}")
            return "I encountered an error while processing your question. Please try again later."
    
    def _create_sources_from_papers(self, paper_titles: List[str], download_urls: List[str]) -> List[Dict[str, Any]]:
        """
        Create sources from paper titles and URLs (matching original backend format)
        """
        sources = []
        
        try:
            for i, (title, url) in enumerate(zip(paper_titles, download_urls)):
                source = {
                    "id": i + 1,
                    "type": "research_paper",
                    "title": title,
                    "url": url,
                    "content_preview": title[:200] + "..." if len(title) > 200 else title
                }
                sources.append(source)
                
        except Exception as e:
            logger.warning(f"Error creating sources: {e}")
        
        return sources
    
    def _extract_sources(self, contexts: List[str]) -> List[Dict[str, Any]]:
        """
        Extract source information from contexts (legacy method)
        """
        sources = []
        
        try:
            for i, context in enumerate(contexts):
                # Simple source extraction - enhance as needed
                source = {
                    "id": i + 1,
                    "type": "research_paper",
                    "content_preview": context[:200] + "..." if len(context) > 200 else context
                }
                sources.append(source)
                
        except Exception as e:
            logger.warning(f"Error extracting sources: {e}")
        
        return sources