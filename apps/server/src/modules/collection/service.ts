import crypto from "node:crypto";
import { articleReviewsService } from "../processing/article-reviews.js";
import fs from "node:fs";
import path from "node:path";
import {
  type SourceOptions,
  type Source,
  type CollectionRequest,
  type CollectionResult,
  type ContentItem,
} from "@openlore/contracts";
import { getAppPaths } from "../../infrastructure/config/paths.js";
import { getSqliteDatabase } from "../../infrastructure/persistence/sqlite/db.js";
import { sourcesService } from "../sources/service.js";
import { settingsService } from "../settings/service.js";
import { GithubApiCollectorAdapter } from "./collectors/github_api/adapter.js";
import { GithubRepositoryCollectorAdapter } from "./collectors/github_repository/adapter.js";
import { PlatformCollectorAdapter } from "./collectors/platform/adapter.js";
import { WebFeedCollectorAdapter } from "./collectors/web_feed/adapter.js";
import { WebPageCollectorAdapter } from "./collectors/web_page/adapter.js";
import { collectorRegistry } from "./registry.js";
import {
  evaluateContent,
  normalizeUrl,
  QUALITY_VERSION,
  ruleRevision,
} from "./quality.js";
import { expireCollectionDetails, removeUnusedBlobs, terminalStates, withoutBody } from './retention.js';
export { matchesSourceKeywords } from "./quality.js";

collectorRegistry.register(new WebFeedCollectorAdapter());
collectorRegistry.register(new WebPageCollectorAdapter());
collectorRegistry.register(new GithubApiCollectorAdapter());
collectorRegistry.register(new GithubRepositoryCollectorAdapter());
collectorRegistry.register(new PlatformCollectorAdapter());

type Candidate = {
  source_id: string;
  item_id: string;
  article_id: string;
  item_json: string;
  rule_revision: string;
  discovery_hash: string;
  status: string;
  reason: string;
  attempts: number;
  last_error?: string;
};
const hash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

export class CollectionService {
  private active = new Map<string, Promise<CollectionResult>>();
  private retiredRawRefs = new Set<string>();

  async previewSource(sourceId: string): Promise<CollectionResult> {
    const source = await sourcesService.getSource(sourceId);
    if (!source) throw new Error(`Source not found: ${sourceId}`);
    const adapter = collectorRegistry.get(source.capability_id);
    if (!adapter)
      throw new Error(`Unsupported capability: ${source.capability_id}`);
    const { timezone } = await settingsService.getSettings();
    const previewRequest = this.request(source, `preview_${crypto.randomUUID()}`, null, 10);
    previewRequest.options = { ...previewRequest.options, timezone };
    const result = await adapter.collect(previewRequest);
    const counts: Record<string, number> = {};
    for (const item of result.items) {
      const decision = evaluateContent(item, source.options, timezone);
      counts[decision.reason] = (counts[decision.reason] || 0) + 1;
      item.issues = [...(item.issues || []), decision.reason];
    }
    result.stats.quality_counts = counts;
    return result;
  }

  discoverSource(sourceId: string, runId?: string): Promise<CollectionResult> {
    const existing = this.active.get(sourceId);
    if (existing) return existing;
    const task = this.discover(sourceId, runId).finally(() =>
      this.active.delete(sourceId),
    );
    this.active.set(sourceId, task);
    return task;
  }

  private request(
    source: Source,
    runId: string,
    state: any,
    limit = 100,
  ): CollectionRequest {
    return {
      run_id: runId,
      source_id: source.id,
      source_revision: ruleRevision(source.options),
      capability_id: source.capability_id,
      operation: "discover",
      target: { url: source.url },
      scope: { limit },
      state,
      options: source.options,
      budget: { timeout_seconds: 20, max_requests: 10 },
    };
  }

