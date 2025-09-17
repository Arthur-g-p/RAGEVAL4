import React, { useState } from 'react';
import { Question } from '../types';
import { logger } from '../utils/logger';
import MetricsDisplay from './MetricsDisplay';
import { isIrrelevantFromSets } from '../utils/relevance';
import ClaimChunkOverlay from './ClaimChunkOverlay';

interface QuestionInspectorProps {
  question: Question;
  allQuestions?: Question[];
  onSelectQuestion?: (queryId: string) => void;
}

const QuestionInspector: React.FC<QuestionInspectorProps> = ({ question, allQuestions, onSelectQuestion }) => {
  const [isGTClaimsExpanded, setIsGTClaimsExpanded] = useState(false);
  const [isResponseClaimsExpanded, setIsResponseClaimsExpanded] = useState(false);
  const [isChunksExpanded, setIsChunksExpanded] = useState(true);
  const [showConnectors, setShowConnectors] = useState(true);
  const [chunkFilters, setChunkFilters] = useState({
    relevant: true,
    irrelevant: true,
    harming: true,
    grounded: true,
    unused: true,
    contradicting: true,
  });
  const [gtClaimFilters, setGtClaimFilters] = useState({ entailed: true, neutral: true, contradiction: true });
  const [respClaimFilters, setRespClaimFilters] = useState({ entailed: true, neutral: true, contradiction: true });
  // Grid ref for the 3-column area so overlays can measure and draw connectors over it
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  // Track expanded state for chunk previews in the three-column viewer
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const toggleChunkExpanded = (idx: number) => {
    setExpandedChunks(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  React.useEffect(() => {
    logger.info(`QuestionInspector rendered for question ${question.query_id}`);
  }, [question.query_id]);

  const getWordDifference = () => {
    const responseWords = question.response.split(/\s+/).length;
    const gtWords = question.gt_answer ? question.gt_answer.split(/\s+/).length : 0;
    return gtWords > 0 ? responseWords - gtWords : 0;
  };

  const wordDiff = getWordDifference();

  // Robust claim extraction to handle different shapes:
  // - string[]
  // - { text | claim | content | value }[]
  // - { claims: [...] }
  const extractClaims = (raw: any): string[] => {
    try {
      if (!raw) return [];
      // Nested { claims: [...] }
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        if (Array.isArray(raw.claims)) return extractClaims(raw.claims);
      }
      // Array case
      if (Array.isArray(raw)) {
        const out: string[] = [];
        for (const item of raw) {
          if (typeof item === 'string') {
            out.push(item);
          } else if (Array.isArray(item)) {
            // Tuple/sequence claim, e.g., [subject, relation, object]
            const parts = item.map((p: any) => {
              if (typeof p === 'string') return p;
              if (p && typeof p === 'object') {
                return (p as any).text ?? (p as any).claim ?? (p as any).content ?? (p as any).value ?? '';
              }
              return String(p ?? '');
            }).filter((s: any) => typeof s === 'string' && s.trim().length > 0);
            if (parts.length > 0) out.push(parts.join(' — '));
          } else if (item && typeof item === 'object') {
            const cand = (item as any).text ?? (item as any).claim ?? (item as any).content ?? (item as any).value ?? null;
            if (cand != null) out.push(String(cand));
          }
        }
        return out.filter(s => typeof s === 'string' && s.trim().length > 0);
      }
      // Stringified JSON array fallback
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
          try {
            const parsed = JSON.parse(trimmed);
            return extractClaims(parsed);
          } catch {
            // fall through
          }
        }
        // delimiter-based fallback (lines)
        if (trimmed.includes('\n')) {
          return trimmed.split('\n').map(s => s.trim()).filter(Boolean);
        }
      }
      return [];
    } catch {
      return [];
    }
  };

  const gtClaimsList = React.useMemo(() => {
    const q: any = question as any;
    const raw = q?.gt_answer_claims ?? q?.gt_claims ?? q?.ground_truth_claims ?? q?.gt_answer?.claims ?? q?.ground_truth?.claims;
    return extractClaims(raw);
  }, [question]);

  const responseClaimsList = React.useMemo(() => {
    const q: any = question as any;
    const raw = q?.response_claims ?? q?.resp_claims ?? q?.answer_claims ?? q?.response?.claims;
    return extractClaims(raw);
  }, [question]);

  // Helper to safely access relation at [chunkIdx][claimIdx] or [claimIdx][chunkIdx]
  const relationAt = (matrix: any[], chunkIdx: number, claimIdx: number): any => {
    try {
      const byChunk = Array.isArray(matrix?.[chunkIdx]) ? matrix[chunkIdx] : undefined;
      if (Array.isArray(byChunk) && byChunk.length > claimIdx) return byChunk[claimIdx];
      const byClaim = Array.isArray(matrix?.[claimIdx]) ? matrix[claimIdx] : undefined;
      if (Array.isArray(byClaim) && byClaim.length > chunkIdx) return byClaim[chunkIdx];
      return undefined;
    } catch {
      return undefined;
    }
  };

  type ClaimStatus = 'entailed' | 'neutral' | 'contradiction';

  const mapRelToStatus = (rel: any): ClaimStatus => {
    const s = String(rel ?? '').toLowerCase();
    if (s === 'entailment') return 'entailed';
    if (s === 'contradiction') return 'contradiction';
    return 'neutral';
  };

  // Map direct claim-level relation arrays to statuses, ignoring chunk matrices
  const mapDirectStatuses = (relations: any, targetLen: number): ClaimStatus[] => {
    const arr: any[] = Array.isArray(relations) ? relations : [];
    const statuses: ClaimStatus[] = [];
    for (let i = 0; i < targetLen; i++) {
      const raw = arr[i];
      const rel = Array.isArray(raw) ? raw[0] : raw;
      statuses.push(mapRelToStatus(rel));
    }
    return statuses;
  };

  const getGTClaimTooltip = (status: ClaimStatus): string => {
    switch (status) {
      case 'entailed':
        return 'This claim can be entailed (i.e. found) in the response and is therefore covered in the answer. Metric: Recall (arrow up ▲, green)';
      case 'contradiction':
        return 'This claim is contradicting at least one claim in the response, which makes the responses at least partially incorrect. Metric: Recall (arrow down ▼) Note: this is treated the same as neutral!';
      case 'neutral':
      default:
        return 'This claim cannot be found in the response and is therefore missing. Metric: Recall (arrow down ▼, red)';
    }
  };

  const getRespClaimTooltip = (status: ClaimStatus): string => {
    switch (status) {
      case 'entailed':
        return 'This claim can be entailed (i.e. found) in the ground truth and is therefore a correct and wanted claim. Metric: Precision (arrow up ▲, green)';
      case 'contradiction':
        return 'This claim is contradicting at least one claim in the ground truth and is therefore wrong. Metric: Precision (arrow down ▼, red) Note: this is treated the same as neutral!';
      case 'neutral':
      default:
        return 'This claim cannot be found in the ground truth and is therefore not asked for. Metric: Precision (arrow down ▼, red)';
    }
  };

  type ChunkStatus = 'relevant' | 'irrelevant' | 'harming';
  const chunkStatusForSets = (sets: { gt: { entailments: string[]; contradictions: string[]; neutrals: string[] } }): ChunkStatus => {
    const ent = sets?.gt?.entailments?.length || 0;
    const con = sets?.gt?.contradictions?.length || 0;
    if (con > 0) return 'harming';
    if (ent > 0) return 'relevant';
    return 'irrelevant';
  };
  const getChunkTooltip = (status: ChunkStatus): string => {
    switch (status) {
      case 'relevant':
        return 'This claim can be entailed (i.e. found) in the chunks, therefore the retrieved chunks are important. Claim Recall ▲';
      case 'harming':
        return 'This claim is contradicting at least one chunk. Context Precision: ▼ Note: This conflict requires attention.';
      case 'irrelevant':
      default:
        return 'This chunk was retrieved but is not relevant to the ground truth (Neutral only).';
    }
  };

  type UsageStatus = 'grounded' | 'unused' | 'contradicting';
  const usageStatusForSets = (sets: { response: { entailments: string[]; contradictions: string[]; neutrals: string[] } }): UsageStatus => {
    const ent = sets?.response?.entailments?.length || 0;
    const con = sets?.response?.contradictions?.length || 0;
    if (con > 0) return 'contradicting';
    if (ent > 0) return 'grounded';
    return 'unused';
  };
  const getUsageTooltip = (status: UsageStatus): string => {
    switch (status) {
      case 'grounded':
        return 'At least one response claim is supported by this chunk (entailment).';
      case 'contradicting':
        return 'At least one response claim conflicts with this chunk.';
      case 'unused':
      default:
        return 'No response claim is supported by this chunk; the generator likely did not use it.';
    }
  };

  const gtClaimStatuses = React.useMemo<ClaimStatus[]>(() => {
    try {
      const resp2ans = (question as any)?.response2answer;
      return mapDirectStatuses(resp2ans, gtClaimsList.length);
    } catch {
      return gtClaimsList.map(() => 'neutral');
    }
  }, [question, gtClaimsList]);

  const respClaimStatuses = React.useMemo<ClaimStatus[]>(() => {
    try {
      const ans2resp = (question as any)?.answer2response;
      return mapDirectStatuses(ans2resp, responseClaimsList.length);
    } catch {
      return responseClaimsList.map(() => 'neutral');
    }
  }, [question, responseClaimsList]);

  const gtCounts = React.useMemo(() => {
    const counts = { entailed: 0, neutral: 0, contradiction: 0 };
    gtClaimStatuses.forEach(s => { (counts as any)[s] += 1; });
    return counts;
  }, [gtClaimStatuses]);

  const respCounts = React.useMemo(() => {
    const counts = { entailed: 0, neutral: 0, contradiction: 0 };
    respClaimStatuses.forEach(s => { (counts as any)[s] += 1; });
    return counts;
  }, [respClaimStatuses]);

  // Transform question metrics into the structure expected by MetricsDisplay
  const getQuestionMetrics = () => {
    const metrics = question.metrics || {};
    return {
      overall_metrics: {
        precision: metrics.precision || 0,
        recall: metrics.recall || 0,
        f1: metrics.f1 || 0,
      },
      retriever_metrics: {
        claim_recall: metrics.claim_recall || 0,
        context_precision: metrics.context_precision || 0,
      },
      generator_metrics: {
        context_utilization: metrics.context_utilization || 0,
        noise_sensitivity_in_relevant: metrics.noise_sensitivity_in_relevant || 0,
        noise_sensitivity_in_irrelevant: metrics.noise_sensitivity_in_irrelevant || 0,
        hallucination: metrics.hallucination || 0,
        self_knowledge: metrics.self_knowledge || 0,
        faithfulness: metrics.faithfulness || 0,
      },
    };
  };

  const getClaimSetsForChunk = (chunkIndex: number) => {
    const gtClaims = gtClaimsList;
    const respClaims = responseClaimsList;
    const r2a = Array.isArray((question as any).retrieved2answer) ? (question as any).retrieved2answer as any[] : [];
    const r2r = Array.isArray((question as any).retrieved2response) ? (question as any).retrieved2response as any[] : [];

    const result = {
      gt: { entailments: [] as string[], contradictions: [] as string[], neutrals: [] as string[] },
      response: { entailments: [] as string[], contradictions: [] as string[], neutrals: [] as string[] }
    };

    const chunkCount = Array.isArray(question.retrieved_context) ? question.retrieved_context.length : 0;

    // Robust orientation detection copied from overlay
    const relAtLocal = (matrix: any[], cIdx: number, clIdx: number, cc?: number, clc?: number): any => {
      try {
        if (!Array.isArray(matrix)) return undefined;
        const outer = matrix.length;
        if (typeof cc === 'number' && outer === cc) {
          const row = matrix[cIdx];
          if (Array.isArray(row)) return row[clIdx];
        }
        if (typeof clc === 'number' && outer === clc) {
          const row = matrix[clIdx];
          if (Array.isArray(row)) return row[cIdx];
        }
        const first = matrix[0];
        if (Array.isArray(first)) {
          if (typeof clc === 'number' && first.length === clc) {
            const row = matrix[cIdx];
            if (Array.isArray(row)) return row[clIdx];
          }
          if (typeof cc === 'number' && first.length === cc) {
            const row = matrix[clIdx];
            if (Array.isArray(row)) return row[cIdx];
          }
        }
        const byChunk = Array.isArray(matrix?.[cIdx]) ? matrix[cIdx] : undefined;
        if (Array.isArray(byChunk) && byChunk.length > clIdx) return byChunk[clIdx];
        const byClaim = Array.isArray(matrix?.[clIdx]) ? matrix[clIdx] : undefined;
        if (Array.isArray(byClaim) && byClaim.length > cIdx) return byClaim[cIdx];
        return undefined;
      } catch { return undefined; }
    };

    // Helper to push by relation
    const pushByRel = (target: { entailments: string[]; contradictions: string[]; neutrals: string[] }, rel: any, claim: string) => {
      if (!claim || !rel) return;
      if (rel === 'Entailment') target.entailments.push(claim);
      else if (rel === 'Contradiction') target.contradictions.push(claim);
      else if (rel === 'Neutral') target.neutrals.push(claim);
    };

    // GT relations using robust accessor
    for (let i = 0; i < gtClaims.length; i++) {
      const rel = relAtLocal(r2a, chunkIndex, i, chunkCount, gtClaims.length);
      pushByRel(result.gt, rel, String(gtClaims[i] ?? ''));
    }

    // Response relations using robust accessor
    for (let i = 0; i < respClaims.length; i++) {
      const rel = relAtLocal(r2r, chunkIndex, i, chunkCount, respClaims.length);
      pushByRel(result.response, rel, String(respClaims[i] ?? ''));
    }

    return result;
  };


  // Claim-level summary across the whole question (counts only)

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-2xl font-bold text-gray-900">Question Inspector</h2>
          {allQuestions && onSelectQuestion && (
            <select
              value={question.query_id}
              onChange={(e) => onSelectQuestion(e.target.value)}
              className="block w-64 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
            >
              {allQuestions.map((q) => (
                <option key={q.query_id} value={q.query_id}>
                  Q{q.query_id}: {q.query.length > 50 ? q.query.substring(0, 50) + '...' : q.query}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="text-sm text-gray-600">
          Question ID: <span className="font-medium">{question.query_id}</span>
        </div>
      </div>

      {/* Row 1: Centered User Query */}
      <div className="mb-8 pb-6 border-b border-gray-200">
        <div className="max-w-3xl mx-auto border p-6 rounded-lg">
          <h3 className="text-lg font-semibold mb-3 text-center">User Query</h3>
          <div className="bg-gray-50 p-4 rounded border">
            <p className="text-gray-800 leading-relaxed text-center">{question.query}</p>
          </div>
          <div className="mt-3 text-sm text-gray-600 text-center">
            Length: {question.query.split(/\s+/).length} words
          </div>
        </div>
      </div>

      {/* Row 2: Three-panels horizontal (GT Answer, Retrieved Chunks, System Response) */}
      <div className="overflow-x-auto mb-8 pb-6 border-b border-gray-200">
        <div id="qi-3col-grid" ref={gridRef} style={{ position: 'relative', display: 'grid', gridTemplateColumns: '2fr 3fr 2fr', gap: '1.5rem', minWidth: '1200px' }}>
          {/* Panel A: Ground Truth Answer (2 units) */}
          <div className="bg-white border p-6 rounded-lg">
            <h3 className="text-lg font-semibold mb-3">Ground Truth Answer</h3>
            <div className="bg-gray-50 p-4 rounded border">
              <p className="text-gray-800 leading-relaxed">
                {question.gt_answer || 'No ground truth answer available'}
              </p>
            </div>
            <div className="mt-3 text-sm text-gray-600">
              Length: {question.gt_answer ? question.gt_answer.split(/\s+/).length : 0} words
            </div>
            <div className="mt-3">
              <button
                onClick={() => setIsGTClaimsExpanded(!isGTClaimsExpanded)}
                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                {isGTClaimsExpanded ? 'Collapse Claims' : `Expand Claims (${gtClaimsList.length})`}
              </button>
              {isGTClaimsExpanded && (
                <div className="mt-2 bg-gray-50 p-4 rounded border">
                  <h4 className="text-sm font-semibold text-gray-800 mb-3">Ground Truth Claims</h4>
                  {gtClaimsList.length > 0 ? (
                    <>
                      <div className="flex flex-wrap gap-2 mb-3">
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs rounded-full border ${gtClaimFilters.entailed ? 'bg-green-50 text-green-700 border-green-200 qi-pill-active' : 'bg-white text-gray-400 border-gray-200 qi-pill-inactive'} qi-pill`}
                          title={getGTClaimTooltip('entailed' as any)}
                          onClick={() => setGtClaimFilters(s => ({ ...s, entailed: !s.entailed }))}
                        >
                          Entailed {gtCounts.entailed}
                        </button>
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs rounded-full border ${gtClaimFilters.neutral ? 'bg-gray-50 text-gray-700 border-gray-200 qi-pill-active' : 'bg-white text-gray-400 border-gray-200 qi-pill-inactive'} qi-pill`}
                          title={getGTClaimTooltip('neutral' as any)}
                          onClick={() => setGtClaimFilters(s => ({ ...s, neutral: !s.neutral }))}
                        >
                          Neutral {gtCounts.neutral}
                        </button>
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs rounded-full border ${gtClaimFilters.contradiction ? 'bg-red-50 text-red-700 border-red-200 qi-pill-active' : 'bg-white text-gray-400 border-gray-200 qi-pill-inactive'} qi-pill`}
                          title={getGTClaimTooltip('contradiction' as any)}
                          onClick={() => setGtClaimFilters(s => ({ ...s, contradiction: !s.contradiction }))}
                        >
                          Contradictions {gtCounts.contradiction}
                        </button>
                      </div>
                      <ul className="list-none space-y-2 text-sm">
                        {gtClaimsList.map((c, i) => {
                          const status = gtClaimStatuses[i] as ClaimStatus;
                          if ((status === 'entailed' && !gtClaimFilters.entailed) ||
                              (status === 'neutral' && !gtClaimFilters.neutral) ||
                              (status === 'contradiction' && !gtClaimFilters.contradiction)) {
                            return null;
                          }
                          const base = 'whitespace-pre-wrap rounded-md px-3 py-2 border cursor-help flex items-center gap-2';
                          const cls = status === 'entailed'
                            ? `${base} bg-green-50 border-green-200 text-green-700`
                            : status === 'contradiction'
                              ? `${base} bg-red-50 border-red-200 text-red-700`
                              : `${base} bg-gray-50 border-gray-200 text-gray-700`;
                          return (
                            <li key={`gt-claim-${i}`} data-gt-claim-index={i} className={`${cls} qi-claim-item`} title={getGTClaimTooltip(status)}>
                              <span className="qi-num-badge">{i + 1}</span>
                              <span>{String(c || '')}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <div className="text-sm text-gray-500">No claims extracted</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Panel B: Retrieved Chunks (3 units) */}
          <div className="bg-gray-50 border p-6 rounded-lg">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-semibold">Retrieved Chunks {Array.isArray(question.retrieved_context) ? `(${question.retrieved_context.length})` : ''}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowConnectors(!showConnectors)}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                  title={showConnectors ? 'Hide visual connectors' : 'Show visual connectors'}
                >
                  {showConnectors ? 'Hide connectors' : 'Show connectors'}
                </button>
                <button
                  onClick={() => setIsChunksExpanded(!isChunksExpanded)}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                >
                  {isChunksExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>
            </div>

            {isChunksExpanded && Array.isArray(question.retrieved_context) && question.retrieved_context.length > 0 ? (
              <div>
                {/* Chunk summary row */}
                {(() => {
                  let rel = 0, irr = 0, harm = 0, grounded = 0, unused = 0, respContr = 0;
                  question.retrieved_context.forEach((_, idx) => {
                    const sets = getClaimSetsForChunk(idx);
                    const isIrrelevant = isIrrelevantFromSets(sets);
                    if (sets.gt.entailments.length > 0) rel += 1;
                    if (isIrrelevant) irr += 1;
                    if (sets.gt.contradictions.length > 0) harm += 1;
                    if (sets.response.entailments.length > 0) grounded += 1;
                    if (sets.response.entailments.length === 0) unused += 1;
                    if (sets.response.contradictions.length > 0) respContr += 1;
                  });
                  const tipRelevant = 'This claim can be entailed (i.e. found) in the chunks, therefore the retrieved chunks are important. Claim Recall ▲';
                  const tipHarming = 'This claim is contradicting at least one chunk. Context Precision: ▼ Note: This conflict requires attention.';
                  const tipIrrelevant = 'This chunk was retrieved but is not relevant to the ground truth (Neutral only).';
                  const tipGrounded = 'At least one response claim is supported by this chunk (entailment).';
                  const tipUnused = 'No response claim is supported by this chunk; the generator likely did not use it.';
                  const tipRespContr = 'At least one response claim conflicts with this chunk.';
                  const pill = (active: boolean, onClick: () => void, clsOn: string, clsOff: string, label: string, count: number, title?: string) => (
                    <button
                      type="button"
                      onClick={onClick}
                      className={`px-2 py-0.5 rounded-full border text-xs qi-pill ${active ? `qi-pill-active ${clsOn}` : `qi-pill-inactive ${clsOff}`}`}
                      title={title}
                      aria-pressed={active}
                    >
                      {label} {count}
                    </button>
                  );
                  const join = (arr: string[]) => arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr.slice(-1);
                  const qualitySel: string[] = [];
                  if (chunkFilters.relevant) qualitySel.push('<span class=\"text-green-700\">relevant</span>');
                  if (chunkFilters.irrelevant) qualitySel.push('<span class=\"text-yellow-600\">irrelevant</span>');
                  if (chunkFilters.harming) qualitySel.push('<span class=\"text-red-700\">harming</span>');
                  const usageSel: string[] = [];
                  if (chunkFilters.grounded) usageSel.push('<span class=\"text-blue-700\">used</span>');
                  if (chunkFilters.unused) usageSel.push('<span class=\"text-gray-700\">unused</span>');
                  if (chunkFilters.contradicting) usageSel.push('<span class=\"text-red-700\">conflicting</span>');
                  return (
                    <div className="mb-4">
                      <div className="flex flex-wrap items-start gap-8 text-xs text-gray-700">
                        <div className="flex flex-col">
                          <div className="font-semibold text-gray-900 mb-1">Input Quality</div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {pill(
                              chunkFilters.relevant,
                              () => setChunkFilters(s => ({ ...s, relevant: !s.relevant })),
                              'bg-green-50 text-green-700 border-green-200',
                              'bg-white text-gray-400 border-gray-200',
                              'Relevant',
                              rel,
                              tipRelevant,
                            )}
                            {pill(
                              chunkFilters.irrelevant,
                              () => setChunkFilters(s => ({ ...s, irrelevant: !s.irrelevant })),
                              'bg-yellow-50 text-yellow-600 border-yellow-200',
                              'bg-white text-gray-400 border-gray-200',
                              'Irrelevant',
                              irr,
                              tipIrrelevant,
                            )}
                            {pill(
                              chunkFilters.harming,
                              () => setChunkFilters(s => ({ ...s, harming: !s.harming })),
                              'bg-red-50 text-red-700 border-red-200',
                              'bg-white text-gray-400 border-gray-200',
                              'Harming',
                              harm,
                              tipHarming,
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col">
                          <div className="font-semibold text-gray-900 mb-1">Generator usage</div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {pill(
                              chunkFilters.grounded,
                              () => setChunkFilters(s => ({ ...s, grounded: !s.grounded })),
                              'bg-blue-50 text-blue-700 border-blue-200',
                              'bg-white text-gray-400 border-gray-200',
                              'Used',
                              grounded,
                              tipGrounded,
                            )}
                            {pill(
                              chunkFilters.unused,
                              () => setChunkFilters(s => ({ ...s, unused: !s.unused })),
                              'bg-gray-50 text-gray-700 border-gray-200',
                              'bg-white text-gray-400 border-gray-200',
                              'Unused',
                              unused,
                              tipUnused,
                            )}
                            {pill(
                              chunkFilters.contradicting,
                              () => setChunkFilters(s => ({ ...s, contradicting: !s.contradicting })),
                              'bg-red-50 text-red-700 border-red-200',
                              'bg-white text-gray-400 border-gray-200',
                              'Conflicting',
                              respContr,
                              tipRespContr,
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-600 mt-2" dangerouslySetInnerHTML={{ __html: `Showing ${qualitySel.length?join(qualitySel):'<span class=\"text-gray-500\">no</span>'} chunks that are ${usageSel.length?join(usageSel):'<span class=\"text-gray-500\">no</span>'}.` }} />
                      <div className="border-b border-gray-200" style={{ marginTop: '6px' }} />
                    </div>
                  );
                })()}

                <div className="space-y-4">
                  {question.retrieved_context.map((chunk, index) => {
                    const wordCount = (chunk?.text || '').split(/\s+/).filter(Boolean).length;
                    const sets = getClaimSetsForChunk(index);
                    const isIrrelevant = isIrrelevantFromSets(sets);
                    const expanded = expandedChunks.has(index);
                    const raw = chunk?.text || '';
                    const preview = raw.length > 50 ? raw.slice(0, 50) + '…' : raw;
                    const status: ChunkStatus = chunkStatusForSets(sets);
                    const flags = {
                      relevant: status === 'relevant',
                      irrelevant: status === 'irrelevant',
                      harming: status === 'harming',
                      grounded: sets.response.entailments.length > 0,
                      unused: sets.response.entailments.length === 0,
                      contradicting: sets.response.contradictions.length > 0,
                    };
                    const hidden = (
                      (!chunkFilters.relevant && flags.relevant) ||
                      (!chunkFilters.irrelevant && flags.irrelevant) ||
                      (!chunkFilters.harming && flags.harming) ||
                      (!chunkFilters.grounded && flags.grounded) ||
                      (!chunkFilters.unused && flags.unused) ||
                      (!chunkFilters.contradicting && flags.contradicting)
                    );
                    if (hidden) return null;
                    return (
                      <div key={index} className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden" data-chunk-index={index}>
                        <div className="bg-gray-100 px-4 py-3 border-b border-gray-200">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-semibold text-gray-900">Chunk {index + 1}</div>
                              {(() => {
                                const st = status;
                                const cls = st === 'relevant'
                                  ? 'bg-green-50 text-green-700 border-green-200'
                                  : st === 'harming'
                                    ? 'bg-red-50 text-red-700 border-red-200'
                                    : 'bg-yellow-50 text-yellow-600 border-yellow-200';
                                const label = st === 'relevant' ? 'Relevant' : st === 'harming' ? 'Harming' : 'Irrelevant';
                                return (
                                  <span className={`px-2 py-1 text-xs rounded-full border qi-pill qi-pill-active ${cls}`} title={getChunkTooltip(st)}>{label}</span>
                                );
                              })()}
                            </div>
                            {(() => {
                              const us = usageStatusForSets(sets);
                              const cls = us === 'grounded'
                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                : us === 'contradicting'
                                  ? 'bg-red-50 text-red-700 border-red-200'
                                  : 'bg-gray-50 text-gray-700 border-gray-200';
                              const label = us === 'grounded' ? 'Used' : us === 'contradicting' ? 'Conflicting' : 'Unused';

                              // Relationship arrow meta (with Missed opportunity now red)
                              const metaMap: Record<ChunkStatus, Record<UsageStatus, { label: string; description: string; color: 'green'|'gray'|'red' }>> = {
                                relevant: {
                                  grounded: { label: 'Good evidence used', description: 'Relevant chunk used to support the answer.', color: 'green' },
                                  unused: { label: 'Missed opportunity', description: 'Relevant chunk not used by the generator.', color: 'red' },
                                  contradicting: { label: 'Misuse of good evidence', description: 'Response conflicts with relevant chunk.', color: 'red' },
                                },
                                irrelevant: {
                                  grounded: { label: 'Misgrounded use', description: 'Answer based on irrelevant chunk.', color: 'red' },
                                  unused: { label: 'Benign noise', description: 'Irrelevant chunk not used.', color: 'gray' },
                                  contradicting: { label: 'Distracting conflict', description: 'Irrelevant chunk conflicts with response.', color: 'red' },
                                },
                                harming: {
                                  grounded: { label: 'Actively harmful grounding', description: 'Used chunk contradicts the GT.', color: 'red' },
                                  unused: { label: 'Dodged a bullet', description: 'Contradictory chunk retrieved but not used.', color: 'green' },
                                  contradicting: { label: 'Conflicted evidence', description: 'Chunk contradicts GT and conflicts with response.', color: 'gray' },
                                },
                              };
                              const meta = metaMap[status][us];
                              const stroke = meta.color === 'green' ? '#10b981' : meta.color === 'red' ? '#ef4444' : '#9ca3af';
                              const markerId = `qi-ch-arrow-${index}`;

                              return (
                                <>
                                  {/* Middle relationship arrow occupying available space */}
                                  <div className="qi-rel-arrow" title={meta.description}>
                                    <svg viewBox="0 0 100 16" aria-label={meta.label} preserveAspectRatio="none">
                                      <defs>
                                        <marker id={markerId} markerWidth="8" markerHeight="6" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
                                          <path d="M0,0 L6,3 L0,6 Z" fill={stroke} />
                                        </marker>
                                      </defs>
                                      <line x1="2" y1="11" x2="98" y2="11" stroke={stroke} strokeWidth="2" markerEnd={`url(#${markerId})`} vectorEffect="non-scaling-stroke"/>
                                      <text x="50" y="4" textAnchor="middle" fill={stroke}> {meta.label} </text>
                                    </svg>
                                  </div>
                                  {/* Right usage pill */}
                                  <span className={`qi-pill border ${cls} qi-pill-active`} title={getUsageTooltip(us)}>{label}</span>
                                  <span className="text-xs bg-gray-200 text-gray-700 rounded px-2 py-0.5">{wordCount} words</span>
                                </>
                              );
                            })()}
                          </div>
                          <div className="mt-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-mono text-xs">
                              {chunk?.doc_id || 'Unknown'}
                            </span>
                          </div>
                        </div>
                        <div className="p-4">
                          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                            {expanded ? raw : preview}
                          </p>
                          {raw.length > 50 && (
                            <button onClick={() => toggleChunkExpanded(index)} className="mt-2 text-blue-600 hover:text-blue-800 text-xs font-medium">
                              {expanded ? 'Hide' : 'Expand'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : !isChunksExpanded ? (
              <div className="text-sm text-gray-600">Click "Expand" to view all retrieved chunks</div>
            ) : (
              <div className="text-sm text-gray-500">No chunks retrieved</div>
            )}
          </div>

          {/* Panel C: System Response (2 units) */}
          <div className="bg-white border p-6 rounded-lg">
            <h3 className="text-lg font-semibold mb-3">System Response</h3>
            <div className="bg-gray-50 p-4 rounded border">
              <p className="text-gray-800 leading-relaxed">{question.response}</p>
            </div>
            <div className="mt-3 text-sm text-gray-600">
              Length: {question.response.split(/\s+/).length} words • {wordDiff > 0 ? ` +${wordDiff}` : wordDiff < 0 ? ` ${wordDiff}` : ' ±0'} vs GT
            </div>
            <div className="mt-3">
              <button
                onClick={() => setIsResponseClaimsExpanded(!isResponseClaimsExpanded)}
                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                {isResponseClaimsExpanded ? 'Collapse Claims' : `Expand Claims (${responseClaimsList.length})`}
              </button>
              {isResponseClaimsExpanded && (
                <div className="mt-2 bg-gray-50 p-4 rounded border">
                  <h4 className="text-sm font-semibold text-gray-800 mb-3">Response Claims</h4>
                  {responseClaimsList.length > 0 ? (
                    <>
                      <div className="flex flex-wrap gap-2 mb-3">
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs rounded-full border ${respClaimFilters.entailed ? 'bg-green-50 text-green-700 border-green-200 qi-pill-active' : 'bg-white text-gray-400 border-gray-200 qi-pill-inactive'} qi-pill`}
                          title={getRespClaimTooltip('entailed' as any)}
                          onClick={() => setRespClaimFilters(s => ({ ...s, entailed: !s.entailed }))}
                        >
                          Entailed {respCounts.entailed}
                        </button>
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs rounded-full border ${respClaimFilters.neutral ? 'bg-gray-50 text-gray-700 border-gray-200 qi-pill-active' : 'bg-white text-gray-400 border-gray-200 qi-pill-inactive'} qi-pill`}
                          title={getRespClaimTooltip('neutral' as any)}
                          onClick={() => setRespClaimFilters(s => ({ ...s, neutral: !s.neutral }))}
                        >
                          Neutral {respCounts.neutral}
                        </button>
                        <button
                          type="button"
                          className={`px-2 py-1 text-xs rounded-full border ${respClaimFilters.contradiction ? 'bg-red-50 text-red-700 border-red-200 qi-pill-active' : 'bg-white text-gray-400 border-gray-200 qi-pill-inactive'} qi-pill`}
                          title={getRespClaimTooltip('contradiction' as any)}
                          onClick={() => setRespClaimFilters(s => ({ ...s, contradiction: !s.contradiction }))}
                        >
                          Contradictions {respCounts.contradiction}
                        </button>
                      </div>
                      <ul className="list-none space-y-2 text-sm">
                        {responseClaimsList.map((c, i) => {
                          const status = respClaimStatuses[i] as ClaimStatus;
                          if ((status === 'entailed' && !respClaimFilters.entailed) ||
                              (status === 'neutral' && !respClaimFilters.neutral) ||
                              (status === 'contradiction' && !respClaimFilters.contradiction)) {
                            return null;
                          }
                          const base = 'relative whitespace-pre-wrap rounded-md px-3 py-2 border cursor-help flex items-center gap-2';
                          const cls = status === 'entailed'
                            ? `${base} bg-green-50 border-green-200 text-green-700`
                            : status === 'contradiction'
                              ? `${base} bg-red-50 border-red-200 text-red-700`
                              : `${base} bg-gray-50 border-gray-200 text-gray-700`;
                          return (
                            <li key={`resp-claim-${i}`} data-resp-claim-index={i} className={`${cls} qi-claim-item`} title={getRespClaimTooltip(status)}>
                              <span className="qi-num-badge">{i + 1}</span>
                              <span className="qi-claim-text">{String(c || '')}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <div className="text-sm text-gray-500">No claims extracted</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Overlay: draws connectors across the three columns */}
          {showConnectors && (
            <ClaimChunkOverlay 
              question={question}
              gridRef={gridRef as React.RefObject<HTMLDivElement>}
              showGTClaims={isGTClaimsExpanded && gtClaimsList.length > 0}
              showRespClaims={isResponseClaimsExpanded && responseClaimsList.length > 0}
              showChunks={isChunksExpanded && Array.isArray(question.retrieved_context) && question.retrieved_context.length > 0}
              recalcKey={JSON.stringify({ chunkFilters, gtClaimFilters, respClaimFilters })}
            />
          )}
        </div>
      </div>

      {/* Question Metrics Section */}
      <div className="bg-white border rounded-lg p-6 mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Metric Performance</h3>
        <MetricsDisplay
          title={`Question ${question.query_id} - Metric Performance`}
          subtitle="Individual question evaluation metrics"
          metrics={getQuestionMetrics()}
          showHeader={false}
        />
      </div>

    </div>
  );
};

export default QuestionInspector;
