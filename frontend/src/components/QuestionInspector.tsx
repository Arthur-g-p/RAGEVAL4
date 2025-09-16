import React, { useState } from 'react';
import { Question } from '../types';
import { logger } from '../utils/logger';
import MetricsDisplay from './MetricsDisplay';
import { isIrrelevantFromCounts, isIrrelevantFromSets } from '../utils/relevance';

interface QuestionInspectorProps {
  question: Question;
  allQuestions?: Question[];
  onSelectQuestion?: (queryId: string) => void;
}

const QuestionInspector: React.FC<QuestionInspectorProps> = ({ question, allQuestions, onSelectQuestion }) => {
  const [isContextExpanded, setIsContextExpanded] = useState(false);

  React.useEffect(() => {
    logger.info(`QuestionInspector rendered for question ${question.query_id}`);
  }, [question.query_id]);

  const getWordDifference = () => {
    const responseWords = question.response.split(/\s+/).length;
    const gtWords = question.gt_answer ? question.gt_answer.split(/\s+/).length : 0;
    return gtWords > 0 ? responseWords - gtWords : 0;
  };

  const wordDiff = getWordDifference();

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
    const gtClaims = Array.isArray((question as any).gt_answer_claims) ? (question as any).gt_answer_claims as string[] : [];
    const respClaims = Array.isArray((question as any).response_claims) ? (question as any).response_claims as string[] : [];
    const r2a = Array.isArray((question as any).retrieved2answer) ? (question as any).retrieved2answer as any[] : [];
    const r2r = Array.isArray((question as any).retrieved2response) ? (question as any).retrieved2response as any[] : [];

    const result = {
      gt: { entailments: [] as string[], contradictions: [] as string[], neutrals: [] as string[] },
      response: { entailments: [] as string[], contradictions: [] as string[], neutrals: [] as string[] }
    };

    // Helper to push by relation
    const pushByRel = (target: { entailments: string[]; contradictions: string[]; neutrals: string[] }, rel: any, claim: string) => {
      if (!claim || !rel) return;
      if (rel === 'Entailment') target.entailments.push(claim);
      else if (rel === 'Contradiction') target.contradictions.push(claim);
      else if (rel === 'Neutral') target.neutrals.push(claim);
    };

    // Determine orientation for GT: chunk-major [chunkIndex][claimIndex] OR claim-major [claimIndex][chunkIndex]
    if (Array.isArray(r2a[chunkIndex])) {
      const relsForChunk: any[] = r2a[chunkIndex];
      const n = Math.min(relsForChunk.length, gtClaims.length);
      for (let i = 0; i < n; i++) pushByRel(result.gt, relsForChunk[i], String(gtClaims[i] ?? ''));
    } else if (gtClaims.length > 0 && r2a.length === gtClaims.length) {
      // claim-major fallback
      for (let i = 0; i < gtClaims.length; i++) {
        const row = r2a[i];
        const rel = Array.isArray(row) ? row[chunkIndex] : undefined;
        pushByRel(result.gt, rel, String(gtClaims[i] ?? ''));
      }
    }

    // Determine orientation for Response: chunk-major OR claim-major
    if (Array.isArray(r2r[chunkIndex])) {
      const relsForChunk: any[] = r2r[chunkIndex];
      const n = Math.min(relsForChunk.length, respClaims.length);
      for (let i = 0; i < n; i++) pushByRel(result.response, relsForChunk[i], String(respClaims[i] ?? ''));
    } else if (respClaims.length > 0 && r2r.length === respClaims.length) {
      for (let i = 0; i < respClaims.length; i++) {
        const row = r2r[i];
        const rel = Array.isArray(row) ? row[chunkIndex] : undefined;
        pushByRel(result.response, rel, String(respClaims[i] ?? ''));
      }
    }

    return result;
  };

  const irrelevantChunkCount = React.useMemo(() => {
    try {
      const ctx = question.retrieved_context || [];
      return ctx.reduce((acc, chunk, idx) => {
        const la: any = chunk?.local_analysis || {};
        // Prefer local counts if available, otherwise compute from sets
        if (
          typeof la.local_gt_entailments === 'number' ||
          typeof la.local_gt_neutrals === 'number' ||
          typeof la.local_gt_contradictions === 'number'
        ) {
          return (
            acc + (isIrrelevantFromCounts(la.local_gt_entailments, la.local_gt_neutrals, la.local_gt_contradictions) ? 1 : 0)
          );
        }
        const sets = getClaimSetsForChunk(idx);
        return acc + (isIrrelevantFromSets(sets) ? 1 : 0);
      }, 0);
    } catch {
      return 0;
    }
  }, [question]);

  // Claim-level summary across the whole question (counts only)
  const claimSummary = React.useMemo(() => {
    try {
      const gtClaims = Array.isArray((question as any).gt_answer_claims) ? (question as any).gt_answer_claims as string[] : [];
      const respClaims = Array.isArray((question as any).response_claims) ? (question as any).response_claims as string[] : [];
      const r2a = Array.isArray((question as any).retrieved2answer) ? (question as any).retrieved2answer as any[] : [];
      const r2r = Array.isArray((question as any).retrieved2response) ? (question as any).retrieved2response as any[] : [];
      const chunkCount = Array.isArray(question.retrieved_context) ? question.retrieved_context.length : 0;

      const relAt = (matrix: any[], chunkIdx: number, claimIdx: number): any => {
        const byChunk = Array.isArray(matrix[chunkIdx]) ? matrix[chunkIdx] : undefined;
        if (byChunk && byChunk.length > claimIdx) return byChunk[claimIdx];
        const byClaim = Array.isArray(matrix[claimIdx]) ? matrix[claimIdx] : undefined;
        if (byClaim && byClaim.length > chunkIdx) return byClaim[chunkIdx];
        return undefined;
      };

      let gtVerified = 0;
      for (let i = 0; i < gtClaims.length; i++) {
        let entailed = false;
        for (let j = 0; j < chunkCount; j++) {
          const rel = relAt(r2a, j, i);
          if (rel === 'Entailment') { entailed = true; break; }
        }
        if (entailed) gtVerified += 1;
      }

      let respBacked = 0;
      for (let k = 0; k < respClaims.length; k++) {
        let entailed = false;
        for (let j = 0; j < chunkCount; j++) {
          const rel = relAt(r2r, j, k);
          if (rel === 'Entailment') { entailed = true; break; }
        }
        if (entailed) respBacked += 1;
      }

      const summary = {
        gt_total: gtClaims.length,
        gt_verified: gtVerified,
        gt_missing: Math.max(0, gtClaims.length - gtVerified),
        resp_total: respClaims.length,
        resp_backed: respBacked,
        resp_unbacked: Math.max(0, respClaims.length - respBacked)
      };
      return summary;
    } catch {
      return { gt_total: 0, gt_verified: 0, gt_missing: 0, resp_total: 0, resp_backed: 0, resp_unbacked: 0 };
    }
  }, [question]);

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 pb-6 border-b border-gray-200">
        <div className="border p-6 rounded-lg">
          <h3 className="text-lg font-semibold mb-3">User Query</h3>
          <div className="bg-gray-50 p-4 rounded border">
            <p className="text-gray-800 leading-relaxed">{question.query}</p>
          </div>
          <div className="mt-3 text-sm text-gray-600">
            Length: {question.query.split(/\s+/).length} words
          </div>
        </div>

        <div className="border p-6 rounded-lg">
          <h3 className="text-lg font-semibold mb-3">Ground Truth Answer</h3>
          <div className="bg-gray-50 p-4 rounded border">
            <p className="text-gray-800 leading-relaxed">
              {question.gt_answer || 'No ground truth answer available'}
            </p>
          </div>
          <div className="mt-3 text-sm text-gray-600">
            Length: {question.gt_answer ? question.gt_answer.split(/\s+/).length : 0} words
          </div>
        </div>

        <div className="border p-6 rounded-lg">
          <h3 className="text-lg font-semibold mb-3">System Response</h3>
          <div className="bg-gray-50 p-4 rounded border">
            <p className="text-gray-800 leading-relaxed">{question.response}</p>
          </div>
          <div className="mt-3 text-sm text-gray-600">
            Length: {question.response.split(/\s+/).length} words • 
            {wordDiff > 0 ? ` +${wordDiff}` : wordDiff < 0 ? ` ${wordDiff}` : ' ±0'} vs GT
          </div>
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

      {/* Claim Counts Summary */}
      <div className="bg-white border rounded-lg p-6 mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Claims Summary</h3>
        <div className="relative overflow-x-auto">
          <table className="min-w-full text-sm border border-gray-200 rounded">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-3 py-2 text-left text-gray-700 font-medium">Category</th>
                <th className="px-3 py-2 text-left text-gray-700 font-medium">Total</th>
                <th className="px-3 py-2 text-left text-green-700 font-medium">Verified/Backed</th>
                <th className="px-3 py-2 text-left text-gray-700 font-medium">Missing/Unbacked</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-800">Ground Truth</div>
                  <div className="text-xs text-gray-500">Verified = entailed by any chunk</div>
                </td>
                <td className="px-3 py-2">{claimSummary.gt_total}</td>
                <td className="px-3 py-2 text-green-700 font-medium">{claimSummary.gt_verified}</td>
                <td className="px-3 py-2">{claimSummary.gt_missing}</td>
              </tr>
              <tr className="border-t border-gray-200">
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-800">Response</div>
                  <div className="text-xs text-gray-500">Backed = entailed by any chunk</div>
                </td>
                <td className="px-3 py-2">{claimSummary.resp_total}</td>
                <td className="px-3 py-2 text-green-700 font-medium">{claimSummary.resp_backed}</td>
                <td className="px-3 py-2">{claimSummary.resp_unbacked}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {question.retrieved_context && question.retrieved_context.length > 0 && (
        <div className="bg-white border rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Retrieved Context ({question.retrieved_context.length} chunks)
              </h3>
              <div className="text-xs text-gray-600 mt-1">
                Of {question.retrieved_context.length} chunks, {irrelevantChunkCount} are not relevant
              </div>
            </div>
            <button
              onClick={() => setIsContextExpanded(!isContextExpanded)}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              {isContextExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
          
          {isContextExpanded && (
            <div className="space-y-4">
              {question.retrieved_context.map((chunk, index) => (
                <div key={index} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center">
                        <h4 className="font-semibold text-gray-900">
                          Chunk {index + 1}: {chunk.doc_id}
                        </h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">
                          {chunk.text.split(/\s+/).length} words
                        </span>
                        {(() => {
                          const la: any = chunk?.local_analysis || {};
                          const hasLocal = (
                            typeof la.local_gt_entailments === 'number' ||
                            typeof la.local_gt_neutrals === 'number' ||
                            typeof la.local_gt_contradictions === 'number'
                          );
                          const sets = !hasLocal ? getClaimSetsForChunk(index) : null;
                          const irrelevant = hasLocal
                            ? isIrrelevantFromCounts(la.local_gt_entailments, la.local_gt_neutrals, la.local_gt_contradictions)
                            : isIrrelevantFromSets(sets as any);
                          return irrelevant ? (
                            <span className="px-2 py-1 text-xs rounded-full bg-yellow-50 text-yellow-600 border border-yellow-200" title="This chunk was retrieved but is not relevant to the ground truth (Neutral)">Irrelevant</span>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-4">
                    <div className="mb-4">
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {chunk.text}
                      </p>
                    </div>

                    {/* Local-only Relations Breakdown (reusing Chunk tab layout, but LOCAL COUNTS) */}
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-300">
                      <h5 className="font-semibold text-gray-900 mb-2">Chunk Relations Breakdown</h5>
                      <div className="text-xs text-gray-500 mb-3">Local view — counts within this question only</div>
                      <div className="relative overflow-x-auto">
                        {(() => {
                          const la = chunk.local_analysis || {} as any;
                          const gtE = Number(la.local_gt_entailments) || 0;
                          const gtN = Number(la.local_gt_neutrals) || 0;
                          const gtC = Number(la.local_gt_contradictions) || 0;
                          const gT = Number(la.local_gt_total) || (gtE + gtN + gtC);
                          const rE = Number(la.local_response_entailments) || 0;
                          const rN = Number(la.local_response_neutrals) || 0;
                          const rC = Number(la.local_response_contradictions) || 0;
                          const rT = Number(la.local_response_total) || (rE + rN + rC);
                          const pct = (v: number, t: number) => t > 0 ? Math.round((v / t) * 100) : 0;
                          const bg = (color: 'green'|'gray'|'red', p: number) => {
                            const a = 0.08 + (Math.min(Math.max(p, 0), 100) / 100) * 0.42; // 0.08..0.50 like chunk tab
                            if (p <= 0) return 'transparent';
                            if (color === 'green') return `rgba(16,185,129,${a.toFixed(2)})`;
                            if (color === 'gray') return `rgba(156,163,175,${a.toFixed(2)})`;
                            return `rgba(239,68,68,${a.toFixed(2)})`;
                          };
                          return (
                            <table className="min-w-full text-xs border border-gray-200 rounded">
                              <thead>
                                <tr className="bg-white">
                                  <th className="px-3 py-2 text-left text-gray-700 font-medium">Outcome</th>
                                  <th className="px-3 py-2 text-left text-green-700 font-medium">Entailments</th>
                                  <th className="px-3 py-2 text-left text-gray-700 font-medium">Neutrals</th>
                                  <th className="px-3 py-2 text-left text-red-700 font-medium">Contradictions</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white">
                                <tr className="border-t border-gray-200">
                                  <td className="px-3 py-2 align-top">
                                    <div className="font-medium text-gray-800">Ground Truth</div>
                                    <div className="text-gray-500">Retriever</div>
                                  </td>
                                  <td className="px-3 py-2" style={{ backgroundColor: bg('green', pct(gtE, gT)) }}>
                                    <span className="text-green-700 font-medium">{gtE}</span>
                                    <span className="text-gray-600"> ({pct(gtE, gT)}%)</span>
                                  </td>
                                  <td className="px-3 py-2" style={{ backgroundColor: bg('gray', pct(gtN, gT)) }}>
                                    <span className="text-gray-700 font-medium">{gtN}</span>
                                    <span className="text-gray-600"> ({pct(gtN, gT)}%)</span>
                                  </td>
                                  <td className="px-3 py-2" style={{ backgroundColor: bg('red', pct(gtC, gT)) }}>
                                    <span className="text-red-700 font-medium">{gtC}</span>
                                    <span className="text-gray-600"> ({pct(gtC, gT)}%)</span>
                                  </td>
                                </tr>
                                <tr className="border-t border-gray-200">
                                  <td className="px-3 py-2 align-top">
                                    <div className="font-medium text-gray-800">Response</div>
                                    <div className="text-gray-500">Generator</div>
                                  </td>
                                  <td className="px-3 py-2" style={{ backgroundColor: bg('green', pct(rE, rT)) }}>
                                    <span className="text-green-700 font-medium">{rE}</span>
                                    <span className="text-gray-600"> ({pct(rE, rT)}%)</span>
                                  </td>
                                  <td className="px-3 py-2" style={{ backgroundColor: bg('gray', pct(rN, rT)) }}>
                                    <span className="text-gray-700 font-medium">{rN}</span>
                                    <span className="text-gray-600"> ({pct(rN, rT)}%)</span>
                                  </td>
                                  <td className="px-3 py-2" style={{ backgroundColor: bg('red', pct(rC, rT)) }}>
                                    <span className="text-red-700 font-medium">{rC}</span>
                                    <span className="text-gray-600"> ({pct(rC, rT)}%)</span>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Claim-level Evidence for this chunk */}
                    <div className="bg-white p-4 rounded-lg border border-gray-200 mt-4">
                      <h5 className="font-semibold text-gray-900 mb-3">Claim Evidence</h5>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div>
                          <div className="font-medium text-gray-800 mb-2">Ground Truth</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className={`${getClaimSetsForChunk(index).gt.entailments.length > 0 ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'} rounded p-3`}>
                              <div className="text-green-700 font-medium mb-1">Entailments ({getClaimSetsForChunk(index).gt.entailments.length})</div>
                              <ul style={{ listStyleType: 'disc', paddingLeft: '1rem' }} className="space-y-1 text-sm text-gray-700">
                                {getClaimSetsForChunk(index).gt.entailments.length > 0 ? (
                                  getClaimSetsForChunk(index).gt.entailments.map((c, i) => (
                                    <li key={`gt-ent-${i}`} className="line-clamp-2">{c}</li>
                                  ))
                                ) : (
                                  <li className="text-gray-500">None</li>
                                )}
                              </ul>
                            </div>
                            <div className={`${getClaimSetsForChunk(index).gt.contradictions.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'} rounded p-3`}>
                              <div className="text-red-700 font-medium mb-1">Contradictions ({getClaimSetsForChunk(index).gt.contradictions.length})</div>
                              <ul style={{ listStyleType: 'disc', paddingLeft: '1rem' }} className="space-y-1 text-sm text-gray-700">
                                {getClaimSetsForChunk(index).gt.contradictions.length > 0 ? (
                                  getClaimSetsForChunk(index).gt.contradictions.map((c, i) => (
                                    <li key={`gt-con-${i}`} className="line-clamp-2">{c}</li>
                                  ))
                                ) : (
                                  <li className="text-gray-500">None</li>
                                )}
                              </ul>
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="font-medium text-gray-800 mb-2">Response</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className={`${getClaimSetsForChunk(index).response.entailments.length > 0 ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'} rounded p-3`}>
                              <div className="text-green-700 font-medium mb-1">Entailments ({getClaimSetsForChunk(index).response.entailments.length})</div>
                              <ul style={{ listStyleType: 'disc', paddingLeft: '1rem' }} className="space-y-1 text-sm text-gray-700">
                                {getClaimSetsForChunk(index).response.entailments.length > 0 ? (
                                  getClaimSetsForChunk(index).response.entailments.map((c, i) => (
                                    <li key={`resp-ent-${i}`} className="line-clamp-2">{c}</li>
                                  ))
                                ) : (
                                  <li className="text-gray-500">None</li>
                                )}
                              </ul>
                            </div>
                            <div className={`${getClaimSetsForChunk(index).response.contradictions.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'} rounded p-3`}>
                              <div className="text-red-700 font-medium mb-1">Contradictions ({getClaimSetsForChunk(index).response.contradictions.length})</div>
                              <ul style={{ listStyleType: 'disc', paddingLeft: '1rem' }} className="space-y-1 text-sm text-gray-700">
                                {getClaimSetsForChunk(index).response.contradictions.length > 0 ? (
                                  getClaimSetsForChunk(index).response.contradictions.map((c, i) => (
                                    <li key={`resp-con-${i}`} className="line-clamp-2">{c}</li>
                                  ))
                                ) : (
                                  <li className="text-gray-500">None</li>
                                )}
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 mt-3">Mapping: gt_answer_claims[i] ↔ retrieved2answer[index][i], response_claims[i] ↔ retrieved2response[index][i]</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {!isContextExpanded && (
            <div className="text-sm text-gray-600">
              Click "Expand" to view all retrieved context chunks
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestionInspector;