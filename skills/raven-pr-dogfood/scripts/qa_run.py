#!/usr/bin/env python3
"""Durable PR QA ledger, evidence, command capture, revision retests and reports (Python 3.10+, POSIX)."""
import argparse
from copy import deepcopy
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import uuid

from pr_workspace import QAError, snapshot
from report_model import build_report
from report_renderer import write_views

STATUSES = {'pass', 'fail', 'flaky', 'observed', 'blocked', 'skipped'}
KINDS = {'screenshot', 'video', 'log'}


def now():
    return datetime.now(timezone.utc).isoformat()


def require(ok, message):
    if not ok:
        raise QAError(message)


def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save(path, value):
    path = Path(path)
    fd, tmp = tempfile.mkstemp(prefix='.write-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def strings(value):
    return isinstance(value, list) and bool(value) and all(text(x) for x in value)


def sid():
    return uuid.uuid4().hex[:12]


def inside(path, root):
    return Path(path).resolve().is_relative_to(Path(root).resolve())


@contextmanager
def ledger(run_dir):
    root = Path(run_dir).resolve()
    require((root / 'state.json').is_file(), 'run not initialized')
    with (root / '.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise QAError('another command owns this run; wait for it to finish')
        state = read_json(root / 'state.json')
        require(state.get('schema_version') == 2, 'unsupported run schema')
        yield root, state


def persist(root, state):
    state['updated_at'] = now()
    save(root / 'state.json', state)


def current(state):
    code = snapshot(state['context']['workspace'])
    require(code['fingerprint'] == state['code']['fingerprint'],
            'code changed: prepare a clean updated PR context, then refresh and re-test')
    return code


def scenario(state, ident):
    matches = [s for s in (state.get('plan') or {}).get('scenarios', []) if s['id'] == ident]
    require(len(matches) == 1, 'unknown scenario: ' + str(ident))
    return matches[0]


def stamp(state):
    return {'epoch': state['epoch'], 'environment': (state.get('environment') or {}).get('id')}


def fresh(item, state):
    return item.get('epoch') == state['epoch'] and item.get('environment') == (state.get('environment') or {}).get('id')


def valid_environment(state):
    require(state.get('environment') and state['environment']['epoch'] == state['epoch'],
            'record the current service/environment before testing')


def artifact(root, item):
    path = root / item['path']
    require(not (root / 'artifacts').is_symlink() and inside(path, root) and
            inside(path, root / 'artifacts') and not path.is_symlink() and path.is_file(),
            'missing or escaping artifact: ' + item['id'])
    require(path.stat().st_size == item['bytes'] and hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'],
            'artifact content changed: ' + item['id'])
    return path


def add_evidence(root, state, source, kind, note, scenario_id=None, step=None):
    source = Path(source)
    require(kind in KINDS and text(note), 'evidence kind and observation note required')
    require(not source.is_symlink() and source.is_file() and source.stat().st_size > 0, 'evidence must be a nonempty regular file')
    if scenario_id:
        s = scenario(state, scenario_id)
        require(step is None or 1 <= step <= len(s['steps']), 'evidence step outside scenario')
    with source.open('rb') as f:
        header = f.read(16)
    if kind == 'screenshot':
        require(header.startswith((b'\x89PNG\r\n\x1a\n', b'\xff\xd8\xff')) or
                (header.startswith(b'RIFF') and header[8:12] == b'WEBP'), 'screenshot must be PNG, JPEG or WebP')
        suffix = '.png' if header.startswith(b'\x89PNG') else '.jpg' if header.startswith(b'\xff') else '.webp'
    elif kind == 'video':
        require(header.startswith(b'\x1aE\xdf\xa3') or header[4:8] == b'ftyp', 'video must be WebM or MP4')
        suffix = '.webm' if header.startswith(b'\x1aE') else '.mp4'
    else:
        suffix = '.log'
    ident = 'E-' + sid()
    dest = root / 'artifacts' / (ident + suffix)
    shutil.copyfile(source, dest)
    os.chmod(dest, 0o600)
    item = {'id': ident, 'scenario': scenario_id, 'step': step, 'kind': kind, 'note': note,
            'path': dest.relative_to(root).as_posix(), 'bytes': dest.stat().st_size,
            'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(), 'captured_at': now(), **stamp(state)}
    state['evidence'][ident] = item
    return item


def init_run(context_file, run_dir):
    context = read_json(context_file)
    require(context.get('schema_version') == 1 and context.get('changed_files'), 'invalid PR context')
    code = snapshot(context['workspace'])
    require(code['head'] == context['head'] and not code['dirty'], 'initialize from the exact clean prepared revision')
    root = Path(run_dir).absolute()
    require(not root.exists() and not root.is_symlink(), 'run directory already exists; use status to resume')
    require(not inside(root, context['workspace']), 'keep run artifacts outside the tested worktree')
    root.mkdir(parents=True, mode=0o700)
    (root / 'artifacts').mkdir(mode=0o700)
    state = {'schema_version': 2, 'context': context, 'code': code, 'epoch': 1,
             'created_at': now(), 'plan': None, 'environment': None, 'history': [],
             'results': {}, 'evidence': {}, 'commands': {}}
    persist(root, state)
    return {'run': str(root), 'head': code['head']}


def set_plan(root, state, plan):
    current(state)
    flows, scenarios, exclusions = plan.get('flows'), plan.get('scenarios'), plan.get('exclusions', [])
    require(isinstance(flows, list) and flows and isinstance(scenarios, list) and scenarios, 'flows and scenarios required')
    flow_ids, ids, covered = set(), set(), set()
    for flow in flows:
        require(text(flow.get('id')) and flow['id'] not in flow_ids and text(flow.get('title')) and
                strings(flow.get('steps')) and text(flow.get('expected_end')), 'invalid or duplicate flow')
        flow_ids.add(flow['id'])
    for s in scenarios:
        require(re.fullmatch(r'[A-Za-z0-9_-]{1,64}', s.get('id', '')) and s['id'] not in ids, 'invalid or duplicate scenario id')
        require(s.get('flow_id') in flow_ids and text(s.get('title')) and strings(s.get('steps')) and
                text(s.get('expected')) and text(s.get('oracle')), 'scenario requires flow, steps, expected and oracle source')
        require(s.get('priority') in {'critical', 'high', 'normal'}, 'invalid scenario priority')
        require(strings(s.get('surfaces')) and set(s['surfaces']) <= {'browser', 'api', 'cli', 'job'}, 'invalid surfaces')
        require(isinstance(s.get('changed_files'), list), 'changed_files must be a list')
        require(strings(s.get('required_evidence')) and set(s['required_evidence']) <= KINDS, 'declare required evidence kinds')
        require('screenshot' in s['required_evidence'] if 'browser' in s['surfaces'] else 'log' in s['required_evidence'],
                'browser scenarios need screenshots; functional scenarios need logs')
        require(set(s['changed_files']) <= set(state['context']['changed_files']), 'scenario references unknown changed file')
        ids.add(s['id']); covered.update(s['changed_files'])
    require(isinstance(exclusions, list), 'exclusions must be a list')
    for e in exclusions:
        require(e.get('path') in state['context']['changed_files'] and text(e.get('reason')), 'invalid exclusion')
        covered.add(e['path'])
    require(covered == set(state['context']['changed_files']), 'each changed file needs scenarios or a reasoned exclusion')
    if state['plan'] is not None:
        # Editing a plan changes what a pass means; preserve old evidence but invalidate all outcomes.
        state['history'].append({'at': now(), 'reason': 'plan replaced', 'epoch': state['epoch'], 'plan': state['plan']})
        for ident, result in state['results'].items():
            state['history'].append({'at': now(), 'reason': 'scenario retired by plan update', 'scenario': ident, 'result': result})
        state['results'] = {}
        state['epoch'] += 1
    for item in scenarios:
        item.setdefault('preconditions', [])
    plan.setdefault('exclusions', [])
    state['plan'] = plan
    persist(root, state)


def set_environment(root, state, env):
    current(state)
    require(state['plan'], 'write a plan before choosing the execution environment')
    require(env.get('browser') in {'native', 'agent-browser', 'none'}, 'invalid browser')
    require(text(env.get('identity_proof')) and text(env.get('dataset')), 'service identity and dataset descriptions required')
    require(isinstance(env.get('capabilities'), list) and strings(env.get('proof')), 'capabilities and registered proof evidence required')
    if any('browser' in s['surfaces'] for s in state['plan']['scenarios']):
        require(env['browser'] != 'none' and text(env.get('url')), 'browser scenarios require a browser and URL')
    for ident in env['proof']:
        e = state['evidence'].get(ident)
        require(e and e['epoch'] == state['epoch'], 'environment proof must belong to the current code epoch')
        artifact(root, e)
    if state['environment']:
        state['history'].append({'at': now(), 'reason': 'environment replaced', 'environment': state['environment']})
    env.setdefault('url', None)
    state['environment'] = {**env, 'id': sid(), 'epoch': state['epoch'], 'recorded_at': now()}
    persist(root, state)


def record_result(root, state, ident, result):
    current(state); valid_environment(state)
    s = scenario(state, ident)
    status = result.get('status')
    require(status in STATUSES and text(result.get('summary')), 'result status and actual summary required')
    attempts = result.get('attempts', [])
    require(isinstance(attempts, list), 'attempts must be a list')
    kinds = set()
    for a in attempts:
        require(a.get('outcome') in {'pass', 'fail'} and text(a.get('actual')) and strings(a.get('evidence')),
                'each attempt needs outcome, actual observation and evidence ids')
        for eid in a['evidence']:
            e = state['evidence'].get(eid)
            require(e and e['scenario'] == ident and fresh(e, state), 'attempt references stale or unrelated evidence')
            artifact(root, e); kinds.add(e['kind'])
    previous = state['results'].get(ident)
    if previous and fresh(previous, state):
        old_ids = {eid for a in previous.get('attempts', []) for eid in a['evidence']}
        new_ids = {eid for a in attempts for eid in a['evidence']}
        require(old_ids <= new_ids or status in {'blocked', 'skipped'}, 'retain earlier attempts from this code/environment; a retry cannot erase a failure')
    passed = sum(a['outcome'] == 'pass' for a in attempts)
    failed = len(attempts) - passed
    require(status != 'pass' or (passed >= 1 and failed == 0), 'pass requires successful observations without failures')
    require(status != 'fail' or (failed >= 2 and passed == 0), 'confirmed failure requires two failing attempts; use observed/flaky otherwise')
    require(status != 'flaky' or (failed >= 1 and passed >= 1), 'flaky requires both successful and failing attempts')
    require(status != 'observed' or (failed >= 1), 'observed requires a failing observation')
    require(status not in {'blocked', 'skipped'} or text(result.get('reason')), 'blocked/skipped require a reason')
    require(status not in {'fail', 'flaky', 'observed'} or result.get('severity') in {'critical', 'high', 'medium', 'low'}, 'finding severity required')
    require(result.get('attribution', 'unknown') in {'introduced', 'preexisting', 'unknown'}, 'invalid finding attribution')
    for field in ['cause_hypothesis', 'recommendation']:
        require(result.get(field) is None or text(result[field]), f'{field} must be a nonempty string or null')
    gaps = result.get('evidence_gaps', [])
    require(isinstance(gaps, list) and all(g.get('kind') in KINDS and text(g.get('reason')) for g in gaps), 'invalid evidence gaps')
    for advisory in result.get('advisories', []):
        require(text(advisory.get('summary')) and strings(advisory.get('evidence')), 'advisory needs a summary and evidence')
        for eid in advisory['evidence']:
            e = state['evidence'].get(eid)
            require(e and e['scenario'] == ident and fresh(e, state), 'advisory references stale or unrelated evidence')
            artifact(root, e)
    if attempts:
        missing = set(s['required_evidence']) - kinds
        require(missing <= {g['kind'] for g in gaps}, 'missing required evidence must have an explicit gap reason')
    previous = state['results'].get(ident)
    if previous:
        state['history'].append({'at': now(), 'reason': 'scenario retested', 'scenario': ident, 'result': previous})
    normalized = {'severity': None, 'attribution': 'unknown', 'reason': None,
                  'attempts': [], 'evidence_gaps': [], 'advisories': [],
                  'cause_hypothesis': None, 'recommendation': None, **result}
    state['results'][ident] = {**normalized, 'scenario_snapshot': deepcopy(s), 'tested_commit': state['code']['head'], 'code_fingerprint': state['code']['fingerprint'], 'recorded_at': now(), **stamp(state)}
    persist(root, state)


def refresh(root, state, context=None):
    old = deepcopy(state['context'])
    if context:
        require(context.get('identity') == old['identity'], 'cannot resume a run for a different PR or comparison')
        require(context.get('schema_version') == 1, 'invalid context')
        code = snapshot(context['workspace'])
        require(code['head'] == context['head'] and not code['dirty'], 'updated PR context must point to its exact clean revision')
        state['context'] = context
    else:
        code = snapshot(old['workspace'])
        require(code['fingerprint'] == state['code']['fingerprint'],
                'source edits are not accepted; prepare a clean updated PR context to retest')
    state['history'].append({'at': now(), 'reason': 'code refreshed; all results need revalidation',
                             'epoch': state['epoch'], 'code': state['code'], 'context': old.copy()})
    state['code'] = code; state['epoch'] += 1
    persist(root, state)


def redact(value):
    # Defense in depth; callers must still keep credentials out of argv and review logs before sharing.
    for key, secret in os.environ.items():
        if len(secret) >= 8 and re.search(r'TOKEN|PASSWORD|SECRET|API_KEY', key, re.I):
            value = value.replace(secret, '[REDACTED]')
    return re.sub(r'(?i)(authorization:\s*(?:bearer|basic)\s+)\S+', r'\1[REDACTED]', value)


def execute(root, state, argv, ident, phase, timeout):
    current(state); valid_environment(state)
    require(argv and timeout > 0, 'command and positive timeout required')
    require(phase in {'check', 'suite'}, 'only check and suite execution phases are supported')
    if ident:
        scenario(state, ident)
    require(phase == 'suite' or ident, 'non-suite commands require a scenario')
    entry = {'id': 'C-' + sid(), 'scenario': ident, 'phase': phase, 'argv': [redact(x) for x in argv],
             'started_at': now(), 'finished_at': None, 'evidence': None, 'workspace_unchanged': None,
             'code': state['code'].copy(), 'exit_code': None, **stamp(state)}
    state['commands'][entry['id']] = entry
    persist(root, state)  # Interrupted commands remain visible as incomplete, never a pass.
    with tempfile.TemporaryFile() as output:
        p = subprocess.Popen(argv, cwd=state['context']['workspace'], stdout=output,
                             stderr=subprocess.STDOUT, start_new_session=True)
        try:
            rc = p.wait(timeout=timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as e:
            os.killpg(p.pid, signal.SIGTERM)
            try:
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid, signal.SIGKILL); p.wait()
            rc = 124 if isinstance(e, subprocess.TimeoutExpired) else 130
        output.seek(0)
        content = redact(output.read().decode(errors='replace'))
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8') as log:
        log.write(content or '(command produced no output)\n'); log.flush()
        e = add_evidence(root, state, log.name, 'log', f"command {entry['id']}, exit {rc}", ident)
    after = snapshot(state['context']['workspace'])
    entry.update({'finished_at': now(), 'exit_code': rc, 'evidence': e['id'],
                  'workspace_unchanged': after['fingerprint'] == entry['code']['fingerprint']})
    persist(root, state)
    return entry


def validate(root, state):
    errors, gaps, counts = [], [], {}
    try:
        current(state)
    except (QAError, OSError) as e:
        errors.append(str(e))
    if not state['plan']:
        gaps.append('no test plan')
    env = state.get('environment')
    if not env or env['epoch'] != state['epoch']:
        gaps.append('environment is absent or stale')
    for e in state['evidence'].values():
        try:
            artifact(root, e)
        except QAError as exc:
            errors.append(str(exc))
    mapped = set()
    for s in (state['plan'] or {}).get('scenarios', []):
        mapped.update(s['changed_files'])
        r = state['results'].get(s['id'])
        status = r['status'] if r and fresh(r, state) else 'pending'
        counts[status] = counts.get(status, 0) + 1
        if status not in STATUSES | {'pending'}:
            errors.append(f"{s['id']}: invalid result status")
        if status in {'pending', 'blocked', 'skipped', 'observed'}:
            gaps.append(f"{s['id']}: {status}" + (': ' + r['reason'] if r and fresh(r, state) and r['reason'] else ''))
        if r and fresh(r, state) and r.get('evidence_gaps'):
            gaps.append(f"{s['id']}: evidence capability gaps")
    mapped.update(e['path'] for e in (state['plan'] or {}).get('exclusions', []))
    if mapped != set(state['context']['changed_files']):
        gaps.append('plan does not cover the current changed-file list')
    commands = list(state['commands'].values())
    if any(c['exit_code'] is None for c in commands):
        gaps.append('interrupted command: inspect its effects and explicitly close it with interrupt-command')
    suites = [c for c in commands if c['phase'] == 'suite' and fresh(c, state)]
    suite = suites[-1] if suites else None
    if not suite:
        gaps.append('no current automated suite execution; absence is not a pass')
    else:
        for c in suites:
            if c['exit_code'] is None:
                gaps.append(f"automated suite {c['id']} has not completed")
            elif c['exit_code'] in (124, 130):
                gaps.append(f"automated suite {c['id']} timed out or was interrupted (exit {c['exit_code']})")
            elif c['exit_code'] != 0:
                gaps.append(f"automated suite {c['id']} failed (exit {c['exit_code']})")
            if c.get('workspace_unchanged') is False:
                gaps.append(f"automated suite {c['id']} changed the source workspace")
    failed = bool(counts.get('fail') or counts.get('flaky') or any(c['exit_code'] not in (None, 0) for c in suites))
    verdict = 'INVALID' if errors else 'NOT_READY' if failed else 'INCOMPLETE' if gaps else 'READY_WITHIN_SCOPE'
    return {'verdict': verdict, 'code': state['code']['head'], 'epoch': state['epoch'],
            'counts': counts, 'errors': errors, 'gaps': gaps, 'scope': 'declared PR test scope only', 'suite': suite['id'] if suite else None}


def render(root, state):
    check = validate(root, state)
    public_report = build_report(state, check)
    save(root / 'report.json', public_report)
    write_views(public_report, root)
    save(root / 'validation.json', check)
    return check


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('init'); p.add_argument('--context', required=True); p.add_argument('--run', required=True)
    for name in ['plan', 'environment', 'result']:
        p = sub.add_parser(name); p.add_argument('--run', required=True); p.add_argument('--file', required=True)
        if name == 'result':p.add_argument('--scenario', required=True)
    p = sub.add_parser('evidence'); p.add_argument('--run', required=True); p.add_argument('--file', required=True); p.add_argument('--kind', choices=sorted(KINDS), required=True); p.add_argument('--note', required=True); p.add_argument('--scenario'); p.add_argument('--step', type=int)
    p = sub.add_parser('refresh'); p.add_argument('--run', required=True); p.add_argument('--context')
    p = sub.add_parser('exec'); p.add_argument('--run', required=True); p.add_argument('--scenario'); p.add_argument('--phase', choices=['check', 'suite'], default='check'); p.add_argument('--timeout', type=float, default=120); p.add_argument('command', nargs=argparse.REMAINDER)
    p = sub.add_parser('interrupt-command'); p.add_argument('--run', required=True); p.add_argument('--id', required=True); p.add_argument('--reason', required=True)
    for name in ['status', 'validate', 'report']:
        p = sub.add_parser(name); p.add_argument('--run', required=True)
    p = sub.add_parser('bundle'); p.add_argument('--run', required=True); p.add_argument('--dest', required=True)
    a = parser.parse_args()
    try:
        if a.action == 'init':
            output = init_run(a.context, a.run)
        else:
            with ledger(a.run) as (root, state):
                output = {'action': a.action}
                if a.action == 'plan':set_plan(root, state, read_json(a.file))
                elif a.action == 'environment':set_environment(root, state, read_json(a.file))
                elif a.action == 'result':record_result(root, state, a.scenario, read_json(a.file))
                elif a.action == 'refresh':refresh(root, state, read_json(a.context) if a.context else None)
                elif a.action == 'evidence':
                    current(state)
                    output = add_evidence(root, state, a.file, a.kind, a.note, a.scenario, a.step); persist(root, state)
                elif a.action == 'exec':
                    argv = a.command[1:] if a.command[:1] == ['--'] else a.command
                    output = execute(root, state, argv, a.scenario, a.phase, a.timeout)
                    print(json.dumps(output, ensure_ascii=False)); return output['exit_code'] if output['exit_code'] >= 0 else 128 - output['exit_code']
                elif a.action == 'interrupt-command':
                    c = state['commands'].get(a.id)
                    require(c and c['exit_code'] is None and text(a.reason), 'only incomplete commands can be closed, with a reason')
                    c.update({'exit_code': 130, 'finished_at': now(), 'interruption_reason': a.reason, 'workspace_unchanged': False}); persist(root, state)
                elif a.action == 'status':
                    output = {'validation': validate(root, state), 'context': state['context'],
                              'plan': state['plan'], 'environment': state['environment'], 'results': state['results']}
                elif a.action == 'validate':
                    output = validate(root, state)
                    print(json.dumps(output, ensure_ascii=False)); return 0 if output['verdict'] == 'READY_WITHIN_SCOPE' else 1
                elif a.action in ['report', 'bundle']:
                    output = render(root, state)
                    if a.action == 'bundle':
                        dest = Path(a.dest).absolute()
                        require(not dest.exists() and not inside(dest, root) and not inside(dest, state['context']['workspace']), 'bundle destination must be new and outside run/worktree')
                        dest.mkdir(parents=True, mode=0o700)
                        for name in ['report.json', 'report.html', 'report.md', 'report.schema.json', 'validation.json']:
                            shutil.copyfile(root / name, dest / name)
                        (dest / 'artifacts').mkdir()
                        for e in state['evidence'].values():
                            shutil.copyfile(artifact(root, e), dest / e['path'])
                        output['bundle'] = str(dest)
        print(json.dumps(output, ensure_ascii=False)); return 0
    except (ValueError, OSError, subprocess.SubprocessError) as e:
        print(json.dumps({'error': str(e)}, ensure_ascii=False), file=sys.stderr); return 2


if __name__ == '__main__':
    sys.exit(main())
