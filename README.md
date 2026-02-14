# RAG_V: Retrieval-Augmented Generation Visualizer

## Project Overview

RAG_V is a comprehensive Retrieval-Augmented Generation (RAG) visualization tool. It visualizes the results of document parsing, chunking, and retrieval, helping users to understand what happens in the RAG system and how to optimize it.

## Key Features
### Document Parsing Visualization
![Document Parsing](images/Parsed%20Results.png)

- **Multi-Format Document Processing**: Supports PDF, DOCX, PPTX and other document formats
- **Multiple Parser Options**: Support multiple parsers for different document types. Easy for extension.
- **Document Parsing Visualization**: Visualize parsed results by different parsers directly.

### Chunk Visualization
![Chunk History](images/Chunking%20History.png)
![Chunk Comparison](images/Chunking%20Comparison.png)

- **Visualize Document Chunks**: Displays parsed document chunks with annotations
- **Chunk Comparison**: Compare chunks from different chunkers with different parameters side by side

### Retrieval Visualization
![Retrieval Comparison](images/Retrieval%20Resutls.png)

- **Customizable Embeddings**: Add embedding models from different providers.
- **Retrieval Comparison**: Compare the results of different embedding models side by side.
- **Retriever Selection**: Select different retrieval strategies (Vector, BM25, Fusion, Reranking) for comparison. Easy for extension.


## Installation Guide

### Prerequisites

- Python 3.10+
- Node.js 18+
- Conda (recommended for Python environment management)

### Step 1: Clone the Repository

```bash
cd rag_v
git clone https://github.com/Zeus-Kairos/RAG_V.git
```

### Step 2: Set Up Python Environment

```bash
# Create conda environment
conda create -n rag_v python=3.13

# Activate environment
conda activate rag_v

# Install Python dependencies
pip install -r requirements.txt
```

### Step 3: Set Up Frontend

```bash
# Install Node.js dependencies
npm install

# Build the frontend
npm run build
```

### Step 4: Configure the System

rename .env.example to .env


## Usage Instructions

### Start the Backend Server

```bash
conda activate rag_v
cd rag_v
python main.py
```

### Start the Frontend Development Server

```bash
npm run dev
```

### Access the Application

Open your web browser and navigate to `http://localhost:5173` (for development server) or `http://localhost:8000` (for production build).


## System Components

### Parsers

The system supports multiple parsers for different document types:

- **PDF Parsers**:
  - pymupdf4llm (default)
  - markitdown
  - unstructured
  - pypdf
  - pdfplumber
  - docling

- **DOCX Parsers**:
  - markitdown (default)
  - unstructured
  - docling

- **PPTX Parsers**:
  - markitdown (default)
  - unstructured
  - docling

### Chunkers

The system supports multiple chunkers:

- **Langchain Splitters**:
  - MarkdownHeaderSplitter
  - RecursiveCharacterTextSplitter

- **Chonkie Chunkers**:
  - Sentence Chunker
  - Recursive Chunker
  - Semantic Chunker

- **Docling Chunkers**:
  - Hybrid Chunker

### Embedding Models

RAG_V support embedding models from the following providers:
- OpenAI
- Hugging Face
- Ollama
You can configure the embedding model in the settings.

### Retrieval Methods

The system implements multiple retrieval strategies:

- **BM25**: Traditional lexical search
- **Vector**: Semantic search using embeddings
- **Fusion**: Combines BM25 and semantic search
- **Rerank**: Improves search results using advanced reranker models


## How to Extend

### Add Your Own Parsers
- Add your own parser class that inherits from [BaseParser](src/file_process/parsers.py) with decorator `@register_parser`.
- Add your parser parameters to JSON config file [parserConfig.json](src/ui/parserConfig.json).

### Add Your Local Embedding Models
- Add your Hugging Face based local embedding model on Embedding Setting on ui. Click "Add" -> Select "Hugging Face" -> Input your model path in "Model" column.

### Add Your Own Retrievers
- Add your own retriever class that inherits from [BaseRetriever](src/retriever/retrievers.py).


## Contributing Guidelines

1. Fork the repository
2. Create a new branch for your feature
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the [MIT License](LICENSE).


## Support

For issues or questions, please open an issue in the GitHub repository.