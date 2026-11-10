#!/usr/bin/env python3
"""Resolve an exact PR revision and prepare an isolated, detached Git worktree."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


class QAError(ValueError):
    pass


def run(argv, cwd=None, timeout=120):
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
    p = subprocess.run(argv, cwd=cwd, capture_output=True, timeout=timeout, env=env)
    if p.returncode:
        raise QAError(p.stderr.decode(errors='replace').strip() or f'command failed: {argv[0]}')
    return p.stdout


def git(repo, *args):
    return run(['git', '-C', str(repo), *args])


def commit(repo, ref):
    if not ref or ref.startswith('-'):
        raise QAError('invalid revision')
    return git(repo, 'rev-parse', '--verify', '--end-of-options', ref + '^{commit}').decode().strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def snapshot(repo):
    """Hash HEAD, tracked changes and nonignored untracked content; never follow symlinks."""
    repo = Path(git(repo, 'rev-parse', '--show-toplevel').decode().strip()).resolve()
    head = commit(repo, 'HEAD')
    patch = git(repo, 'diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--')
    untracked = []
    for raw in git(repo, 'ls-files', '--others', '--exclude-standard', '-z').split(b'\0'):
        if not raw:
            continue
        name = os.fsdecode(raw)
        p = repo / name
        if p.is_symlink():
            value = digest(os.fsencode(os.readlink(p)))
        elif p.is_file():
            h = hashlib.sha256()
            with p.open('rb') as f:
                for block in iter(lambda: f.read(1024 * 1024), b''):
                    h.update(block)
            value = h.hexdigest()
        else:
            raise QAError(f'unsupported untracked entry: {name}')
        untracked.append([name, value, p.lstat().st_mode & 0o777])
    submodules = git(repo, 'submodule', 'status', '--recursive').decode(errors='replace')
    # A superproject diff cannot capture uncommitted content inside a submodule.
    if re.search(r'^[-+U]', submodules, re.M) or b'Subproject commit' in patch:
        raise QAError('submodules must be initialized and clean; snapshot them separately if they are the target')
    payload = {'head': head, 'patch_sha256': digest(patch), 'untracked': sorted(untracked), 'submodules': submodules}
    return {'head': head, 'fingerprint': digest(json.dumps(payload, sort_keys=True).encode()),
            'dirty': bool(patch or untracked), 'workspace': str(repo)}


def describe(repo, base, head, identity):
    base_oid, head_oid = commit(repo, base), commit(repo, head)
    merge = git(repo, 'merge-base', base_oid, head_oid).decode().strip()
    changed = [os.fsdecode(p) for p in git(repo, 'diff', '--name-only', '--no-renames', '-z', merge, head_oid, '--').split(b'\0') if p]
    if not changed:
        raise QAError('no code changes between the selected revisions')
    return {'schema_version': 1, 'identity': identity, 'base': base_oid, 'head': head_oid,
            'merge_base': merge, 'changed_files': changed}


def prepare(repo, worktree, base=None, head=None, pr=None, repository=None):
    repo = Path(git(repo, 'rev-parse', '--show-toplevel').decode().strip()).resolve()
    dest = Path(worktree).absolute()
    if dest.exists() or dest.is_symlink():
        raise QAError('worktree destination must not exist')
    if dest.resolve().is_relative_to(repo):
        raise QAError('place the worktree outside the source checkout')
    if pr:
        if not repository or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
            raise QAError('--repository owner/repo is required for a PR')
        # A URL is accepted only for the explicitly selected repository.
        match = re.fullmatch(r'https://github\.com/([^/]+/[^/]+)/pull/(\d+)/?', pr)
        number = match.group(2) if match and match.group(1).lower() == repository.lower() else pr
        if not re.fullmatch(r'[1-9][0-9]*', number):
            raise QAError('PR must be a positive number or a matching github.com PR URL')
        metadata = json.loads(run(['gh', 'pr', 'view', number, '--repo', repository, '--json',
                                   'number,url,title,body,baseRefName,baseRefOid,headRefOid,state']))
        remote = f'https://github.com/{repository}.git'
        # Fetch by immutable oid. A moving branch cannot silently change the revision being tested.
        for oid in [metadata['baseRefOid'], metadata['headRefOid']]:
            if not re.fullmatch(r'[0-9a-fA-F]{40,64}', oid):
                raise QAError('invalid PR oid')
            try:
                commit(repo, oid)
            except QAError:
                try:
                    git(repo, 'fetch', '--no-tags', '--no-recurse-submodules', remote, oid)
                except QAError:
                    if oid != metadata['headRefOid']:
                        raise
                    # Some hosts disallow fetching a fork's unadvertised oid. Fetch its PR ref,
                    # then verify FETCH_HEAD; a concurrent PR update is an explicit blocker.
                    git(repo, 'fetch', '--no-tags', '--no-recurse-submodules', remote, f'refs/pull/{number}/head')
                    if commit(repo, 'FETCH_HEAD') != oid.lower():
                        raise QAError('PR changed while fetching; resolve a fresh PR context')
            if commit(repo, oid) != oid.lower():
                raise QAError('fetched revision does not match PR metadata')
        context = describe(repo, metadata['baseRefOid'], metadata['headRefOid'],
                           {'repository': repository, 'pr': int(number), 'url': metadata['url']})
        context['request'] = {k: metadata[k] for k in ['title', 'body', 'state', 'baseRefName']}
    else:
        if not base or not head:
            raise QAError('provide --pr/--repository or both --base and --head')
        context = describe(repo, base, head, {'local_repository': str(repo), 'base_ref': base, 'head_ref': head})
    git(repo, 'worktree', 'add', '--detach', str(dest), context['head'])
    context['workspace'] = str(dest.resolve())
    context['code'] = snapshot(dest)
    return context


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo', required=True)
    p.add_argument('--worktree', required=True)
    p.add_argument('--pr')
    p.add_argument('--repository')
    p.add_argument('--base')
    p.add_argument('--head')
    p.add_argument('--output', required=True)
    a = p.parse_args()
    try:
        output = Path(a.output).absolute()
        if output.exists():
            raise QAError('context output already exists')
        context = prepare(a.repo, a.worktree, a.base, a.head, a.pr, a.repository)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x') as f:
            json.dump(context, f, ensure_ascii=False, indent=2)
            f.write('\n')
        os.chmod(output, 0o600)
        print(json.dumps({'context': str(output), 'workspace': context['workspace'], 'head': context['head']}))
        return 0
    except (QAError, OSError, subprocess.TimeoutExpired, KeyError, json.JSONDecodeError) as e:
        print(json.dumps({'error': str(e)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
