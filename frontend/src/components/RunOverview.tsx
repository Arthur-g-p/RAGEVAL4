import React from 'react';
import { RunData } from '../types';
import { logger } from '../utils/logger';

interface RunOverviewProps {
  run: RunData;
}

interface MetricConfig {
  label: string;
  key: string;
  lowerIsBetter?: boolean;
}

const RunOverview: React.FC<RunOverviewProps> = ({ run }) => {
  React.useEffect(() => {
    logger.info('RunOverview rendered successfully');
  }, []);

  const normalize = (val: number) => {
    if (val > 1) return Math.min(val / 100, 1); // treat as percentage
    return Math.max(0, Math.min(val, 1)); // clamp 0–1
  };

  const calcColor = (val: number, lowerIsBetter = false) => {
    const v = normalize(val);
    const effective = lowerIsBetter ? 1 - v : v;
    const hue = effective * 120;
    return `hsl(${hue}, 85%, 45%)`;
  };

  const MetricBar: React.FC<{
    label: string;
    value: number;
    lowerIsBetter?: boolean;
  }> = ({ label, value, lowerIsBetter }) => {
    const norm = normalize(value);
    const percent = Math.round(norm * 100);
    const color = calcColor(value, lowerIsBetter);

    return (
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="font-medium text-gray-700">{label}</span>
          <span className="font-medium" style={{ color }}>{percent}%</span>
        </div>
        <div className="w-full bg-red-200 h-10 border-2 border-black">
          <div
            className="h-full bg-blue-500"
            style={{
              width: `${Math.max(percent, 15)}%`,
              minWidth: '40px'
            }}
          />
        </div>
        {lowerIsBetter && (
          <div className="text-xs text-gray-500 mt-1">* Lower values are better</div>
        )}
      </div>
    );
  };

  const sections: {
    title: string;
    metrics: MetricConfig[];
    data: Record<string, number>;
  }[] = [
    {
      title: "Overall Metrics",
      metrics: [
        { label: "Precision", key: "precision" },
        { label: "Recall", key: "recall" },
        { label: "F1 Score", key: "f1" },
      ],
      data: run.metrics.overall_metrics,
    },
    {
      title: "Retriever Metrics",
      metrics: [
        { label: "Claim Recall", key: "claim_recall" },
        { label: "Context Precision", key: "context_precision" },
      ],
      data: run.metrics.retriever_metrics,
    },
    {
      title: "Generator Metrics",
      metrics: [
        { label: "Context Utilization", key: "context_utilization" },
        { label: "Noise Sensitivity (Relevant)", key: "noise_sensitivity_in_relevant", lowerIsBetter: true },
        { label: "Noise Sensitivity (Irrelevant)", key: "noise_sensitivity_in_irrelevant", lowerIsBetter: true },
        { label: "Hallucination", key: "hallucination", lowerIsBetter: true },
        { label: "Self Knowledge", key: "self_knowledge" },
        { label: "Faithfulness", key: "faithfulness" },
      ],
      data: run.metrics.generator_metrics,
    },
  ];

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900">Metric Overview - Single-Run View</h1>
          <p className="mt-2 text-md text-gray-600">A comprehensive overview of evaluation metrics.</p>
        </header>

        {/* Summary Stats */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Experiment Summary</h3>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{run.results.length}</div>
            <div className="text-sm text-gray-600">Questions Analyzed</div>
          </div>
        </div>

        <main className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {sections.map((section) => (
            <div
              key={section.title}
              className="bg-white p-6 rounded-2xl shadow-md border-t-4 border-gray-200 transition-all duration-200 hover:transform hover:-translate-y-1 hover:shadow-lg"
            >
              <h2 className="text-xl font-bold mb-6 text-gray-800">{section.title}</h2>
              {section.metrics.map((m) => (
                <MetricBar
                  key={m.key}
                  label={m.label}
                  value={section.data[m.key]}
                  lowerIsBetter={m.lowerIsBetter}
                />
              ))}
            </div>
          ))}
        </main>
      </div>
    </div>
  );
};

export default RunOverview;