import type {
  ExecutionInput,
  ExecutionResult,
  ExecutionProgress,
} from '@openlore/contracts';
export type AITaskInput = ExecutionInput;
export type AIResult = Omit<ExecutionResult, 'result'> & { result?: any };
export interface AIValidationIssue {
  path: string;
  code: string;
  message: string;
}
export interface AIExecutionOptions {
  validateResult?: (result: unknown) => AIValidationIssue[];
  onStart?: (traceId: string) => void;
}
export interface AIAdapter {
  execute(
    input: AITaskInput,
    onProgress?: (progress: ExecutionProgress) => void,
    options?: AIExecutionOptions,
  ): Promise<AIResult>;
  testConnection(): Promise<{ ok: boolean; message: string; version?: string }>;
}
