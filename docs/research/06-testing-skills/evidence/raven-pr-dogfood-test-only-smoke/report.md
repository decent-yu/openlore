# Raven PR Dogfood 测试报告

结论：**NOT_READY**（仅限声明范围）

报告：RPD-f7a1938c1e95 · JSON 2.0.0
目标：source · 本地 base/head 比较
代码：`3c2536dd1414f8a3c97c26eedaeb46d702c00e46` · 指纹：`0e8856185523a83bd735d7b7a574e04e66d03f4049b7d7d3b52893c97fd702ad` · 轮次：2
比较：`bb279abb37f95232b9108a022638d5c1cbadf811` → `3c2536dd1414f8a3c97c26eedaeb46d702c00e46`；范围：declared PR test scope only
场景：3 · 当前通过：2 · 发现：1 · 待处理问题：1

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
| S2 同一购物车重复提交保持幂等 | critical | fail | 订单数量为1 | 同一购物车重复提交产生重复订单，独立复现两次 |
| S3 不同购物车分别创建订单 | high | pass | 两张订单分别属于两个购物车 | 不同购物车分别保存，接口检查通过 |

### S1 · 正常提交创建一张订单

前提：本轮独立内存测试数据，每次尝试先重置，无外部服务

操作步骤：

1. 重置测试数据后提交一次，检查页面与保存结果

预期：订单数量为1
依据：测试夹具验收条件及release版本已接受行为：同购物车幂等，不同购物车独立

实际：正常提交一张订单，页面和接口均通过

尝试 1 · pass：订单数量为1

- [证据 E-9a9676b62da2](artifacts/E-9a9676b62da2.png) · 正常提交一次后实际页面显示一张订单
- [证据 E-ef49b03d24dc](artifacts/E-ef49b03d24dc.log) · command C-83c8a85b64c8, exit 0


### S2 · 同一购物车重复提交保持幂等

前提：本轮独立内存测试数据，每次尝试先重置，无外部服务

操作步骤：

1. 重置后连续两次提交同一购物车，检查页面和保存结果

预期：订单数量为1
依据：测试夹具验收条件及release版本已接受行为：同购物车幂等，不同购物车独立

实际：同一购物车重复提交产生重复订单，独立复现两次

尝试 1 · fail：重复提交后页面显示订单数量2，接口断言同样失败

- [证据 E-3c30a9140dda](artifacts/E-3c30a9140dda.png) · 第1次浏览器复现：同一购物车提交两次产生两张订单
- [证据 E-0f347cdb84fe](artifacts/E-0f347cdb84fe.webm) · 第1次独立重置后重复提交全过程
- [证据 E-a79f0ee30de4](artifacts/E-a79f0ee30de4.log) · command C-d4f01a4f82d6, exit 1

尝试 2 · fail：重复提交后页面显示订单数量2，接口断言同样失败

- [证据 E-ba51a1dd79a0](artifacts/E-ba51a1dd79a0.png) · 第2次浏览器复现：同一购物车提交两次产生两张订单
- [证据 E-02d348d74cf1](artifacts/E-02d348d74cf1.webm) · 第2次独立重置后重复提交全过程
- [证据 E-637199c9552a](artifacts/E-637199c9552a.log) · command C-fd07a8fae9cd, exit 1


### S3 · 不同购物车分别创建订单

前提：本轮独立内存测试数据，每次尝试先重置，无外部服务

操作步骤：

1. 使用两个不同购物车标识各提交一次，读取订单结果

预期：两张订单分别属于两个购物车
依据：测试夹具验收条件及release版本已接受行为：同购物车幂等，不同购物车独立

实际：不同购物车分别保存，接口检查通过

尝试 1 · pass：不同key各保存一张订单，总数2

- [证据 E-112f61622b27](artifacts/E-112f61622b27.log) · command C-3abb5800b564, exit 0


## 问题与复测

### S2 · 同一购物车重复提交保持幂等

状态：open · 严重度：high · 归属：introduced
同一购物车重复提交产生重复订单，独立复现两次

