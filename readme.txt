# RAG-Debugger — Developer Instructions (Markdown)

> Single-run interactive analyzer for forensic debugging of RAG experiments. Implement as a React front-end and a small FastAPI Python helper. Runs are delivered as `.json` files in the `\\collections` folder. This document is a practical instruction for developers — concise, precise, and actionable.

---

## 1) High-level constraints
- **Frontend**: React + TypeScript with custom CSS utilities. Project must prioritize professional, polished styling. The UI **must not rely on scrolling**. Use a tabbed layout (see UI rules). No emojis.
- **Backend**: FastAPI (Python). No authentication. Backend is a helper for listing runs and optional heavier derived computations. The frontend must be able to operate by directly reading the run JSON files during development.
- **Runtime**: Windows development environment. Provide instructions and scripts to run everything inside a Python `venv`.
- **Data source**: All runs live in `\\collections` (root relative). A **collection** contains multiple run JSON files. The app analyzes a single run at a time selected by the user.
- **Logging**: Must log startup, run-loading, parsing results, and whether each major visualization successfully rendered. On Windows, write logs to a file (e.g. `logs\\app.log`) and to console. Log levels: INFO, WARNING, ERROR.

---

## 2) Run files & data structure (exact contract)
> The frontend and backend must assume this schema exactly. Do not invent or rely on sample data embedded in code — load actual run JSON files from `\\collections`.

**Top-level run JSON**
```json
{
  "collection": "string",
  "timestamp": "string",
  "file_origin": "string",
  "metrics": {
    "overall_metrics": { "precision": number, "recall": number, "f1": number },
    "retriever_metrics": { "claim_recall": number, "context_precision": number },
    "generator_metrics": {
       "context_utilization": number,
       "noise_sensitivity_in_relevant": number,
       "noise_sensitivity_in_irrelevant": number,
       "hallucination": number,
       "self_knowledge": number,
       "faithfulness": number
    }
  },
  "performance": { "rag_retrieval_seconds": number, "rag_checker_processing_seconds": number },
  "results": [ /* array of Question objects */ ]
}
```

**Question object** (each element of `results`)
```json
{
  "query_id": "string",
  "query": "string",
  "gt_answer": "string",
  "response": "string",
  "retrieved_context": [ { "doc_id": "string", "text": "string" } ],
  "response_claims": ["string"],
  "gt_answer_claims": ["string"],
  "retrieved2response": [["Entailment"|"Contradiction"|"Neutral"]],
  "retrieved2answer": [["Entailment"|"Contradiction"|"Neutral"]],
  "metrics": { /* per-question numeric metrics (0..1 or 0..100) */ }
}
```

**Important parsing rules**
- Values in `metrics` may be percentages (0..100) or fractions (0..1). Implement a consistent normalization utility that converts to [0,1]. Do not assume one representation.
- Do **not** hardcode sample runs into the source. Always read from `\\collections/<collection>/<run>.json`.

---

## 3) UI & Visual rules (no scrolling; tabs only)
- Layout: top header (run identity), then **tab bar** with the following tabs: **Overview**, **Metrics**, **Question Inspector**, **Chunks**.
- The current run (collection + run filename + timestamp) must be visible in the header at all times.
- No vertical page scrolling: each tab is a fixed viewport panel. If content overflows, use internal, component-level scrolling confined to small scroll areas (not full page). Prefer paginated lists or collapsible sections.
- Aesthetics: first priority. The app must look professional: clean typography, consistent spacing, subtle shadows and rounded corners, clear color palette and accessible contrasts. Designers/developers should invest in visual polish early (spacing, micro-interactions, legible fonts). Tabs should feel like a modern application — not a simple web page.

---

## 4) Required components (clear props and responsibilities)
**Principles**: each component has a single responsibility and must be replaceable without changing others.

### A. RunSelector (top-left / header)
- Purpose: let user pick a collection and a run (from filesystem or server endpoint).
- Responsibilities: list collections and runs (from `\\collections` or via `GET /collections`), load selected run JSON, show loading spinner and errors, call `onRunLoaded(run)` when ready.
- Must show status messages and write to log when load succeeds/fails.

### B. Overview Tab (RunOverview)
- Props: `run` object
- **Experiment Summary**: Displays key statistics including total questions analyzed and total processing time in a clean, grid layout.
- **Key Performance Metrics**: Shows the most important metrics (F1 Score, Faithfulness, Hallucination, Context Precision) as colored cards with progress bars. Each card includes the metric value as a percentage and goodness indicator.
- **Metric Explanations**: Provides a dedicated section explaining what each metric means in plain language, helping users understand the significance of their results.
- Behavior: Cards are visual indicators only (read-only). The tab renders quickly and focuses on providing a high-level overview of experiment performance.

### C. Metrics Tab (MetricsByQuestion)
- Props: `run.results` and a `onSelectQuestion(query_id)` callback.
- **Chart**: "Performance Metrics Comparison Across Questions" - **Grouped vertical bars** where:
  - **X-axis**: discrete columns, one per question, labeled `Q{query_id} · {context_length}w` where `context_length` is the total word count of concatenated retrieved chunks for that question.
  - **Y-axis**: normalized metric goodness in the range [0,1]. Provide exact normalization rules (see section 5).
  - Bars grouped by metric; user can toggle which metrics are visible (checkboxes or legend toggles). Allow up to 6 metrics displayed at once for readability.
