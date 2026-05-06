"""
Analysis service for metadata-driven keyword analytics.

Phases covered:
1. Metadata collection
2. Normalization
3. Analysis artifact storage
4. Keyword aggregation
5. Keyword presence matrix generation
"""

from __future__ import annotations

import ast
import json
import logging
import os
import re
import time
from itertools import combinations
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import networkx as nx

from app.core.config import Settings

logger = logging.getLogger("research_rover")


class AnalysisService:
    """Generate keyword analysis artifacts from Rover metadata."""

    def __init__(self, settings: Settings):
        self.settings = settings

    def _resolve_csv_path(self, filename: str) -> str:
        filename = os.path.basename(filename)  # strip any path traversal attempts
        csv_path = os.path.join(self.settings.DATA_FOLDER, filename)
        if not os.path.exists(csv_path):
            raise FileNotFoundError(f"CSV file not found: {filename}")
        if not filename.lower().endswith(".csv"):
            raise ValueError("Only CSV files can be analyzed")
        return csv_path

    def _analysis_paths(self, filename: str) -> Dict[str, str]:
        base_name = os.path.splitext(os.path.basename(filename))[0]
        return {
            "normalized_metadata_file": os.path.join(
                self.settings.DATA_FOLDER, f"{base_name}_analysis_normalized_metadata.json"
            ),
            "keyword_frequency_file": os.path.join(
                self.settings.DATA_FOLDER, f"{base_name}_analysis_keyword_frequency.csv"
            ),
            "keyword_presence_matrix_file": os.path.join(
                self.settings.DATA_FOLDER, f"{base_name}_analysis_keyword_presence_matrix.csv"
            ),
            "summary_file": os.path.join(
                self.settings.DATA_FOLDER, f"{base_name}_analysis_summary.json"
            ),
        }

    def _normalize_text(self, value: Any) -> str:
        if value is None:
            return ""
        text = str(value).strip()
        if text.lower() in {"nan", "none", "null"}:
            return ""
        return text

    def _parse_authors(self, value: Any) -> List[str]:
        if isinstance(value, list):
            return [self._normalize_text(item) for item in value if self._normalize_text(item)]
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return []

        text = self._normalize_text(value)
        if not text:
            return []

        if text.startswith("[") and text.endswith("]"):
            try:
                parsed = ast.literal_eval(text)
                if isinstance(parsed, list):
                    return [self._normalize_text(item) for item in parsed if self._normalize_text(item)]
            except Exception:
                pass

        separator = ";" if ";" in text else ","
        return [part.strip() for part in text.split(separator) if part.strip()]

    def _normalize_keyword(self, keyword: str) -> str:
        alias_map = {
            "iot": "internet of things",
            "iiot": "industrial internet of things",
            "ai": "artificial intelligence",
            "ml": "machine learning",
            "dl": "deep learning",
            "block chain": "blockchain",
            "digital twins": "digital twin",
            "smart logistics platforms": "smart logistics platform",
        }

        word = self._normalize_text(keyword).lower()
        word = re.sub(r"\(.*?\)", "", word).strip()
        word = re.sub(r"\s+", " ", word)
        return alias_map.get(word, word)

    def _parse_keywords(self, value: Any) -> List[str]:
        if isinstance(value, list):
            raw_keywords = value
        elif value is None or (isinstance(value, float) and pd.isna(value)):
            raw_keywords = []
        else:
            text = self._normalize_text(value)
            if not text:
                raw_keywords = []
            elif text.startswith("[") and text.endswith("]"):
                try:
                    parsed = ast.literal_eval(text)
                    raw_keywords = parsed if isinstance(parsed, list) else [text]
                except Exception:
                    raw_keywords = [part.strip() for part in re.split(r"[;,]", text.strip("[]")) if part.strip()]
            elif ";" in text:
                raw_keywords = [part.strip() for part in text.split(";") if part.strip()]
            elif "," in text:
                raw_keywords = [part.strip() for part in text.split(",") if part.strip()]
            else:
                raw_keywords = [text]

        normalized = [self._normalize_keyword(keyword) for keyword in raw_keywords]
        deduped: List[str] = []
        seen = set()
        for keyword in normalized:
            if keyword and keyword not in seen:
                seen.add(keyword)
                deduped.append(keyword)
        return deduped

    def _paper_id_from_row(self, row: pd.Series, index: int) -> str:
        for key in ("DOI", "Doi", "PMID", "Id", "id"):
            value = self._normalize_text(row.get(key))
            if value:
                return value
        return f"paper_{index + 1}"

    def _load_dataframe(self, csv_path: str) -> pd.DataFrame:
        df = pd.read_csv(csv_path)
        for column in ("Title", "Abstract", "Source", "Journal/Book", "Year_Published", "Publication Year", "Authors", "Keywords", "DOI", "Doi", "PMID", "Download_URL"):
            if column not in df.columns:
                df[column] = ""
        return df

    def normalize_metadata(self, csv_path: str) -> List[Dict[str, Any]]:
        df = self._load_dataframe(csv_path)
        records: List[Dict[str, Any]] = []

        for index, row in df.iterrows():
            source = self._normalize_text(row.get("Source") or row.get("Journal/Book") or "Unknown") or "Unknown"
            title = self._normalize_text(row.get("Title") or "Unknown") or "Unknown"
            year = self._normalize_text(row.get("Year_Published") or row.get("Publication Year")) or None
            doi = self._normalize_text(row.get("DOI") or row.get("Doi")) or None
            paper_id = self._paper_id_from_row(row, index)
            keywords = self._parse_keywords(row.get("Keywords"))
            authors = self._parse_authors(row.get("Authors"))
            abstract = self._normalize_text(row.get("Abstract")) or None
            download_url = self._normalize_text(row.get("Download_URL")) or None

            records.append(
                {
                    "paper_id": paper_id,
                    "title": title,
                    "source": source,
                    "year": year,
                    "doi": doi,
                    "authors": authors,
                    "keywords": keywords,
                    "abstract": abstract,
                    "download_url": download_url,
                }
            )

        return records

    def build_analysis_artifacts(
        self,
        filename: str,
        top_keywords: int = 100,
        minimum_frequency: int = 1,
        refresh: bool = True,
    ) -> Dict[str, Any]:
        csv_path = self._resolve_csv_path(filename)
        paths = self._analysis_paths(filename)

        if not refresh and os.path.exists(paths["summary_file"]):
            return self.load_analysis_summary(filename)

        records = self.normalize_metadata(csv_path)
        total_papers = len(records)

        keyword_counter: Counter[str] = Counter()
        for record in records:
            unique_keywords = record["keywords"]
            keyword_counter.update(unique_keywords)

        frequency_rows = []
        for keyword, count in keyword_counter.most_common():
            if count < minimum_frequency:
                continue
            frequency_rows.append(
                {
                    "keyword": keyword,
                    "frequency": int(count),
                    "percentage": round((count / total_papers) * 100, 2) if total_papers else 0.0,
                }
            )

        frequency_rows = frequency_rows[:top_keywords]
        matrix_keywords = [row["keyword"] for row in frequency_rows]
        matrix_keyword_set = set(matrix_keywords)

        matrix_rows = []
        cooccurrence_counter: Counter[Tuple[str, str]] = Counter()
        for record in records:
            present_keywords = [kw for kw in record["keywords"] if kw in matrix_keyword_set]
            row = {
                "paper_id": record["paper_id"],
                "title": record["title"],
                "source": record["source"],
                "year": record["year"],
                "keywords": present_keywords,
            }
            for keyword in matrix_keywords:
                row[keyword] = 1 if keyword in present_keywords else 0
            matrix_rows.append(row)

            for source, target in combinations(sorted(present_keywords), 2):
                cooccurrence_counter[(source, target)] += 1

        cooccurrence_edges = [
            {
                "source": source,
                "target": target,
                "weight": int(weight),
            }
            for (source, target), weight in cooccurrence_counter.most_common()
            if weight > 0
        ]

        centrality_scores = self._build_centrality_scores(matrix_keywords, cooccurrence_edges)

        normalized_df = pd.DataFrame(records)
        normalized_df.to_json(paths["normalized_metadata_file"], orient="records", indent=2, force_ascii=False)

        frequency_df = pd.DataFrame(frequency_rows)
        frequency_df.to_csv(paths["keyword_frequency_file"], index=False, encoding="utf-8-sig")

        matrix_df = pd.DataFrame(matrix_rows)
        matrix_df.to_csv(paths["keyword_presence_matrix_file"], index=False, encoding="utf-8-sig")

        summary = {
            "filename": os.path.basename(filename),
            "source_file": os.path.basename(csv_path),
            "total_papers": total_papers,
            "papers_with_keywords": sum(1 for record in records if record["keywords"]),
            "unique_keywords": len(keyword_counter),
            "top_keywords_limit": top_keywords,
            "minimum_frequency": minimum_frequency,
            "normalized_metadata_file": os.path.basename(paths["normalized_metadata_file"]),
            "keyword_frequency_file": os.path.basename(paths["keyword_frequency_file"]),
            "keyword_presence_matrix_file": os.path.basename(paths["keyword_presence_matrix_file"]),
            "summary_file": os.path.basename(paths["summary_file"]),
            "generated_at": time.time(),
            "keyword_frequency": frequency_rows,
            "matrix_keywords": matrix_keywords,
            "matrix_rows": len(matrix_rows),
            "matrix_columns": len(matrix_keywords),
            "cooccurrence_edges": cooccurrence_edges[:250],
            "centrality_scores": centrality_scores,
        }

        with open(paths["summary_file"], "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

        logger.info(
            "Analysis artifacts generated for %s: %s papers, %s unique keywords, %s matrix columns",
            filename,
            total_papers,
            len(keyword_counter),
            len(matrix_keywords),
        )

        return summary

    def _build_centrality_scores(
        self,
        matrix_keywords: List[str],
        cooccurrence_edges: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        graph = nx.Graph()
        graph.add_nodes_from(matrix_keywords)

        for edge in cooccurrence_edges:
            source = edge.get("source")
            target = edge.get("target")
            weight = int(edge.get("weight", 1))
            if source and target:
                graph.add_edge(source, target, weight=weight)

        if not graph.nodes:
            return []

        degree = nx.degree_centrality(graph)
        closeness = nx.closeness_centrality(graph)
        betweenness = nx.betweenness_centrality(graph, normalized=True)
        clustering = nx.clustering(graph)

        try:
            eigenvector = nx.eigenvector_centrality(graph, max_iter=1000)
        except Exception:
            eigenvector = {node: 0.0 for node in graph.nodes}

        scores = []
        for keyword in matrix_keywords:
            scores.append(
                {
                    "keyword": keyword,
                    "degree_centrality": round(float(degree.get(keyword, 0.0)), 6),
                    "closeness_centrality": round(float(closeness.get(keyword, 0.0)), 6),
                    "betweenness_centrality": round(float(betweenness.get(keyword, 0.0)), 6),
                    "eigenvector_centrality": round(float(eigenvector.get(keyword, 0.0)), 6),
                    "clustering_coefficient": round(float(clustering.get(keyword, 0.0)), 6),
                }
            )

        scores.sort(key=lambda item: item["degree_centrality"], reverse=True)
        return scores

    def load_analysis_summary(self, filename: str) -> Dict[str, Any]:
        paths = self._analysis_paths(filename)
        if not os.path.exists(paths["summary_file"]):
            raise FileNotFoundError(f"Analysis summary not found for {filename}")

        with open(paths["summary_file"], "r", encoding="utf-8") as f:
            return json.load(f)

    def load_keyword_matrix(self, filename: str, preview_rows: int = 25) -> Dict[str, Any]:
        paths = self._analysis_paths(filename)
        if not os.path.exists(paths["keyword_presence_matrix_file"]):
            raise FileNotFoundError(f"Keyword matrix not found for {filename}")

        df = pd.read_csv(paths["keyword_presence_matrix_file"])
        matrix_keywords = [
            column
            for column in df.columns
            if column not in {"paper_id", "title", "source", "year", "keywords"}
        ]

        rows = []
        for _, row in df.head(preview_rows).iterrows():
            values = {keyword: int(row.get(keyword, 0)) for keyword in matrix_keywords}
            present_keywords = [keyword for keyword in matrix_keywords if values.get(keyword, 0) == 1]
            rows.append(
                {
                    "paper_id": self._normalize_text(row.get("paper_id")),
                    "title": self._normalize_text(row.get("title")),
                    "source": self._normalize_text(row.get("source")),
                    "year": self._normalize_text(row.get("year")) or None,
                    "keywords": present_keywords,
                    "values": values,
                }
            )

        return {
            "filename": os.path.basename(filename),
            "matrix_keywords": matrix_keywords,
            "rows": rows,
            "total_rows": len(df),
            "total_columns": len(matrix_keywords),
            "truncated": len(df) > preview_rows,
        }

    def list_analysis_sources(self) -> List[Dict[str, Any]]:
        if not os.path.exists(self.settings.DATA_FOLDER):
            return []

        sources = []
        for filename in os.listdir(self.settings.DATA_FOLDER):
            if not filename.lower().endswith(".csv"):
                continue

            file_path = os.path.join(self.settings.DATA_FOLDER, filename)
            try:
                header_df = pd.read_csv(file_path, nrows=0)
                paper_count = len(pd.read_csv(file_path, usecols=[0]))
                keyword_columns = [col for col in header_df.columns if col.lower() == "keywords"]
                sources.append(
                    {
                        "filename": filename,
                        "size": os.path.getsize(file_path),
                        "created_at": os.path.getctime(file_path),
                        "paper_count": paper_count,
                        "has_keywords": bool(keyword_columns),
                    }
                )
            except Exception as e:
                logger.warning("Unable to inspect CSV %s: %s", filename, e)
                sources.append(
                    {
                        "filename": filename,
                        "size": os.path.getsize(file_path),
                        "created_at": os.path.getctime(file_path),
                        "paper_count": 0,
                        "has_keywords": False,
                    }
                )

        return sources
