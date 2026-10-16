import crypto from 'node:crypto';
import { and, eq, lte, or } from 'drizzle-orm';
import { getDb } from '../../infrastructure/persistence/sqlite/db.js';
import { jobsTable, runsTable } from '../../infrastructure/persistence/sqlite/schema.js';

export interface JobRecord {
  id: string;
  runId: string | null;
  jobKey: string;
  type: string;
  status: string;
  payload: any;
  result?: any;
  attempt: number;
}

export class JobsQueue {
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private currentLeases = new Map<string, string>(); // jobId -> leaseToken

  startHeartbeat(intervalMs: number = 15000): void {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(async () => {
      await this.renewLeases();
      await this.recoverExpiredJobs();
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async enqueueJob(data: {
    runId?: string;
    jobKey: string;
    type: string;
    payload: any;
  }): Promise<string> {
    const db = getDb();
    const id = `job_${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    const existing = db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.jobKey, data.jobKey))
      .get();

    if (existing) {
      return existing.id;
    }

    db.insert(jobsTable)
      .values({
        id,
        runId: data.runId || null,
        jobKey: data.jobKey,
        type: data.type,
        status: 'queued',
        payloadJson: JSON.stringify(data.payload || {}),
        attempt: 0,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return id;
  }

  async acquireNextJob(
    types?: string[],
    leaseDurationSeconds: number = 90,
  ): Promise<JobRecord | null> {
    const db = getDb();
    const now = new Date();
    const nowIso = now.toISOString();

    // Find candidate job: status in ('queued', 'retry_wait') and available_at <= now
    const candidates = db
      .select()
      .from(jobsTable)
      .where(
        and(
          or(
            eq(jobsTable.status, 'queued'),
            eq(jobsTable.status, 'retry_wait'),
          ),
          lte(jobsTable.availableAt, nowIso),
        ),
      )
      .all();

    for (const job of candidates) {
      if (types && !types.includes(job.type)) continue;

      const leaseToken = crypto.randomUUID();
      const leasedUntil = new Date(
        now.getTime() + leaseDurationSeconds * 1000,
      ).toISOString();

      const updated = db
        .update(jobsTable)
        .set({
          status: 'running',
          leaseToken,
          leasedUntil,
          attempt: job.attempt + 1,
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(jobsTable.id, job.id),
            or(eq(jobsTable.status, 'queued'), eq(jobsTable.status, 'retry_wait')),
          ),
        )
        .run();

      if (updated.changes > 0) {
        this.currentLeases.set(job.id, leaseToken);
        return {
          id: job.id,
          runId: job.runId,
          jobKey: job.jobKey,
          type: job.type,
          status: 'running',
          payload: JSON.parse(job.payloadJson || '{}'),
          attempt: job.attempt + 1,
        };
      }
    }

    return null;
  }

  async completeJob(jobId: string, result?: any): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    this.currentLeases.delete(jobId);

    db.update(jobsTable)
      .set({
        status: 'succeeded',
        resultJson: result ? JSON.stringify(result) : null,
        leaseToken: null,
        leasedUntil: null,
        updatedAt: now,
      })
      .where(eq(jobsTable.id, jobId))
      .run();
  }

  async failJob(
    jobId: string,
    errorMsg: string,
    retryable: boolean = true,
    delaySeconds: number = 30,
  ): Promise<void> {
    const db = getDb();
    const now = new Date();
    this.currentLeases.delete(jobId);

    const job = db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).get();
    if (!job) return;

    if (retryable && job.attempt < 3) {
      const nextAvailable = new Date(
        now.getTime() + delaySeconds * 1000,
      ).toISOString();
      db.update(jobsTable)
        .set({
          status: 'retry_wait',
          errorMessage: errorMsg,
          availableAt: nextAvailable,
          leaseToken: null,
          leasedUntil: null,
          updatedAt: now.toISOString(),
        })
        .where(eq(jobsTable.id, jobId))
        .run();
    } else {
      db.update(jobsTable)
        .set({
          status: 'failed',
          errorMessage: errorMsg,
          leaseToken: null,
          leasedUntil: null,
          updatedAt: now.toISOString(),
        })
        .where(eq(jobsTable.id, jobId))
        .run();
    }
  }

  private async renewLeases(): Promise<void> {
    const db = getDb();
    const now = new Date();
    const nextLease = new Date(now.getTime() + 90 * 1000).toISOString();

    for (const [jobId, leaseToken] of this.currentLeases.entries()) {
      db.update(jobsTable)
        .set({ leasedUntil: nextLease, updatedAt: now.toISOString() })
        .where(
          and(eq(jobsTable.id, jobId), eq(jobsTable.leaseToken, leaseToken)),
        )
        .run();
    }
  }

  async recoverExpiredJobs(): Promise<void> {
    const db = getDb();
    const nowIso = new Date().toISOString();

    // Expired running jobs
    const expired = db
      .select()
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.status, 'running'),
          lte(jobsTable.leasedUntil, nowIso),
        ),
      )
      .all();

    for (const job of expired) {
      this.currentLeases.delete(job.id);
      db.update(jobsTable)
        .set({
          status: 'retry_wait',
          leaseToken: null,
          leasedUntil: null,
          updatedAt: nowIso,
          errorMessage: 'Job lease expired, recovered for retry',
        })
        .where(eq(jobsTable.id, job.id))
        .run();
    }
  }
}

export const jobsQueue = new JobsQueue();
