"""Contract, integrity and safe rendering tests for the public JSON report."""
from copy import deepcopy
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import sys
import unittest

import test_workflow as workflow
SCRIPTS = workflow.SCRIPTS
import qa_run as qa
from report_model import build_report, validate_report
from report_renderer import html_report, markdown


class DataBlock(HTMLParser):
    def __init__(self):
        super().__init__();self.inside=False;self.data=''
    def handle_starttag(self,tag,attrs):
        if tag=='script' and dict(attrs).get('id')=='report-data':self.inside=True
    def handle_endtag(self,tag):
        if tag=='script':self.inside=False
    def handle_data(self,data):
        if self.inside:self.data+=data


class Reporting(unittest.TestCase):
    def setUp(self):
        self.case=workflow.Workflow();self.case.setUp();self.addCleanup(self.case.doCleanups)
        c=self.case.command();self.case.result('pass',[c]);self.case.command(phase='suite')
    def model(self):
        with qa.ledger(self.case.run) as (r,s):return build_report(s,qa.validate(r,s))

    def test_roundtrip_exports_the_same_contract_in_all_views(self):
        with qa.ledger(self.case.run) as (r,s):qa.render(r,s)
        root=self.case.run;data=json.loads((root/'report.json').read_text())
        parsed=DataBlock();parsed.feed((root/'report.html').read_text())
        self.assertEqual(json.loads(parsed.data),data)
        self.assertIn(data['metadata']['report_id'],(root/'report.md').read_text())
        self.assertEqual(data['summary']['verdict'],'READY_WITHIN_SCOPE')
        self.assertTrue((root/'report.schema.json').is_file())
        dest=self.case.root/'public'
        p=subprocess.run([sys.executable,'-B',str(SCRIPTS/'qa_run.py'),'bundle','--run',str(root),'--dest',str(dest)],capture_output=True,text=True)
        self.assertEqual(p.returncode,0,p.stderr)
        for name in ['report.json','report.html','report.md','report.schema.json','validation.json']:
            self.assertTrue((dest/name).is_file())
        self.assertFalse((dest/'state.json').exists())

    def test_missing_unknown_and_wrong_typed_fields_are_rejected(self):
        data=self.model()
        for change in ['missing','unknown','type','version','enum']:
            with self.subTest(change=change):
                bad=deepcopy(data)
                if change=='missing':del bad['target']['head_commit']
                elif change=='unknown':bad['summary']['made_up_score']=100
                elif change=='type':bad['target']['epoch']=True
                elif change=='version':bad['schema_version']='9.0.0'
                else:bad['scenarios'][0]['status']='green'
                with self.assertRaises(ValueError):validate_report(bad)

    def test_wrong_totals_dangling_refs_and_unsafe_media_paths_fail(self):
        data=self.model()
        for change in ['counts','reference','path','url']:
            with self.subTest(change=change):
                bad=deepcopy(data)
                if change=='counts':bad['summary']['status_counts']['pass']=99
                elif change=='reference':bad['scenarios'][0]['result']['attempts'][0]['evidence_ids']=['E-missing']
                elif change=='path':bad['evidence'][0]['path']='../private.txt'
                else:bad['target']['url']='javascript:alert(1)'
                with self.assertRaises(ValueError):validate_report(bad)

    def test_html_does_not_execute_report_text(self):
        data=self.model();attack='</script><script>window.unsafe=true</script><img src=x onerror=alert(1)>'
        data['scenarios'][0]['title']=attack;data['scenarios'][0]['result']['summary']=attack
        page=html_report(data);parsed=DataBlock();parsed.feed(page)
        self.assertEqual(json.loads(parsed.data)['scenarios'][0]['title'],attack)
        self.assertNotIn('</script><script>window.unsafe',page)
        self.assertNotIn('<img src=x onerror',markdown(data))
        self.assertIn('.textContent=',page)

    def test_stale_result_is_pending_and_cannot_become_ready_in_json(self):
        self.case.environment()
        data=self.model()
        self.assertEqual(data['scenarios'][0]['status'],'pending')
        self.assertFalse(data['scenarios'][0]['current'])
        bad=deepcopy(data);bad['summary']['verdict']='READY_WITHIN_SCOPE'
        with self.assertRaises(ValueError):validate_report(bad)

    def test_resolved_findings_and_original_evidence_survive_json_export(self):
        # Use a fresh run epoch so previous pass evidence is not overwritten.
        with qa.ledger(self.case.run) as (r,s):qa.refresh(r,s)
        self.case.environment()
        before=self.case.command('import calc; assert calc.total() == 1','before')
        second=self.case.command('import calc; assert calc.total() == 1')
        self.case.result('fail',[before,second],severity='high')
        (self.case.work/'calc.py').write_text('def total():\n    return 1\n')
        with qa.ledger(self.case.run) as (r,s):qa.refresh(r,s)
        self.case.environment()
        after=self.case.command('import calc; assert calc.total() == 1','after');self.case.result('pass',[after])
        with qa.ledger(self.case.run) as (r,s):
            qa.repair(r,s,'S1',{'summary':'fix','root_cause':'wrong return','files':['calc.py'],'before':before['id'],'after':after['id']})
        self.case.command(phase='suite');data=self.model()
        self.assertEqual(data['summary']['resolved_findings'],1)
        self.assertEqual(data['summary']['findings_total'],1)
        f=data['findings'][0]
        self.assertEqual(f['resolution'],'resolved')
        self.assertEqual(len(f['attempts']),2)
        self.assertIn(before['evidence'],[e for a in f['attempts'] for e in a['evidence_ids']])
        self.assertTrue(f['repair_ids'])

    def test_standalone_json_renderer_needs_no_git_or_run_state(self):
        data=self.model();folder=self.case.root/'standalone';folder.mkdir()
        source=folder/'input.json';source.write_text(json.dumps(data))
        p=subprocess.run([sys.executable,'-B',str(SCRIPTS/'report_renderer.py'),'--input',str(source),'--output',str(folder/'view.html'),'--markdown',str(folder/'view.md')],cwd=folder,capture_output=True,text=True)
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertTrue((folder/'view.html').is_file());self.assertTrue((folder/'view.md').is_file())
        broken=deepcopy(data);broken['summary']['total']=200;source.write_text(json.dumps(broken))
        original=(folder/'view.html').read_bytes()
        p=subprocess.run([sys.executable,'-B',str(SCRIPTS/'report_renderer.py'),'--input',str(source),'--output',str(folder/'view.html')],capture_output=True)
        self.assertEqual(p.returncode,2);self.assertEqual((folder/'view.html').read_bytes(),original)


if __name__=='__main__':unittest.main()
