import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DailyFeedPage } from '../features/feed/DailyFeedPage.js';
import { PipelinesPage } from '../features/pipelines/PipelinesPage.js';
import { ReportsPage } from '../features/reports/ReportsPage.js';
import { LibraryPage } from '../features/library/LibraryPage.js';
import { RunsPage } from '../features/runs/RunsPage.js';
import { SettingsPage } from '../features/settings/SettingsPage.js';
import { SourcesPage } from '../features/sources/SourcesPage.js';
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
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
