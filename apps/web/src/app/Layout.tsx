import React, { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  Send,
  BookOpen,
  FolderTree,
  Library,
  Rss,
  Settings,
  Sparkles,
} from 'lucide-react';

const NAV_GROUPS = [
  {
    title: '内容与精选',
    items: [
      { name: '每日精选', path: '/', icon: Sparkles },
      { name: '内容池', path: '/pool', icon: Library },
    ],
  },
  {
    title: '采集与流水线',
    items: [
      { name: '来源采集', path: '/sources', icon: Rss },
      { name: '流水线任务', path: '/pipelines', icon: FolderTree },
      { name: '汇报推送', path: '/reports', icon: Send },
    ],
  },
  {
    title: '运行与设置',
    items: [
      { name: '运行记录', path: '/runs', icon: Activity },
      { name: '系统设置', path: '/settings', icon: Settings },
    ],
  },
];

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-neutral-50 text-neutral-900 overflow-x-hidden">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:p-3">跳到主要内容</a>
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r md:sticky md:top-0 md:h-screen border-neutral-200 shrink-0 flex flex-col justify-between max-w-full overflow-hidden">
        <div className="p-3 md:p-4 space-y-3 md:space-y-6">
          <div className="flex items-center justify-between md:justify-start space-x-2 px-2 py-1">
            <div className="flex items-center space-x-2">
              <BookOpen className="h-6 w-6 text-neutral-900" />
              <span className="font-bold text-lg tracking-tight">OpenLore</span>
            </div>
            <span className="md:hidden text-xs text-neutral-400">本地知识工作台</span>
          </div>

          <nav className="flex md:flex-col overflow-x-auto md:overflow-visible gap-2 md:gap-5 pb-1 md:pb-0 scrollbar-none max-w-full">
            {NAV_GROUPS.map((group, gIdx) => (
              <div key={group.title} className="flex md:flex-col gap-1 shrink-0">
                {gIdx > 0 && (
                  <div className="md:hidden w-px h-5 bg-neutral-200 self-center shrink-0 my-auto mx-1" />
                )}
                <div className="hidden md:block px-3 py-1 text-[11px] font-semibold text-neutral-400 tracking-wider">
                  {group.title}
                </div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === '/'}
                      className={({ isActive }) =>
                        `flex items-center space-x-2 md:space-x-3 px-3 py-1.5 md:py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${
                          isActive
                            ? 'bg-neutral-900 text-neutral-50'
                            : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                        }`
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.name}</span>
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        <div className="hidden md:block p-4 border-t border-neutral-100 text-xs text-neutral-400">
          <p>OpenLore v0.1.0</p>
          <p>本地知识采集与研究工作台</p>
        </div>
      </aside>

      {/* Main Content Area */}
      <main id="main-content" className="flex-1 min-w-0 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full overflow-y-auto">
        <Suspense fallback={<p role="status" className="py-20 text-center text-sm text-neutral-500">正在加载页面…</p>}><Outlet /></Suspense>
      </main>
    </div>
  );
}
