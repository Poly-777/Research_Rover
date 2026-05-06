"""
Optimized PubMed searcher for Research Rover
Fixed version: uses proper MeSH[MH] field tagging, removes broken score filter
"""

from datetime import date
import requests
import pandas as pd
import time
import logging
from typing import Optional, List, Dict, Any
from xml.etree import ElementTree as ET
import re

logger = logging.getLogger("research_rover")


# ---------------------------------------------------------------------------
# Synonym map — manual fallback used when MeSH lookup returns nothing
# ---------------------------------------------------------------------------
SYNONYM_MAP: Dict[str, List[str]] = {
    "smart healthcare": [
        "digital health", "ehealth", "e-health", "mhealth", "m-health",
        "connected health", "health informatics", "medical informatics",
        "telemedicine", "telehealth", "smart health",
    ],
    "machine learning": [
        "deep learning", "neural network", "artificial intelligence",
        "ai", "ml", "random forest", "support vector machine",
        "natural language processing", "nlp",
    ],
    "software industry": [
        "software development", "software engineering", "it industry",
        "software company", "tech industry", "information technology",
    ],
    "internet of things": [
        "iot", "iiot", "connected devices", "sensor network",
        "smart devices", "wearable",
    ],
    "electronic health records": [
        "ehr", "emr", "electronic medical records", "clinical data",
    ],
    "blockchain": [
        "distributed ledger", "block chain", "smart contract",
    ],
    "big data": [
        "data analytics", "data mining", "large scale data",
    ],
    "cloud computing": [
        "cloud storage", "cloud platform", "saas", "paas",
    ],
}

# ---------------------------------------------------------------------------
# Relevant journal whitelist
# ---------------------------------------------------------------------------
RELEVANT_JOURNALS = [
    "journal of medical internet research",
    "npj digital medicine",
    "ieee journal of biomedical",
    "computers in biology and medicine",
    "health informatics journal",
    "journal of biomedical informatics",
    "international journal of medical informatics",
    "telemedicine and e-health",
    "digital health",
    "applied clinical informatics",
    "jmir",
]

# ---------------------------------------------------------------------------
# Retry config
# ---------------------------------------------------------------------------
MAX_RETRIES = 3
RETRY_BACKOFF = [1, 3, 7]


