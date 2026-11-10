"""Behavioral tests using real temporary Git repositories and subprocesses."""
import base64
from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import pr_workspace as workspace
import qa_run as qa

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=')


class Workflow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'source'; self.repo.mkdir()
        self.git('init', '-q', '-b', 'release')
        self.git('config', 'user.email', 'qa@example.invalid'); self.git('config', 'user.name', 'QA Fixture')
        (self.repo / 'calc.py').write_text('def total():\n    return 1\n')
        (self.repo / '.gitignore').write_text('__pycache__/\n')
        self.git('add', '.'); self.git('commit', '-qm', 'base')
        self.git('switch', '-qc', 'feature')
        (self.repo / 'calc.py').write_text('def total():\n    return 2\n')
        self.git('commit', '-qam', 'change')
        self.work = self.root / 'work'
        self.ctx = workspace.prepare(self.repo, self.work, 'release', 'feature')
        self.context = self.root / 'context.json'; qa.save(self.context, self.ctx)
        self.run = self.root / 'run'
        qa.init_run(self.context, self.run, 'repair')
        self.plan = {'flows': [{'id': 'F1', 'title': 'Calculate total', 'steps': ['calculate'], 'expected_end': 'correct total'}],
                     'scenarios': [{'id': 'S1', 'flow_id': 'F1', 'title': 'total', 'priority': 'critical', 'changed_files': ['calc.py'],
                                    'steps': ['run total'], 'expected': 'total is 1', 'oracle': 'fixture requirement',
                                    'surfaces': ['cli'], 'required_evidence': ['log']}], 'exclusions': []}
        with qa.ledger(self.run) as (r, s):qa.set_plan(r, s, self.plan)
        self.environment()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.DEVNULL).decode().strip()

    def state(self):return qa.read_json(self.run / 'state.json')

    def environment(self):
        log = self.root / 'service.log'; log.write_text('local fixture served from prepared workspace')
        with qa.ledger(self.run) as (r, s):
            e = qa.add_evidence(r, s, log, 'log', 'service revision proof')
            qa.persist(r, s)
            qa.set_environment(r, s, {'browser': 'none', 'identity_proof': 'local fixture workspace', 'dataset': 'synthetic', 'capabilities': ['log'], 'proof': [e['id']]})

    def command(self, code='print("okay")', phase='check', timeout=5):
        with qa.ledger(self.run) as (r, s):
            return qa.execute(r, s, [sys.executable, '-B', '-c', code], 'S1' if phase != 'suite' else None, phase, timeout)

    def result(self, status, commands, **extra):
        data = {'status': status, 'summary': 'actual fixture observation',
                'attempts': [{'outcome': 'pass' if c['exit_code'] == 0 else 'fail', 'actual': 'observed output', 'evidence': [c['evidence']]} for c in commands], **extra}
        with qa.ledger(self.run) as (r, s):qa.record_result(r, s, 'S1', data)

    def verdict(self):
        with qa.ledger(self.run) as (r, s):return qa.validate(r, s)

    def test_detached_exact_head_preserves_dirty_primary(self):
        (self.repo / 'calc.py').write_text('user changes\n')
        self.assertEqual(self.ctx['head'], workspace.commit(self.work, 'HEAD'))
        self.assertTrue((self.repo / 'calc.py').read_text().startswith('user'))
        self.assertEqual(self.git('branch', '--show-current'), 'feature')
        self.assertEqual(self.ctx['changed_files'], ['calc.py'])
        self.assertEqual(self.ctx['base'], self.git('rev-parse', 'release'))
        self.assertEqual(workspace.git(self.work, 'branch', '--show-current').strip(), b'')

    def test_complete_run_bundle_and_real_exit_codes(self):
        c = self.command(); self.result('pass', [c]); self.command(phase='suite')
        self.assertEqual(self.verdict()['verdict'], 'READY_WITHIN_SCOPE')
        dest = self.root / 'bundle'
        p = subprocess.run([sys.executable, str(SCRIPTS / 'qa_run.py'), 'bundle', '--run', str(self.run), '--dest', str(dest)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue((dest / 'report.md').is_file())
        self.assertFalse((dest / 'state.json').exists())
        self.assertIn('S1', (dest / 'report.md').read_text())
        p = subprocess.run([sys.executable, str(SCRIPTS / 'qa_run.py'), 'exec', '--run', str(self.run), '--scenario', 'S1', '--', sys.executable, '-c', 'raise SystemExit(7)'], capture_output=True)
        self.assertEqual(p.returncode, 7)

    def test_no_suite_and_skipped_are_not_ready(self):
        self.result('pass', [self.command()])
        self.assertEqual(self.verdict()['verdict'], 'INCOMPLETE')
        with qa.ledger(self.run) as (r, s):qa.record_result(r, s, 'S1', {'status': 'skipped', 'summary': 'not tested', 'reason': 'fixture unavailable'})
        self.command(phase='suite')
        self.assertEqual(self.verdict()['verdict'], 'INCOMPLETE')

    def test_failure_needs_reproduction_and_flaky_is_preserved(self):
        failed = self.command('raise SystemExit(1)')
        with self.assertRaises(qa.QAError):self.result('fail', [failed], severity='high')
        self.result('observed', [failed], severity='high')
        with self.assertRaises(qa.QAError):self.result('pass', [self.command()])
        self.result('flaky', [failed, self.command()], severity='high')
        self.command(phase='suite')
        self.assertEqual(self.verdict()['verdict'], 'NOT_READY')

    def test_dirty_worktree_and_plan_refresh_invalidate_old_passes(self):
        self.result('pass', [self.command()]); self.command(phase='suite')
        (self.work / 'calc.py').write_text('def total():\n    return 3\n')
        self.assertEqual(self.verdict()['verdict'], 'INVALID')
        with qa.ledger(self.run) as (r, s):qa.refresh(r, s)
        self.assertEqual(self.verdict()['counts']['pending'], 1)
        self.assertEqual(self.verdict()['verdict'], 'INCOMPLETE')
        self.environment()
        self.result('pass', [self.command()]); self.command(phase='suite')
        self.assertEqual(self.verdict()['verdict'], 'READY_WITHIN_SCOPE')

    def test_report_mode_rejects_accepting_source_edits(self):
        with qa.ledger(self.run) as (r, s):s['mode'] = 'report'; qa.persist(r, s)
        (self.work / 'calc.py').write_text('changed\n')
        with qa.ledger(self.run) as (r, s):
            with self.assertRaises(qa.QAError):qa.refresh(r, s)

    def test_evidence_cannot_be_missing_tampered_or_cross_scenario(self):
        command = self.command()
        evidence = self.state()['evidence'][command['evidence']]
        (self.run / evidence['path']).write_text('tampered')
        with self.assertRaises(qa.QAError):self.result('pass', [command])
        self.assertEqual(self.verdict()['verdict'], 'INVALID')
        with qa.ledger(self.run) as (r, s):
            with self.assertRaises(qa.QAError):qa.add_evidence(r, s, self.root / 'missing', 'log', 'absent')
            fake = self.root / 'fake.png'; fake.write_text('not an image')
            with self.assertRaises(qa.QAError):qa.add_evidence(r, s, fake, 'screenshot', 'fake screenshot', 'S1')
            link = self.root / 'link'; link.symlink_to(fake)
            with self.assertRaises(qa.QAError):qa.add_evidence(r, s, link, 'log', 'symlink')

    def test_browser_evidence_capability_gap_prevents_ready(self):
        plan = deepcopy(self.plan)
        plan['scenarios'][0].update(surfaces=['browser'], required_evidence=['screenshot', 'video'])
        screenshot = self.root / 'page.png'; screenshot.write_bytes(PNG)
        with qa.ledger(self.run) as (r, s):qa.set_plan(r, s, plan)
        proof = self.root / 'proof.log'; proof.write_text('fixture browser is on exact revision')
        with qa.ledger(self.run) as (r, s):
            e = qa.add_evidence(r, s, proof, 'log', 'service proof'); qa.persist(r, s)
            qa.set_environment(r, s, {'browser': 'native', 'url': 'http://localhost:9000', 'identity_proof': 'fixture', 'dataset': 'synthetic', 'capabilities': ['screenshot'], 'proof': [e['id']]})
            shot = qa.add_evidence(r, s, screenshot, 'screenshot', 'fixture test image', 'S1', 1); qa.persist(r, s)
            data = {'status': 'pass', 'summary': 'fixture attempt', 'attempts': [{'outcome': 'pass', 'actual': 'observed', 'evidence': [shot['id']]}]}
            with self.assertRaises(qa.QAError):qa.record_result(r, s, 'S1', data)
            data['evidence_gaps'] = [{'kind': 'video', 'reason': 'fixture browser has no recorder'}]
            qa.record_result(r, s, 'S1', data)
        self.command(phase='suite')
        self.assertEqual(self.verdict()['verdict'], 'INCOMPLETE')

    def test_changed_file_coverage_is_required(self):
        broken = deepcopy(self.plan); broken['scenarios'][0]['changed_files'] = []
        with qa.ledger(self.run) as (r, s):
            with self.assertRaises(qa.QAError):qa.set_plan(r, s, broken)

    def test_timeout_and_secret_redaction(self):
        timed = self.command('import time; time.sleep(10)', timeout=.05)
        self.assertEqual(timed['exit_code'], 124)
        os.environ['QA_TEST_SECRET'] = 'synthetic-secret-value'
        self.addCleanup(os.environ.pop, 'QA_TEST_SECRET', None)
        c = self.command('import os; print(os.environ["QA_TEST_SECRET"])')
        data = self.state()['evidence'][c['evidence']]
        content = (self.run / data['path']).read_text()
        self.assertIn('[REDACTED]', content); self.assertNotIn(os.environ['QA_TEST_SECRET'], content)

    def test_actual_repair_requires_same_regression_and_current_replay(self):
        code = 'import calc; assert calc.total() == 1'
        before = self.command(code, 'before'); again = self.command(code)
        self.result('fail', [before, again], severity='high')
        (self.work / 'calc.py').write_text('def total():\n    return 1\n')
        with qa.ledger(self.run) as (r, s):qa.refresh(r, s)
        self.environment()
        after = self.command(code, 'after'); self.result('pass', [after])
        proof = {'summary': 'correct total', 'root_cause': 'wrong return value', 'files': ['calc.py'], 'before': before['id'], 'after': after['id']}
        self.assertTrue(any('regression proof' in g for g in self.verdict()['gaps']))
        with qa.ledger(self.run) as (r, s):qa.repair(r, s, 'S1', proof)
        self.command(phase='suite')
        self.assertEqual(len(self.state()['repairs']), 1)
        self.assertEqual(self.verdict()['verdict'], 'READY_WITHIN_SCOPE')
        mismatch = self.command('print("different test")', 'after')
        proof['after'] = mismatch['id']
        with qa.ledger(self.run) as (r, s):
            with self.assertRaises(qa.QAError):qa.repair(r, s, 'S1', proof)

    def test_environment_change_invalidates_results(self):
        self.result('pass', [self.command()]); self.command(phase='suite')
        self.environment()
        self.assertEqual(self.verdict()['counts']['pending'], 1)
        self.assertEqual(self.verdict()['verdict'], 'INCOMPLETE')

    def test_ledger_lock_rejects_concurrent_writer(self):
        with qa.ledger(self.run):
            p = subprocess.run([sys.executable, str(SCRIPTS / 'qa_run.py'), 'status', '--run', str(self.run)], capture_output=True, text=True)
            self.assertEqual(p.returncode, 2)
            self.assertIn('another command', p.stderr)

    def test_worktree_and_context_no_overwrite(self):
        with self.assertRaises(workspace.QAError):workspace.prepare(self.repo, self.work, 'release', 'feature')
        with self.assertRaises(workspace.QAError):workspace.describe(self.repo, 'release', 'release', {})
        with self.assertRaises(workspace.QAError):workspace.commit(self.repo, '--help')

    def test_pr_metadata_uses_actual_base_and_keeps_pr_identity(self):
        metadata = {'number': 42, 'url': 'https://github.com/example/project/pull/42',
                    'title': 'fork feature', 'body': 'test requirement', 'state': 'OPEN',
                    'baseRefName': 'release', 'baseRefOid': self.ctx['base'], 'headRefOid': self.ctx['head']}
        original = workspace.run
        def fake_gh(argv, *args, **kwargs):
            return json.dumps(metadata).encode() if argv[0] == 'gh' else original(argv, *args, **kwargs)
        with patch.object(workspace, 'run', side_effect=fake_gh):
            ctx = workspace.prepare(self.repo, self.root / 'pr-work', pr='42', repository='example/project')
        self.assertEqual(ctx['base'], self.ctx['base'])
        self.assertEqual(ctx['identity']['pr'], 42)
        self.assertEqual(ctx['request']['baseRefName'], 'release')

    def test_pr_update_changes_context_and_invalidates_old_results(self):
        self.result('pass', [self.command()]); self.command(phase='suite')
        (self.repo / 'new.py').write_text('print("new behavior")\n')
        self.git('add', 'new.py'); self.git('commit', '-qm', 'update PR')
        ctx = workspace.prepare(self.repo, self.root / 'next-work', 'release', 'feature')
        with qa.ledger(self.run) as (r, s):qa.refresh(r, s, ctx)
        self.assertIn('new.py', self.state()['context']['changed_files'])
        self.assertEqual(self.verdict()['counts']['pending'], 1)
        self.assertTrue(any('changed-file' in g for g in self.verdict()['gaps']))

    def test_suite_retry_does_not_hide_a_failure(self):
        self.result('pass', [self.command()])
        self.command('raise SystemExit(1)', 'suite'); self.command(phase='suite')
        self.assertEqual(self.verdict()['verdict'], 'NOT_READY')

    def test_command_edit_and_missing_executable_cannot_prove_success(self):
        c = self.command('from pathlib import Path; Path("calc.py").write_text("edited")')
        self.assertFalse(c['workspace_unchanged'])
        self.assertEqual(self.verdict()['verdict'], 'INVALID')
        with qa.ledger(self.run) as (r, s):qa.refresh(r, s)
        self.environment()
        with qa.ledger(self.run) as (r, s):
            with self.assertRaises(OSError):qa.execute(r, s, ['/missing/qa-executable'], 'S1', 'check', 5)
        incomplete = [c for c in self.state()['commands'].values() if c['exit_code'] is None]
        self.assertEqual(len(incomplete), 1)
        self.assertTrue(any('interrupted command' in g for g in self.verdict()['gaps']))

    def test_advisory_is_preserved_without_inventing_functional_failure(self):
        c = self.command()
        self.result('pass', [c], advisories=[{'summary': 'confirmation copy could be clearer', 'evidence': [c['evidence']]}])
        self.command(phase='suite')
        with qa.ledger(self.run) as (r, s):qa.render(r, s)
        report = (self.run / 'report.md').read_text()
        self.assertIn('confirmation copy could be clearer', report)
        self.assertIn('操作步骤', report)
        self.assertEqual(self.verdict()['verdict'], 'READY_WITHIN_SCOPE')

    def test_replacing_plan_retires_old_scenarios_without_losing_findings(self):
        first = self.command('raise SystemExit(1)')
        self.result('observed', [first], severity='high')
        changed = deepcopy(self.plan)
        changed['scenarios'][0]['id'] = 'S2'
        with qa.ledger(self.run) as (r, s):
            qa.set_plan(r, s, changed)
            qa.render(r, s)
        self.assertEqual(self.verdict()['counts']['pending'], 1)
        report = (self.run / 'report.md').read_text()
        self.assertIn('S1', report)
        self.assertIn('S2', report)
        self.assertIn('原始证据', report)

    def test_symlink_parent_cannot_escape_workspace_or_evidence_boundary(self):
        alias = self.root / 'source-alias'; alias.symlink_to(self.repo, target_is_directory=True)
        with self.assertRaises(workspace.QAError):
            workspace.prepare(self.repo, alias / 'nested-work', 'release', 'feature')
        c = self.command()
        artifacts = self.run / 'artifacts'
        outside = self.root / 'moved-artifacts'
        artifacts.rename(outside); artifacts.symlink_to(outside, target_is_directory=True)
        self.assertEqual(self.verdict()['verdict'], 'INVALID')


if __name__ == '__main__':
    unittest.main()
