import React, { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
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

// Reusable tooltip card for chunk info (used by both charts)
const ChunkTooltipCard: React.FC<{ chunk: EnhancedChunkData }> = ({ chunk }) => {
  const safeDocId = String(chunk.doc_id || 'Unknown');
  const safeText = String(chunk.text || '');
  const truncated = safeText.length > 50 ? safeText.substring(0, 50) + '…' : safeText;
  const safeFrequency = Number(chunk.frequency) || 0;
  const safeWordCount = Number(chunk.wordCount) || 0;
  const safeRank = Number(chunk.frequency_rank) || 0;
  const safeQuestions = Array.isArray(chunk.questions) ? chunk.questions : [];

  const gt = {
    e: Number(chunk.gt_entailments) || 0,
    n: Number(chunk.gt_neutrals) || 0,
    c: Number(chunk.gt_contradictions) || 0,
  };
  const resp = {
    e: Number(chunk.response_entailments) || 0,
    n: Number(chunk.response_neutrals) || 0,
    c: Number(chunk.response_contradictions) || 0,
  };

  return (
    <div className="bg-white p-3 border border-gray-300 rounded-lg shadow-lg max-w-sm">
      <p className="font-semibold text-gray-900">{safeDocId}</p>
      <p className="text-xs text-gray-600 mb-2">{truncated}</p>
      <div className="text-xs space-y-1">
        <div>Frequency: <span className="font-medium">{safeFrequency}</span></div>
        <div>Word Count: <span className="font-medium">{safeWordCount}</span></div>
        <div>Rank: <span className="font-medium">#{safeRank}</span></div>
        <div className="grid grid-cols-1 gap-1 pt-1">
          <div className="flex items-center gap-2">
            <span className="text-gray-700 min-w-10">GT:</span>
            <span className="text-green-600">E {gt.e}</span>
            <span className="text-gray-500">N {gt.n}</span>
            <span className="text-red-600">C {gt.c}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-700 min-w-10">Resp:</span>
            <span className="text-green-600">E {resp.e}</span>
            <span className="text-gray-500">N {resp.n}</span>
            <span className="text-red-600">C {resp.c}</span>
          </div>
        </div>
        <div className="pt-1">
          <div className="text-gray-600">Questions:</div>
          <div className="text-gray-500 text-xs break-words">{safeQuestions.join(', ')}</div>
        </div>
      </div>
    </div>
  );
};

const ChunkAnalysisInner: React.FC<ChunkAnalysisProps> = ({ questions }) => {
  const [topN, setTopN] = useState<number>(20);
  const [selectedView, setSelectedView] = useState<'frequency' | 'length' | 'duplicates'>('frequency');
  const [analysisMode, setAnalysisMode] = useState<'retrieved2answer' | 'retrieved2response'>('retrieved2answer');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'frequency' | 'contradictions' | 'neutrals' | 'entailments'>('frequency');
  const [activeFreqIndex, setActiveFreqIndex] = useState<number | null>(null);
  const [activeEntIndex, setActiveEntIndex] = useState<number | null>(null);
  const [showPercent, setShowPercent] = useState<boolean>(false);

  React.useEffect(() => {
    logger.info('ChunkAnalysis rendered successfully');
  }, []);

  const { lengthDistributionData, duplicateGroups, stats, enhancedChunkData } = useMemo(() => {
    const chunkMap = new Map<string, ChunkInfo>();
    const enhancedChunkMap = new Map<string, EnhancedChunkData>();
    const allChunks: Array<{ doc_id: string; text: string; questionId: string }> = [];

    // Safely process questions with error handling
    try {
      if (!questions || !Array.isArray(questions)) {
        console.warn('No valid questions array provided');
        return { lengthDistributionData: [], duplicateGroups: [], stats: { totalUniqueChunks: 0, averageLength: 0, duplicateGroups: 0 }, enhancedChunkData: [] };
      }

      questions.forEach((question) => {
        if (!question?.retrieved_context || !Array.isArray(question.retrieved_context)) {
          return;
        }
        
        question.retrieved_context.forEach((chunk) => {
          if (!chunk?.doc_id || !chunk?.text) {
            return;
          }
          
          const key = `${chunk.doc_id}:${chunk.text}`;
          allChunks.push({ ...chunk, questionId: question.query_id || 'unknown' });

          if (!chunkMap.has(key)) {
            chunkMap.set(key, {
              doc_id: chunk.doc_id,
              text: chunk.text,
              frequency: 0,
              questions: [],
              wordCount: (chunk.text || '').split(/\s+/).filter(word => word.length > 0).length
            });
          }

          const chunkInfo = chunkMap.get(key)!;
          chunkInfo.frequency++;
          const questionId = question.query_id || 'unknown';
          if (!chunkInfo.questions.includes(questionId)) {
            chunkInfo.questions.push(questionId);
          }

          // Build enhanced chunk data with entailment information
          if (chunk.effectiveness_analysis && !enhancedChunkMap.has(key)) {
            enhancedChunkMap.set(key, {
              doc_id: chunk.doc_id,
              text: chunk.text,
              frequency: Math.max(0, Number(chunk.effectiveness_analysis.total_appearances) || 0),
              frequency_rank: Math.max(0, Number(chunk.effectiveness_analysis.frequency_rank) || 0),
              questions: Array.isArray(chunk.effectiveness_analysis.questions_appeared) ? chunk.effectiveness_analysis.questions_appeared : [],
              wordCount: (chunk.text || '').split(/\s+/).filter(word => word.length > 0).length,
              gt_entailments: Math.max(0, Number(chunk.effectiveness_analysis.gt_entailments) || 0),
              gt_neutrals: Math.max(0, Number(chunk.effectiveness_analysis.gt_neutrals) || 0),
              gt_contradictions: Math.max(0, Number(chunk.effectiveness_analysis.gt_contradictions) || 0),
              response_entailments: Math.max(0, Number(chunk.effectiveness_analysis.response_entailments) || 0),
              response_neutrals: Math.max(0, Number(chunk.effectiveness_analysis.response_neutrals) || 0),
              response_contradictions: Math.max(0, Number(chunk.effectiveness_analysis.response_contradictions) || 0),
              gt_entailment_rate: Math.max(0, Math.min(1, Number(chunk.effectiveness_analysis.gt_entailment_rate) || 0)),
              response_entailment_rate: Math.max(0, Math.min(1, Number(chunk.effectiveness_analysis.response_entailment_rate) || 0)),
            });
          }
        });
      });
    } catch (error) {
      console.error('Error processing questions data:', error);
      return { lengthDistributionData: [], duplicateGroups: [], stats: { totalUniqueChunks: 0, averageLength: 0, duplicateGroups: 0 }, enhancedChunkData: [] };
    }

    const lengthCounts = new Map<number, number>();
    chunkMap.forEach(chunk => {
      if (chunk?.wordCount && Number.isFinite(chunk.wordCount)) {
        const lengthBucket = Math.floor(Math.max(0, chunk.wordCount) / 50) * 50;
        lengthCounts.set(lengthBucket, (lengthCounts.get(lengthBucket) || 0) + 1);
      }
    });

    const lengthDistributionData = Array.from(lengthCounts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([length, count]) => ({
        lengthRange: `${length}-${length + 49}`,
        count: Math.max(0, count),
        length: Math.max(0, length)
      }));

    const duplicateMap = new Map<string, Array<{ doc_id: string; text: string }>>();
    chunkMap.forEach(chunk => {
      if (chunk?.text) {
        const normalized = chunk.text.trim().replace(/\s+/g, ' ');
        if (!duplicateMap.has(normalized)) {
          duplicateMap.set(normalized, []);
        }
        duplicateMap.get(normalized)!.push({ doc_id: chunk.doc_id || 'unknown', text: chunk.text });
      }
    });

    const duplicateGroups: DuplicateGroup[] = Array.from(duplicateMap.entries())
      .filter(([_, chunks]) => {
        if (!chunks || chunks.length <= 1) return false;
        const uniqueDocIds = new Set(chunks.map(c => c?.doc_id).filter(Boolean));
        return uniqueDocIds.size > 1;
      })
      .map(([normalizedText, chunks]) => ({
        normalizedText,
        chunks: chunks.filter(c => c?.doc_id && c?.text)
      }))
      .sort((a, b) => b.chunks.length - a.chunks.length);

    const chunkValues = Array.from(chunkMap.values()).filter(chunk => chunk && Number.isFinite(chunk.wordCount));
    const totalWords = chunkValues.reduce((sum, chunk) => sum + chunk.wordCount, 0);
    const stats = {
      totalUniqueChunks: chunkMap.size,
      averageLength: chunkValues.length > 0 ? Math.round(totalWords / chunkValues.length) : 0,
      duplicateGroups: duplicateGroups.length
    };

    // Process enhanced chunk data with validation
    const enhancedChunkData = Array.from(enhancedChunkMap.values()).filter(chunk => 
      chunk && chunk.doc_id && chunk.text && Number.isFinite(chunk.frequency)
    );

    return { lengthDistributionData, duplicateGroups, stats, enhancedChunkData };
  }, [questions, topN]);

  // Prepare data for stacked bar chart and expandable section
  const toSafeId = (s: string) => String(s || '').substring(0, 80).replace(/[^a-zA-Z0-9\-_]/g, '_');

  const chartData = useMemo(() => {
    if (!enhancedChunkData || !Array.isArray(enhancedChunkData) || enhancedChunkData.length === 0) {
      console.warn('No enhancedChunkData available for entailment chart');
      return [];
    }
    
    try {
      // Validate topN to prevent crashes
      const validTopN = Math.max(1, Math.min(Number(topN) || 20, 1000));
      
      const scoreOf = (c: EnhancedChunkData) => {
        switch (sortBy) {
          case 'contradictions':
            return analysisMode === 'retrieved2answer' 
              ? (Number(c.gt_contradictions) || 0)
              : (Number(c.response_contradictions) || 0);
          case 'neutrals':
            return analysisMode === 'retrieved2answer' 
              ? (Number(c.gt_neutrals) || 0)
              : (Number(c.response_neutrals) || 0);
          case 'entailments':
            return analysisMode === 'retrieved2answer' 
              ? (Number(c.gt_entailments) || 0)
              : (Number(c.response_entailments) || 0);
          case 'frequency':
          default:
            return Number(c.frequency) || 0;
        }
      };

      const sortedChunks = [...enhancedChunkData]
        .filter(chunk => {
          // Comprehensive validation
          return chunk && 
                 typeof chunk === 'object' && 
                 chunk.doc_id && 
                 typeof chunk.doc_id === 'string' &&
                 chunk.text &&
                 typeof chunk.text === 'string' &&
                 typeof chunk.frequency === 'number' && 
                 Number.isFinite(chunk.frequency) &&
                 chunk.frequency >= 0;
        })
        .sort((a, b) => scoreOf(b) - scoreOf(a))
        .slice(0, validTopN);
        
      if (sortedChunks.length === 0) {
        console.warn('No valid chunks for entailment chart');
        return [];
      }
      
      const data = sortedChunks.map((chunk, index) => {
        // Safe extraction with validation
        const entailments = analysisMode === 'retrieved2answer' ? 
          Math.max(0, Number(chunk.gt_entailments) || 0) : 
          Math.max(0, Number(chunk.response_entailments) || 0);
        const neutrals = analysisMode === 'retrieved2answer' ? 
          Math.max(0, Number(chunk.gt_neutrals) || 0) : 
          Math.max(0, Number(chunk.response_neutrals) || 0);
        const contradictions = analysisMode === 'retrieved2answer' ? 
          Math.max(0, Number(chunk.gt_contradictions) || 0) : 
          Math.max(0, Number(chunk.response_contradictions) || 0);
          
        const safeDocId = toSafeId(String(chunk.doc_id || `chunk-${index}`));
        
        // Ensure all values are valid numbers
        const validEntailments = Number.isFinite(entailments) ? entailments : 0;
        const validNeutrals = Number.isFinite(neutrals) ? neutrals : 0;
        const validContradictions = Number.isFinite(contradictions) ? contradictions : 0;
        const totals = validEntailments + validNeutrals + validContradictions;

        const entVal = showPercent && totals > 0 ? validEntailments / totals : validEntailments;
        const neuVal = showPercent && totals > 0 ? validNeutrals / totals : validNeutrals;
        const conVal = showPercent && totals > 0 ? validContradictions / totals : validContradictions;
        
        // Use a unique key for the X domain to avoid duplicate categories
        const xKey = `${safeDocId}-${index}`;
        
        return {
          id: `chunk-${index}`,
          xKey,
          doc_label: safeDocId,
          entailments: entVal,
          neutrals: neuVal,
          contradictions: conVal,
          total: totals,
          chunk: chunk
        };
      }).filter(item => 
        item && 
        item.xKey &&
        item.xKey.length > 0 &&
        Number.isFinite(item.entailments) &&
        Number.isFinite(item.neutrals) &&
        Number.isFinite(item.contradictions)
      );
      
      // Ensure we always return at least an empty array
      const validData = Array.isArray(data) ? data : [];
      console.log('Entailment chart data prepared:', validData.length, 'items');
      return validData;
    } catch (error) {
      console.error('Error preparing entailment chart data:', error);
      return [];
    }
  }, [enhancedChunkData, topN, analysisMode, sortBy, showPercent]);

  // Prepare frequency chart data with proper memoization
  const frequencyChartData = useMemo(() => {
    if (!enhancedChunkData || !Array.isArray(enhancedChunkData) || enhancedChunkData.length === 0) {
      console.warn('No enhancedChunkData for frequency chart');
      return [];
    }

    try {
      // Validate topN to prevent crashes
      const validTopN = Math.max(1, Math.min(Number(topN) || 20, 1000));
      
      const sortedData = [...enhancedChunkData]
        .filter(chunk => {
          // Comprehensive validation
          return chunk && 
                 typeof chunk === 'object' && 
                 chunk.doc_id && 
                 typeof chunk.doc_id === 'string' &&
                 chunk.text &&
                 typeof chunk.text === 'string' &&
                 typeof chunk.frequency === 'number' && 
                 Number.isFinite(chunk.frequency) &&
                 chunk.frequency >= 0;
        })
        .sort((a, b) => {
          const freqA = Number(a.frequency) || 0;
          const freqB = Number(b.frequency) || 0;
          return freqB - freqA;
        })
        .slice(0, validTopN)
        .map((chunk, index) => {
          const safeDocId = toSafeId(String(chunk.doc_id || `chunk-${index}`));
          const safeFrequency = Math.max(0, Number(chunk.frequency) || 0);
          const safeWordCount = Math.max(0, Number(chunk.wordCount) || 0);
          
          const itemId = `${safeDocId} (${safeWordCount})`;
          const xKey = `${safeDocId}-${safeWordCount}-${index}`; // guaranteed unique within the slice
          
          return {
            id: itemId,
            xKey,
            frequency: safeFrequency,
            chunk: chunk,
            index: index
          };
        })
        .filter(item => 
          item && 
          item.frequency > 0 && 
          item.id && 
          item.id.length > 0 &&
          Number.isFinite(item.frequency) &&
          item.chunk &&
          item.chunk.doc_id
        );

      // Ensure we always return at least an empty array
      const validData = Array.isArray(sortedData) ? sortedData : [];
      console.log('Frequency chart data prepared:', validData.length, 'items');
      return validData;
    } catch (error) {
      console.error('Error preparing frequency chart data:', error);
      return [];
    }
  }, [enhancedChunkData, topN]);

  // Compute stable Y domains to avoid Recharts domain truncation issues
  const frequencyYDomain = useMemo<[number, number]>(() => {
    const max = Array.isArray(frequencyChartData)
      ? frequencyChartData.reduce((m, d: any) => Math.max(m, Number(d?.frequency) || 0), 0)
      : 0;
    const upper = max > 0 ? Math.max(1, Math.ceil(max * 1.1)) : 1;
    return [0, upper];
  }, [frequencyChartData]);

  const frequencyXDomain = useMemo<string[]>(() => {
    if (!Array.isArray(frequencyChartData)) return [];
    const ids = frequencyChartData.map((d: any) => String(d?.id ?? ''));
    return Array.from(new Set(ids)).filter(Boolean);
  }, [frequencyChartData]);

  const entailmentYDomain = useMemo<[number, number]>(() => {
    if (showPercent) return [0, 1];
    const max = Array.isArray(chartData)
      ? chartData.reduce((m, d: any) => Math.max(m, Number(d?.total) || 0), 0)
      : 0;
    const upper = max > 0 ? Math.max(1, Math.ceil(max * 1.1)) : 1;
    return [0, upper];
  }, [chartData, showPercent]);

  const entailmentXDomain = useMemo<string[]>(() => {
    if (!Array.isArray(chartData)) return [];
    const ids = chartData.map((d: any) => String(d?.doc_id ?? ''));
    return Array.from(new Set(ids)).filter(Boolean);
  }, [chartData]);

  // Sorted data for the expandable section
  const sortedChunkData = useMemo(() => {
    if (!enhancedChunkData || !Array.isArray(enhancedChunkData) || enhancedChunkData.length === 0) {
      return [];
    }
    
    try {
      const validChunks = enhancedChunkData.filter(chunk => 
        chunk && 
        typeof chunk === 'object' && 
        chunk.doc_id && 
        chunk.text &&
        Number.isFinite(chunk.frequency)
      );
      
      return [...validChunks].sort((a, b) => {
        try {
          switch (sortBy) {
            case 'frequency':
              const freqA = Number(a.frequency) || 0;
              const freqB = Number(b.frequency) || 0;
              return freqB - freqA;
            case 'contradictions':
              const aContradictions = analysisMode === 'retrieved2answer' ? 
                (Number(a.gt_contradictions) || 0) : (Number(a.response_contradictions) || 0);
              const bContradictions = analysisMode === 'retrieved2answer' ? 
                (Number(b.gt_contradictions) || 0) : (Number(b.response_contradictions) || 0);
              return bContradictions - aContradictions;
            case 'neutrals':
              const aNeutrals = analysisMode === 'retrieved2answer' ? 
                (Number(a.gt_neutrals) || 0) : (Number(a.response_neutrals) || 0);
              const bNeutrals = analysisMode === 'retrieved2answer' ? 
                (Number(b.gt_neutrals) || 0) : (Number(b.response_neutrals) || 0);
              return bNeutrals - aNeutrals;
            case 'entailments':
              const aEntailments = analysisMode === 'retrieved2answer' ? 
                (Number(a.gt_entailments) || 0) : (Number(a.response_entailments) || 0);
              const bEntailments = analysisMode === 'retrieved2answer' ? 
                (Number(b.gt_entailments) || 0) : (Number(b.response_entailments) || 0);
              return bEntailments - aEntailments;
            default:
              const defFreqA = Number(a.frequency) || 0;
              const defFreqB = Number(b.frequency) || 0;
              return defFreqB - defFreqA;
          }
        } catch (sortError) {
          console.warn('Error sorting chunks:', sortError);
          return 0;
        }
      });
    } catch (error) {
      console.error('Error preparing sorted chunk data:', error);
      return [];
    }
  }, [enhancedChunkData, sortBy, analysisMode]);

  const handleJumpToChunk = (opts: { docId?: string; frequencyRank?: number }) => {
    try {
      setIsExpanded(true);
      // wait for expand render
      setTimeout(() => {
        const safeDoc = toSafeId(opts.docId || '');
        const rank = opts.frequencyRank != null ? String(opts.frequencyRank) : '';
        const candidates: Element[] = [];
        if (safeDoc && rank) {
          document.querySelectorAll(`[data-docid="${safeDoc}"][data-rank="${rank}"]`).forEach(el => candidates.push(el));
        }
        if (candidates.length === 0 && safeDoc) {
          document.querySelectorAll(`[data-docid="${safeDoc}"]`).forEach(el => candidates.push(el));
        }
        const target = candidates[0] as HTMLElement | undefined;
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('ring-2', 'ring-blue-500');
          setTimeout(() => target.classList.remove('ring-2', 'ring-blue-500'), 1500);
        }
      }, 80);
    } catch (e) {
      console.warn('Failed to jump to chunk', e);
    }
  };

  const handleBarClick = (payload: any) => {
    try {
      const p = payload?.payload || payload;
      const raw = p?.chunk;
      const docId = raw?.doc_id || p?.doc_label;
      const freqRank = raw?.frequency_rank;
      handleJumpToChunk({ docId, frequencyRank: typeof freqRank === 'number' ? freqRank : undefined });
    } catch (e) {
      console.warn('Bar click handler failed', e);
    }
  };

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
          {/* Top N Control */}
          <div className="mb-4">
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
                <option value={100}>100</option>
              </select>
              chunks
            </label>
          </div>

          {/* Chunk Frequency Ranking Chart */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 relative overflow-hidden" style={{ height: '400px' }}>
            <h3 className="text-lg font-semibold text-center mb-4 text-gray-800">
              Total Chunk Frequency Ranking
            </h3>
            {Array.isArray(frequencyChartData) && frequencyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={frequencyChartData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 100 }}
                  layout="horizontal"
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="xKey" 
                    angle={-45}
                    textAnchor="end"
                    height={100}
                    fontSize={10}
                    interval="preserveStartEnd"
                    scale="band"
                    tickFormatter={(value, index) => {
                      try {
                        const d = frequencyChartData[index];
                        return d?.id ?? String(value);
                      } catch {
                        return String(value);
                      }
                    }}
                    allowDuplicatedCategory={false}
                  />
                  <YAxis 
                    label={{ value: 'Frequency Count', angle: -90, position: 'insideLeft' }}
                    domain={frequencyYDomain}
                    allowDecimals={false}
                    allowDataOverflow={false}
                  />
                  <Tooltip 
                    cursor={false}
                    formatter={(value, name) => {
                      const safeValue = Number(value) || 0;
                      return [safeValue, 'Frequency'];
                    }}
                    labelFormatter={() => ''}
                    content={({ active, payload }) => {
                      try {
                        const chunk = active && payload && payload.length ? payload[0]?.payload?.chunk : null;
                        return chunk ? <ChunkTooltipCard chunk={chunk} /> : null;
                      } catch (error) {
                        console.warn('Error rendering frequency tooltip:', error);
                        return null;
                      }
                    }}
                  />
                  <Bar 
                    dataKey="frequency" 
                    fill="#3B82F6" 
                    isAnimationActive={false}
                    onMouseLeave={() => setActiveFreqIndex(null)}
                    onMouseMove={(data: any, index: number) => setActiveFreqIndex(index)}
                    onClick={(data: any) => handleBarClick(data)}
                  >
                    {frequencyChartData.map((entry: any, index: number) => (
                      <Cell key={`cell-freq-${index}`} fill={activeFreqIndex === index ? '#1D4ED8' : '#3B82F6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-gray-500">
                  <p className="text-lg mb-2">No chunk frequency data available</p>
                  <p className="text-sm">Load a run with analyzed chunks to view the chart</p>
                </div>
              </div>
            )}
          </div>

          {/* Analysis Mode Selector */}
            <div className="mb-4 flex justify-center">
              <fieldset className="inline-flex items-center bg-gray-50 p-1 rounded-lg border border-gray-200 relative z-10 pointer-events-auto" role="radiogroup" aria-label="Entailment Analysis Mode">
                <legend className="sr-only">Entailment Analysis Mode</legend>
                <input
                  id="mode-gt"
                  type="radio"
                  name="analysisMode"
                  value="retrieved2answer"
                  checked={analysisMode === 'retrieved2answer'}
                  onChange={(e) => setAnalysisMode(e.target.value as any)}
                  className="sr-only"
                />
                <label
                  htmlFor="mode-gt"
                  className={`px-4 py-2 text-sm rounded-md cursor-pointer ${analysisMode === 'retrieved2answer' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-200'}`}
                >
                  Ground Truth
                </label>
                <input
                  id="mode-resp"
                  type="radio"
                  name="analysisMode"
                  value="retrieved2response"
                  checked={analysisMode === 'retrieved2response'}
                  onChange={(e) => setAnalysisMode(e.target.value as any)}
                  className="sr-only"
                />
                <label
                  htmlFor="mode-resp"
                  className={`px-4 py-2 text-sm rounded-md cursor-pointer ${analysisMode === 'retrieved2response' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-200'}`}
                >
                  Response
                </label>
              </fieldset>
            </div>

          {/* Stacked Bar Chart */}
          <h3 className="text-lg font-semibold text-center text-gray-800">
            Entailment Analysis - {analysisMode === 'retrieved2answer' ? 'Ground Truth' : 'Response'}
          </h3>
          <p className="text-center text-gray-500 text-xs mt-1 mb-2">
            This chart shows, for each retrieved chunk, how often it agrees with, is neutral to, or contradicts the chosen target (Ground Truth or Response).
            Use the toggle to switch the target. Sort the bars to focus on frequency or specific relation types. Switch to Percent to compare quality independent of volume.
            Click a bar to jump to the detailed card below.
          </p>
          <div className="flex items-center justify-between mb-2 relative z-10 pointer-events-auto">
            <div className="text-xs text-gray-500">
              Showing top {topN} by {sortBy} in {analysisMode === 'retrieved2answer' ? 'Ground Truth' : 'Response'} mode.
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700">Sort by:</label>
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
              <div className="inline-flex rounded-md overflow-hidden border border-gray-300">
                <button
                  type="button"
                  onClick={() => setShowPercent(false)}
                  className={`px-2 py-1 text-xs ${!showPercent ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                >Counts</button>
                <button
                  type="button"
                  onClick={() => setShowPercent(true)}
                  className={`px-2 py-1 text-xs ${showPercent ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                >Percent</button>
              </div>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 relative overflow-hidden" style={{ height: '500px' }}>
            {Array.isArray(chartData) && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 100 }}
                  layout="horizontal"
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="xKey" 
                    angle={-45}
                    textAnchor="end"
                    height={100}
                    fontSize={10}
                    interval="preserveStartEnd"
                    scale="band"
                    tickFormatter={(value, index) => {
                      try {
                        const d = chartData[index];
                        return d?.doc_label ?? String(value);
                      } catch {
                        return String(value);
                      }
                    }}
                    allowDuplicatedCategory={false}
                  />
                  <YAxis 
                    domain={entailmentYDomain}
                    tickFormatter={(v: number) => showPercent ? `${Math.round(Number(v) * 100)}%` : String(v)}
                    allowDecimals={false}
                    allowDataOverflow={false}
                  />
                  <Tooltip 
                    cursor={false}
                    formatter={(value, name) => {
                      const safeValue = Number(value) || 0;
                      const safeName = String(name || 'Unknown');
                      return [safeValue, safeName];
                    }}
                    labelFormatter={() => ''}
                    content={({ active, payload }) => {
                      try {
                        const chunk = active && payload && payload.length ? payload[0]?.payload?.chunk : null;
                        return chunk ? <ChunkTooltipCard chunk={chunk} /> : null;
                      } catch (error) {
                        console.warn('Error rendering entailment tooltip:', error);
                        return null;
                      }
                    }}
                  />
                  <Bar 
                    dataKey="entailments" 
                    stackId="a" 
                    fill="#10B981" 
                    isAnimationActive={false}
                    onMouseLeave={() => setActiveEntIndex(null)}
                    onMouseMove={(data: any, index: number) => setActiveEntIndex(index)}
                    onClick={(data: any) => handleBarClick(data)}
                  >
                    {chartData.map((_, index: number) => (
                      <Cell key={`cell-ent-${index}`} fill={activeEntIndex === index ? '#059669' : '#10B981'} />
                    ))}
                  </Bar>
                  <Bar 
                    dataKey="neutrals" 
                    stackId="a" 
                    fill="#9CA3AF" 
                    isAnimationActive={false}
                    onMouseLeave={() => setActiveEntIndex(null)}
                    onMouseMove={(data: any, index: number) => setActiveEntIndex(index)}
                    onClick={(data: any) => handleBarClick(data)}
                  >
                    {chartData.map((_, index: number) => (
                      <Cell key={`cell-neu-${index}`} fill={activeEntIndex === index ? '#6B7280' : '#9CA3AF'} />
                    ))}
                  </Bar>
                  <Bar 
                    dataKey="contradictions" 
                    stackId="a" 
                    fill="#EF4444" 
                    isAnimationActive={false}
                    onMouseLeave={() => setActiveEntIndex(null)}
                    onMouseMove={(data: any, index: number) => setActiveEntIndex(index)}
                    onClick={(data: any) => handleBarClick(data)}
                  >
                    {chartData.map((_, index: number) => (
                      <Cell key={`cell-con-${index}`} fill={activeEntIndex === index ? '#B91C1C' : '#EF4444'} />
                    ))}
                  </Bar>
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
            <div className="flex justify-between items-center mb-4 relative z-10 pointer-events-auto">
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
                    {/* Detailed Chunk Cards */}
                    <div className="space-y-6 max-h-96 overflow-y-auto">
                      {sortedChunkData.map((chunk, index) => {
                        const cardDocId = toSafeId(String(chunk.doc_id || 'unknown'));
                        return (
                        <div key={`${chunk.doc_id}-${index}`} className="bg-white border border-gray-200 rounded-lg overflow-hidden" data-docid={cardDocId} data-rank={String(chunk.frequency_rank ?? '')}>
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
                      )})}
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

const ChunkAnalysis: React.FC<ChunkAnalysisProps> = ({ questions }) => {
  try {
    return <ChunkAnalysisInner questions={questions} />;
  } catch (error) {
    console.error('ChunkAnalysis crashed:', error);
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
        <div className="text-center">
          <h2 className="text-xl font-bold text-red-800 mb-2">Chunk Analysis Error</h2>
          <p className="text-red-600">Failed to load chunk analysis. Please refresh the page.</p>
        </div>
      </div>
    );
  }
};

export default ChunkAnalysis;