  private async discover(
    sourceId: string,
    runId?: string,
  ): Promise<CollectionResult> {
    const source = await sourcesService.getSource(sourceId);
    if (!source) throw new Error(`Source not found: ${sourceId}`);
    const adapter = collectorRegistry.get(source.capability_id);
    if (!adapter)
      throw new Error(`Unsupported capability: ${source.capability_id}`);
    const db = getSqliteDatabase();
    expireCollectionDetails();
    const state = db
      .prepare(
        "SELECT state_json FROM source_states WHERE source_id = ? AND capability_id = ?",
      )
      .get(sourceId, source.capability_id) as
      { state_json: string } | undefined;
    const id = runId || `collect_${crypto.randomUUID()}`;
    const { timezone } = await settingsService.getSettings();
    const collectionRequest = this.request(source, id, state ? JSON.parse(state.state_json) : null);
    collectionRequest.options = { ...collectionRequest.options, timezone };
    const result = await adapter.collect(collectionRequest);
    const counts: Record<string, number> = {};
    let newlyReady = 0;
    // Durably store every discovered candidate before acknowledging the feed cursor/ETag.
    for (const item of result.items) {
      const reason = await this.enqueue(item, source.options, timezone);
      counts[reason] = (counts[reason] || 0) + 1;
      if (reason === "ready") newlyReady++;
    }
    if (result.status !== "failed" && result.next_state) {
      db.prepare(
        "INSERT INTO source_states(source_id, capability_id, revision, state_json, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id, capability_id, revision) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at",
      ).run(
        sourceId,
        source.capability_id,
        "rev_1",
        JSON.stringify(result.next_state),
        new Date().toISOString(),
      );
    }
    // Even a 304 or failed feed request must not strand already discovered work.
    const enriched = await this.drain(
      source,
      timezone,
      id,
      Math.max(0, 10 - result.stats.requests),
    );
    newlyReady += enriched.ready;
    result.stats.requests += enriched.requests;
    result.stats.processing_reasons = enriched.reasons;
    const queued = (
      db
        .prepare(
          "SELECT count(*) n FROM collection_candidates WHERE source_id=? AND status='pending'",
        )
        .get(sourceId) as { n: number }
    ).n;
    result.stats.items_new = newlyReady;
    result.stats.items_filtered = Object.entries(counts)
      .filter(
        ([key]) =>
          !["ready", "queued", "body_missing", "duplicate"].includes(key),
      )
      .reduce((n, [, v]) => n + v, 0);
    result.stats.quality_counts = counts;
    result.stats.queued = queued;
    if (queued && result.scan !== "more") result.scan = "limited";
    await sourcesService.updateLastPolled(
      sourceId,
      result.status !== "failed",
      result.errors[0]?.message,
    );
    db.prepare(
      "INSERT INTO collection_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      sourceId,
      ruleRevision(source.options),
      JSON.stringify(source.options),
      QUALITY_VERSION,
      JSON.stringify(result.stats),
      result.status,
      new Date().toISOString(),
    );
    removeUnusedBlobs([...this.retiredRawRefs]);
    this.retiredRawRefs.clear();
    articleReviewsService.processPending().catch(() => {});
    return result;
  }

  private async enqueue(
    item: ContentItem,
    options: SourceOptions,
    timezone: string,
    existingArticleId?: string,
  ): Promise<string> {
    const db = getSqliteDatabase();
    const prior = db
      .prepare(
        "SELECT * FROM collection_candidates WHERE source_id=? AND item_id=?",
      )
      .get(item.source_id, item.source_item_id) as Candidate | undefined;
    if(prior?.status==='ready') return 'duplicate';
    const discoveryHash = hash(
      JSON.stringify([
        item.title,
        item.published_at,
        item.body,
        item.categories,
      ]),
    );
    const revision = ruleRevision(options);
    const receipt = db.prepare('SELECT discovery_hash,rule_revision FROM collection_receipts WHERE source_id=? AND item_id=?').get(item.source_id,item.source_item_id) as {discovery_hash:string;rule_revision:string}|undefined;
    if (receipt?.discovery_hash===discoveryHash && receipt.rule_revision===revision) return 'duplicate';
    const canonical=normalizeUrl(item.canonical_url || item.final_url || item.original_url);
    item={...item,canonical_url:canonical};
    if (
      prior?.rule_revision === revision &&
      prior.discovery_hash === discoveryHash
    )
      return "duplicate";
    // A short feed summary cannot overwrite an enriched body or its original publication date.
    if (prior) {
      const enriched: ContentItem = JSON.parse(prior.item_json);
      if (
        enriched.fetch_method === "web_page" &&
        item.fetch_method !== "web_page"
      ) {
        item = {
          ...item,
          title: enriched.title,
          body: enriched.body,
          published_at: enriched.published_at,
          date_evidence: enriched.date_evidence,
          categories: [
            ...new Set([
              ...(item.categories || []),
              ...(enriched.categories || []),
            ]),
          ],
          fetch_method: enriched.fetch_method,
          raw_ref: enriched.raw_ref,
        };
      }
    }
    // Reserve an identity only. Candidates are not articles until admission succeeds.
    const linked = canonical ? db.prepare(`SELECT id FROM articles WHERE canonical_url=? UNION ALL SELECT article_id id FROM collection_candidates WHERE json_extract(item_json,'$.canonical_url')=? LIMIT 1`).get(canonical,canonical) as {id:string}|undefined : undefined;
    const articleId = existingArticleId || prior?.article_id || linked?.id || `art_${crypto.randomUUID()}`;
    let decision = evaluateContent(item, options, timezone);
    if (prior && terminalStates.has(prior.status) && !item.body.value && !['history','excluded'].includes(decision.status)) decision={...decision,status:'pending',reason:'queued'};
    if (
      item.fetch_method !== "web_page" &&
      ["date_unknown", "future_date", "date_conflict"].includes(decision.reason)
    )
      decision = { ...decision, status: "pending", reason: "queued" };
    db.prepare(
      `INSERT INTO collection_candidates(source_id,item_id,article_id,item_json,rule_revision,discovery_hash,status,reason,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,item_id) DO UPDATE SET item_json=excluded.item_json, rule_revision=excluded.rule_revision,
      discovery_hash=excluded.discovery_hash,status=excluded.status,reason=excluded.reason,attempts=0,next_attempt_at=NULL,last_error=NULL,updated_at=excluded.updated_at`,
    ).run(
      item.source_id,
      item.source_item_id,
      articleId,
      JSON.stringify(item),
      revision,
      discoveryHash,
      decision.status,
      decision.reason,
      new Date().toISOString(),
    );
    db.prepare('DELETE FROM collection_receipts WHERE source_id=? AND item_id=?').run(item.source_id,item.source_item_id);
    this.refreshArticle(articleId);
    return decision.status === "ready" && prior?.status === "ready"
      ? "duplicate"
      : decision.reason;
  }

