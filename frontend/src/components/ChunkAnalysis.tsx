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

const ChunkAnalysis: React.FC<ChunkAnalysisProps> = ({ questions }) => {
  const [topN, setTopN] = useState<number>(20);
  const [selectedView, setSelectedView] = useState<'frequency' | 'length' | 'duplicates'>('frequency');

  React.useEffect(() => {
    logger.info('ChunkAnalysis rendered successfully');
  }, []);

  const { chunkFrequencyData, lengthDistributionData, duplicateGroups, stats } = useMemo(() => {
    const chunkMap = new Map<string, ChunkInfo>();
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

    return { chunkFrequencyData, lengthDistributionData, duplicateGroups, stats };
  }, [questions, topN]);

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
          <div className="mb-4 flex items-center space-x-4">
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

          <div className="bg-white border border-gray-200 rounded-lg p-4" style={{ height: '500px' }}>
            <h3 className="text-lg font-semibold text-center mb-4 text-gray-800">Most Frequently Retrieved Chunks</h3>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chunkFrequencyData}
                margin={{ top: 20, right: 30, left: 20, bottom: 100 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="doc_id" 
                  angle={-45}
                  textAnchor="end"
                  height={100}
                  fontSize={10}
                  interval={0}
                />
                <YAxis />
                <Tooltip content={<FrequencyTooltip />} />
                <Bar dataKey="frequency" fill="#3B82F6" />
              </BarChart>
            </ResponsiveContainer>
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