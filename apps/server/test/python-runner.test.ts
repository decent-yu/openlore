import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { PythonWorkerRunner } from '../src/infrastructure/python/runner.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openlore-python-env-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

it('detects a virtual environment installed after the runner was created', () => {
  const runner = new PythonWorkerRunner(undefined, root);
  expect(runner.getPythonPath()).toBe('python3');
  const python = path.join(root, '.venv/bin/python');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, '');
  expect(runner.getPythonPath()).toBe(python);
});

it('reports missing dependencies instead of marking a Python executable healthy', async () => {
  const python = path.join(root, 'missing-dependencies');
  fs.writeFileSync(python, '#!/bin/sh\necho "ModuleNotFoundError: feedparser" >&2\nexit 1\n', { mode: 0o700 });
  const runner = new PythonWorkerRunner(python, root);
  await expect(runner.checkEnvironment()).rejects.toThrow('uv sync --project workers/python');
  await expect(runner.run({ protocol_version: 1, job_id: 'test', operation: 'test', payload: {} } as any)).rejects.toThrow('采集依赖缺失');
});
