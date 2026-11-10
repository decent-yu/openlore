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
    flows=index(report['flows'],'flow');commands=index(report['commands'],'command');repairs=index(report['repairs'],'repair')
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
        if any(i not in repairs for i in f['repair_ids']):raise ValueError('unknown repair reference')
        if f['resolution']=='resolved' and not any(repairs[i]['current'] and repairs[i]['scenario_id']==f['scenario_id'] for i in f['repair_ids']):
            raise ValueError('resolved finding has no current repair')
    for c in commands.values():
        if c['evidence_id']:refs([c['evidence_id']],c['id'])
    for r in repairs.values():
        for k in ['before_command_id','after_command_id']:
            if r[k] and r[k] not in commands:raise ValueError('unknown regression command')
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
    for k,status in [('open_findings','open'),('resolved_findings','resolved'),('historical_findings','historical')]:
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
    epoch=state['epoch'];env=state.get('environment');env_id=(env or {}).get('id')
    def fresh(x):return x.get('epoch')==epoch and x.get('environment')==env_id
    def result(r):
        if not r:return None
        return {'status':r['status'],'summary':r['summary'],'severity':r.get('severity'),'attribution':r.get('attribution','unknown'),
                'reason':r.get('reason'),'recorded_at':r.get('recorded_at'),'epoch':r['epoch'],'environment_id':r.get('environment'),
                'code_fingerprint':r.get('code_fingerprint'),'attempts':[{'index':i,'outcome':a['outcome'],'actual':a['actual'],'evidence_ids':a['evidence']} for i,a in enumerate(r.get('attempts',[]),1)],
                'evidence_gaps':r.get('evidence_gaps',[]),'advisories':[{'summary':a['summary'],'evidence_ids':a['evidence']} for a in r.get('advisories',[])]}
    plan=state.get('plan') or {};current_specs={s['id']:s for s in plan.get('scenarios',[])}
    specs=dict(current_specs)
    for h in state['history']:
        if h.get('plan'):specs.update({s['id']:s for s in h['plan']['scenarios']})
    specs.update(current_specs)
    scenarios=[]
    for s in plan.get('scenarios',[]):
        r=state['results'].get(s['id']);is_current=bool(r and fresh(r))
        scenarios.append({k:s.get(k,[]) if k=='preconditions' else s[k] for k in ['id','flow_id','title','priority','surfaces','changed_files','preconditions','steps','expected','oracle','required_evidence']})
        scenarios[-1].update({'status':r['status'] if is_current else 'pending','current':is_current,'result':result(r)})
    evidence=[{'id':e['id'],'scenario_id':e.get('scenario'),'step':e.get('step'),'kind':e['kind'],'note':e['note'],
               'path':e['path'],'sha256':e['sha256'],'bytes':e['bytes'],'captured_at':e['captured_at'],'epoch':e['epoch'],
               'environment_id':e.get('environment'),'current':fresh(e)} for e in state['evidence'].values()]
    commands=[{'id':c['id'],'scenario_id':c['scenario'],'phase':c['phase'],'argv':c['argv'],'started_at':c['started_at'],
               'finished_at':c.get('finished_at'),'exit_code':c['exit_code'],'evidence_id':c.get('evidence'),'epoch':c['epoch'],
               'environment_id':c.get('environment'),'code_fingerprint':c['code']['fingerprint'],
               'workspace_unchanged':c.get('workspace_unchanged'),'current':fresh(c)} for c in state['commands'].values()]
    repairs=[{'id':r['id'],'scenario_id':r['scenario'],'summary':r['summary'],'root_cause':r['root_cause'],'files':r['files'],
              'before_command_id':r.get('before'),'after_command_id':r.get('after'),'visual_reason':r.get('visual_reason'),
              'epoch':r['epoch'],'environment_id':r.get('environment'),'recorded_at':r['recorded_at'],'current':fresh(r)} for r in state['repairs']]
    # Collapse cumulative updates in one epoch/environment into one finding, keeping its latest failure.
    candidates=[(h['scenario'],h['result']) for h in state['history'] if h.get('scenario') and h.get('result')]
    candidates+=list(state['results'].items())
    groups={}
    for ident,r in candidates:
        if r['status'] in {'fail','flaky','observed'}:groups[(ident,r['epoch'],r.get('environment'))]=r
    findings=[]
    for (ident,old_epoch,environment),r in groups.items():
        s=r.get('scenario_snapshot') or specs.get(ident,{})
        linked=[p['id'] for p in repairs if p['scenario_id']==ident and p['current']]
        current_result=state['results'].get(ident)
        resolved=bool(linked and current_result and fresh(current_result) and current_result['status']=='pass')
        f_id='F-'+hashlib.sha256(json.dumps([ident,old_epoch,environment]).encode()).hexdigest()[:12]
        findings.append({'id':f_id,'scenario_id':ident,'title':s.get('title',ident),'severity':r.get('severity'),
                         'resolution':'resolved' if resolved else 'open' if fresh(r) else 'historical','status':r['status'],
                         'attribution':r.get('attribution','unknown'),'summary':r['summary'],'expected':s.get('expected',''),
                         'oracle':s.get('oracle',''),'preconditions':s.get('preconditions',[]),'steps':s.get('steps',[]),
                         'attempts':result(r)['attempts'],'epoch':old_epoch,'environment_id':environment,
                         'code_fingerprint':r.get('code_fingerprint'),'repair_ids':linked if resolved else []})
    timeline=[]
    for h in state['history']:
        r=h.get('result')
        timeline.append({'at':h['at'],'event':h['reason'],'scenario_id':h.get('scenario'),'epoch':r.get('epoch') if r else h.get('epoch'),
                         'summary':r['summary'] if r else h['reason'],'evidence_ids':[eid for a in (r or {}).get('attempts',[]) for eid in a['evidence']]})
    ctx=state['context'];identity=ctx['identity'];counts=Counter(c['status'] for c in scenarios)
    severity=Counter(f['severity'] or 'unspecified' for f in findings);resolutions=Counter(f['resolution'] for f in findings)
    mapped={p for c in scenarios for p in c['changed_files']}|{e['path'] for e in plan.get('exclusions',[])}
    rid=hashlib.sha256(json.dumps([identity,state['created_at']],sort_keys=True).encode()).hexdigest()[:12]
    public_env=None if not env else {'browser':env['browser'],'url':env.get('url'),'identity_proof':env['identity_proof'],
              'dataset':env['dataset'],'capabilities':env['capabilities'],'evidence_ids':env['proof'],'epoch':env['epoch'],
              'environment_id':env['id'],'recorded_at':env['recorded_at'],'current':env['epoch']==epoch}
    report={'schema_version':'1.0.0','metadata':{'report_id':'RPD-'+rid,'title':'Raven PR Dogfood 测试报告',
              'generated_at':datetime.now(timezone.utc).isoformat(),'mode':state['mode']},
            'target':{'kind':'pull_request' if identity.get('pr') else 'revision_comparison',
              'repository':identity.get('repository') or Path(identity.get('local_repository','local')).name,
              'title':ctx.get('request',{}).get('title'),'description':ctx.get('request',{}).get('body'),
              'base_ref':ctx.get('request',{}).get('baseRefName') or identity.get('base_ref'),
              'head_ref':ctx.get('request',{}).get('headRefName') or identity.get('head_ref'),
              'pr_number':identity.get('pr'),'url':identity.get('url'),'base_commit':ctx['base'],'head_commit':ctx['head'],
              'tested_commit':state['code']['head'],'merge_base':ctx['merge_base'],'code_fingerprint':state['code']['fingerprint'],
              'dirty':state['code']['dirty'],'epoch':epoch},
            'summary':{'verdict':check['verdict'],'scope':check['scope'],'total':len(scenarios),
              'status_counts':{s:counts[s] for s in STATUSES},'findings_total':len(findings),'open_findings':resolutions['open'],
              'resolved_findings':resolutions['resolved'],'historical_findings':resolutions['historical'],
              'severity_counts':{s:severity[s] for s in SEVERITIES}},
            'environment':public_env,'coverage':{'changed_files':ctx['changed_files'],'exclusions':plan.get('exclusions',[]),
              'unmapped_files':sorted(set(ctx['changed_files'])-mapped)},'flows':plan.get('flows',[]),'scenarios':scenarios,
            'findings':findings,'repairs':repairs,'commands':commands,'evidence':evidence,'timeline':timeline,
            'checks':{'errors':check['errors'],'gaps':check['gaps'],'suite_command_id':check['suite']}}
    return validate_report(report)