尝试 1：重复提交后页面显示订单数量2，接口断言同样失败
- [原始证据 E-3c30a9140dda](artifacts/E-3c30a9140dda.png) · 第1次浏览器复现：同一购物车提交两次产生两张订单
- [原始证据 E-0f347cdb84fe](artifacts/E-0f347cdb84fe.webm) · 第1次独立重置后重复提交全过程
- [原始证据 E-a79f0ee30de4](artifacts/E-a79f0ee30de4.log) · command C-d4f01a4f82d6, exit 1

尝试 2：重复提交后页面显示订单数量2，接口断言同样失败
- [原始证据 E-ba51a1dd79a0](artifacts/E-ba51a1dd79a0.png) · 第2次浏览器复现：同一购物车提交两次产生两张订单
- [原始证据 E-02d348d74cf1](artifacts/E-02d348d74cf1.webm) · 第2次独立重置后重复提交全过程
- [原始证据 E-637199c9552a](artifacts/E-637199c9552a.log) · command C-fd07a8fae9cd, exit 1

- 排查线索（待验证）：请求处理路径可能缺少购物车标识的幂等检查，需要作者进一步确认
- 处理建议：建议作者检查重复请求处理并提交新版本，再针对相同预期复测；本次只记录问题
## 执行记录

| ID | 场景 | 阶段 | 命令 | 退出码 | 日志 |
| --- | --- | --- | --- | --- | --- |
| C-83c8a85b64c8 | S1 | check | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B -c import urllib.request,json,os<br>url=os.environ\['QA\_FIXTURE\_URL'\]<br>def post(path,key):<br> return json.load(urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps({'key':key}).encode(),method='POST')))<br>post('/reset','')<br>result=post('/orders','single-cart'); assert len(result)==1; print('PASS: one submission creates one order') | 0 | [日志](artifacts/E-ef49b03d24dc.log) |
| C-d4f01a4f82d6 | S2 | check | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B regression.py | 1 | [日志](artifacts/E-a79f0ee30de4.log) |
| C-fd07a8fae9cd | S2 | check | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B regression.py | 1 | [日志](artifacts/E-637199c9552a.log) |
| C-3abb5800b564 | S3 | check | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B -c import urllib.request,json,os<br>url=os.environ\['QA\_FIXTURE\_URL'\]<br>def post(path,key):<br> return json.load(urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps({'key':key}).encode(),method='POST')))<br>post('/reset','')<br>post('/orders','first-cart'); result=post('/orders','second-cart'); assert len(result)==2 and {o\['key'\] for o in result}=={'first-cart','second-cart'}; print('PASS: distinct carts stay independent') | 0 | [日志](artifacts/E-112f61622b27.log) |
| C-1d01e3061e00 | - | suite | /Users/decent/.pyenv/versions/3.14.1/bin/python3 -B -c import urllib.request,json,os<br>url=os.environ\['QA\_FIXTURE\_URL'\]<br>def post(path,key):<br> return json.load(urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps({'key':key}).encode(),method='POST')))<br>post('/reset','')<br>result=post('/orders','single-cart'); assert len(result)==1; print('PASS: one submission creates one order')<br>import urllib.request,json,os<br>url=os.environ\['QA\_FIXTURE\_URL'\]<br>def post(path,key):<br> return json.load(urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps({'key':key}).encode(),method='POST')))<br>post('/reset','')<br>post('/orders','first-cart'); result=post('/orders','second-cart'); assert len(result)==2 and {o\['key'\] for o in result}=={'first-cart','second-cart'}; print('PASS: distinct carts stay independent')<br>import subprocess,sys; subprocess.run(\[sys.executable,"-B","regression.py"\],check=True) | 1 | [日志](artifacts/E-800997fbc3fd.log) |

## 覆盖与未验证项

- automated suite C-1d01e3061e00 failed (exit 1)

## 被测环境

- 浏览器：native；URL：http://127.0.0.1:38764
- 服务身份：从context指定的隔离工作区启动，本轮只执行测试，不修改被测代码
- 测试数据与替身：临时内存订单和合成购物车，每次尝试重置，无外部系统
- [证据 E-1fbae24573d6](artifacts/E-1fbae24573d6.log) · 从固定提交启动的实际服务，日志包含提交和代码指纹

## 历史发现与恢复

- plan replaced · plan replaced

本报告由 report.json 生成。记录校验不能代替需求与范围判断；通过仅限声明范围，不构成上线或合并授权。
