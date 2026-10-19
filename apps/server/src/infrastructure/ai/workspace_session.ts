import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  ExecutionRequest,
  ExecutionSession,
  SkillBundle,
} from '@openlore/contracts';

export function sessionBinding(
  request: ExecutionRequest,
  bundle?: SkillBundle,
): string {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        job: request.input.jobId,
        article: request.input.articleId,
        profile: request.input.profileId,
        provider: request.provider,
        cli: request.cli_path,
        model: request.input.model,
        config_profile: request.config.config_profile,
        inherit_user_config: request.config.inherit_user_config,
        material: request.input.material,
        schema: request.input.outputSchema,
        skill: bundle?.id,
        revision: bundle?.revision,
      }),
    )
    .digest('hex');
}

export function resolveSessionWorkspace(
  root: string,
  session: ExecutionSession,
): string {
  if (!path.isAbsolute(session.workspace))
    throw new Error('会话工作区必须为绝对路径');
  const jobs = fs.realpathSync(path.join(root, 'jobs'));
  const workspace = fs.realpathSync(session.workspace);
  if (
    path.dirname(workspace) !== jobs ||
    !path.basename(workspace).startsWith('job-') ||
    fs.lstatSync(session.workspace).isSymbolicLink()
  )
    throw new Error('会话工作区不属于当前执行器，拒绝续用');
  return session.workspace;
}

export function verifySession(
  workspace: string,
  session: ExecutionSession,
  binding: string,
  material: string,
): void {
  const file = path.join(workspace, '.openlore-session.json');
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('无效会话文件');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as ExecutionSession;
  if (
    saved.id !== session.id ||
    saved.workspace !== session.workspace ||
    saved.binding !== binding ||
    session.binding !== binding
  )
    throw new Error(
      '会话与当前任务、文章材料、Skill 或执行器配置不匹配，拒绝续用',
    );
  const article = path.join(workspace, 'input/article.md');
  if (
    fs.lstatSync(article).isSymbolicLink() ||
    fs.readFileSync(article, 'utf8') !== material
  )
    throw new Error('会话正文已变化，拒绝续用');
}

export function claimWorkspace(workspace: string): () => void {
  const file = path.join(workspace, '.openlore-session.lock');
  const owner = crypto.randomUUID();
  fs.writeFileSync(file, owner, { flag: 'wx', mode: 0o600 });
  return () => {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === owner)
      fs.unlinkSync(file);
  };
}
