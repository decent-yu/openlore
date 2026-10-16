import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PythonWorkerRequest,
  PythonWorkerResponse,
} from '@openlore/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PythonWorkerRunner {
  private pythonPath: string;
  private pythonProjectDir: string;

  constructor(customPythonPath?: string) {
    // Resolve project directory: repo_root/workers/python
    // from apps/server/src/infrastructure/python -> up 4 levels to root
    const repoRoot = path.resolve(__dirname, '../../../../../');
    this.pythonProjectDir = path.join(repoRoot, 'workers/python');

    if (customPythonPath && fs.existsSync(customPythonPath)) {
      this.pythonPath = customPythonPath;
    } else {
      const venvPython = path.join(this.pythonProjectDir, '.venv/bin/python');
      if (fs.existsSync(venvPython)) {
        this.pythonPath = venvPython;
      } else {
        this.pythonPath = 'python3';
      }
    }
  }

  getPythonPath(): string {
    return this.pythonPath;
  }

  async run(
    request: PythonWorkerRequest,
    timeoutMs: number = 30000,
  ): Promise<PythonWorkerResponse> {
    return new Promise((resolve, reject) => {
      const args = ['-m', 'openlore_collectors'];
      const child = spawn(this.pythonPath, args, {
        cwd: this.pythonProjectDir,
        shell: false,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONPATH: path.join(this.pythonProjectDir, 'src'),
        },
      });

      let stdoutData = '';
      let stderrData = '';
      const maxStdoutBytes = 16 * 1024 * 1024; // 16 MiB limit

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(
          new Error(
            `Python worker timed out after ${timeoutMs}ms for job ${request.job_id}`,
          ),
        );
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString('utf-8');
        if (Buffer.byteLength(stdoutData) > maxStdoutBytes) {
          clearTimeout(timer);
          child.kill('SIGTERM');
          reject(
            new Error(
              `Python worker stdout exceeded ${maxStdoutBytes} bytes limit`,
            ),
          );
        }
      });

      child.stderr.on('data', (chunk) => {
        stderrData += chunk.toString('utf-8');
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          return reject(
            new Error(
              `Python worker exited with code ${code}. Stderr: ${stderrData}`,
            ),
          );
        }

        try {
          const parsed = JSON.parse(stdoutData.trim());
          if (parsed.protocol_version !== 1) {
            return reject(
              new Error(
                `Invalid protocol version in worker response: ${parsed.protocol_version}`,
              ),
            );
          }
          resolve(parsed as PythonWorkerResponse);
        } catch (e: any) {
          reject(
            new Error(
              `Failed to parse worker stdout as JSON: ${e.message}. Raw output: ${stdoutData.slice(0, 500)}`,
            ),
          );
        }
      });

      child.stdin.write(JSON.stringify(request));
      child.stdin.end();
    });
  }
}

export const pythonWorkerRunner = new PythonWorkerRunner();
