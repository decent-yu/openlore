import { z } from "zod";
import type { Decision, StructuredEntry } from "./processing.js";
import type { Group, ResearchTask, RunAILog, RunCounts } from "./entities.js";
import type { ArtifactBundle, RepositorySyncResult } from "./delivery.js";

export interface ProcessedBatchResult {
  decisions: Decision[];
  entries: StructuredEntry[];
  aiLogs: RunAILog[];
  counts: RunCounts;
}
export interface ArchiveInput {
  group: Group;
  runId: string;
  entries: StructuredEntry[];
  researchTasks?: ResearchTask[];
}
export interface DeliveryResult {
  bundle: ArtifactBundle;
  syncResult: RepositorySyncResult;
}

export const PipelineTaskTypeSchema = z.enum([
  "article_research",
  "repository_research",
]);
export type PipelineTaskType = z.infer<typeof PipelineTaskTypeSchema>;
export const pipelineTaskLabels: Record<PipelineTaskType, string> = {
  article_research: "文章调研",
  repository_research: "仓库研读",
};
export function sourceSupportsTask(
  capability: string,
  taskType: PipelineTaskType,
): boolean {
  return taskType === "repository_research"
    ? capability === "github_repository"
    : capability !== "github_repository";
}
