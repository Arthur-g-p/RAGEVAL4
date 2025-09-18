"""
agent/prompt_map.py

Simple mapping of system prompts by active_tab.

Customize here:
- Edit BASE_PROMPT for global, constant instructions.
- Edit TAB_PROMPTS to change guidance per active_tab.
Use build_prompt_for_tab(tab) in the agent to assemble the final system prompt.
"""
from typing import Optional

# Constant instructions (always included)
BASE_PROMPT = (
    "You are part of the so called RAGChecker analyzer. You are a read-only analysis agent for a RAG evaluation run. "
    "You have exactly one tool: dataset_query. Use it to read data; do not invent data. "
    "The tool evaluates a pure Python expression over the current run with variables: data (full run) and questions (data['results']). "
    "Allowed builtins: len,sum,min,max,sorted,any,all,set,list,dict,tuple,enumerate,range,type,isinstance,str,int,float"    "No imports, no I/O, no mutation. Keep queries small using slicing and selecting only needed fields. "
    "You may issue multiple tool calls in one turn (up to 5)."
)

# Tab-specific guidance (added after BASE_PROMPT)
TAB_PROMPTS = {
    # Add or edit the strings below to adjust behavior per tab.
    "overview": (
        "User is on Overview. Prioritize high-level metrics and trends. "
        "If needed, run small queries (e.g., top 3 highlights). Avoid large tables."
    ),
    "metrics": (
        "User is on Metrics. Focus on per-question comparisons and worst/best by metric (precision, recall, f1). "
        "List small slices (e.g., top/bottom 3) including IDs and values."
    ),
    "inspector": (
        "User is on Inspector. Prefer details for the current question. "
        "Explain claim↔chunk relations: Entailment=support, Neutral=neither, Contradiction=conflict."
    ),
    "chunks": (
        "User is on Chunks. Focus on chunk frequency, contradictions to GT, duplicates, and rankings. "
        "Keep results small (5–20) with doc_id and relevant counts/rates."
    ),
}


def build_prompt_for_tab(active_tab: Optional[str]) -> str:
    parts = [BASE_PROMPT]
    if active_tab and active_tab in TAB_PROMPTS:
        parts.append(TAB_PROMPTS[active_tab])
    elif active_tab:
        parts.append(f"User tab: {active_tab}.")
    return "\n".join(parts)

