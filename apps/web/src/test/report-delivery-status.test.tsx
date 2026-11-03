import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { PushDeliveryRecordSchema } from '@openlore/contracts';
import { RunsPage } from '../features/runs/RunsPage.js';

it('shows scheduled partial delivery as sent while retaining the task warning and report links', () => {
  const client = new QueryClient();
  client.setQueryData(['groups'], []);
  client.setQueryData(['pushDeliveries'], [PushDeliveryRecordSchema.parse({
    id: 'partial-delivery', batch_id: 'daily', group_id: 'daily', status: 'sent',
    headline: '技术知识汇报', total_count: 13, trigger: 'scheduled', partial: true,
    summary: '> 部分失败；先汇报已归档的 1 篇研报。\n\n- [有效研报](https://wiki.example/report)',
    created_at: '2026-10-22T01:00:00Z',
  })]);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/runs?tab=pushes']}><RunsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  client.clear();
  expect(html).toContain('已发送');
  expect(html).toContain('13 篇');
  expect(html).toContain('定时推送');
  expect(html).toContain('包含未完成任务');
  expect(html).toContain('部分失败；先汇报已归档的 1 篇研报');
  expect(html).toContain('href="https://wiki.example/report"');
});
