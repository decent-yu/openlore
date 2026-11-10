# Raven PR Dogfood 测试报告

结论：**READY_WITHIN_SCOPE**（仅限声明范围）

报告：RPD-0faacd612791 · JSON 1.0.0
目标：source · 本地 base/head 比较
代码：`26e23c2584ce5cc8f9bd8f4e5af3f1dbcb504690` · 指纹：`e1d7c58237cb8f9a5c63d5bb585e8fbf52a2adf9f7138ab13f5ebb91a1d6a0b6` · 轮次：3
比较：`06e8644d61089619696fa0d5af31dfffb587909c` → `26e23c2584ce5cc8f9bd8f4e5af3f1dbcb504690`；范围：declared PR test scope only
场景：3 · 当前通过：3 · 发现：1 · 已修复：1

## 用户旅程

### F1 · 订单提交与重复请求处理

1. 打开订单测试页
2. 提交一个或多个购物车请求
3. 检查订单数量与购物车归属

终态：正常提交成功，同购物车不重复，不同购物车不合并

## 测试结果

| 场景 | 优先级 | 状态 | 预期 | 实际 |
| --- | --- | --- | --- | --- |
| S1 正常提交创建一张订单 | high | pass | 订单数量为1 | 正常提交一张订单，页面和接口均通过 |
| S2 同一购物车重复提交保持幂等 | critical | pass | 订单数量为1 | 修复后重复提交保持一张订单 |
| S3 不同购物车分别创建订单 | high | pass | 两张订单分别属于两个购物车 | 不同购物车创建两张独立订单，接口断言通过 |

### S1 · 正常提交创建一张订单

前提：本轮独立内存测试数据，每次尝试先重置，无外部服务

操作步骤：

1. 重置测试数据后提交一次，检查页面与保存结果

预期：订单数量为1
依据：测试夹具验收条件及release版本已接受行为：同购物车幂等，不同购物车独立

实际：正常提交一张订单，页面和接口均通过

尝试 1 · pass：一次提交后订单数量为1

- [证据 E-dc9c0ddccfe4](artifacts/E-dc9c0ddccfe4.png) · 实际浏览器一次提交后页面订单数量为1
- [证据 E-0daa5b75a0ae](artifacts/E-0daa5b75a0ae.log) · command C-acdcdba6c431, exit 0


### S2 · 同一购物车重复提交保持幂等

前提：本轮独立内存测试数据，每次尝试先重置，无外部服务

操作步骤：

1. 重置后连续两次提交同一购物车，检查页面和保存结果

预期：订单数量为1
依据：测试夹具验收条件及release版本已接受行为：同购物车幂等，不同购物车独立

实际：修复后重复提交保持一张订单

尝试 1 · pass：重置后两次提交，实际订单数量为1，符合幂等要求

- [证据 E-5c3880ff3e97](artifacts/E-5c3880ff3e97.png) · 重复提交页面显示订单数量1
- [证据 E-abc09358f879](artifacts/E-abc09358f879.webm) · 实际浏览器重复提交与查看结果全过程
- [证据 E-401cbefe5404](artifacts/E-401cbefe5404.log) · command C-9ecf970089b2, exit 0


### S3 · 不同购物车分别创建订单

前提：本轮独立内存测试数据，每次尝试先重置，无外部服务

操作步骤：

1. 使用两个不同购物车标识各提交一次，读取订单结果

预期：两张订单分别属于两个购物车
依据：测试夹具验收条件及release版本已接受行为：同购物车幂等，不同购物车独立

实际：不同购物车创建两张独立订单，接口断言通过

尝试 1 · pass：两个不同key分别保存，订单数量为2

- [证据 E-484010874ab3](artifacts/E-484010874ab3.log) · command C-974bb23789e3, exit 0


## 问题与修复

### S2 · 同一购物车重复提交保持幂等

状态：resolved · 严重度：high · 归属：introduced
重复请求产生重复订单

尝试 1：重置后两次提交，实际订单数量为2，违反幂等要求
- [原始证据 E-40d2b8b19881](artifacts/E-40d2b8b19881.png) · 重复提交页面显示订单数量2
- [原始证据 E-5dcda21ac27c](artifacts/E-5dcda21ac27c.webm) · 实际浏览器重复提交与查看结果全过程
- [原始证据 E-e2975b4a3b63](artifacts/E-e2975b4a3b63.log) · command C-0a91183be31b, exit 1

尝试 2：重置后两次提交，实际订单数量为2，违反幂等要求
- [原始证据 E-7aceca3d1473](artifacts/E-7aceca3d1473.png) · 重复提交页面显示订单数量2
- [原始证据 E-b33aae4ba8c5](artifacts/E-b33aae4ba8c5.webm) · 实际浏览器重复提交与查看结果全过程
- [原始证据 E-19dee5e790c5](artifacts/E-19dee5e790c5.log) · command C-9a3355b1871d, exit 1

- S2：恢复购物车标识幂等检查
- 根因：PR移除了重复购物车检测，重复请求分别追加订单
- 文件：app.py
- 回归：C-0a91183be31b → C-9ecf970089b2；视觉例外：无

## 执行记录

