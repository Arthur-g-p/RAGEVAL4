# RAG-Debugger

A single-run interactive analyzer for forensic debugging of RAG experiments with React frontend and FastAPI backend.

## Features

- **Run Selection**: Load and analyze RAG experiment runs from JSON files
- **Overview Tab**: High-level KPI cards showing overall, retriever, and generator metrics
- **Metrics Tab**: Interactive bar charts comparing metrics across questions
- **Inspector Tab**: Detailed question analysis with claims, entailments, and chunk inspection
- **Chunks Tab**: Analysis of chunk retrieval frequency, length distribution, and duplicates
- **Professional UI**: Clean, modern interface with no scrolling - uses tabbed layout

## Setup Instructions (Windows)

### Prerequisites

- Python 3.8+ installed
- Node.js 16+ installed
- Windows environment

### Quick Start

1. **Clone or download the project** to your desired directory

2. **Run the development environment**:
   ```cmd
   run-dev.bat
   ```
   
   This script will:
   - Set up Python virtual environment
   - Install Python dependencies
   - Start the FastAPI backend
   - Install Node.js dependencies
   - Start the React frontend

3. **Access the application**:
   - Frontend: http://localhost:3000
   - Backend API: http://127.0.0.1:8000

### Manual Setup

If you prefer to set up manually:

#### Backend Setup

1. Create virtual environment:
   ```cmd
   python -m venv venv
   ```

2. Activate virtual environment:
   ```cmd
   venv\Scripts\activate.bat
   ```

3. Install dependencies:
   ```cmd
   pip install -r requirements.txt
   ```

4. Start backend:
   ```cmd
   python main.py
   ```

#### Frontend Setup

1. Navigate to frontend directory:
   ```cmd
   cd frontend
   ```

2. Install dependencies:
   ```cmd
   npm install
   ```

3. Start development server:
   ```cmd
   npm start
   ```

## Usage

1. **Select a Run**: Use the dropdown in the top-right to select a collection and run
2. **Explore Tabs**: 
   - **Overview**: See overall performance metrics
   - **Metrics**: Compare metrics across questions with interactive charts
   - **Inspector**: Dive deep into individual questions
   - **Chunks**: Analyze chunk retrieval patterns

## Data Structure

The application expects JSON files in the `collections/` directory with the following structure:

```
collections/
├── collection_name_1/
│   ├── run_1.json
│   ├── run_2.json
│   └── ...
├── collection_name_2/
│   └── ...
```

Each run JSON file should follow the schema defined in the requirements document.

## Logging

- Backend logs: `logs/backend.log`
- Frontend logs: Browser console + in-memory log storage

## Architecture

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: FastAPI (Python)
- **Charts**: Recharts library
- **No Authentication**: As specified in requirements

## Development

The application supports hot reloading for both frontend and backend during development.

### Available Scripts

- `run-dev.bat` - Start both backend and frontend
- `run-backend.bat` - Start only the backend
- `run-frontend.bat` - Start only the frontend

## Troubleshooting

1. **Backend not accessible**: Check that port 8000 is not in use
2. **Frontend build errors**: Ensure Node.js 16+ is installed
3. **Python import errors**: Verify virtual environment is activated
4. **Run loading fails**: Ensure JSON files are valid and follow the expected schema