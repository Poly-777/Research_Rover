# to push git checkout -b Polycarp/pubmed_search_accurate-analytics_page-better_ui_interface


# Research Rover

## Introduction
Research Rover is a modern, AI-powered web application designed to help researchers and students efficiently discover, analyze, and interact with academic research papers. The application provides an intelligent interface for paper discovery, full-text extraction, semantic search, and AI-powered chat functionality, making research more efficient and insightful.

## Tech Stack

### Backend
- **Python 3.11+**
- **FastAPI**: Modern, fast web framework for building REST APIs
- **Uvicorn**: ASGI server for FastAPI
- **Pydantic**: Data validation and settings management
- **Sentence Transformers**: AI embeddings for semantic search
- **FAISS**: Vector similarity search and clustering
- **Crawl4ai**: Advanced web scraping for full-text extraction
- **BeautifulSoup4**: HTML parsing and content extraction
- **Pandas**: Data manipulation and analysis
- **Google Generative AI**: LLM integration for chat functionality
- **Asyncio**: Asynchronous programming support

### Frontend
- **React 18**: Modern UI library with hooks
- **TypeScript**: Type-safe JavaScript development
- **Vite**: Fast build tool and development server
- **Tailwind CSS**: Utility-first CSS framework
- **Shadcn/ui**: Modern component library
- **Framer Motion**: Smooth animations and transitions
- **React Router**: Client-side routing
- **Lucide React**: Beautiful icon library

## Features

### Currently Implemented
- **Intelligent Paper Search**
  - PubMed integration with advanced query optimization
  - Real-time search progress tracking with step indicators
  - Smart query enhancement (abbreviation expansion, typo correction)
  - Comprehensive metadata extraction (DOI, authors, keywords, abstracts)
  - Paginated results with client-side filtering

- **Full-Text Extraction & Processing**
  - Automatic full-text extraction from paper URLs
  - Clean JSON mapping storage (DOI → full-text content)
  - Fallback to abstracts when full-text unavailable
  - Enhanced content quality for better AI responses

- **AI-Powered Semantic Search**
  - Vector embeddings using Sentence Transformers (all-mpnet-base-v2)
  - FAISS-based similarity search for fast retrieval
  - Chunk-based processing for better context matching
  - Support for both abstract and full-text embeddings

- **Intelligent Chat Interface**
  - Query decomposition for complex research questions
  - Multi-query semantic search with result deduplication
  - Context-aware responses using Google Gemini
  - Source citations with paper references
  - Real-time streaming responses

- **Data Management**
  - Clean CSV export without pollution (no Full_Text column)
  - Separate JSON storage for full-text content
  - Efficient file management and organization
  - Background processing for large datasets


### Prerequisites
- Python 3.11 or higher
- Node.js 18+ (Latest LTS version recommended)
- npm or yarn package manager

### API Configuration
* Get [Google Gemini API Key](https://aistudio.google.com/apikey) - Required for AI chat functionality
* Get [PubMed API Key](https://support.nlm.nih.gov/kbArticle/?pn=KA-05317) - Optional but recommended for higher rate limits

Configure environment variables in `backend_fastapi/.env`:
```bash
# Copy the example file
cp backend_fastapi/.env.example backend_fastapi/.env

# Edit the .env file with your API keys
GOOGLE_GENAI_API_KEY="your_gemini_api_key_here"
EMAIL="your_email@example.com"
PUBMED_API_KEY="your_pubmed_api_key_here"
```

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/Research-Rover.git
   cd Research-Rover
   ```

2. **Backend Setup (FastAPI)**
   ```bash
   cd backend
   uv venv
   
   # Windows
    # macOS/Linux
   source .venv/bin/activate
   
   uv pip install -r requirements.txt
   python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

3. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

4. **Access the Application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:8000
   - API Documentation: http://localhost:8000/docs
## Usage Guide

### 1. Searching Papers
- Enter research keywords (e.g., "machine learning healthcare")
- The system automatically optimizes queries (expands "ml" to "machine learning")
- Monitor real-time search progress with step-by-step indicators
- Browse paginated results with rich metadata
- Export clean CSV files for offline analysis

### 2. Creating Embeddings
- After searching, create vector embeddings for semantic search
- Full-text extraction automatically attempts to get complete paper content
- Fallback to abstracts ensures all papers are processed
- Progress tracking shows embedding generation status

### 3. AI-Powered Chat
- Ask complex research questions about your collected papers
- System decomposes queries into sub-questions for comprehensive answers
- Get contextual responses with proper source citations
- Real-time streaming responses for better user experience

### 4. Data Management
- Papers stored in clean CSV format (metadata only)
- Full-text content stored separately in JSON mapping files
- Efficient file organization in the `data/` directory
- Background processing for large datasets

## API Endpoints

### Search & Discovery
- `POST /api/v1/search/`: Search for research papers
- `GET /api/v1/search/progress`: Get current search progress
- `GET /api/v1/files/list`: List available CSV files
- `GET /api/v1/files/download/{filename}`: Download CSV files

### AI & Embeddings
- `POST /api/v1/embeddings/{filename}`: Create vector embeddings
- `GET /api/v1/embeddings/{filename}/status`: Check embedding status
- `GET /api/v1/embeddings/progress`: Get embedding progress
- `POST /api/v1/chat/`: AI chat with research papers

### System
- `GET /`: Health check endpoint
- `GET /health`: Detailed system health status
- `GET /docs`: Interactive API documentation

## Architecture

### Data Flow
1. **Search**: PubMed API → Paper Metadata → CSV Storage
2. **Full-Text**: URL Extraction → Web Scraping → JSON Mapping
3. **Embeddings**: Text Processing → Vector Generation → FAISS Index
4. **Chat**: Query → Semantic Search → LLM Processing → Response

### File Structure
```
data/
├── {query}.csv                           # Paper metadata
├── {query}_full_text_mapping.json       # Full-text content
├── {query}_paper_chunks_hdbscan.index   # FAISS vector index
├── {query}_paper_chunk_metadata_hdbscan.json  # Chunk metadata
└── {query}_paper_data_doi_mapped_hdbscan.json # DOI mappings
```

## Contributing
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License
This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments
- PubMed/NCBI for providing access to biomedical literature
- Google for Gemini AI integration
- Sentence Transformers for semantic embeddings
- FastAPI community for excellent documentation