| ID | 场景 | 阶段 | 命令 | 退出码 | 日志 |
| --- | --- | --- | --- | --- | --- |
| C-9ae8707cc216 | S1 | check | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B -c import urllib.request,json,os<br>url=os.environ\['QA\_FIXTURE\_URL'\]<br>def post(path,key):<br> return json.load(urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps({'key':key}).encode(),method='POST')))<br>post('/reset','')<br>result=post('/orders','single-cart'); assert len(result)==1; print('PASS: one submission creates one order') | 0 | [日志](artifacts/E-60c9b30b2b41.log) |
| C-0a91183be31b | S2 | before | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B regression.py | 1 | [日志](artifacts/E-e2975b4a3b63.log) |
| C-9a3355b1871d | S2 | check | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B regression.py | 1 | [日志](artifacts/E-19dee5e790c5.log) |
| C-e764c4c91b9b | S3 | check | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B -c import urllib.request,json,os<br>url=os.environ\['QA\_FIXTURE\_URL'\]<br>def post(path,key):<br> return json.load(urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps({'key':key}).encode(),method='POST')))<br>post('/reset','')<br>post('/orders','first-cart'); result=post('/orders','second-cart'); assert len(result)==2 and {o\['key'\] for o in result}=={'first-cart','second-cart'}; print('PASS: distinct carts stay independent') | 0 | [日志](artifacts/E-69fd3915445b.log) |
| C-acdcdba6c431 | S1 | check | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B -c import urllib.request,json,os<br>url=os.environ\['QA\_FIXTURE\_URL'\]<br>def post(path,key):<br> return json.load(urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps({'key':key}).encode(),method='POST')))<br>post('/reset','')<br>result=post('/orders','single-cart'); assert len(result)==1; print('PASS: one submission creates one order') | 0 | [日志](artifacts/E-0daa5b75a0ae.log) |
| C-9ecf970089b2 | S2 | after | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B regression.py | 0 | [日志](artifacts/E-401cbefe5404.log) |
| C-974bb23789e3 | S3 | check | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B -c import urllib.request,json,os<br>url=os.environ\['QA\_FIXTURE\_URL'\]<br>def post(path,key):<br> return json.load(urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps({'key':key}).encode(),method='POST')))<br>post('/reset','')<br>post('/orders','first-cart'); result=post('/orders','second-cart'); assert len(result)==2 and {o\['key'\] for o in result}=={'first-cart','second-cart'}; print('PASS: distinct carts stay independent') | 0 | [日志](artifacts/E-484010874ab3.log) |
| C-23a2aeec6ae2 | - | suite | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B -c import urllib.request,json,os<br>url=os.environ\['QA\_FIXTURE\_URL'\]<br>def post(path,key):<br> return json.load(urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps({'key':key}).encode(),method='POST')))<br>post('/reset','')<br>result=post('/orders','single-cart'); assert len(result)==1; print('PASS: one submission creates one order')<br>import urllib.request,json,os<br>url=os.environ\['QA\_FIXTURE\_URL'\]<br>def post(path,key):<br> return json.load(urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps({'key':key}).encode(),method='POST')))<br>post('/reset','')<br>post('/orders','first-cart'); result=post('/orders','second-cart'); assert len(result)==2 and {o\['key'\] for o in result}=={'first-cart','second-cart'}; print('PASS: distinct carts stay independent')<br>import subprocess,sys; subprocess.run(\[sys.executable,"-B","regression.py"\],check=True) | 0 | [日志](artifacts/E-05a67ee27bcd.log) |

## 覆盖与未验证项


## 被测环境

- 浏览器：native；URL：http://127.0.0.1:38762
- 服务身份：本轮隔离工作区启动的本地服务，启动日志记录代码指纹；独立无头Chrome执行浏览器操作
- 测试数据与替身：每个尝试重置临时内存订单，仅使用本地合成购物车，没有外部系统
- [证据 E-f09d90a44e8e](artifacts/E-f09d90a44e8e.log) · 实际服务启动日志，包含隔离工作区、提交与指纹

## 历史发现与恢复

- plan replaced · plan replaced
- code refreshed; all results need revalidation · code refreshed; all results need revalidation
- environment replaced · environment replaced
- scenario retested · 正常提交一张订单，页面和接口均通过
- [原始证据 E-b35f722afe09](artifacts/E-b35f722afe09.png) · 实际浏览器一次提交后页面订单数量为1
- [原始证据 E-60c9b30b2b41](artifacts/E-60c9b30b2b41.log) · command C-9ae8707cc216, exit 0
- scenario retested · 不同购物车创建两张独立订单，接口断言通过
- [原始证据 E-69fd3915445b](artifacts/E-69fd3915445b.log) · command C-e764c4c91b9b, exit 0
- scenario retested · 重复请求产生重复订单
- [原始证据 E-40d2b8b19881](artifacts/E-40d2b8b19881.png) · 重复提交页面显示订单数量2
- [原始证据 E-5dcda21ac27c](artifacts/E-5dcda21ac27c.webm) · 实际浏览器重复提交与查看结果全过程
- [原始证据 E-e2975b4a3b63](artifacts/E-e2975b4a3b63.log) · command C-0a91183be31b, exit 1
- [原始证据 E-7aceca3d1473](artifacts/E-7aceca3d1473.png) · 重复提交页面显示订单数量2
- [原始证据 E-b33aae4ba8c5](artifacts/E-b33aae4ba8c5.webm) · 实际浏览器重复提交与查看结果全过程
- [原始证据 E-19dee5e790c5](artifacts/E-19dee5e790c5.log) · command C-9a3355b1871d, exit 1

本报告由 report.json 生成。记录校验不能代替需求与范围判断；通过仅限声明范围，不构成上线或合并授权。
