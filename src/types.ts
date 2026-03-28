export type ModelType = 'llama-3.3-70b-versatile';

export interface EvaluationResult {
  id: string;
  timestamp: number;
  prompt: string;
  modelResults: {
    modelId: ModelType;
    response: string;
    latency: number;
    tokenCount?: number;
    score?: number;
  }[];
}

export interface TestCase {
  id: string;
  input: string;
  expectedOutput?: string;
  category: string;
}

export interface EvaluationMetric {
  name: string;
  value: number;
  unit: string;
  trend?: 'up' | 'down' | 'neutral';
}
