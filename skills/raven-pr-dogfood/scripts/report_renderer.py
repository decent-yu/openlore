#!/usr/bin/env python3
"""Render a standardized report.json to offline HTML and Markdown, without run state or Git."""
import argparse
import html
import json
import os
from pathlib import Path
import tempfile
import sys

from report_model import validate_report, schema

TEMPLATE = Path(__file__).resolve().parents[1] / 'assets/report.html'


def write(path, content):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix='.report-',dir=path.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f:f.write(content)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)


def md(value):
    escaped = html.escape(str(value), quote=False).replace('\\', '\\\\')
    for char in '[]`*_':
        escaped = escaped.replace(char, '\\' + char)
    return escaped.replace('|', '\\|').replace('\n', '<br>')


def markdown(data):
    validate_report(data)
    target=data['target'];summary=data['summary'];evidence={e['id']:e for e in data['evidence']}
    def links(ids,label='证据'):
        return [f"- [{label} {i}]({evidence[i]['path']}) · {md(evidence[i]['note'])}" for i in ids]
    lines=['# '+md(data['metadata']['title']),'',f"结论：**{summary['verdict']}**（仅限声明范围）",'',
           f"报告：{data['metadata']['report_id']} · JSON {data['schema_version']}",
           f"目标：{md(target['repository'])} · {md(target['url'] or '本地 base/head 比较')}",
           f"代码：`{target['tested_commit']}` · 指纹：`{target['code_fingerprint']}` · 轮次：{target['epoch']}",
           f"比较：`{target['base_commit']}` → `{target['head_commit']}`；范围：{md(summary['scope'])}",
           f"场景：{summary['total']} · 当前通过：{summary['status_counts']['pass']} · 发现：{summary['findings_total']} · 待处理问题：{summary['open_findings']}",
           '', '## 用户旅程','']
    for flow in data['flows']:
        lines += ['### '+md(flow['id']+' · '+flow['title']),'',*[f'{i}. {md(s)}' for i,s in enumerate(flow['steps'],1)],'', '终态：'+md(flow['expected_end']),'']
    lines+=['## 测试结果','','| 场景 | 优先级 | 状态 | 预期 | 实际 |','| --- | --- | --- | --- | --- |']
    for case in data['scenarios']:
        r=case['result']
        lines.append(f"| {md(case['id']+' '+case['title'])} | {case['priority']} | {case['status']} | {md(case['expected'])} | {md(r['summary'] if r and case['current'] else '尚未验证或结果已过期')} |")
    for case in data['scenarios']:
        lines+=['','### '+md(case['id']+' · '+case['title']),'','前提：'+md('；'.join(case['preconditions'])),'','操作步骤：','']
        lines += [f'{i}. {md(step)}' for i,step in enumerate(case['steps'],1)]
        lines += ['','预期：'+md(case['expected']),'依据：'+md(case['oracle']),'']
        if case['result']:
            r=case['result']
            lines+=['实际：'+md(r['summary']),'']
            if r['reason']:lines+=['原因：'+md(r['reason']),'']
            for a in r['attempts']:
                lines += [f"尝试 {a['index']} · {a['outcome']}：{md(a['actual'])}",'',*links(a['evidence_ids']),'']
            for g in r['evidence_gaps']:lines.append('- 证据缺口：'+md(g['kind']+' · '+g['reason']))
            for a in r['advisories']:lines+=['- 改进建议（不计功能失败）：'+md(a['summary']),*links(a['evidence_ids'])]
    lines+=['','## 问题与复测','']
    for f in data['findings']:
        lines+=['### '+md(f['scenario_id']+' · '+f['title']),'',f"状态：{f['resolution']} · 严重度：{f['severity'] or '未分级'} · 归属：{f['attribution']}",md(f['summary']),'']
        for a in f['attempts']:lines += [f"尝试 {a['index']}：{md(a['actual'])}",*links(a['evidence_ids'],'原始证据'),'']
        if f['cause_hypothesis']:lines.append('- 排查线索（待验证）：'+md(f['cause_hypothesis']))
        if f['recommendation']:lines.append('- 处理建议：'+md(f['recommendation']))
    for r in data['retests']:
        lines += [f"- {r['scenario_id']} 新版复测：{md(r['summary'])}",
                  f"- 版本：`{r['previous_commit']}` → `{r['tested_commit']}`",*links(r['evidence_ids'],'复测证据'),'']
    lines+=['## 执行记录','','| ID | 场景 | 阶段 | 命令 | 退出码 | 日志 |','| --- | --- | --- | --- | --- | --- |']
    for c in data['commands']:
        link=f"[日志]({evidence[c['evidence_id']]['path']})" if c['evidence_id'] else '未完成'
        lines.append(f"| {c['id']} | {c['scenario_id'] or '-'} | {c['phase']} | {md(' '.join(c['argv']))} | {c['exit_code']} | {link} |")
    lines+=['','## 覆盖与未验证项','']
    lines += ['- '+md(x) for x in data['checks']['errors']+data['checks']['gaps']]
    lines += [f"- 排除 {md(e['path'])}：{md(e['reason'])}" for e in data['coverage']['exclusions']]
    lines += ['- 未关联测试：'+md(p) for p in data['coverage']['unmapped_files']]
    if data['environment']:
        env=data['environment'];lines+=['','## 被测环境','',f"- 浏览器：{env['browser']}；URL：{md(env['url'] or '无')}",
            '- 服务身份：'+md(env['identity_proof']),'- 测试数据与替身：'+md(env['dataset']),*links(env['evidence_ids']),'']
    lines+=['## 历史发现与恢复','']
    for event in data['timeline']:lines+=['- '+md(event['event']+' · '+event['summary']),*links(event['evidence_ids'],'原始证据')]
    lines+=['','本报告由 report.json 生成。记录校验不能代替需求与范围判断；通过仅限声明范围，不构成上线或合并授权。','']
    return '\n'.join(lines)


def html_report(data):
    validate_report(data)
    # JSON in a script data block must not be able to close that block.
    payload=json.dumps(data,ensure_ascii=False).replace('&','\\u0026').replace('<','\\u003c').replace('>','\\u003e').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
    return TEMPLATE.read_text().replace('__RAVEN_REPORT_JSON__',payload,1)


def write_views(data, root):
    root=Path(root)
    write(root/'report.html',html_report(data))
    write(root/'report.md',markdown(data))
    write(root/'report.schema.json',json.dumps(schema(),ensure_ascii=False,indent=2)+'\n')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--markdown')
    a=p.parse_args()
    try:
        source=Path(a.input).resolve();output=Path(a.output).resolve()
        if output==source or (a.markdown and Path(a.markdown).resolve() in {source,output}):raise ValueError('input and output paths must differ')
        data=validate_report(json.loads(source.read_text()))
        write(output,html_report(data))
        if a.markdown:write(a.markdown,markdown(data))
        print(json.dumps({'html':str(output),'report_id':data['metadata']['report_id'],'verdict':data['summary']['verdict']}));return 0
    except (ValueError,OSError) as e:
        print(json.dumps({'error':str(e)},ensure_ascii=False),file=sys.stderr);return 2


if __name__=='__main__':sys.exit(main())
