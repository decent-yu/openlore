# 推送与 Git 沉淀

将处理完成的知识简报多渠道推送分发，并自动归档为 Markdown 文件提交沉淀至 Git 仓库。

以[采集组](01-source-configuration.md)为交付单位：使用该组的 Git 仓库地址和归档路径写入 Markdown，使用该组的 Webhook 推送简报。各组分别记录同步结果，重试一个组不重复发送其他组已完成的内容。