class PubMedService:
    """Optimized PubMed searcher with rate limiting and batch processing"""

    def __init__(self, email: str, api_key: Optional[str] = None):
        self.email = email
        self.api_key = api_key
        self.base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
        self.rate_limit = 0.1  # 10 requests/sec with API key
        if not api_key:
            self.rate_limit = 0.34  # 3 requests/sec without API key

        # In-memory cache so repeated searches for the same term don't
        # make extra API calls during the same session
        self._mesh_cache: Dict[str, List[str]] = {}

    # ------------------------------------------------------------------
    # HTTP helper — POST with retry/backoff
    # ------------------------------------------------------------------

    def _post_with_retry(self, endpoint: str, data: Dict[str, Any]) -> requests.Response:
        """POST to a PubMed endpoint with exponential backoff on transient errors."""
        url = f"{self.base_url}{endpoint}"
        data = dict(data)
        data['email'] = self.email
        if self.api_key:
            data['api_key'] = self.api_key

        last_exc: Optional[Exception] = None
        for attempt in range(MAX_RETRIES):
            try:
                time.sleep(self.rate_limit)
                response = requests.post(url, data=data, timeout=30)
                if response.status_code in (429, 500, 502, 503, 504):
                    wait = RETRY_BACKOFF[attempt]
                    logger.warning(
                        f"PubMed {endpoint} returned {response.status_code} "
                        f"(attempt {attempt+1}/{MAX_RETRIES}), retrying in {wait}s"
                    )
                    time.sleep(wait)
                    continue
                response.raise_for_status()
                return response
            except requests.RequestException as e:
                last_exc = e
                wait = RETRY_BACKOFF[attempt]
                logger.warning(
                    f"PubMed {endpoint} request error (attempt {attempt+1}/{MAX_RETRIES}): "
                    f"{e}, retrying in {wait}s"
                )
                time.sleep(wait)

        raise RuntimeError(
            f"PubMed {endpoint} failed after {MAX_RETRIES} attempts. Last error: {last_exc}"
        )

    # ------------------------------------------------------------------
    # MeSH lookup — queries PubMed's own ontology database
    # ------------------------------------------------------------------

    def _fetch_mesh_terms(self, term: str) -> List[str]:
        """
        Query PubMed's MeSH database to find official ontology terms.
        Returns MeSH descriptor names to be used with [MeSH Terms] field tag.
        Results are cached in-memory.
        """
        cache_key = term.lower().strip()
        if cache_key in self._mesh_cache:
            return self._mesh_cache[cache_key]

        try:
            # Step 1 — find matching MeSH IDs for the term
            search_data = {
                'db': 'mesh',
                'term': term,
                'retmax': 5,
                'retmode': 'xml',
            }
            search_response = self._post_with_retry('esearch.fcgi', search_data)
            search_root = ET.fromstring(search_response.content)
            mesh_ids = [
                id_elem.text
                for id_elem in search_root.findall('.//Id')
                if id_elem.text
            ]

            if not mesh_ids:
                logger.info(f"No MeSH IDs found for '{term}'")
                self._mesh_cache[cache_key] = []
                return []

            # Step 2 — fetch the actual MeSH descriptor names for those IDs
            fetch_data = {
                'db': 'mesh',
                'id': ','.join(mesh_ids[:3]),  # top 3 matches only
                'retmode': 'xml',
            }
            fetch_response = self._post_with_retry('efetch.fcgi', fetch_data)
            fetch_root = ET.fromstring(fetch_response.content)

            mesh_terms = []

            # Primary descriptor names (e.g. "Telemedicine", "Medical Informatics")
            for descriptor in fetch_root.findall('.//DescriptorName'):
                if descriptor.text and descriptor.text.strip():
                    mesh_terms.append(descriptor.text.strip())

            # Entry terms — alternative names PubMed maps to the descriptor
            for entry_term in fetch_root.findall('.//Term/String'):
                if entry_term.text and entry_term.text.strip():
                    candidate = entry_term.text.strip()
                    if candidate.lower() not in [m.lower() for m in mesh_terms]:
                        mesh_terms.append(candidate)

            # Deduplicate and cap at 8 to keep the query manageable
            seen = set()
            deduped = []
            for t in mesh_terms:
                if t.lower() not in seen:
                    seen.add(t.lower())
                    deduped.append(t)
            mesh_terms = deduped[:8]

            logger.info(f"MeSH terms for '{term}': {mesh_terms}")
            self._mesh_cache[cache_key] = mesh_terms
            return mesh_terms

        except Exception as e:
            logger.warning(f"MeSH lookup failed for '{term}': {e}")
            self._mesh_cache[cache_key] = []
            return []

    # ------------------------------------------------------------------
    # Synonym + MeSH expansion
    # ------------------------------------------------------------------

    def _get_synonyms(self, term: str) -> List[str]:
        """Return manual synonyms from SYNONYM_MAP (exact match only)."""
        return SYNONYM_MAP.get(term.lower().strip(), [])

    def _build_expanded_query_for_term(self, term: str) -> str:
        """
        Build a PubMed sub-query for a single term using proper field tags.

        Strategy:
          - MeSH descriptor names get the [MeSH Terms] field tag, which is
            exactly how PubMed's own website expands queries internally.
          - The original term and manual synonyms search [Title/Abstract].
          - Combining both with OR gives maximum recall matching PubMed's
            native search behaviour.

        Result looks like:
          (("smart healthcare"[Title/Abstract] OR "digital health"[Title/Abstract]
            OR "Medical Informatics"[MeSH Terms] OR "Telemedicine"[MeSH Terms]))
        """
        synonyms = self._get_synonyms(term)
        mesh_terms = self._fetch_mesh_terms(term)

        parts = []

        # Original term + manual synonyms → search title/abstract
        tiab_variants = [term] + synonyms
        seen = set()
        for v in tiab_variants:
            if v.lower() not in seen:
                seen.add(v.lower())
                parts.append(f'"{v}"[Title/Abstract]')

        # MeSH descriptor names → use [MeSH Terms] field tag
        # This is the key fix: [MeSH Terms] matches PubMed's own ontology tagging
        mesh_seen = set(v.lower() for v in tiab_variants)
        for m in mesh_terms:
            if m.lower() not in mesh_seen:
                mesh_seen.add(m.lower())
                parts.append(f'"{m}"[MeSH Terms]')

        logger.info(f"Expanded query for '{term}': {len(parts)} clauses")
        return "(" + " OR ".join(parts) + ")"

    # ------------------------------------------------------------------
    # Main search entry point
    # ------------------------------------------------------------------

    def search_and_retrieve_optimized(
        self,
        query: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        max_results: int = 1000,
        use_raw_query: bool = False,
    ) -> pd.DataFrame:
        """
        Search PubMed and retrieve paper details.

        Query strategy (use_raw_query=False, default):
          1. Split user query into individual terms (comma-separated)
          2. For each term, build an expanded sub-query combining
             [Title/Abstract] variants and [MeSH Terms] field tags
          3. AND the sub-queries together (both terms must match)
          4. Post-fetch: enforce date range strictly

        Query strategy (use_raw_query=True):
          Pass the query directly to PubMed's esearch, matching the
          results you would get from PubMed's own web search.
        """
        try:
            logger.info(f"Starting PubMed search for: {query}")
            logger.info(f"Parameters: max_results={max_results}, "
                        f"start_date={start_date}, end_date={end_date}, "
                        f"use_raw_query={use_raw_query}")

            if use_raw_query:
                search_query = query.strip()
                logger.info("Using raw query mode — no expansion applied")
            else:
                terms = [t.strip() for t in query.split(",") if t.strip()]

                # Build AND query — each term must appear (in some form)
                if len(terms) > 1:
                    term_blocks = [self._build_expanded_query_for_term(t) for t in terms]
                    # AND between term blocks: paper must match ALL terms
                    search_query = " AND ".join(term_blocks)
                else:
                    search_query = self._build_expanded_query_for_term(query.strip())

            if start_date or end_date:
                date_filter = self._build_date_filter(start_date, end_date)
                search_query = f"({search_query}) AND {date_filter}"

            logger.info(f"Final PubMed query: {search_query}")

            fetch_limit = min(max_results * 2, 1000)
            max_attempts = 3

            df = pd.DataFrame()
            current_offset = 0
            attempts = 0

            while attempts < max_attempts:
                attempts += 1
                logger.info(
                    f"Attempt {attempts}: fetching up to {fetch_limit} "
                    f"PMIDs at offset {current_offset}"
                )

                pmids = self._search_pmids_with_offset(
                    search_query, fetch_limit, current_offset
                )
                if not pmids:
                    logger.warning(f"No more PMIDs at offset {current_offset}")
                    break

                logger.info(f"Found {len(pmids)} PMIDs, retrieving details...")
                papers = self._retrieve_paper_details(pmids)

                if not papers:
                    logger.warning("No papers retrieved from PMIDs")
                    break

                batch_df = pd.DataFrame(papers)
                if not batch_df.empty:
                    df = pd.concat([df, batch_df], ignore_index=True)
                    logger.info(f"Total raw papers so far: {len(df)}")

                current_offset += len(pmids)
                if len(pmids) < fetch_limit:
                    logger.info("Reached end of available PubMed results")
                    break

                # Stop if we already have enough
                if len(df) >= max_results:
                    break

            if df.empty:
                logger.warning("No papers found for query")
                return pd.DataFrame()

            # ── Post-fetch date filter ──────────────────────────────────
            if start_date or end_date:
                years = pd.to_numeric(df['Publication Year'], errors='coerce')
                mask = pd.Series([True] * len(df))
                if start_date:
                    mask = mask & (years >= start_date.year)
                if end_date:
                    mask = mask & (years <= end_date.year)
                before = len(df)
                df = df[mask].reset_index(drop=True)
                logger.info(
                    f"Date filter: {before} -> {len(df)} papers "
                    f"within {getattr(start_date, 'year', '?')}-"
                    f"{getattr(end_date, 'year', '?')}"
                )

            # ── NO post-hoc score filtering ─────────────────────────────
            # Reason: PubMed's [MeSH Terms] field tagging is authoritative.
            # Papers that don't mention "smart healthcare" verbatim in their
            # title/abstract are still legitimately relevant if PubMed tagged
            # them with matching MeSH descriptors. Score filtering based on
            # keyword presence incorrectly removes these papers.
            # PubMed's own AND query between term blocks already enforces
            # that both topics are present — no further filtering needed.

            df = df.head(max_results).reset_index(drop=True)
            logger.info(f"Final result count: {len(df)} (target: {max_results})")
            return df

        except Exception as e:
            logger.error(f"Error in search_and_retrieve_optimized: {e}")
            return pd.DataFrame()

    # ------------------------------------------------------------------
    # PubMed API helpers
    # ------------------------------------------------------------------

    def _build_date_filter(
        self, start_date: Optional[date], end_date: Optional[date]
    ) -> str:
        if start_date and end_date:
            return (f"{start_date.strftime('%Y/%m/%d')}:"
                    f"{end_date.strftime('%Y/%m/%d')}[pdat]")
        elif start_date:
            return f"{start_date.strftime('%Y/%m/%d')}:3000/12/31[pdat]"
        elif end_date:
            return f"1900/01/01:{end_date.strftime('%Y/%m/%d')}[pdat]"
        return ""

    def _search_pmids(self, query: str, max_results: int) -> List[str]:
        return self._search_pmids_with_offset(query, max_results, 0)

    def _search_pmids_with_offset(
        self, query: str, max_results: int, offset: int = 0
    ) -> List[str]:
        """Search for PMIDs using esearch (POST)."""
        try:
            data = {
                'db': 'pubmed',
                'term': query,
                'retmax': min(max_results, 10000),
                'retstart': offset,
                'retmode': 'xml',
            }
            logger.info(f"esearch POST — retmax={data['retmax']}, retstart={offset}")
            response = self._post_with_retry('esearch.fcgi', data)

            root = ET.fromstring(response.content)
            pmids = [id_elem.text for id_elem in root.findall('.//Id')]

            logger.info(f"esearch found {len(pmids)} PMIDs")
            if not pmids:
                logger.warning(f"No PMIDs for query: {query}")
                logger.warning(response.content.decode('utf-8')[:500])

            return pmids

        except Exception as e:
            logger.error(f"Error searching PMIDs: {e}")
            return []

    def _retrieve_paper_details(self, pmids: List[str]) -> List[Dict[str, Any]]:
        """Retrieve paper details using efetch + esummary (POST), batch size 50."""
        papers = []
        batch_size = 50

        for i in range(0, len(pmids), batch_size):
            batch_pmids = pmids[i:i + batch_size]
            try:
                efetch_data = {
                    'db': 'pubmed',
                    'id': ','.join(batch_pmids),
                    'retmode': 'xml',
                }
                response = self._post_with_retry('efetch.fcgi', efetch_data)
                summary_details = self._fetch_summary_details(batch_pmids)
                batch_papers = self._parse_pubmed_xml(response.content, summary_details)
                papers.extend(batch_papers)
                logger.info(
                    f"Batch {i//batch_size + 1}: "
                    f"{len(batch_papers)} papers (total {len(papers)})"
                )
            except Exception as e:
                logger.error(f"Error in batch {i//batch_size + 1}: {e}")
                continue

        return papers

    def _fetch_summary_details(
        self, pmids: List[str]
    ) -> Dict[str, Dict[str, str]]:
        """Fetch PubMed summary metadata via POST."""
        try:
            data = {
                'db': 'pubmed',
                'id': ','.join(pmids),
                'retmode': 'json',
            }
            response = self._post_with_retry('esummary.fcgi', data)
            payload = response.json()
            result = payload.get('result', {})
            summary_map: Dict[str, Dict[str, str]] = {}

            for pmid in result.get('uids', []):
                doc = result.get(str(pmid), {})
                summary_map[str(pmid)] = {
                    'publication_year': self._extract_year_from_text(
                        doc.get('pubdate', '')
                    ) or "",
                    'journal': doc.get('fulljournalname') or doc.get('source') or "",
                }
            return summary_map
        except Exception as e:
            logger.warning(f"Unable to fetch summary details: {e}")
            return {}

    def _parse_pubmed_xml(
        self,
        xml_content: bytes,
        summary_details: Optional[Dict[str, Dict[str, str]]] = None
    ) -> List[Dict[str, Any]]:
        papers = []
        summary_details = summary_details or {}
        try:
            root = ET.fromstring(xml_content)
            for article in root.findall('.//PubmedArticle'):
                try:
                    paper = self._extract_paper_info(article, summary_details)
                    if paper:
                        papers.append(paper)
                except Exception as e:
                    logger.warning(f"Error parsing article: {e}")
                    continue
        except Exception as e:
            logger.error(f"Error parsing XML: {e}")
        return papers

    def _extract_paper_info(
        self,
        article,
        summary_details: Optional[Dict[str, Dict[str, str]]] = None
    ) -> Optional[Dict[str, Any]]:
        try:
            summary_details = summary_details or {}

            title_elem = article.find('.//ArticleTitle')
            title = title_elem.text if title_elem is not None else "Unknown"
            if title:
                title = re.sub(r'<[^>]+>', '', str(title)).strip()

            abstract_elem = article.find('.//AbstractText')
            abstract = abstract_elem.text if abstract_elem is not None else ""
            if abstract:
                abstract = re.sub(r'<[^>]+>', '', str(abstract)).strip()

            doi = pmcid = nihms_id = ""
            for article_id in article.findall('.//ArticleId'):
                id_type = article_id.get('IdType')
                if id_type == 'doi' and not doi:
                    doi = article_id.text or ""
                elif id_type == 'pmc' and not pmcid:
                    pmcid = article_id.text or ""
                elif id_type == 'mid' and not nihms_id:
                    nihms_id = article_id.text or ""

            pmid_elem = article.find('.//PMID')
            pmid = pmid_elem.text if pmid_elem is not None else ""
            summary = summary_details.get(pmid, {})

            journal_elem = article.find('.//Journal/Title')
            if journal_elem is None:
                journal_elem = article.find('.//Journal/ISOAbbreviation')
            journal = journal_elem.text if journal_elem is not None else "Unknown"
            journal = summary.get('journal') or journal
            publication_year = (
                summary.get('publication_year')
                or self._extract_publication_year(article)
            )
            create_date = self._extract_create_date(article)

            # --- FIX: read Authors list directly from parsed XML ---
            authors = []
            for author in article.findall('.//Author'):
                ln = author.find('LastName')
                fn = author.find('ForeName')
                initials = author.find('Initials')
                collective = author.find('CollectiveName')
                if collective is not None and collective.text:
                    authors.append(collective.text.strip())
                elif ln is not None and ln.text:
                    lastname = ln.text.strip()
                    # Use ForeName if available, else Initials
                    if fn is not None and fn.text:
                        firstname = fn.text.strip()
                    elif initials is not None and initials.text:
                        firstname = initials.text.strip()
                    else:
                        firstname = ""
                    full = f"{firstname} {lastname}".strip() if firstname else lastname
                    if full:
                        authors.append(full)
            first_author = authors[0] if authors else ""

            keywords = [
                kw.text.strip()
                for kw in article.findall('.//Keyword')
                if kw.text
            ]

            # Extract MeSH terms from the article XML
            mesh_terms = [
                mh.find('DescriptorName').text.strip()
                for mh in article.findall('.//MeshHeading')
                if mh.find('DescriptorName') is not None
                and mh.find('DescriptorName').text
            ]

            download_url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else ""
            citation = self._build_citation(article, journal, publication_year, doi)
            reference = citation or f"{title}. {journal}. {publication_year}."

            return {
                'Title':            title,
                'Abstract':         abstract,
                'Year_Published':   publication_year,
                'Publication Year': publication_year,
                'Source':           journal,
                'Journal/Book':     journal,
                # Use 'DOI' consistently (search_service reads 'DOI' first, then 'Doi' as fallback)
                'DOI':              doi,
                'Download_URL':     download_url,
                'Keywords':         keywords,
                'MeSH_Terms':       mesh_terms,
                # FIX: Authors is already a proper list — search_service.py
                # should read this directly instead of parsing Reference
                'Authors':          authors,
                'PMID':             pmid,
                'Citation':         citation,
                'Create Date':      create_date,
                'PMCID':            pmcid,
                'NIHMS ID':         nihms_id,
                'First Author':     first_author,
                'Reference':        reference,
            }

        except Exception as e:
            logger.error(f"Error extracting paper info: {e}")
            return None

    def _extract_publication_year(self, article) -> str:
        pub_date = article.find('.//JournalIssue/PubDate')
        year = self._extract_year_from_pubdate(pub_date)
        if year:
            return year
        article_date = article.find(".//ArticleDate[@DateType='Electronic']")
        year = self._extract_year_from_pubdate(article_date)
        if year:
            return year
        medline_date = article.find('.//MedlineDate')
        if medline_date is not None and medline_date.text:
            year = self._extract_year_from_text(medline_date.text)
            if year:
                return year
        return "Unknown"

    def _extract_create_date(self, article) -> str:
        pubmed_data = article.find('.//PubmedData/History')
        if pubmed_data is None:
            return ""
        for pubmed_date in pubmed_data.findall(
            "PubMedPubDate[@PubStatus='pubmed']"
        ):
            date_str = self._format_pubmed_date(pubmed_date)
            if date_str:
                return date_str
        first_date = pubmed_data.find('PubMedPubDate')
        return self._format_pubmed_date(first_date) if first_date is not None else ""

    def _build_citation(
        self, article, journal: str, publication_year: str, doi: str
    ) -> str:
        citation_parts = []
        if journal and journal != "Unknown":
            citation_parts.append(journal)

        pub_date = article.find('.//JournalIssue/PubDate')
        medline_date = ""
        if pub_date is not None:
            ml = pub_date.find('MedlineDate')
            if ml is not None and ml.text:
                medline_date = ml.text.strip()

        if medline_date:
            citation_parts.append(medline_date)
        elif publication_year and publication_year != "Unknown":
            month = self._get_text(pub_date, 'Month') if pub_date is not None else ""
            day   = self._get_text(pub_date, 'Day')   if pub_date is not None else ""
            frag  = publication_year
            if month:
                frag = f"{frag} {month}"
            if day:
                frag = f"{frag} {day}"
            citation_parts.append(frag)

        volume = self._get_text(article, './/JournalIssue/Volume')
        issue  = self._get_text(article, './/JournalIssue/Issue')
        pages  = self._get_text(article, './/Pagination/MedlinePgn')
        ids = []
        if volume:
            ids.append(f"{volume}({issue})" if issue else volume)
        elif issue:
            ids.append(f"({issue})")
        if pages:
            ids.append(pages)
        if ids:
            citation_parts.append(':'.join(ids) if len(ids) > 1 else ids[0])

        citation = '. '.join(p for p in citation_parts if p).strip()
        if citation and not citation.endswith('.'):
            citation += '.'
        if doi:
            citation = f"{citation} doi: {doi}".strip()
            if not citation.endswith('.'):
                citation += '.'
        return citation

    def _extract_year_from_pubdate(self, pub_date) -> Optional[str]:
        if pub_date is None:
            return None
        year_elem = pub_date.find('Year')
        if year_elem is not None and year_elem.text:
            return year_elem.text.strip()
        ml = pub_date.find('MedlineDate')
        if ml is not None and ml.text:
            return self._extract_year_from_text(ml.text)
        return None

    def _extract_year_from_text(self, text: str) -> Optional[str]:
        m = re.search(r'\b(19|20)\d{2}\b', text or "")
        return m.group() if m else None

    def _format_pubmed_date(self, date_elem) -> str:
        if date_elem is None:
            return ""
        year  = self._get_text(date_elem, 'Year')
        month = self._normalize_month(self._get_text(date_elem, 'Month'))
        day   = self._get_text(date_elem, 'Day')
        if not year:
            return ""
        month = month or "01"
        day   = day.zfill(2) if day else "01"
        return f"{day}-{month}-{year}"

    def _normalize_month(self, month: str) -> str:
        if not month:
            return ""
        month = month.strip()
        if month.isdigit():
            return month.zfill(2)
        month_map = {
            'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
            'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
            'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
        }
        return month_map.get(month[:3].lower(), "")

    def _get_text(self, element, path: str) -> str:
        if element is None:
            return ""
        child = element.find(path)
        if child is None or child.text is None:
            return ""
        return child.text.strip()


# Legacy alias for backward compatibility
OptimizedPubMedSearcher = PubMedService