import logging
import os
import json
from pathlib import Path
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('logs/backend.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = FastAPI(title="RAG-Debugger Backend", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

COLLECTIONS_DIR = Path("collections")

@app.get("/")
async def root():
    return {"message": "RAG-Debugger Backend is running"}

@app.get("/collections")
async def get_collections():
    """Get list of collections and their run files."""
    try:
        logger.info("Listing collections...")
        if not COLLECTIONS_DIR.exists():
            logger.error("Collections directory does not exist")
            raise HTTPException(status_code=404, detail="Collections directory not found")
        
        collections = {}
        for collection_dir in COLLECTIONS_DIR.iterdir():
            if collection_dir.is_dir():
                run_files = []
                for file_path in collection_dir.glob("*.json"):
                    run_files.append(file_path.name)
                collections[collection_dir.name] = sorted(run_files)
        
        logger.info(f"Found {len(collections)} collections")
        return collections
    except Exception as e:
        logger.error(f"Error listing collections: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/collections/{collection}/runs/{run_file}")
async def get_run(collection: str, run_file: str):
    """Get a specific run JSON file."""
    try:
        logger.info(f"Loading run: {collection}/{run_file}")
        run_path = COLLECTIONS_DIR / collection / run_file
        
        if not run_path.exists():
            logger.error(f"Run file not found: {run_path}")
            raise HTTPException(status_code=404, detail="Run file not found")
        
        with open(run_path, 'r', encoding='utf-8') as f:
            run_data = json.load(f)
        
        logger.info(f"Successfully loaded run: {collection}/{run_file}")
        return run_data
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in run file {collection}/{run_file}: {str(e)}")
        raise HTTPException(status_code=400, detail="Invalid JSON file")
    except Exception as e:
        logger.error(f"Error loading run {collection}/{run_file}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/derive")
async def derive_metrics(run_data: Dict[str, Any]):
    """Add derived metrics to run data."""
    try:
        logger.info("Computing derived metrics...")
        
        # Add derived metrics for each question
        if "results" in run_data:
            for question in run_data["results"]:
                if "retrieved_context" in question:
                    # Calculate context length in words
                    context_text = " ".join([chunk["text"] for chunk in question["retrieved_context"]])
                    question["context_length"] = len(context_text.split())
                    question["num_chunks"] = len(question["retrieved_context"])
        
        logger.info("Successfully computed derived metrics")
        return run_data
    except Exception as e:
        logger.error(f"Error computing derived metrics: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting FastAPI server...")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)