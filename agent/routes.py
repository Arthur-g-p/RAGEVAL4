# Agent module for LLM streaming chat + dataset_query tool (single endpoint)
# Single-user, no persistence. Keeps current run in memory when provided with each call.

import asyncio
import json
import logging
import os
import uuid
from typing import Any, Dict, Iterable, Optional, List

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

try:
    from litellm import acompletion  # async
except Exception as e:  # pragma: no cover
    acompletion = None

logger = logging.getLogger(__name__)

router = APIRouter()

# In-memory current run (single-user)
CURRENT_RUN: Optional[Dict[str, Any]] = None

# ---------------------- Request models ----------------------
class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    active_tab: Optional[str] = Field(default=None, description="overview | metrics | inspector | chunks")
    selected_question_id: Optional[str] = None
    view_context: Optional[Dict[str, Any]] = None
    run_data: Optional[Dict[str, Any]] = Field(default=None, description="Provide on first call or when run changes")

# Tool args
class ToolCallArgs(BaseModel):
    expr: str
    limit: Optional[int] = Field(default=50, ge=1, le=200)

# OpenAI-style tools schema for dataset_query
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "dataset_query",
            "description": (
                "Evaluate a pure Python expression over the current run. Read-only.\n"
                "Variables: data (enhanced run), questions (data['results'] list).\n"
                "Allowed builtins: len,sum,min,max,sorted,any,all,set,list,dict,tuple,enumerate,range.\n"
                "Return small results; slice or use limit."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "expr": {"type": "string", "description": "Python expression returning JSON-serializable value."},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 200}
                },
                "required": ["expr"],
                "additionalProperties": False
            }
        }
    }
]

BASE_SYSTEM_PROMPT = (
    "You are a read-only analysis agent for a RAG evaluation run. "
    "You have exactly one tool: dataset_query, which evaluates a Python expression over the dataset. "
    "Do not invent data. Do not modify anything. "
    "Use the tool when you need concrete values; keep results small. "
    "Stream only your final answer tokens; never stream tool inputs/outputs."
)

TAB_HINTS = {
    "overview": "User is on Overview. Prioritize explaining high-level metrics and trends.",
    "metrics": "User is on Metrics. Focus on per-question comparisons, worst/best by metric.",
    "inspector": "User is on Inspector. Prefer details for the selected question and claim-level relations.",
    "chunks": "User is on Chunks. Focus on chunk frequency, entailments/contradictions, and duplicates.",
}

ALLOWED_BUILTINS = {
    "len": len,
    "sum": sum,
    "min": min,
    "max": max,
    "sorted": sorted,
    "any": any,
    "all": all,
    "set": set,
    "list": list,
    "dict": dict,
    "tuple": tuple,
    "enumerate": enumerate,
    "range": range,
}

def _trunc(val: Optional[str], n: int = 200) -> str:
    try:
        s = str(val) if val is not None else ""
        return s if len(s) <= n else s[:n] + "…"
    except Exception:
        return ""

async def _eval_expr(expr: str, ctx: Dict[str, Any], timeout_ms: int = 400) -> Any:
    loop = asyncio.get_event_loop()

    def runner():
        code = compile(expr, "<expr>", "eval")
        return eval(code, {"__builtins__": ALLOWED_BUILTINS}, ctx)

    return await asyncio.wait_for(loop.run_in_executor(None, runner), timeout_ms / 1000)