  private refreshArticle(articleId: string): void {
    const db = getSqliteDatabase();
    const best = db
      .prepare(
        `SELECT * FROM collection_candidates WHERE article_id=? ORDER BY CASE status WHEN 'ready' THEN 0 WHEN 'pending' THEN 1 WHEN 'review' THEN 2 WHEN 'failed' THEN 3 WHEN 'history' THEN 4 ELSE 5 END LIMIT 1`,
      )
      .get(articleId) as Candidate | undefined;
    if (!best) return;
    const item: ContentItem = JSON.parse(best.item_json);
    if (best.status === 'ready') {
      const admittedId=this.persistContentItem(item,articleId);
      if (admittedId!==articleId) db.prepare('UPDATE collection_candidates SET article_id=? WHERE article_id=?').run(admittedId,articleId);
      articleId=admittedId;
      // Preserve all source relationships when several candidates converge on one URL.
      for(const row of db.prepare("SELECT item_json FROM collection_candidates WHERE article_id=? AND status='ready'").all(articleId) as Array<{item_json:string}>) {
        const other=JSON.parse(row.item_json) as ContentItem;
        if(other.source_item_id!==item.source_item_id) this.persistContentItem(other,articleId);
      }
    }
    if(best.status==='ready') db.prepare('UPDATE articles SET date_evidence_json=? WHERE id=?').run(JSON.stringify(item.date_evidence || {}),articleId);
    const rawRefs:string[]=[];
    for(const row of db.prepare("SELECT source_id,item_id,item_json FROM collection_candidates WHERE article_id=? AND status IN ('history','excluded','failed')").all(articleId) as any[]) {
      const rejected=JSON.parse(row.item_json) as ContentItem;
      if(rejected.raw_ref)rawRefs.push(rejected.raw_ref);
      db.prepare('UPDATE collection_candidates SET item_json=? WHERE source_id=? AND item_id=?').run(JSON.stringify(withoutBody(rejected)),row.source_id,row.item_id);
    }
    for(const ref of rawRefs) this.retiredRawRefs.add(ref);
  }


