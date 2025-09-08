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

def analyze_entailment_relations(relations_matrix: List[List[str]], chunk_count: int) -> Dict[str, int]:
    """Analyze entailment relations for chunks. Reusable for both retrieved2answer and retrieved2response."""
    chunk_relations = {}
    
    for chunk_idx in range(chunk_count):
        entailments = neutrals = contradictions = total = 0
        
        if chunk_idx < len(relations_matrix):
            relations = relations_matrix[chunk_idx]
            for relation in relations:
                total += 1
                if relation == "Entailment":
                    entailments += 1
                elif relation == "Neutral":
                    neutrals += 1
                elif relation == "Contradiction":
                    contradictions += 1
        
        chunk_relations[chunk_idx] = {
            "entailments": entailments,
            "neutrals": neutrals,
            "contradictions": contradictions,
            "total": total
        }
    
    return chunk_relations

def calculate_chunk_frequency_stats(questions: List[Dict]) -> Dict[str, Any]:
    """Calculate chunk frequency statistics. Reusable across different analysis types."""
    chunk_stats = {}
    
    for question in questions:
        if "retrieved_context" not in question:
            continue
            
        query_id = question.get("query_id", "unknown")
        retrieved_context = question.get("retrieved_context", [])
        
        for chunk in retrieved_context:
            chunk_key = f"{chunk['doc_id']}::{chunk['text']}"
            
            if chunk_key not in chunk_stats:
                chunk_stats[chunk_key] = {
                    "doc_id": chunk["doc_id"],
                    "text": chunk["text"],
                    "total_appearances": 0,
                    "questions_appeared": []
                }
            
            stats = chunk_stats[chunk_key]
            stats["total_appearances"] += 1
            
            if query_id not in stats["questions_appeared"]:
                stats["questions_appeared"].append(query_id)
    
    # Add frequency rankings
    chunks_by_frequency = sorted(
        chunk_stats.values(),
        key=lambda x: x["total_appearances"],
        reverse=True
    )
    
    ranked_stats = {}
    for rank, chunk_info in enumerate(chunks_by_frequency, 1):
        chunk_key = f"{chunk_info['doc_id']}::{chunk_info['text']}"
        ranked_stats[chunk_key] = {
            **chunk_info,
            "frequency_rank": rank,
            "total_unique_chunks": len(chunks_by_frequency)
        }
    
    return ranked_stats

def calculate_importance_metrics(frequency: int, gt_entailments: int, total_gt_relations: int, response_entailments: int, total_response_relations: int) -> Dict[str, Any]:
    """Calculate entailment rates only."""
    gt_entailment_rate = gt_entailments / max(total_gt_relations, 1)
    response_entailment_rate = response_entailments / max(total_response_relations, 1)
    
    return {
        "gt_entailment_rate": round(gt_entailment_rate, 3),
        "response_entailment_rate": round(response_entailment_rate, 3)
    }

def analyze_local_chunk_relations(question: Dict[str, Any]) -> Dict[int, Dict[str, Any]]:
    """Analyze entailment relations for chunks within the current question only."""
    retrieved_context = question.get("retrieved_context", [])
    retrieved2answer = question.get("retrieved2answer", [])
    retrieved2response = question.get("retrieved2response", [])
    
    logger.info(f"Analyzing local relations: {len(retrieved_context)} chunks, {len(retrieved2answer)} GT relations, {len(retrieved2response)} response relations")
    
    local_relations = {}
    
    for chunk_idx in range(len(retrieved_context)):
        # Initialize counters
        gt_entailments = gt_neutrals = gt_contradictions = 0
        response_entailments = response_neutrals = response_contradictions = 0
        
        # Analyze GT relations for this chunk
        if chunk_idx < len(retrieved2answer):
            for relation in retrieved2answer[chunk_idx]:
                if relation == "Entailment":
                    gt_entailments += 1
                elif relation == "Neutral":
                    gt_neutrals += 1
                elif relation == "Contradiction":
                    gt_contradictions += 1
        
        # Analyze response relations for this chunk
        if chunk_idx < len(retrieved2response):
            for relation in retrieved2response[chunk_idx]:
                if relation == "Entailment":
                    response_entailments += 1
                elif relation == "Neutral":
                    response_neutrals += 1
                elif relation == "Contradiction":
                    response_contradictions += 1
        
        result = {
            "local_gt_entailments": gt_entailments,
            "local_gt_neutrals": gt_neutrals,
            "local_gt_contradictions": gt_contradictions,
            "local_gt_total": gt_entailments + gt_neutrals + gt_contradictions,
            "local_response_entailments": response_entailments,
            "local_response_neutrals": response_neutrals,
            "local_response_contradictions": response_contradictions,
            "local_response_total": response_entailments + response_neutrals + response_contradictions
        }
        
        local_relations[chunk_idx] = result
        logger.info(f"Chunk {chunk_idx}: GT={gt_entailments}E/{gt_neutrals}N/{gt_contradictions}C, Resp={response_entailments}E/{response_neutrals}N/{response_contradictions}C")
    
    return local_relations

