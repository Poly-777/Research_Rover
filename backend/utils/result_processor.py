"""
Turn FAISS search results into an LLM context string plus aligned source lists.

The context is numbered (`[1] [Source Title: ...]`) so the citation markers the
LLM produces line up with the source cards built from the returned title/URL lists.
"""

import os
import logging

import pandas as pd

logger = logging.getLogger("research_rover")

_DATA_FOLDER = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))


def _build_doi_url_map(filename):
    """Map DOI -> Download_URL from the source CSV, if it can be read."""
    doi_to_url = {}
    try:
        csv_path = os.path.join(_DATA_FOLDER, filename)
        if not os.path.exists(csv_path):
            return doi_to_url

        df = pd.read_csv(csv_path)
        doi_col = "Doi" if "Doi" in df.columns else ("DOI" if "DOI" in df.columns else None)
        if doi_col is None:
            return doi_to_url

        for _, row in df.iterrows():
            doi = str(row.get(doi_col, "")).strip()
            url = str(row.get("Download_URL", "")).strip()
            if doi and doi.lower() != "nan":
                doi_to_url[doi] = url if url and url.lower() != "nan" else ""
    except Exception as e:
        logger.warning(f"Could not build DOI->URL map from {filename}: {e}")
    return doi_to_url


def get_context_from_result(search_results, filename):
    """Return (llm_context_string, paper_titles, download_urls) aligned by citation index."""
    doi_to_url = _build_doi_url_map(filename)

    context_parts = []
    paper_titles = []
    download_urls = []

    for i, result in enumerate(search_results, start=1):
        title = result.get("paperTitle") or result.get("title") or "Unknown Title"
        text = result.get("text", "")
        doi = str(result.get("doi", "")).strip()

        url = doi_to_url.get(doi, "")
        if not url and doi and doi not in ("Unknown DOI", "nan"):
            url = f"https://doi.org/{doi}"

        context_parts.append(f"[{i}] [Source Title: {title}]\n{text}")
        paper_titles.append(title)
        download_urls.append(url)

    llm_context_string = "\n\n".join(context_parts)
    return llm_context_string, paper_titles, download_urls