  private async drain(
    source: Source,
    timezone: string,
    runId: string,
    limit: number,
  ): Promise<{
    ready: number;
    requests: number;
    reasons: Record<string, number>;
  }> {
    const db = getSqliteDatabase();
    const candidates = db
      .prepare(
        `SELECT c.* FROM collection_candidates c WHERE c.source_id=? AND c.status='pending'
      AND (c.next_attempt_at IS NULL OR c.next_attempt_at<=?) ORDER BY julianday(json_extract(c.item_json,'$.published_at')) DESC, c.item_id LIMIT ?`,
      )
      .all(source.id, new Date().toISOString(), limit) as Candidate[];
    const deadline = Date.now() + 45000;
    let ready = 0;
    let requests = 0;
    const reasons: Record<string, number> = {};
    for (const candidate of candidates) {
      if (Date.now() > deadline) break;
      const item: ContentItem = JSON.parse(candidate.item_json);
      const url = normalizeUrl(
        item.canonical_url || item.final_url || item.original_url,
      );
      const adapter = collectorRegistry.get("web_page");
      if (!adapter || !url) {
        db.prepare(
          "UPDATE collection_candidates SET status='review',reason='body_invalid' WHERE source_id=? AND item_id=?",
        ).run(source.id, candidate.item_id);
        this.refreshArticle(candidate.article_id);
        continue;
      }
      requests++;
      const response = await adapter.collect({
        ...this.request(source, `${runId}_${candidate.article_id}`, null, 1),
        capability_id: "web_page",
        operation: "fetch",
        target: { url, source_item_id: candidate.item_id },
      });
      // Ignore stale work if rules changed while the request was in flight.
      const current = await sourcesService.getSource(source.id);
      if (!current || ruleRevision(current.options) !== candidate.rule_revision)
        continue;
      if (response.status === "failed" || !response.items.length) {
        reasons.fetch_failed = (reasons.fetch_failed || 0) + 1;
        const attempts = candidate.attempts + 1;
        const retryable = response.errors[0]?.retryable !== false;
        db.prepare(
          "UPDATE collection_candidates SET status=?,reason=?,attempts=?,next_attempt_at=?,updated_at=?,last_error=? WHERE source_id=? AND item_id=?",
        ).run(
          attempts >= 3 || !retryable ? "failed" : "pending",
          "fetch_failed",
          attempts,
          new Date(Date.now() + attempts * 60000).toISOString(),
          new Date().toISOString(),
          response.errors[0]?.message || "Empty extraction response",
          source.id,
          candidate.item_id,
        );
        this.refreshArticle(candidate.article_id);
        continue;
      }
      const fetched = response.items[0];
      const enriched: ContentItem = {
        ...fetched,
        source_id: source.id,
        source_item_id: candidate.item_id,
        original_url: item.original_url,
        categories: [
          ...new Set([
            ...(item.categories || []),
            ...(fetched.categories || []),
          ]),
        ],
        date_evidence: {
          ...fetched.date_evidence,
          feed_published_at:
            item.date_evidence?.feed_published_at || item.published_at,
        },
        issues: [
          ...new Set([
            ...(fetched.issues || []),
            ...(fetched.published_at &&
            item.published_at &&
            fetched.published_at.slice(0, 10) !== item.published_at.slice(0, 10)
              ? ["feed_date_corrected"]
              : []),
          ]),
        ],
      };
      let decision = evaluateContent(enriched, source.options, timezone);
      if (decision.status === "pending")
        decision = {
          ...decision,
          status: "review",
          reason:
            decision.reason === "queued" ? "date_unknown" : "body_invalid",
        };
      db.prepare(
        "UPDATE collection_candidates SET item_json=?,status=?,reason=?,attempts=attempts+1,next_attempt_at=NULL,last_error=NULL,updated_at=? WHERE source_id=? AND item_id=?",
      ).run(
        JSON.stringify(enriched),
        decision.status,
        decision.reason,
        new Date().toISOString(),
        source.id,
        candidate.item_id,
      );
      this.refreshArticle(candidate.article_id);
      reasons[decision.reason] = (reasons[decision.reason] || 0) + 1;
      if (decision.status === "ready") ready++;
    }
    return { ready, requests, reasons };
  }

  async revalidateSource(sourceId: string): Promise<Record<string, number>> {
    const source=await sourcesService.getSource(sourceId);
    if(!source)throw new Error(`Source not found: ${sourceId}`);
    const {timezone}=await settingsService.getSettings();
    const db=getSqliteDatabase();
    const counts:Record<string,number>={};
    // Re-evaluate candidates only. Admitted articles never return to admission.
    for(const row of db.prepare("SELECT * FROM collection_candidates WHERE source_id=? AND status!='ready'").all(sourceId) as Candidate[]) {
      const item:ContentItem=JSON.parse(row.item_json);
      db.prepare("UPDATE collection_candidates SET rule_revision='' WHERE source_id=? AND item_id=?").run(sourceId,row.item_id);
      const reason=await this.enqueue(item,source.options,timezone,row.article_id);
      counts[reason]=(counts[reason]||0)+1;
    }
    db.prepare('DELETE FROM collection_receipts WHERE source_id=?').run(sourceId);
    removeUnusedBlobs([...this.retiredRawRefs]);
    this.retiredRawRefs.clear();
    articleReviewsService.processPending().catch(() => {});
    return counts;
  }

