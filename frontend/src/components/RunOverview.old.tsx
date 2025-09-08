import React from 'react';
import { RunData } from '../types';
import MetricsDisplay from './MetricsDisplay';

interface RunOverviewProps {
  run: RunData;
}

const RunOverview: React.FC<RunOverviewProps> = ({ run }) => {
  return (
    <div>
      {/* Summary Stats */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6 mx-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Experiment Summary</h3>
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-600">{run.results.length}</div>
          <div className="text-sm text-gray-600">Questions Analyzed</div>
        </div>
      </div>

      <MetricsDisplay
        title="Metric Overview - Single-Run View"
        subtitle="A comprehensive overview of evaluation metrics."
        metrics={run.metrics}
        showHeader={true}
      />
    </div>
  );
};

export default RunOverview;