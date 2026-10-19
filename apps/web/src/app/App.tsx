import React, { lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
const DailyFeedPage = lazy(() => import('../features/feed/DailyFeedPage.js').then(module => ({default: module.DailyFeedPage})));
const PipelinesPage = lazy(() => import('../features/pipelines/PipelinesPage.js').then(module => ({default: module.PipelinesPage})));
const ReportsPage = lazy(() => import('../features/reports/ReportsPage.js').then(module => ({default: module.ReportsPage})));
const LibraryPage = lazy(() => import('../features/library/LibraryPage.js').then(module => ({default: module.LibraryPage})));
const RunsPage = lazy(() => import('../features/runs/RunsPage.js').then(module => ({default: module.RunsPage})));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage.js').then(module => ({default: module.SettingsPage})));
const SourcesPage = lazy(() => import('../features/sources/SourcesPage.js').then(module => ({default: module.SourcesPage})));
import { Layout } from './Layout.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: true,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<DailyFeedPage />} />
            <Route path="sources" element={<SourcesPage />} />
            <Route path="pipelines" element={<PipelinesPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="pool" element={<LibraryPage />} />
            <Route path="research" element={<Navigate to="/pool" replace />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<div className="rounded-xl border bg-white p-10"><h1 className="text-xl font-semibold">页面不存在</h1><p className="mt-3 text-sm text-neutral-500">请通过左侧导航继续，或返回每日研报。</p><a href="/" className="mt-4 inline-block text-sm text-blue-700 underline">返回每日研报</a></div>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