  persistContentItem(
    item: ContentItem,
    targetArticleId?: string,
  ): string {
    const db = getSqliteDatabase();
    const canonical = normalizeUrl(
      item.canonical_url || item.final_url || item.original_url,
    );
    const linked = db
      .prepare("SELECT article_id FROM source_items WHERE id=?")
      .get(item.source_item_id) as { article_id: string } | undefined;
    const existing = db
      .prepare("SELECT * FROM articles WHERE id=? OR canonical_url=? LIMIT 1")
      .get(targetArticleId || linked?.article_id || "", canonical) as any;
    const articleId = existing?.id || targetArticleId || `art_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    if (!existing)
      db.prepare(
        "INSERT INTO articles(id,canonical_url,title,author,published_at,updated_at,created_at) VALUES (?,?,?,?,?,?,?)",
      ).run(
        articleId,
        canonical,
        item.title || null,
        item.author || null,
        item.published_at || null,
        item.updated_at || null,
        now,
      );
    const previous = existing?.latest_revision
      ? (db
          .prepare(
            "SELECT body_completeness FROM article_revisions WHERE article_id=? AND revision_hash=?",
          )
          .get(articleId, existing.latest_revision) as any)
      : null;
    const downgrade =
      previous?.body_completeness === "full" &&
      item.body.completeness !== "full";
    if (!downgrade) {
      const revisionHash = hash(item.body.value || "");
      const contentRef = path.join(getAppPaths().blobsDir, revisionHash);
      if (!fs.existsSync(contentRef))
        fs.writeFileSync(contentRef, item.body.value || "");
      const rev = db
        .prepare(
          "SELECT id FROM article_revisions WHERE article_id=? AND revision_hash=?",
        )
        .get(articleId, revisionHash);
      if (!rev)
        db.prepare(
          "INSERT INTO article_revisions(id,article_id,revision_hash,content_ref,title,body_format,body_completeness,fetched_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        ).run(
          `rev_${crypto.randomUUID()}`,
          articleId,
          revisionHash,
          contentRef,
          item.title || null,
          item.body.format,
          item.body.completeness,
          item.fetched_at,
          now,
        );
      if (rev && item.body.completeness === "full") db.prepare("UPDATE article_revisions SET body_completeness='full' WHERE article_id=? AND revision_hash=?").run(articleId,revisionHash);
      db.prepare(
        "UPDATE articles SET latest_revision=?,title=COALESCE(?,title),author=COALESCE(?,author) WHERE id=?",
      ).run(revisionHash, item.title || null, item.author || null, articleId);
    }
    if (existing?.canonical_url) db.prepare('UPDATE articles SET canonical_url=? WHERE id=?').run(normalizeUrl(existing.canonical_url), articleId);
    // Metadata corrections are independent of body hashes; feed dates cannot replace verified dates.
    const oldEvidence = JSON.parse(existing?.date_evidence_json || "{}");
    if (item.fetch_method === "web_page" || !oldEvidence.verified)
      db.prepare(
        "UPDATE articles SET published_at=?,updated_at=?,date_evidence_json=? WHERE id=?",
      ).run(
        item.published_at || null,
        item.updated_at || null,
        JSON.stringify(item.date_evidence || {}),
        articleId,
      );
    db.prepare(
      "INSERT INTO source_items(id,source_id,native_id,article_id,original_url,final_url,published_at,raw_ref,issues_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET issues_json=excluded.issues_json",
    ).run(
      item.source_item_id,
      item.source_id,
      item.native_id || null,
      articleId,
      item.original_url || canonical,
      item.final_url || canonical,
      item.published_at || null,
      item.raw_ref || null,
      JSON.stringify(item.issues || []),
      now,
    );
    const current = db.prepare('SELECT latest_revision FROM articles WHERE id=?').get(articleId) as {latest_revision: string};
    if (item.fetch_method !== 'github_repository' && (!existing || current.latest_revision !== existing.latest_revision)) articleReviewsService.enqueue([articleId]);
    return articleId;
  }
}
export const collectionService = new CollectionService();
