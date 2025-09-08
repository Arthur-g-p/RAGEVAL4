import React, { useState } from 'react';
import { Question } from '../types';
import { logger } from '../utils/logger';
import MetricsDisplay from './MetricsDisplay';

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

      {question.retrieved_context && question.retrieved_context.length > 0 && (
        <div className="bg-white border rounded-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Retrieved Context ({question.retrieved_context.length} chunks)
            </h3>
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
                      <h4 className="font-semibold text-gray-900">
                        Chunk {index + 1}: {chunk.doc_id}
                      </h4>
                      <span className="text-sm text-gray-500">
                        {chunk.text.split(/\s+/).length} words
                      </span>
                    </div>
                  </div>
                  
                  <div className="p-4">
                    <div className="mb-4">
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {chunk.text}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Local Analysis - This Question */}
                      <div className="bg-gray-50 p-4 rounded-lg border border-gray-300">
                        <h5 className="font-semibold text-gray-900 mb-3">This Question Analysis</h5>
                        <div className="space-y-3 text-sm">
                          <div>
                            <div className="font-medium text-gray-800 mb-1">Total Relations:</div>
                            <div className="text-gray-600 ml-3">
                              GT: {(chunk.local_analysis?.local_gt_total || 0)} relations, Response: {(chunk.local_analysis?.local_response_total || 0)} relations
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-3">
                            {/* Ground Truth Sub-box */}
                            <div className="bg-gray-50 p-3 rounded border border-gray-300">
                              <div className="font-medium text-gray-800 mb-1">Ground Truth Relations:</div>
                              <div className="text-gray-600 ml-2 text-xs">
                                {(chunk.local_analysis?.local_gt_entailments || 0)} Entailments, {(chunk.local_analysis?.local_gt_neutrals || 0)} Neutral, <span className={`${(chunk.local_analysis?.local_gt_contradictions || 0) > 0 ? 'text-red-600 font-medium' : ''}`}>{(chunk.local_analysis?.local_gt_contradictions || 0)} Contradictions</span>
                                <div className="font-medium">Rate: {chunk.local_analysis?.local_gt_total ? ((chunk.local_analysis.local_gt_entailments / chunk.local_analysis.local_gt_total) * 100).toFixed(1) : 0}%</div>
                              </div>
                            </div>
                            
                            {/* Response Sub-box */}
                            <div className="bg-gray-50 p-3 rounded border border-gray-300">
                              <div className="font-medium text-gray-800 mb-1">Response Relations:</div>
                              <div className="text-gray-600 ml-2 text-xs">
                                {(chunk.local_analysis?.local_response_entailments || 0)} Entailments, {(chunk.local_analysis?.local_response_neutrals || 0)} Neutral, <span className={`${(chunk.local_analysis?.local_response_contradictions || 0) > 0 ? 'text-red-600 font-medium' : ''}`}>{(chunk.local_analysis?.local_response_contradictions || 0)} Contradictions</span>
                                <div className="font-medium">Rate: {chunk.local_analysis?.local_response_total ? ((chunk.local_analysis.local_response_entailments / chunk.local_analysis.local_response_total) * 100).toFixed(1) : 0}%</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Global Analysis - Across All Questions */}
                      <div className="bg-gray-50 p-4 rounded-lg border border-gray-300">
                        <h5 className="font-semibold text-gray-900 mb-3">Global Effectiveness</h5>
                        {chunk.effectiveness_analysis ? (
                          <div className="space-y-3 text-sm">
                            <div>
                              <div className="font-medium text-gray-800 mb-1">Frequency:</div>
                              <div className="text-gray-600 ml-3">
                                Found {chunk.effectiveness_analysis.total_appearances}x (Rank #{chunk.effectiveness_analysis.frequency_rank}/{chunk.effectiveness_analysis.total_unique_chunks})
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-3">
                              {/* Ground Truth Sub-box */}
                              <div className="bg-gray-50 p-3 rounded border border-gray-300">
                                <div className="font-medium text-gray-800 mb-1">Overall Ground Truth:</div>
                                <div className="text-gray-600 ml-2 text-xs">
                                  {chunk.effectiveness_analysis.gt_entailments} Entailments, {chunk.effectiveness_analysis.gt_neutrals} Neutral, <span className={`${chunk.effectiveness_analysis.gt_contradictions > 0 ? 'text-red-600 font-medium' : ''}`}>{chunk.effectiveness_analysis.gt_contradictions} Contradictions</span>
                                  <div className="font-medium">Rate: {(chunk.effectiveness_analysis.gt_entailment_rate * 100).toFixed(1)}%</div>
                                </div>
                              </div>
                              
                              {/* Response Sub-box */}
                              <div className="bg-gray-50 p-3 rounded border border-gray-300">
                                <div className="font-medium text-gray-800 mb-1">Overall Response:</div>
                                <div className="text-gray-600 ml-2 text-xs">
                                  {chunk.effectiveness_analysis.response_entailments} Entailments, {chunk.effectiveness_analysis.response_neutrals} Neutral, <span className={`${chunk.effectiveness_analysis.response_contradictions > 0 ? 'text-red-600 font-medium' : ''}`}>{chunk.effectiveness_analysis.response_contradictions} Contradictions</span>
                                  <div className="font-medium">Rate: {(chunk.effectiveness_analysis.response_entailment_rate * 100).toFixed(1)}%</div>
                                </div>
                              </div>
                            </div>

                          </div>
                        ) : (
                          <div className="text-sm text-gray-500">No global analysis available</div>
                        )}
                      </div>
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