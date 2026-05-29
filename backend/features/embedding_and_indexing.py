"""
Embedding and FAISS indexing helpers.

These functions are imported by the embedding and chat services. Vectors are
L2-normalized so cosine similarity is expressed as L2 distance (smaller = more
relevant), which the chat service relies on when ranking results.
"""

import os
import json
import logging

import faiss
import numpy as np
import pandas as pd

logger = logging.getLogger("research_rover")

_DATA_FOLDER = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))


def load_data(csv_path):
    """Load a papers CSV into a DataFrame, guaranteeing the columns we read later."""
    df = pd.read_csv(csv_path)
    for col in ("Download_URL", "Abstract", "Title"):
        if col not in df.columns:
            df[col] = ""
    return df


def build_faiss_index(all_vectors):
    """Build a normalized L2 FAISS index from chunk vectors."""
    if all_vectors is None or len(all_vectors) == 0:
        logger.error("build_faiss_index received no vectors.")
        return None

    vectors = np.asarray(all_vectors).astype("float32")
    faiss.normalize_L2(vectors)
    index = faiss.IndexFlatL2(vectors.shape[1])
    index.add(vectors)
    logger.info(f"Built FAISS index with {index.ntotal} vectors (dim={vectors.shape[1]}).")
    return index


def save_metadata_list(metadata_list, path):
    """Persist the flat list of chunk metadata as JSON."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(metadata_list, f, indent=2, ensure_ascii=False)
    logger.info(f"Saved {len(metadata_list)} chunk metadata entries to {path}")


def save_doi_mapped_json(metadata_list, path):
    """Persist chunk metadata grouped by DOI."""
    doi_mapped = {}
    for meta in metadata_list:
        doi = meta.get("doi", "Unknown DOI")
        doi_mapped.setdefault(doi, []).append(meta)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doi_mapped, f, indent=2, ensure_ascii=False)
    logger.info(f"Saved DOI-mapped metadata for {len(doi_mapped)} papers to {path}")


def search_faiss(query, sentence_model, faiss_index, all_chunk_metadata, k=5):
    """Embed the query and return the top-k chunk metadata dicts with distances."""
    query_embedding = sentence_model.encode([query]).astype("float32")
    faiss.normalize_L2(query_embedding)

    distances, indices = faiss_index.search(query_embedding, k)

    results = []
    for dist, idx in zip(distances[0], indices[0]):
        if idx < 0 or idx >= len(all_chunk_metadata):
            continue
        result = dict(all_chunk_metadata[idx])
        result["distance"] = float(dist)
        result["chunk_id"] = int(idx)
        results.append(result)
    return results