def _normalize_questions(run: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not run:
        return []
    results = run.get("results", [])
    if isinstance(results, dict) and "results" in results:
        results = results.get("results", [])
    if not isinstance(results, list):
        return []
    return results


async def _run_dataset_query(expr: str, limit: Optional[int]) -> Dict[str, Any]:
    if CURRENT_RUN is None:
        raise HTTPException(status_code=400, detail="No run loaded. Include run_data in the request once after loading a run.")
    questions = _normalize_questions(CURRENT_RUN)
    ctx = {"data": CURRENT_RUN, "questions": questions}

    value = await _eval_expr(expr, ctx, timeout_ms=400)

    truncated = False
    if isinstance(value, list) and limit is not None and len(value) > limit:
        value = value[:limit]
        truncated = True

    # Ensure JSON serializable
    try:
        json.dumps(value)
    except TypeError:
        if isinstance(value, (set, tuple)):
            value = list(value)
        else:
            value = str(value)

    return {"result": value, "truncated": truncated}


def _build_system_prompt(active_tab: Optional[str], selected_question_id: Optional[str], view_context: Optional[Dict[str, Any]]) -> str:
    parts = [BASE_SYSTEM_PROMPT]
    if active_tab:
        parts.append(TAB_HINTS.get(active_tab, f"User tab: {active_tab}."))
    if selected_question_id:
        parts.append(f"Selected question id: {selected_question_id}.")
    if view_context:
        # Keep it short to avoid token bloat; include only keys
        keys = ", ".join(sorted(view_context.keys()))
        if keys:
            parts.append(f"View context keys: {keys}.")
    return "\n".join(parts)


@router.post("/chat/stream")
async def chat_stream(req: Request, body: ChatRequest):
    global CURRENT_RUN

    request_id = uuid.uuid4().hex[:8]

    if acompletion is None:  # pragma: no cover
        raise HTTPException(status_code=500, detail="litellm is not available")

    # Load env (use only LLM_NAME for model)
    model = os.getenv("LLM_NAME")
    if not model:
        logger.error(f"[{request_id}] LLM_NAME is not set in environment")
        raise HTTPException(status_code=500, detail="LLM_NAME is not set in environment")
    api_base = os.getenv("LLM_PROVIDER_API_BASE", os.getenv("LLM_API_BASE", "https://api.openai.com/v1"))
    api_key = os.getenv("LLM_PROVIDER_API_KEY", os.getenv("LLM_API_KEY"))
    timeout_sec = float(os.getenv("LLM_TIMEOUT_SEC", "30"))

    logger.info(
        f"[{request_id}] chat request: tab={body.active_tab} sel_qid={body.selected_question_id} "
        f"msgs={len(body.messages) if body.messages else 0} view_keys={sorted(body.view_context.keys()) if body.view_context else []} "
        f"run_data={'yes' if body.run_data is not None else 'no'}"
    )

    if not api_key:
        raise HTTPException(status_code=400, detail="Missing LLM_PROVIDER_API_KEY in environment")

    # Update current run if provided
    if body.run_data is not None:
        CURRENT_RUN = body.run_data
        logger.info("Agent: current run cached in memory for this process")

    # Build messages array
    sys_prompt = _build_system_prompt(body.active_tab, body.selected_question_id, body.view_context)
    logger.info(f"[{request_id}] === SYSTEM PROMPT ===\n{sys_prompt}")
    messages: List[Dict[str, str]] = [{"role": "system", "content": sys_prompt}]
    last_user = None
    for m in body.messages:
        if m.role in ("user", "assistant") and isinstance(m.content, str):
            messages.append({"role": m.role, "content": m.content})
            if m.role == "user":
                last_user = m.content
    if last_user is not None:
        logger.info(f"[{request_id}] === USER INPUT ===\n{last_user}")

    # Iterative tool-use loop: allow the model to call the tool up to 5 times before final answer
    MAX_STEPS = 5

    async def sse_generator() -> Iterable[bytes]:
        # === TOOL LOOP ===
        tool_steps = 0
        tool_used = False
        tool_call_id: Optional[str] = None
        while tool_steps < MAX_STEPS:
            # Non-stream call with tools enabled
            try:
                resp = await acompletion(
                    model=model,
                    api_base=api_base,
                    api_key=api_key,
                    timeout=timeout_sec,
                    messages=messages,
                    tools=TOOLS,
                    tool_choice="auto",
                    stream=False,
                )
            except Exception as e:
                err = f"LLM call failed during tool loop: {e}"
                logger.error(f"[{request_id}] [TOOL-LOOP-ERROR] {err}")
                yield f"data: {json.dumps({"error": err})}\n\n".encode("utf-8")
                return

            msg = resp.choices[0].message
            tool_calls = getattr(msg, "tool_calls", None)
            if not tool_calls:
                logger.info(f"[{request_id}] tool loop: no tool call (will stream final)")
                break

            call = tool_calls[0]
            fn = getattr(call, "function", None)
            name = getattr(fn, "name", None) if fn else None
            args_raw = getattr(fn, "arguments", "{}") if fn else "{}"
            tool_call_id = getattr(call, "id", None)
            logger.info(f"[{request_id}] tool loop: assistant requested tool name={name} id={tool_call_id} args={args_raw}")

            if name != "dataset_query":
                logger.info(f"[{request_id}] tool loop: unknown tool '{name}', stopping tool loop")
                break

            # Parse args
            try:
                args = json.loads(args_raw)
                tool_args = ToolCallArgs(**args)
            except Exception as e:
                err = f"Invalid tool arguments: {e}"
                logger.error(f"[{request_id}] [TOOL-ARGS-ERROR] {err}")
                yield f"data: {json.dumps({"error": err})}\n\n".encode("utf-8")
                return

            # Append assistant tool_call message
            assistant_tool_msg = {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": tool_call_id or f"call_{tool_steps+1}",
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": json.dumps(args)
                        }
                    }
                ]
            }
            messages.append(assistant_tool_msg)

            # Execute dataset_query
            try:
                logger.info(f"[{request_id}] === TOOL EXECUTE (step {tool_steps+1}) ===\nexpr={tool_args.expr}\nlimit={tool_args.limit}")
                tool_result = await _run_dataset_query(tool_args.expr, tool_args.limit)
                logger.info(f"[{request_id}] === TOOL RESULT (step {tool_steps+1}) ===\n{json.dumps(tool_result, ensure_ascii=False)}")
            except Exception as e:
                err = f"dataset_query failed: {e}"
                logger.error(f"[{request_id}] [DATASET-QUERY-ERROR] {err}")
                yield f"data: {json.dumps({"error": err})}\n\n".encode("utf-8")
                return

            # Append tool result message
            tool_msg = {
                "role": "tool",
                "name": "dataset_query",
                "content": json.dumps(tool_result, ensure_ascii=False),
            }
            if tool_call_id:
                tool_msg["tool_call_id"] = tool_call_id
            messages.append(tool_msg)

            tool_used = True
            tool_steps += 1

        # === FINAL STREAM ===
        try:
            logger.info(f"[{request_id}] final: streaming answer (tool_choice=none)")
            stream = await acompletion(
                model=model,
                api_base=api_base,
                api_key=api_key,
                timeout=timeout_sec,
                messages=messages,
                tool_choice="none",
                stream=True,
            )
        except Exception as e:
            logger.error(f"[{request_id}] [FINAL-STREAM-ERROR] {e}")
            yield f"data: {json.dumps({"error": "Final LLM call failed"})}\n\n".encode("utf-8")
            return

        final_text_parts: List[str] = []
        try:
            async for chunk in stream:
                delta = chunk.choices[0].delta
                text = getattr(delta, "content", None)
                if text:
                    final_text_parts.append(text)
                    yield f"data: {json.dumps({"content": text})}\n\n".encode("utf-8")
        except Exception as e:
            logger.error(f"[{request_id}] [STREAM-EMIT-ERROR] {e}")
        finally:
            final_text = "".join(final_text_parts)
            logger.info(f"[{request_id}] === FINAL ANSWER ===\n{final_text}")
            yield b"event: done\ndata: {}\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")

