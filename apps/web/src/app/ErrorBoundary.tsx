import React from 'react';

export class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return (
      <div role="alert" className="mx-auto my-20 max-w-lg space-y-4 rounded-xl border bg-white p-8">
        <h1 className="text-xl font-semibold">页面暂时无法显示</h1>
        <p className="text-sm text-neutral-500">请刷新后重试。已经保存的配置和后台任务会保留。</p>
        <button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white" onClick={() => window.location.reload()}>重新加载</button>
      </div>
    );
    return this.props.children;
  }
}
