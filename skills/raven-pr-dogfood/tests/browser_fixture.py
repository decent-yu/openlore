#!/usr/bin/env python3
"""Disposable local order app for manual browser validation; no external services."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import pr_workspace
import qa_run

APP = '''import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
orders = []
def create_order(key):
    if not any(o['key'] == key for o in orders):
        orders.append({'id': len(orders) + 1, 'key': key})
PAGE = """<!doctype html><html lang="zh"><meta charset="utf-8"><title>订单测试应用</title>
<body style="font:20px system-ui;max-width:720px;margin:70px auto"><h1>订单提交验证</h1>
<p>测试要求：同一购物车连续提交两次，只产生一张订单。</p>
<button onclick="submitOrder()">提交订单</button> <button onclick="resetData()">重置测试数据</button>
<p id="result" role="status">订单数量：0</p><script>
async function submitOrder() {const r=await fetch('/orders',{method:'POST',body:JSON.stringify({key:'cart-1'})}); const d=await r.json(); document.querySelector('#result').textContent='订单数量：'+d.length;}
async function resetData() {await fetch('/reset',{method:'POST'}); document.querySelector('#result').textContent='订单数量：0';}
</script></body></html>"""
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8' if self.path=='/' else 'application/json');self.end_headers()
        self.wfile.write(PAGE.encode() if self.path=='/' else json.dumps(orders).encode())
    def do_POST(self):
        if self.path=='/reset': orders.clear()
        elif self.path=='/orders':
            data=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
            create_order(data['key'])
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(orders).encode())
'''
CHECK = '''import json,urllib.request,os
url=os.environ['QA_FIXTURE_URL']
def post(path,payload):
 return json.load(urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps(payload).encode(),method='POST')))
post('/reset',{})
post('/orders',{'key':'regression-cart'})
result=post('/orders',{'key':'regression-cart'})
assert len(result)==1, f'expected one order, got {len(result)}'
print('PASS: duplicate submission creates exactly one order')
'''


def setup(root):
    root = Path(root).absolute()
    root.mkdir(parents=True, exist_ok=False)
    repo = root / 'source'; repo.mkdir()
    def git(*a):subprocess.run(['git','-C',str(repo),*a],check=True,capture_output=True)
    git('init','-q','-b','release');git('config','user.name','QA Fixture');git('config','user.email','qa@example.invalid')
    (repo/'app.py').write_text(APP)
    (repo/'regression.py').write_text(CHECK)
    (repo/'.gitignore').write_text('__pycache__/\n')
    git('add','.');git('commit','-qm','working base');git('switch','-qc','feature')
    broken=APP.replace("    if not any(o['key'] == key for o in orders):\n        orders.append", '    if True:\n        orders.append')
    (repo/'app.py').write_text(broken);git('commit','-qam','seed duplicate-order regression')
    ctx=pr_workspace.prepare(repo,root/'worktree','release','feature')
    qa_run.save(root/'context.json',ctx)
    qa_run.init_run(root/'context.json',root/'run','repair')
    plan={'flows':[{'id':'F1','title':'重复提交购物车','steps':['打开结算','重复提交同一购物车','核对订单数'],'expected_end':'一张订单'}],
          'scenarios':[{'id':'S1','flow_id':'F1','title':'提交幂等','priority':'critical','changed_files':['app.py'],
                        'steps':['连续两次提交同一购物车并查看订单数'],'expected':'订单数量为1','oracle':'fixture要求：同一购物车只产生一张订单',
                        'surfaces':['browser','api'],'required_evidence':['screenshot','video','log']}], 'exclusions':[]}
    with qa_run.ledger(root/'run') as (r,s):qa_run.set_plan(r,s,plan)
    print(json.dumps({'root':str(root),'run':str(root/'run'),'workspace':ctx['workspace']}))


def serve(root,port):
    path=Path(root)/'worktree/app.py'
    spec=importlib.util.spec_from_file_location('order_fixture',path); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    server=module.ThreadingHTTPServer(('127.0.0.1',port),module.Handler)
    print(json.dumps({'url':f'http://127.0.0.1:{server.server_port}','workspace':str(path.parent),'code':pr_workspace.snapshot(path.parent)}),flush=True)
    try:server.serve_forever()
    finally:server.server_close()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['setup','serve']);p.add_argument('--root',required=True);p.add_argument('--port',type=int,default=0);a=p.parse_args()
    setup(a.root) if a.action=='setup' else serve(a.root,a.port)