- **Interactions**:
  - Hover on bar: show full question text and metric raw + normalized values.
  - Click on a bar or question label: **switch to the Question Inspector tab** and open the selected question (do not scroll the page — switch tabs and focus the inspector view on that question).
- **Additional UI**: show `context_length` and `num_chunks` for each question in a tooltip or small label under the X-axis tick.

### D. Question Inspector Tab (QuestionInspector)
- Props: `selectedQuestion` (a Question object), `allQuestions`, and `onSelectQuestion` callback
- **Layout**: Clean, focused design without scrolling. Question selector dropdown at top-right for easy navigation.
- **Three-Column Comparison**: Side-by-side display of:
  - **User Query**: The original question with word count
  - **Ground Truth Answer**: The expected correct answer with word count
  - **System Response**: The generated answer with word count and difference comparison (±N vs GT)
- **Retrieved Context**: Expandable/collapsible section showing all retrieved chunks. When expanded, displays full text of each chunk with document ID and word counts. When collapsed, shows summary message.
- **Interactions**: Click question dropdown to switch between questions. Click "Expand" to view all retrieved context chunks in full detail.
- **Focus**: Provides detailed forensic analysis of individual questions, comparing what the system generated vs. ground truth, with full access to the context that informed the response.

### E. Chunks Tab (ChunkAnalysis)
- Props: `run.results`
- **Summary Stats**: Three key metrics displayed at the top - Unique Chunks, Average Words/Chunk, and Duplicate Groups.
- **View Selector**: Toggle between three analysis modes: Retrieval Frequency, Length Distribution, and Duplicates.
- **Visualizations**:
  1. **"Most Frequently Retrieved Chunks"**: Bar chart showing Y-axis = retrieval frequency, X-axis = chunk identifier (doc_id). Sort descending. Hover shows doc_id, length, and snippet; displays list of question IDs where it appeared.
  2. **"Chunk Length Distribution"**: Bar chart histogram of chunk lengths in words (compute per unique chunk). Shows distribution of chunk sizes across the dataset.
  3. **Duplicate Detection**: List view showing groups of chunks with identical text but different doc_ids. Provides exportable CSV of duplicate groups for further analysis.
- **Controls**: Filter to show top-N most-frequently retrieved chunks (10/20/50 options).

---

## 5) Metric normalization rules (must be implemented exactly)
- Any numeric metric may be encoded as a fraction (0..1) or percent (0..100). Implement a single utility function:
  - If value ∈ [0,1] → treat as fraction.
  - If value ∈ (1,100] → divide by 100.
  - Otherwise clamp into [0,1] and log a WARNING.
- Define `higher_is_better` per metric key:
  - Good (higher better): `precision`, `recall`, `f1`, `faithfulness`, `context_utilization`, `claim_recall`, `context_precision`, `self_knowledge`.
  - Bad (higher worse): `hallucination`, `noise_sensitivity_in_relevant`, `noise_sensitivity_in_irrelevant`.
- For plotting, convert bad metrics to **goodness** via `goodness = 1 - normalized_value`. Tooltips must show raw value, normalized value, and whether the metric was inverted for plotting.

---

## 6) Backend (FastAPI) — minimum endpoints and behavior
- **Environment**: Provide a Python `venv`. Include `requirements.txt` and a `run.bat` or PowerShell script that activates the venv and starts the FastAPI server on Windows.
- **Endpoints** (minimal):
  - `GET /collections` — returns list of collection names and run file names (read from `\\collections`).
  - `GET /collections/{collection}/runs/{run_file}` — returns raw run JSON.
  - `POST /derive` — accepts run JSON and returns the same run with optional derived numeric helpers (context_length, num_chunks, chunk lengths, chunk frequency, duplicate groups). This endpoint is optional; the frontend must be able to compute these client-side if the backend is not present.
- **Logging**: backend must write INFO logs when run files are listed, when a run is served, and ERROR logs on exceptions. Logs must be written to `logs\\backend.log`.

---

## 7) Developer notes & non-functional requirements
- Run everything in a Python virtual environment on Windows. Provide explicit setup instructions in a `README.md` and a `run-dev.bat` to bootstrap environment and start the dev servers.
- The app **must** look good. Invest time in CSS, spacing, color palette, and accessible contrast. Tabs are the main navigation model; avoid long vertical lists that require full-page scrolling.
- Each UI component must have a clear prop contract and be unit-testable. Follow SOLID: single responsibility and clear interface boundaries.
- Logging is required for both frontend (console + file via a small logging utility) and backend (file and console). Log successes for graph rendering to help debug whether visualizations loaded.
- The frontend must display clear error messages on load failure and not crash the UI.

---

## 8) Acceptance criteria (what to hand over)
- A Git repository that builds on Windows and contains:
  - `README.md` with step-by-step Windows venv setup and how to run frontend and backend.
  - Frontend app that reads runs from `\\collections` or via backend, implements tabs, and all components described above.
  - FastAPI helper with endpoints described and logging.
  - Unit tests for metric normalization and chunk duplicate detector.
- Visual quality: evaluator will judge polish — spacing, color, typography, and tab interactions matter.

---

## 9) Final constraints — what not to do
- Do not embed sample runs within code. Do not create or rely on example data files inside source other than referencing the `\\collections` folder.
- Do not add authentication or unrelated features.
- Do not rely on page-level vertical scrolling; tabs are mandatory.

---

This is the instruction set — concise and focused. Implementors should feel free to exercise reasonable design judgment for UI polish, but must adhere to the technical contracts and the non-functional constraints above.
