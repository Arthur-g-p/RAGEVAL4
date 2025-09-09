import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Question } from '../types';
import { logger } from '../utils/logger';

interface ChunkAnalysisProps {
  questions: Question[];
}

interface ChunkInfo {
  doc_id: string;
  text: string;
  frequency: number;
  questions: string[];
  wordCount: number;
}

interface DuplicateGroup {
  normalizedText: string;
  chunks: Array<{ doc_id: string; text: string }>;
}

interface EnhancedChunkData {
  doc_id: string;
  text: string;
  frequency: number;
  frequency_rank: number;
  questions: string[];
  wordCount: number;
  gt_entailments: number;
  gt_neutrals: number;
  gt_contradictions: number;
  response_entailments: number;
  response_neutrals: number;
  response_contradictions: number;
  gt_entailment_rate: number;
  response_entailment_rate: number;
}

const ChunkAnalysis: React.FC<ChunkAnalysisProps> = ({ questions }) => {
  const [topN, setTopN] = useState<number>(20);
  const [selectedView, setSelectedView] = useState<'frequency' | 'length' | 'duplicates'>('frequency');
  const [analysisMode, setAnalysisMode] = useState<'retrieved2answer' | 'retrieved2response'>('retrieved2answer');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'frequency' | 'contradictions' | 'neutrals' | 'entailments'>('frequency');

  React.useEffect(() => {
    logger.info('ChunkAnalysis rendered successfully');
  }, []);

  const { chunkFrequencyData, lengthDistributionData, duplicateGroups, stats, enhancedChunkData } = useMemo(() => {
    const chunkMap = new Map<string, ChunkInfo>();
    const enhancedChunkMap = new Map<string, EnhancedChunkData>();
    const allChunks: Array<{ doc_id: string; text: string; questionId: string }> = [];

    questions.forEach((question) => {
      question.retrieved_context?.forEach((chunk) => {
        const key = `${chunk.doc_id}:${chunk.text}`;
        allChunks.push({ ...chunk, questionId: question.query_id });

        if (!chunkMap.has(key)) {
          chunkMap.set(key, {
            doc_id: chunk.doc_id,
            text: chunk.text,
            frequency: 0,
            questions: [],
            wordCount: chunk.text.split(/\s+/).length
          });
        }

        const chunkInfo = chunkMap.get(key)!;
        chunkInfo.frequency++;
        if (!chunkInfo.questions.includes(question.query_id)) {
          chunkInfo.questions.push(question.query_id);
        }

        // Build enhanced chunk data with entailment information
        if (chunk.effectiveness_analysis && !enhancedChunkMap.has(key)) {
          enhancedChunkMap.set(key, {
            doc_id: chunk.doc_id,
            text: chunk.text,
            frequency: chunk.effectiveness_analysis.total_appearances || 0,
            frequency_rank: chunk.effectiveness_analysis.frequency_rank || 0,
            questions: chunk.effectiveness_analysis.questions_appeared || [],
            wordCount: chunk.text.split(/\s+/).length,
            gt_entailments: chunk.effectiveness_analysis.gt_entailments || 0,
            gt_neutrals: chunk.effectiveness_analysis.gt_neutrals || 0,
            gt_contradictions: chunk.effectiveness_analysis.gt_contradictions || 0,
            response_entailments: chunk.effectiveness_analysis.response_entailments || 0,
            response_neutrals: chunk.effectiveness_analysis.response_neutrals || 0,
            response_contradictions: chunk.effectiveness_analysis.response_contradictions || 0,
            gt_entailment_rate: chunk.effectiveness_analysis.gt_entailment_rate || 0,
            response_entailment_rate: chunk.effectiveness_analysis.response_entailment_rate || 0,
          });
        } else if (!chunk.effectiveness_analysis) {
          console.warn('Chunk missing effectiveness_analysis:', chunk.doc_id);
        }
      });
    });

    const chunkFrequencyData = Array.from(chunkMap.values())
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, topN)
      .map((chunk, index) => ({
        rank: index + 1,
        doc_id: chunk.doc_id,
        frequency: chunk.frequency,
        wordCount: chunk.wordCount,
        questions: chunk.questions,
        snippet: chunk.text.length > 100 ? chunk.text.substring(0, 100) + '...' : chunk.text
      }));

    const lengthCounts = new Map<number, number>();
    chunkMap.forEach(chunk => {
      const lengthBucket = Math.floor(chunk.wordCount / 50) * 50;
      lengthCounts.set(lengthBucket, (lengthCounts.get(lengthBucket) || 0) + 1);
    });

    const lengthDistributionData = Array.from(lengthCounts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([length, count]) => ({
        lengthRange: `${length}-${length + 49}`,
        count,
        length
      }));

    const duplicateMap = new Map<string, Array<{ doc_id: string; text: string }>>();
    chunkMap.forEach(chunk => {
      const normalized = chunk.text.trim().replace(/\s+/g, ' ');
      if (!duplicateMap.has(normalized)) {
        duplicateMap.set(normalized, []);
      }
      duplicateMap.get(normalized)!.push({ doc_id: chunk.doc_id, text: chunk.text });
    });

    const duplicateGroups: DuplicateGroup[] = Array.from(duplicateMap.entries())
      .filter(([_, chunks]) => {
        const uniqueDocIds = new Set(chunks.map(c => c.doc_id));
        return uniqueDocIds.size > 1;
      })
      .map(([normalizedText, chunks]) => ({
        normalizedText,
        chunks
      }))
      .sort((a, b) => b.chunks.length - a.chunks.length);

    const stats = {
      totalUniqueChunks: chunkMap.size,
      averageLength: Array.from(chunkMap.values()).reduce((sum, chunk) => sum + chunk.wordCount, 0) / chunkMap.size,
      duplicateGroups: duplicateGroups.length
    };

    // Process enhanced chunk data
    const enhancedChunkData = Array.from(enhancedChunkMap.values());

    return { chunkFrequencyData, lengthDistributionData, duplicateGroups, stats, enhancedChunkData };
  }, [questions, topN]);

  // Prepare data for stacked bar chart and expandable section
  const chartData = useMemo(() => {
    if (!enhancedChunkData || enhancedChunkData.length === 0) {
      console.warn('No enhancedChunkData available for chart');
      return [];
    }
    
    const validChunks = enhancedChunkData
      .filter(chunk => chunk && typeof chunk === 'object' && chunk.doc_id)
      .slice(0, topN);
      
    if (validChunks.length === 0) {
      console.warn('No valid chunks for chart');
      return [];
    }
    
    const data = validChunks.map((chunk, index) => {
      const entailments = analysisMode === 'retrieved2answer' ? 
        (Number(chunk.gt_entailments) || 0) : 
        (Number(chunk.response_entailments) || 0);
      const neutrals = analysisMode === 'retrieved2answer' ? 
        (Number(chunk.gt_neutrals) || 0) : 
        (Number(chunk.response_neutrals) || 0);
      const contradictions = analysisMode === 'retrieved2answer' ? 
        (Number(chunk.gt_contradictions) || 0) : 
        (Number(chunk.response_contradictions) || 0);
        
      return {
        id: `chunk-${index}`,
        doc_id: String(chunk.doc_id).substring(0, 20), // Truncate for display
        entailments,
        neutrals,
        contradictions,
        total: entailments + neutrals + contradictions
      };
    });
    
    console.log('Chart data prepared:', data.length, 'items', data);
    return data;
  }, [enhancedChunkData, topN, analysisMode]);

  // Sorted data for the expandable section
  const sortedChunkData = useMemo(() => {
    if (!enhancedChunkData || enhancedChunkData.length === 0) return [];
    
    return [...enhancedChunkData].sort((a, b) => {
      switch (sortBy) {
        case 'frequency':
          return b.frequency - a.frequency;
        case 'contradictions':
          const aContradictions = analysisMode === 'retrieved2answer' ? a.gt_contradictions : a.response_contradictions;
          const bContradictions = analysisMode === 'retrieved2answer' ? b.gt_contradictions : b.response_contradictions;
          return bContradictions - aContradictions;
        case 'neutrals':
          const aNeutrals = analysisMode === 'retrieved2answer' ? a.gt_neutrals : a.response_neutrals;
          const bNeutrals = analysisMode === 'retrieved2answer' ? b.gt_neutrals : b.response_neutrals;
          return bNeutrals - aNeutrals;
        case 'entailments':
          const aEntailments = analysisMode === 'retrieved2answer' ? a.gt_entailments : a.response_entailments;
          const bEntailments = analysisMode === 'retrieved2answer' ? b.gt_entailments : b.response_entailments;
          return bEntailments - aEntailments;
        default:
          return b.frequency - a.frequency;
      }
    });
  }, [enhancedChunkData, sortBy, analysisMode]);

  const exportDuplicatesCSV = () => {
    const csvContent = duplicateGroups
      .map(group => {
        return group.chunks
          .map(chunk => `"${chunk.doc_id}","${group.normalizedText.replace(/"/g, '""')}"`)
          .join('\n');
      })
      .join('\n');

    const csvHeader = 'doc_id,text\n';
    const fullCsv = csvHeader + csvContent;

    const blob = new Blob([fullCsv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'duplicate_chunks.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    logger.info('Exported duplicate chunks CSV');
  };

  const FrequencyTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-300 rounded-lg shadow-lg max-w-sm">
          <p className="font-semibold text-gray-900">#{data.rank}</p>
          <p className="text-sm font-medium text-gray-700">{data.doc_id}</p>
          <p className="text-xs text-gray-600 mb-2">{data.snippet}</p>
          <div className="text-xs">
            <div>Frequency: {data.frequency}</div>
            <div>Length: {data.wordCount} words</div>
            <div>Questions: {data.questions.join(', ')}</div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Chunk Analysis</h2>
        
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-blue-800">{stats.totalUniqueChunks}</div>
            <div className="text-sm text-blue-600">Unique Chunks</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-green-800">{stats.averageLength.toFixed(0)}</div>
            <div className="text-sm text-green-600">Avg Words/Chunk</div>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-orange-800">{stats.duplicateGroups}</div>
            <div className="text-sm text-orange-600">Duplicate Groups</div>
          </div>
        </div>

        <div className="flex space-x-4 mb-4">
          {[
            { id: 'frequency', label: 'Retrieval Frequency' },
            { id: 'length', label: 'Length Distribution' },
            { id: 'duplicates', label: 'Duplicates' }
          ].map((view) => (
            <button
              key={view.id}
              onClick={() => setSelectedView(view.id as any)}
              className={`px-4 py-2 text-sm rounded-md ${
                selectedView === view.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>

      {selectedView === 'frequency' && (
        <div>
          {/* Controls Section */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <label className="text-sm font-medium text-gray-700">
                Show top:
                <select
                  value={topN}
                  onChange={(e) => setTopN(Number(e.target.value))}
                  className="ml-2 rounded border-gray-300 text-sm"
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
                chunks
              </label>
            </div>

            {/* Analysis Mode Selector */}
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-700">Analysis Mode:</span>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="retrieved2answer"
                  checked={analysisMode === 'retrieved2answer'}
                  onChange={(e) => setAnalysisMode(e.target.value as any)}
                  className="mr-1"
                />
                <span className="text-sm text-gray-700">Ground Truth</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="retrieved2response"
                  checked={analysisMode === 'retrieved2response'}
                  onChange={(e) => setAnalysisMode(e.target.value as any)}
                  className="mr-1"
                />
                <span className="text-sm text-gray-700">Response</span>
              </label>
            </div>
          </div>

          {/* Stacked Bar Chart */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6" style={{ height: '500px' }}>
            <h3 className="text-lg font-semibold text-center mb-4 text-gray-800">
              Entailment Analysis - {analysisMode === 'retrieved2answer' ? 'Ground Truth' : 'Response'}
            </h3>
            {Array.isArray(chartData) && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 100 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="doc_id" 
                    angle={-45}
                    textAnchor="end"
                    height={100}
                    fontSize={10}
                  />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="entailments" stackId="a" fill="#10B981" />
                  <Bar dataKey="neutrals" stackId="a" fill="#F59E0B" />
                  <Bar dataKey="contradictions" stackId="a" fill="#EF4444" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-gray-500">
                  <p className="text-lg mb-2">No entailment data available</p>
                  <p className="text-sm">Load a run with analyzed chunks to view the chart</p>
                </div>
              </div>
            )}
          </div>

          {/* Expandable Detailed Section */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Detailed Chunk Analysis</h3>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                {isExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
            
            {isExpanded && (
              <div>
                {sortedChunkData.length > 0 ? (
                  <div>
                    {/* Sort Controls */}
                    <div className="mb-4 flex items-center space-x-4">
                      <span className="text-sm font-medium text-gray-700">Sort by:</span>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        className="rounded border-gray-300 text-sm"
                      >
                        <option value="frequency">Frequency (Rank)</option>
                        <option value="contradictions">Total Contradictions</option>
                        <option value="neutrals">Total Neutrals</option>
                        <option value="entailments">Total Entailments</option>
                      </select>
                    </div>

                    {/* Detailed Chunk Cards */}
                    <div className="space-y-6 max-h-96 overflow-y-auto">
                      {sortedChunkData.map((chunk, index) => (
                        <div key={`${chunk.doc_id}-${index}`} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                            <div className="flex justify-between items-center">
                              <h4 className="font-semibold text-gray-900">
                                Rank #{chunk.frequency_rank}: {chunk.doc_id}
                              </h4>
                              <span className="text-sm text-gray-500">
                                {chunk.wordCount} words
                              </span>
                            </div>
                          </div>
                          
                          <div className="p-4">
                            <div className="mb-4">
                              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                                {chunk.text.length > 200 ? chunk.text.substring(0, 200) + '...' : chunk.text}
                              </p>
                            </div>

                            {/* Global Effectiveness Section - Same styling as QuestionInspector */}
                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-300">
                              <h5 className="font-semibold text-gray-900 mb-3">Global Effectiveness</h5>
                              <div className="space-y-3 text-sm">
                                <div>
                                  <div className="font-medium text-gray-800 mb-1">Frequency:</div>
                                  <div className="text-gray-600 ml-3">
                                    Found {chunk.frequency}x (Rank #{chunk.frequency_rank})
                                  </div>
                                </div>
                                <div className="text-gray-600 ml-3">
                                  Questions: {chunk.questions.join(', ')}
                                </div>
                                
                                <div className="grid grid-cols-2 gap-3">
                                  {/* Ground Truth Sub-box */}
                                  <div className="bg-gray-50 p-3 rounded border border-gray-300">
                                    <div className="font-medium text-gray-800 mb-1">Ground Truth Relations:</div>
                                    <div className="text-gray-600 ml-2 text-xs">
                                      {chunk.gt_entailments} Entailments, {chunk.gt_neutrals} Neutral, <span className={`${chunk.gt_contradictions > 0 ? 'text-red-600 font-medium' : ''}`}>{chunk.gt_contradictions} Contradictions</span>
                                      <div className="font-medium">Rate: {(chunk.gt_entailment_rate * 100).toFixed(1)}%</div>
                                    </div>
                                  </div>
                                  
                                  {/* Response Sub-box */}
                                  <div className="bg-gray-50 p-3 rounded border border-gray-300">
                                    <div className="font-medium text-gray-800 mb-1">Response Relations:</div>
                                    <div className="text-gray-600 ml-2 text-xs">
                                      {chunk.response_entailments} Entailments, {chunk.response_neutrals} Neutral, <span className={`${chunk.response_contradictions > 0 ? 'text-red-600 font-medium' : ''}`}>{chunk.response_contradictions} Contradictions</span>
                                      <div className="font-medium">Rate: {(chunk.response_entailment_rate * 100).toFixed(1)}%</div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500 py-8">
                    <p className="text-lg mb-2">No chunk data available</p>
                    <p className="text-sm">Load a run with analyzed chunks to view detailed information</p>
                  </div>
                )}
              </div>
            )}
            
            {!isExpanded && (
              <div className="text-sm text-gray-600">
                Click "Expand" to view detailed chunk analysis with Global Effectiveness metrics
              </div>
            )}
          </div>
        </div>
      )}

      {selectedView === 'length' && (
        <div>
          <div className="bg-white border border-gray-200 rounded-lg p-4" style={{ height: '400px' }}>
            <h3 className="text-lg font-semibold text-center mb-4 text-gray-800">Chunk Length Distribution</h3>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={lengthDistributionData}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="lengthRange" 
                  label={{ value: 'Word Count Range', position: 'insideBottom', offset: -5 }}
                />
                <YAxis label={{ value: 'Number of Chunks', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  formatter={(value: any) => [value, 'Number of Chunks']}
                  labelFormatter={(label: any) => `${label} words`}
                />
                <Bar dataKey="count" fill="#10B981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {selectedView === 'duplicates' && (
        <div>
          <div className="mb-4 flex justify-between items-center">
            <p className="text-sm text-gray-600">
              Found {duplicateGroups.length} groups of chunks with identical text but different doc_ids
            </p>
            <button
              onClick={exportDuplicatesCSV}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700"
            >
              Export CSV
            </button>
          </div>

          <div className="space-y-4 max-h-96 overflow-y-auto">
            {duplicateGroups.map((group, index) => (
              <div key={index} className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    Group {index + 1} ({group.chunks.length} instances)
                  </span>
                </div>
                <div className="text-sm text-gray-600 mb-3 bg-gray-50 p-3 rounded">
                  {group.normalizedText.length > 200 
                    ? group.normalizedText.substring(0, 200) + '...' 
                    : group.normalizedText
                  }
                </div>
                <div className="space-y-1">
                  {group.chunks.map((chunk, chunkIndex) => (
                    <div key={chunkIndex} className="text-xs text-blue-600">
                      {chunk.doc_id}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {duplicateGroups.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No duplicate chunks found
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ChunkAnalysis;