def build_chunk_effectiveness_lookup(questions: List[Dict]) -> Dict[str, Any]:
    """Build comprehensive chunk effectiveness lookup. Orchestrates all analysis functions."""
    # Get frequency statistics
    frequency_stats = calculate_chunk_frequency_stats(questions)
    chunk_lookup = {}
    
    # Analyze each question for entailment data
    chunk_entailment_data = {}
    for question in questions:
        if "retrieved_context" not in question:
            continue
            
        retrieved_context = question.get("retrieved_context", [])
        retrieved2answer = question.get("retrieved2answer", [])
        retrieved2response = question.get("retrieved2response", [])
        
        # Analyze entailments for this question
        gt_relations = analyze_entailment_relations(retrieved2answer, len(retrieved_context))
        response_relations = analyze_entailment_relations(retrieved2response, len(retrieved_context))
        
        # Accumulate data for each chunk
        for chunk_idx, chunk in enumerate(retrieved_context):
            chunk_key = f"{chunk['doc_id']}::{chunk['text']}"
            
            if chunk_key not in chunk_entailment_data:
                chunk_entailment_data[chunk_key] = {
                    "gt_entailments": 0, "gt_neutrals": 0, "gt_contradictions": 0, "total_gt_relations": 0,
                    "response_entailments": 0, "response_neutrals": 0, "response_contradictions": 0, "total_response_relations": 0
                }
            
            data = chunk_entailment_data[chunk_key]
            
            # Add GT relations
            if chunk_idx in gt_relations:
                gt_rel = gt_relations[chunk_idx]
                data["gt_entailments"] += gt_rel["entailments"]
                data["gt_neutrals"] += gt_rel["neutrals"]
                data["gt_contradictions"] += gt_rel["contradictions"]
                data["total_gt_relations"] += gt_rel["total"]
            
            # Add response relations
            if chunk_idx in response_relations:
                resp_rel = response_relations[chunk_idx]
                data["response_entailments"] += resp_rel["entailments"]
                data["response_neutrals"] += resp_rel["neutrals"]
                data["response_contradictions"] += resp_rel["contradictions"]
                data["total_response_relations"] += resp_rel["total"]
    
    # Build final lookup combining frequency and entailment data
    for chunk_key, freq_data in frequency_stats.items():
        entailment_data = chunk_entailment_data.get(chunk_key, {
            "gt_entailments": 0, "gt_neutrals": 0, "gt_contradictions": 0, "total_gt_relations": 0,
            "response_entailments": 0, "response_neutrals": 0, "response_contradictions": 0, "total_response_relations": 0
        })
        
        # Calculate importance metrics
        importance = calculate_importance_metrics(
            freq_data["total_appearances"],
            entailment_data["gt_entailments"],
            entailment_data["total_gt_relations"],
            entailment_data["response_entailments"],
            entailment_data["total_response_relations"]
        )
        
        # Combine all data
        chunk_lookup[chunk_key] = {
            **freq_data,
            **entailment_data,
            **importance
        }
    
    return chunk_lookup

@app.post("/derive")
async def derive_metrics(run_data: Dict[str, Any]):
    """Add derived metrics to run data."""
    try:
        logger.info("Computing derived metrics...")
        
        # Handle both direct results and nested results structure
        questions = run_data.get("results", [])
        if isinstance(questions, dict) and "results" in questions:
            questions = questions["results"]
        
        # Calculate chunk effectiveness analysis using modular functions
        chunk_effectiveness_lookup = build_chunk_effectiveness_lookup(questions)
        
        # Add derived metrics for each question
        for question in questions:
            if "retrieved_context" in question:
                # Calculate context length in words
                context_text = " ".join([chunk["text"] for chunk in question["retrieved_context"]])
                question["context_length"] = len(context_text.split())
                question["num_chunks"] = len(question["retrieved_context"])
                
                # Get local entailment analysis for this question
                local_relations = analyze_local_chunk_relations(question)
                logger.info(f"Question {question.get('query_id')}: Created local analysis for {len(local_relations)} chunks")
                
                # Add effectiveness analysis to each chunk
                for chunk_idx, chunk in enumerate(question["retrieved_context"]):
                    chunk_key = f"{chunk['doc_id']}::{chunk['text']}"
                    
                    # Add global effectiveness analysis
                    if chunk_key in chunk_effectiveness_lookup:
                        chunk["effectiveness_analysis"] = chunk_effectiveness_lookup[chunk_key]
                    
                    # Add local analysis for this question - FORCE IT
                    if chunk_idx in local_relations:
                        chunk["local_analysis"] = local_relations[chunk_idx]
                        logger.info(f"Chunk {chunk_idx}: Added local analysis {chunk['local_analysis']}")
                    else:
                        chunk["local_analysis"] = {
                            "local_gt_entailments": 0,
                            "local_gt_neutrals": 0,
                            "local_gt_contradictions": 0,
                            "local_gt_total": 0,
                            "local_response_entailments": 0,
                            "local_response_neutrals": 0,
                            "local_response_contradictions": 0,
                            "local_response_total": 0
                        }
                        logger.warning(f"Chunk {chunk_idx}: NO local relations found, using zeros")
        
        logger.info("Successfully computed derived metrics with chunk effectiveness analysis")
        return run_data
    except Exception as e:
        logger.error(f"Error computing derived metrics: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting FastAPI server...")
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)