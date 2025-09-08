import React, { useState } from 'react';
import { RunData } from './types';
import { logger } from './utils/logger';
import RunSelector from './components/RunSelector';
import RunOverview from './components/RunOverview';
import MetricsByQuestion from './components/MetricsByQuestion';
import QuestionInspector from './components/QuestionInspector';
import ChunkAnalysis from './components/ChunkAnalysis';

type TabType = 'overview' | 'metrics' | 'inspector' | 'chunks';

function App() {
  const [selectedRun, setSelectedRun] = useState<RunData | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);

  const handleRunLoaded = (run: RunData) => {
    logger.info(`Run loaded: ${run.collection} - ${run.file_origin}`);
    setSelectedRun(run);
    setActiveTab('overview');
    // Auto-select the first question for the Inspector tab
    if (run.results && run.results.length > 0) {
      setSelectedQuestionId(run.results[0].query_id);
    } else {
      setSelectedQuestionId(null);
    }
  };

  const handleSelectQuestion = (queryId: string) => {
    setSelectedQuestionId(queryId);
    setActiveTab('inspector');
  };

  const selectedQuestion = selectedRun?.results.find(q => q.query_id === selectedQuestionId);

  const tabs = [
    { id: 'overview' as TabType, label: 'Overview' },
    { id: 'metrics' as TabType, label: 'Metrics' },
    { id: 'inspector' as TabType, label: 'Question Inspector' },
    { id: 'chunks' as TabType, label: 'Chunks' }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">RAG Debugger</h1>
              {selectedRun && (
                <div className="ml-8 text-sm text-gray-600">
                  <span className="font-medium">{selectedRun.collection}</span>
                  <span className="mx-2">•</span>
                  <span>{selectedRun.file_origin}</span>
                  <span className="mx-2">•</span>
                  <span>{selectedRun.timestamp}</span>
                </div>
              )}
            </div>
            <RunSelector onRunLoaded={handleRunLoaded} />
          </div>
        </div>
      </header>

      {selectedRun ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <nav className="flex space-x-8 mb-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 font-medium text-sm rounded-md transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className={activeTab === 'overview' ? '' : 'bg-white rounded-lg shadow'}>
            {activeTab === 'overview' && <RunOverview run={selectedRun} />}
            {activeTab === 'metrics' && (
              <MetricsByQuestion
                questions={selectedRun.results}
                onSelectQuestion={handleSelectQuestion}
              />
            )}
            {activeTab === 'inspector' && (
              selectedQuestion ? (
                <QuestionInspector 
                  question={selectedQuestion} 
                  allQuestions={selectedRun.results}
                  onSelectQuestion={setSelectedQuestionId}
                />
              ) : (
                <div className="p-6 text-center">
                  <div className="text-gray-500">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">No Question Selected</h3>
                    <p className="mb-4">Select a question to inspect its details.</p>
                    <p className="text-sm">You can click on questions from the Metrics tab or use the dropdown below.</p>
                  </div>
                </div>
              )
            )}
            {activeTab === 'chunks' && <ChunkAnalysis questions={selectedRun.results} />}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center">
            <h2 className="text-2xl font-medium text-gray-900 mb-4">
              Welcome to RAG Debugger
            </h2>
            <p className="text-gray-600">
              Select a run from the dropdown to begin analyzing your RAG experiment.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
