"""
Semantic re-ranking for Research Rover (retrieve-then-rerank).

PubMed's E-utilities return the candidate set in chronological (most-recent)
order, *not* by relevance. This module re-scores that candidate set against the
user's original query using MedCPT — NCBI's biomedical bi-encoder trained on
PubMed and hundreds of millions of real PubMed click logs — so the final
ordering reflects semantic relevance to what the user actually asked.

Pipeline position:
    PubMed esearch/efetch  ->  candidate set  ->  [MedCPT bi-encoder rerank]  ->  UI

Design notes:
  * Bi-encoder only (Phase 1). The query encoder and article encoder are a
    matched pair; relevance is the dot product of their CLS embeddings, which
    is exactly how MedCPT was trained. We rank by that dot product.
  * For the UI we expose a 0-100 "relevance" that is a monotonic (min-max)
    transform of the dot product, so the displayed score and the row order
    always agree within a result set.
  * Fails open: if torch/transformers or the model weights are unavailable
    (e.g. first run with no internet), rerank() logs a warning and returns the
    records untouched in PubMed's original order. Search never breaks.
  * Lazy loading: weights (~440 MB each) download/load on the first rerank
    call, not at import or server startup.
"""

import logging
import threading
from typing import Any, Dict, List, Optional

logger = logging.getLogger("research_rover")


class MedCPTReRanker:
    """MedCPT bi-encoder re-ranker. One instance per process (see get_reranker)."""

    def __init__(
        self,
        query_model: str = "ncbi/MedCPT-Query-Encoder",
        article_model: str = "ncbi/MedCPT-Article-Encoder",
        max_candidates: int = 300,
    ):
        self.query_model_name = query_model
        self.article_model_name = article_model
        self.max_candidates = max_candidates

        self._lock = threading.Lock()
        self._loaded = False
        self._unavailable = False  # set True if loading failed, so we don't retry forever
        self._torch = None
        self._q_tok = self._q_model = None
        self._a_tok = self._a_model = None

    # ------------------------------------------------------------------
    # Model loading (lazy, thread-safe, fail-open)
    # ------------------------------------------------------------------
    def _ensure_loaded(self) -> bool:
        """Load the MedCPT encoders on first use. Returns False if unavailable."""
        if self._loaded:
            return True
        if self._unavailable:
            return False

        with self._lock:
            if self._loaded:
                return True
            if self._unavailable:
                return False
            try:
                import torch
                from transformers import AutoModel, AutoTokenizer

                logger.info(f"Loading MedCPT query encoder: {self.query_model_name}")
                self._q_tok = AutoTokenizer.from_pretrained(self.query_model_name)
                self._q_model = AutoModel.from_pretrained(self.query_model_name).eval()

                logger.info(f"Loading MedCPT article encoder: {self.article_model_name}")
                self._a_tok = AutoTokenizer.from_pretrained(self.article_model_name)
                self._a_model = AutoModel.from_pretrained(self.article_model_name).eval()

                self._torch = torch
                self._loaded = True
                logger.info("MedCPT re-ranker ready (CPU).")
                return True
            except Exception as e:
                self._unavailable = True
                logger.warning(
                    f"MedCPT re-ranker unavailable ({e}); falling back to PubMed order."
                )
                return False

    # ------------------------------------------------------------------
    # Encoding helpers
    # ------------------------------------------------------------------
    def _encode_query(self, query: str):
        torch = self._torch
        with torch.no_grad():
            enc = self._q_tok(
                [query], truncation=True, padding=True,
                return_tensors="pt", max_length=64,
            )
            # CLS token embedding
            return self._q_model(**enc).last_hidden_state[:, 0, :]

    def _encode_articles(self, articles: List[List[str]], batch_size: int = 16):
        torch = self._torch
        embeds = []
        with torch.no_grad():
            for i in range(0, len(articles), batch_size):
                batch = articles[i : i + batch_size]
                enc = self._a_tok(
                    batch, truncation=True, padding=True,
                    return_tensors="pt", max_length=512,
                )
                embeds.append(self._a_model(**enc).last_hidden_state[:, 0, :])
        return torch.cat(embeds, dim=0)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def rerank(self, query: str, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Re-order `records` by MedCPT relevance to `query` and attach a
        'Relevance_Score' (0-100, relative within this result set) to each.
        Returns records unchanged (no score) if the model is unavailable.
        """
        if not records or not query or not query.strip():
            return records

        if not self._ensure_loaded():
            return records  # fail open — keep PubMed order

        try:
            # Only re-rank the first N candidates; the rest keep PubMed order.
            head = records[: self.max_candidates]
            tail = records[self.max_candidates :]

            articles = []
            for r in head:
                title = str(r.get("Title", "") or "")
                abstract = str(r.get("Abstract", "") or "")
                articles.append([title, abstract])

            torch = self._torch
            q_emb = self._encode_query(query)            # (1, d)
            a_emb = self._encode_articles(articles)       # (n, d)

            # MedCPT relevance = dot product of CLS embeddings (training objective).
            scores = (a_emb @ q_emb.T).squeeze(1)         # (n,)
            scores_list = scores.tolist()

            order = sorted(range(len(head)), key=lambda i: scores_list[i], reverse=True)

            # Monotonic 0-100 display score so badge order == row order.
            lo = min(scores_list)
            hi = max(scores_list)
            span = (hi - lo) or 1.0

            ranked = []
            for rank_pos, idx in enumerate(order):
                rec = dict(head[idx])
                rec["Relevance_Score"] = round((scores_list[idx] - lo) / span * 100.0, 1)
                rec["Relevance_Rank"] = rank_pos + 1
                ranked.append(rec)

            logger.info(
                f"MedCPT re-ranked {len(ranked)} candidates for query '{query}' "
                f"(top score raw={max(scores_list):.2f})"
            )
            return ranked + tail
        except Exception as e:
            logger.warning(f"Re-ranking failed ({e}); returning PubMed order.")
            return records

    @staticmethod
    def sort_by_recency(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Sort by publication year descending (stable). Used for the 'recency' mode."""
        def year_key(r: Dict[str, Any]) -> int:
            for k in ("Publication Year", "Year_Published"):
                try:
                    return int(str(r.get(k, "")).strip()[:4])
                except (ValueError, TypeError):
                    continue
            return 0
        return sorted(records, key=year_key, reverse=True)
