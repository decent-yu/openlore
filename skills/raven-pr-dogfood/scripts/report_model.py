"""Public, versioned report contract. Internal run state never becomes the public API."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlparse

SCHEMA_PATH = Path(__file__).resolve().parents[1] / 'references/report.schema.json'
STATUSES = ['pending', 'pass', 'fail', 'flaky', 'observed', 'blocked', 'skipped']
SEVERITIES = ['critical', 'high', 'medium', 'low', 'unspecified']


def schema():
    return json.loads(SCHEMA_PATH.read_text())


def _check(value, rule, defs, path='$'):
    if '$ref' in rule:
        return _check(value, defs[rule['$ref'].split('/')[-1]], defs, path)
    if 'const' in rule and value != rule['const']:
        raise ValueError(f'{path}: unsupported constant/version')
    if 'enum' in rule and value not in rule['enum']:
        raise ValueError(f'{path}: value outside enum')
    kinds = rule.get('type')
    checks = {'null':lambda x:x is None,'string':lambda x:isinstance(x,str),'object':lambda x:isinstance(x,dict),
              'array':lambda x:isinstance(x,list),'integer':lambda x:type(x) is int,'boolean':lambda x:type(x) is bool}
    if kinds and not any(checks[k](value) for k in (kinds if isinstance(kinds,list) else [kinds])):
        raise ValueError(f'{path}: expected {kinds}')
    if value is None:
        return
    if isinstance(value,dict):
        props = rule.get('properties',{})
        missing = set(rule.get('required',[])) - value.keys()
        if missing:raise ValueError(f'{path}: missing fields {sorted(missing)}')
        if rule.get('additionalProperties') is False and set(value)-props.keys():
            raise ValueError(f'{path}: unknown fields {sorted(set(value)-props.keys())}')
        for k,v in value.items():
            if k in props:_check(v,props[k],defs,path+'.'+k)
    elif isinstance(value,list):
        for i,v in enumerate(value):_check(v,rule.get('items',{}),defs,f'{path}[{i}]')
    elif isinstance(value,str):
        if len(value)<rule.get('minLength',0) or ('pattern' in rule and not re.search(rule['pattern'],value)):
            raise ValueError(f'{path}: invalid string')
    elif type(value) is int and value<rule.get('minimum',value):
        raise ValueError(f'{path}: value below minimum')


def validate_report(report):
    contract = schema()
    _check(report,contract,contract['$defs'])
    def index(items,label):
        out={i['id']:i for i in items}
        if len(out)!=len(items):raise ValueError(f'duplicate {label} id')
        return out
    evidence=index(report['evidence'],'evidence');scenarios=index(report['scenarios'],'scenario')
    flows=index(report['flows'],'flow');commands=index(report['commands'],'command');retests=index(report['retests'],'retest')
    index(report['findings'],'finding')
    def refs(ids,owner):
        if any(i not in evidence for i in ids):raise ValueError(f'{owner}: dangling evidence reference')
    for c in scenarios.values():
        if c['flow_id'] not in flows:raise ValueError('scenario has unknown flow')
        if c['current'] != bool(c['result'] and c['result']['epoch']==report['target']['epoch'] and
                                report['environment'] and c['result']['environment_id']==report['environment']['environment_id']):
            raise ValueError('scenario freshness inconsistent')
        if c['status'] != (c['result']['status'] if c['current'] else 'pending'):
            raise ValueError('stale result cannot count as current')
        if c['result']:
            for a in c['result']['attempts']:
                refs(a['evidence_ids'],c['id'])
                if any(evidence[i]['scenario_id']!=c['id'] for i in a['evidence_ids']):raise ValueError('cross-scenario evidence')
            for a in c['result']['advisories']:refs(a['evidence_ids'],c['id'])
    for f in report['findings']:
        for a in f['attempts']:refs(a['evidence_ids'],f['id'])
        if any(i not in retests for i in f['retest_ids']):raise ValueError('unknown retest reference')
        if f['resolution']=='retested_pass':
            case=scenarios.get(f['scenario_id'])
            linked=[retests[i] for i in f['retest_ids']]
            if not case or not case['current'] or case['status']!='pass' or not linked:
                raise ValueError('retest needs a current successful scenario')
            if case['expected']!=f['expected'] or case['oracle']!=f['oracle']:
                raise ValueError('changed expectations cannot prove the old finding passed')
            if not any(t['finding_id']==f['id'] and t['scenario_id']==f['scenario_id'] and
                       t['previous_commit']==f['tested_commit'] and t['tested_commit']==report['target']['tested_commit'] and
                       t['tested_commit']!=t['previous_commit'] for t in linked):
                raise ValueError('retest must refer to a different submitted revision')
    for c in commands.values():
        if c['evidence_id']:refs([c['evidence_id']],c['id'])
    for t in retests.values():
        refs(t['evidence_ids'],t['id'])
        if not t['evidence_ids'] or any(not evidence[e]['current'] or evidence[e]['scenario_id']!=t['scenario_id'] for e in t['evidence_ids']):
            raise ValueError('retest evidence must be current and scenario-bound')
    if report['environment']:refs(report['environment']['evidence_ids'],'environment')
    for event in report['timeline']:refs(event['evidence_ids'],'timeline')
    if report['checks']['suite_command_id'] and report['checks']['suite_command_id'] not in commands:
        raise ValueError('unknown suite command')
    mapped={p for c in scenarios.values() for p in c['changed_files']}|{e['path'] for e in report['coverage']['exclusions']}
    expected_unmapped=sorted(set(report['coverage']['changed_files'])-mapped)
    if expected_unmapped!=report['coverage']['unmapped_files']:raise ValueError('coverage totals disagree')
    counts=Counter(c['status'] for c in scenarios.values())
    summary=report['summary']
    expected={s:counts[s] for s in STATUSES}
    if summary['total']!=len(scenarios) or summary['status_counts']!=expected:raise ValueError('scenario totals disagree')
    finding_counts=Counter(f['resolution'] for f in report['findings'])
    for k,status in [('open_findings','open'),('retested_findings','retested_pass'),('historical_findings','historical')]:
        if summary[k]!=finding_counts[status]:raise ValueError('finding totals disagree')
    severity=Counter(f['severity'] or 'unspecified' for f in report['findings'])
    if summary['findings_total']!=len(report['findings']) or summary['severity_counts']!={s:severity[s] for s in SEVERITIES}:
        raise ValueError('severity totals disagree')
    for url in [report['target']['url'],(report['environment'] or {}).get('url')]:
        if url and (urlparse(url).scheme not in {'http','https'} or not urlparse(url).netloc):raise ValueError('unsafe URL')
    if summary['verdict']=='READY_WITHIN_SCOPE':
        if not scenarios or any(c['status']!='pass' for c in scenarios.values()) or report['checks']['errors'] or report['checks']['gaps']:
            raise ValueError('ready verdict conflicts with results or gaps')
        suite=commands.get(report['checks']['suite_command_id'])
        if not suite or not suite['current'] or suite['exit_code']!=0 or not suite['workspace_unchanged']:
            raise ValueError('ready verdict requires a current successful suite')
        if not report['environment'] or not report['environment']['current'] or report['coverage']['unmapped_files']:
            raise ValueError('ready verdict conflicts with environment or coverage')
    return report


def build_report(state, check):
    epoch=state['epoch'];env=state['environment'];env_id=env['id'] if env else None
    def fresh(x):return x['epoch']==epoch and x['environment']==env_id
    def result(r):
        if not r:return None
        return {'status':r['status'],'summary':r['summary'],'severity':r['severity'],'attribution':r['attribution'],
                'reason':r['reason'],'recorded_at':r['recorded_at'],'epoch':r['epoch'],'environment_id':r['environment'],
                'code_fingerprint':r['code_fingerprint'],'tested_commit':r['tested_commit'],
                'cause_hypothesis':r['cause_hypothesis'],'recommendation':r['recommendation'],'attempts':[{'index':i,'outcome':a['outcome'],'actual':a['actual'],'evidence_ids':a['evidence']} for i,a in enumerate(r['attempts'],1)],
                'evidence_gaps':r['evidence_gaps'],'advisories':[{'summary':a['summary'],'evidence_ids':a['evidence']} for a in r['advisories']]}
    plan=state['plan']
    current_specs={s['id']:s for s in plan['scenarios']} if plan else {}
    scenarios=[]
    for s in current_specs.values():
        r=state['results'].get(s['id']);is_current=bool(r and fresh(r))
        scenarios.append({k:s[k] for k in ['id','flow_id','title','priority','surfaces','changed_files','preconditions','steps','expected','oracle','required_evidence']})
        scenarios[-1].update({'status':r['status'] if is_current else 'pending','current':is_current,'result':result(r)})
    evidence=[{'id':e['id'],'scenario_id':e['scenario'],'step':e['step'],'kind':e['kind'],'note':e['note'],
               'path':e['path'],'sha256':e['sha256'],'bytes':e['bytes'],'captured_at':e['captured_at'],'epoch':e['epoch'],
               'environment_id':e['environment'],'current':fresh(e)} for e in state['evidence'].values()]
    commands=[{'id':c['id'],'scenario_id':c['scenario'],'phase':c['phase'],'argv':c['argv'],'started_at':c['started_at'],
               'finished_at':c['finished_at'],'exit_code':c['exit_code'],'evidence_id':c['evidence'],'epoch':c['epoch'],
               'environment_id':c['environment'],'code_fingerprint':c['code']['fingerprint'],
               'workspace_unchanged':c['workspace_unchanged'],'current':fresh(c)} for c in state['commands'].values()]
    retests=[]
    # Collapse cumulative updates in one epoch/environment into one finding, keeping its latest failure.
    candidates=[(h['scenario'],h['result']) for h in state['history'] if h.get('scenario') and h.get('result')]
    candidates+=list(state['results'].items())
    groups={}
    for ident,r in candidates:
        if r['status'] in {'fail','flaky','observed'}:groups[(ident,r['epoch'],r['environment'])]=r
    findings=[]
    for (ident,old_epoch,environment),r in groups.items():
        s=r['scenario_snapshot']
        current_result=state['results'].get(ident)
        current_spec=current_specs.get(ident)
        passed_new=bool(current_spec and current_result and fresh(current_result) and current_result['status']=='pass' and
                        r['tested_commit']!=state['code']['head'] and
                        current_spec['expected']==s['expected'] and current_spec['oracle']==s['oracle'])
        f_id='F-'+hashlib.sha256(json.dumps([ident,old_epoch,environment]).encode()).hexdigest()[:12]
        linked=[]
        if passed_new:
            retest_id='T-'+hashlib.sha256((f_id+state['code']['head']).encode()).hexdigest()[:12]
            linked=[retest_id]
            retests.append({'id':retest_id,'finding_id':f_id,'scenario_id':ident,
                'previous_commit':r['tested_commit'],'tested_commit':state['code']['head'],
                'summary':current_result['summary'],'recorded_at':current_result['recorded_at'],
                'evidence_ids':list(dict.fromkeys(e for a in current_result['attempts'] for e in a['evidence']))})
        findings.append({'id':f_id,'scenario_id':ident,'title':s['title'],'severity':r['severity'],
                         'resolution':'retested_pass' if passed_new else 'open' if fresh(r) else 'historical','status':r['status'],
                         'attribution':r['attribution'],'summary':r['summary'],'expected':s['expected'],
                         'oracle':s['oracle'],'preconditions':s['preconditions'],'steps':s['steps'],
                         'attempts':result(r)['attempts'],'epoch':old_epoch,'environment_id':environment,
                         'code_fingerprint':r['code_fingerprint'],'tested_commit':r['tested_commit'],
                         'cause_hypothesis':r['cause_hypothesis'],'recommendation':r['recommendation'],'retest_ids':linked})
    timeline=[]
    for h in state['history']:
        r=h.get('result')
        timeline.append({'at':h['at'],'event':h['reason'],'scenario_id':h.get('scenario'),'epoch':r['epoch'] if r else h.get('epoch'),
                         'summary':r['summary'] if r else h['reason'],'evidence_ids':[eid for a in (r['attempts'] if r else []) for eid in a['evidence']]})
    ctx=state['context'];identity=ctx['identity'];request=ctx['request'];counts=Counter(c['status'] for c in scenarios)
    severity=Counter(f['severity'] or 'unspecified' for f in findings);resolutions=Counter(f['resolution'] for f in findings)
    mapped={p for c in scenarios for p in c['changed_files']}|{e['path'] for e in (plan['exclusions'] if plan else [])}
    rid=hashlib.sha256(json.dumps([identity,state['created_at']],sort_keys=True).encode()).hexdigest()[:12]
    public_env=None if not env else {'browser':env['browser'],'url':env['url'],'identity_proof':env['identity_proof'],
              'dataset':env['dataset'],'capabilities':env['capabilities'],'evidence_ids':env['proof'],'epoch':env['epoch'],
              'environment_id':env['id'],'recorded_at':env['recorded_at'],'current':env['epoch']==epoch}
    report={'schema_version':'2.0.0','metadata':{'report_id':'RPD-'+rid,'title':'Raven PR Dogfood 测试报告',
              'generated_at':datetime.now(timezone.utc).isoformat()},
            'target':{'kind':'pull_request' if identity.get('pr') else 'revision_comparison',
              'repository':identity['repository'] if 'pr' in identity else Path(identity['local_repository']).name,
              'title':request['title'],'description':request['body'],
              'base_ref':request['baseRefName'],
              'head_ref':request['headRefName'],
              'pr_number':identity.get('pr'),'url':identity.get('url'),'base_commit':ctx['base'],'head_commit':ctx['head'],
              'tested_commit':state['code']['head'],'merge_base':ctx['merge_base'],'code_fingerprint':state['code']['fingerprint'],
              'dirty':state['code']['dirty'],'epoch':epoch},
            'summary':{'verdict':check['verdict'],'scope':check['scope'],'total':len(scenarios),
              'status_counts':{s:counts[s] for s in STATUSES},'findings_total':len(findings),'open_findings':resolutions['open'],
              'retested_findings':resolutions['retested_pass'],'historical_findings':resolutions['historical'],
              'severity_counts':{s:severity[s] for s in SEVERITIES}},
            'environment':public_env,'coverage':{'changed_files':ctx['changed_files'],'exclusions':(plan['exclusions'] if plan else []),
              'unmapped_files':sorted(set(ctx['changed_files'])-mapped)},'flows':plan['flows'] if plan else [],'scenarios':scenarios,
            'findings':findings,'retests':retests,'commands':commands,'evidence':evidence,'timeline':timeline,
            'checks':{'errors':check['errors'],'gaps':check['gaps'],'suite_command_id':check['suite']}}
    return validate_report(report)
