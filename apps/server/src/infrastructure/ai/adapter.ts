import type { ExecutionInput, ExecutionResult } from '@openlore/contracts';
export type AITaskInput = ExecutionInput;
export type AIResult = Omit<ExecutionResult, 'result'> & { result?: any };
export interface AIAdapter {
  execute(input: AITaskInput): Promise<AIResult>;
  testConnection(): Promise<{ ok: boolean; message: string; version?: string }>;
}
