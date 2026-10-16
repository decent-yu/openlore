import React from 'react';
import type { ExecutorConfig } from '@openlore/contracts';
import { Input } from '../../components/ui/input.js';

export function ExecutorFields({
  value,
  provider,
  onChange,
}: {
  value: ExecutorConfig;
  provider: string;
  onChange: (value: ExecutorConfig) => void;
}) {
  const set = <K extends keyof ExecutorConfig>(
    key: K,
    next: ExecutorConfig[K],
  ) => onChange({ ...value, [key]: next });
  const text = (label: string, key: keyof ExecutorConfig, placeholder = '') => (
    <label className="block text-xs font-medium text-neutral-600">
      {label}
      <Input
        className="mt-1 h-8 text-xs"
        value={String(value[key])}
        placeholder={placeholder}
        onChange={(event) => set(key, event.target.value as never)}
      />
    </label>
  );
  return (
    <div className="space-y-3 rounded-lg border bg-neutral-50 p-3">
      <label className="block text-xs font-medium text-neutral-600">
        连接方式
        <select
          className="mt-1 h-9 w-full rounded border bg-white px-2 text-xs"
          value={value.transport}
          onChange={(event) =>
            set('transport', event.target.value as ExecutorConfig['transport'])
          }
        >
          <option value="local">服务端本机</option>
          <option value="worker">我的电脑 · 常驻 Worker（推荐）</option>
          <option value="ssh">远程机器 · SSH</option>
        </select>
      </label>
      <p className="text-[11px] text-neutral-500">
        下面的 CLI、工作区和 Skills
        路径均属于执行机器。网站部署到服务器后，可通过 Worker 使用你的电脑。
      </p>
      {text(
        '工作区根目录',
        'workspace_root',
        '留空使用执行机 ~/.openlore/executor-workspace',
      )}
      <label className="block text-xs font-medium text-neutral-600">
        Skills 来源
        <select
          className="mt-1 h-9 w-full rounded border bg-white px-2 text-xs"
          value={value.skills_mode}
          onChange={(event) =>
            set('skills_mode', event.target.value as 'synced' | 'local')
          }
        >
          <option value="synced">同步服务器管理的 Skill 版本</option>
          <option value="local">读取执行机器上的 Skills 目录</option>
        </select>
      </label>
      {value.skills_mode === 'local' &&
        text(
          'Skills 目录',
          'skills_directory',
          '目录下每个子目录包含 SKILL.md',
        )}
      <p className="text-[11px] text-neutral-500">
        每次任务复制所需 Skill
        到独立工作区，不安装到用户全局目录。本地目录模式需要 Worker 在线或先测试
        SSH，才会显示可用 Skills。
      </p>
      {provider === 'codex_cli' && (
        <>
          {text('Codex 配置 Profile（可选）', 'config_profile')}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={value.inherit_user_config}
              onChange={(event) =>
                set('inherit_user_config', event.target.checked)
              }
            />
            沿用本机用户配置和模型服务
          </label>
        </>
      )}
      {value.transport === 'ssh' && (
        <div className="space-y-3 border-t pt-3">
          {text('SSH 主机', 'ssh_host', 'example.com')}
          {text('SSH 用户', 'ssh_user')}
          {text('密钥文件（服务器上的路径）', 'ssh_identity_file')}
          {text('远端 Node 可执行路径', 'ssh_node_path', '/usr/local/bin/node')}
          {text(
            '远端 OpenLore CLI 文件路径',
            'ssh_cli_entry',
            '/opt/openlore/apps/server/dist/cli/index.js',
          )}
          <label className="block text-xs">
            SSH 端口
            <Input
              type="number"
              min={1}
              max={65535}
              value={value.ssh_port}
              onChange={(event) => set('ssh_port', Number(event.target.value))}
            />
          </label>
          <p className="text-[11px] text-neutral-500">
            使用 SSH 密钥与已确认的 known_hosts；远端需安装同版本 OpenLore。
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ['执行超时（秒）', 'timeout_seconds', 10, 3600],
            ['离线等待（秒）', 'queue_timeout_seconds', 10, 86400],
            ['任务文件保留（天）', 'retention_days', 1, 90],
            ['Worker 并发数', 'concurrency', 1, 4],
          ] as const
        ).map(([label, key, min, max]) => (
          <label key={key} className="text-[11px] text-neutral-600">
            {label}
            <Input
              className="mt-1 h-8 text-xs"
              type="number"
              min={min}
              max={max}
              value={value[key]}
              onChange={(event) => set(key, Number(event.target.value))}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
