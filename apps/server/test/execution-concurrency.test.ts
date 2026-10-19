import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import { ExecutorConfigSchema } from '@openlore/contracts';
import { initDatabase } from '../src/infrastructure/persistence/sqlite/db.js';
import { getAppPaths } from '../src/infrastructure/config/paths.js';
import { ExecutionSlots } from '../src/infrastructure/ai/execution_slots.js';
import { ExecutorAdapter } from '../src/infrastructure/ai/executor_adapter.js';

beforeAll(() => initDatabase());
afterEach(() => vi.useRealTimers());
it('shares capacity, releases exactly once and keeps other profiles independent', async () => {
  const slots = new ExecutionSlots();
  const first = await slots.acquire('same', 2, 10);
  const second = await slots.acquire('same', 2, 10);
  let thirdStarted = false;
  const third = slots.acquire('same', 2, 10).then((release) => {
    thirdStarted = true;
    return release;
  });
  await Promise.resolve();
  expect(thirdStarted).toBe(false);
  const other = await slots.acquire('other', 1, 10);
  other();
  first();
  first();
  const releaseThird = await third;
  let fourthStarted = false;
  const fourth = slots.acquire('same', 2, 10).then((release) => {
    fourthStarted = true;
    return release;
  });
  await Promise.resolve();
  expect(fourthStarted).toBe(false);
  second();
  const releaseFourth = await fourth;
  releaseThird();
  releaseFourth();
});
it('expires queued calls without consuming a slot or blocking later work', async () => {
  vi.useFakeTimers();
  const slots = new ExecutionSlots();
  const first = await slots.acquire('profile', 1, 10);
  const waiting = slots.acquire('profile', 1, 10).then(
    () => null,
    (error) => error,
  );
  await vi.advanceTimersByTimeAsync(10001);
  expect(await waiting).toMatchObject({ code: 'executor_queue_timeout' });
  first();
  const next = await slots.acquire('profile', 1, 10);
  next();
});
it('enforces one local profile limit across separate review and research adapters and records queue time', async () => {
  const root = path.join(getAppPaths().dataDir, 'concurrent-adapters');
  fs.mkdirSync(root);
  const events = path.join(root, 'events.jsonl'),
    cli = path.join(root, 'fake-cli');
  fs.writeFileSync(
    cli,
    `#!${process.execPath}\nconst fs=require('fs');const file=${JSON.stringify(events)};const job=JSON.parse(fs.readFileSync('manifest.json','utf8')).job_id;fs.appendFileSync(file,JSON.stringify({job,type:'start'})+'\\n');setTimeout(()=>{fs.appendFileSync(file,JSON.stringify({job,type:'end'})+'\\n');console.log(JSON.stringify({response:'done'}));},100);`,
    { mode: 0o700 },
  );
  const config = ExecutorConfigSchema.parse({
    workspace_root: path.join(root, 'work'),
    concurrency: 1,
  });
  const make = () =>
    new ExecutorAdapter('shared-profile', 'gemini_cli', cli, config);
  const input = {
    jobId: 'review',
    profileId: 'shared-profile',
    taskType: 'assess' as const,
    prompt: 'Read the article',
    material: 'Actual source material',
  };
  const progress = vi.fn();
  const [first, second] = await Promise.all([
    make().execute(input),
    make().execute(
      { ...input, jobId: 'research', taskType: 'research_report' },
      progress,
    ),
  ]);
  expect(first.status).toBe('success');
  expect(second.status).toBe('success');
  const recorded = fs
    .readFileSync(events, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(recorded.map((event) => event.type)).toEqual([
    'start',
    'end',
    'start',
    'end',
  ]);
  expect(second.queue_duration_ms).toBeGreaterThan(0);
  expect(progress).toHaveBeenCalledWith(
    expect.objectContaining({ state: 'queued' }),
  );
  expect(progress).toHaveBeenCalledWith(
    expect.objectContaining({
      state: 'running',
      queue_duration_ms: expect.any(Number),
    }),
  );
});
