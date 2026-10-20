import type {
  AIProfile,
  AIExecutionLogPage,
  AIExecutionLogDetail,
  DailyFeedArticle,
  DoctorResult,
  Group,
  LibraryArticle,
  LibraryFilterParams,
  LibraryResponse,
  NotificationConnection,
  PushDeliveryRecord,
  ReportPlan,
  ReportPreview,
  RepositoryConnection,
  ResearchTask,
  Run,
  ServiceStatus,
  Skill,
  Source,
  WorkspaceSettings,
} from '@openlore/contracts';

const BASE_URL = '/api/v1';

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Request failed with status ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Settings
  getSettings: () => request<WorkspaceSettings>('/settings'),
  updateSettings: (data: Partial<WorkspaceSettings>) =>
    request<WorkspaceSettings>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),


  setDefaultGitHubToken: (id: string) => request<WorkspaceSettings>(`/settings/connections/repository/${id}/default-token`, { method: 'POST' }),

  listRepos: () => request<RepositoryConnection[]>('/settings/connections/repository'),
  saveRepo: (data: any) =>
    request<RepositoryConnection>('/settings/connections/repository', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteRepo: (id: string) =>
    request<{ ok: boolean }>(`/settings/connections/repository/${id}`, {
      method: 'DELETE',
    }),
  testRepo: (id: string) =>
    request<{ ok: boolean; message: string }>(`/settings/connections/repository/${id}/test`, {
      method: 'POST',
    }),

  listNotifs: () => request<NotificationConnection[]>('/settings/connections/notification'),
  saveNotif: (data: any) =>
    request<NotificationConnection>('/settings/connections/notification', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteNotif: (id: string) =>
    request<{ ok: boolean }>(`/settings/connections/notification/${id}`, {
      method: 'DELETE',
    }),

  listAIProfiles: () => request<AIProfile[]>('/settings/ai-profiles'),
  saveAIProfile: (data: any) =>
    request<AIProfile>('/settings/ai-profiles', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  testAIProfile: (id: string) => request<{ok:boolean;message:string}>(`/settings/ai-profiles/${id}/test`, {method:'POST'}),
  pairAIProfile: (id: string) => request<{profile_id:string;token:string}>(`/settings/ai-profiles/${id}/pair`, {method:'POST'}),
  deleteAIProfile: (id: string) =>
    request<{ ok: boolean }>(`/settings/ai-profiles/${id}`, {
      method: 'DELETE',
    }),
  setPrimaryAIProfile: (id: string) =>
    request<{ ok: boolean; primary_id: string }>(`/settings/ai-profiles/${id}/primary`, {
      method: 'POST',
    }),

  getDoctor: () => request<DoctorResult>('/settings/doctor'),
  getServiceStatus: () => request<ServiceStatus>('/settings/service'),

  // Sources
  listSources: () => request<Source[]>('/sources'),
  saveSource: (data: any) =>
    request<Source>('/sources', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  toggleSource: (id: string, enabled: boolean) =>
    request<Source>(`/sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  previewSource: (id: string) =>
    request<any>(`/sources/${id}/preview`, {
      method: 'POST',
    }),
  pollSource: (id: string) =>
    request<any>(`/sources/${id}/poll`, {
      method: 'POST',
    }),
  revalidateSource: (id: string) => request<{counts: Record<string,number>}>(`/sources/${id}/revalidate`, {method:'POST'}),
  pollAllSources: () =>
    request<{ ok: boolean; polled_sources: string[] }>('/sources/poll-all', {
      method: 'POST',
    }),

  // Groups
  listGroups: () => request<Group[]>('/pipelines'),
  saveGroup: (data: any) =>
    request<Group>('/pipelines', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  toggleGroup: (id: string, enabled: boolean) =>
    request<Group>(`/pipelines/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  triggerGroupRun: (id: string) =>
    request<Run>(`/pipelines/${id}/run`, {
      method: 'POST',
    }),
  triggerAllGroups: () =>
    request<Run[]>('/pipelines/trigger-all', {
      method: 'POST',
    }),

  listReportPlans: () => request<ReportPlan[]>('/reports'),
  saveReportPlan: (data: Omit<ReportPlan, 'id'> & { id?: string }) => request<ReportPlan>(data.id ? `/reports/${data.id}` : '/reports', { method: data.id ? 'PUT' : 'POST', body: JSON.stringify(data) }),
  deleteReportPlan: (id: string) => request<{ ok: boolean }>(`/reports/${id}`, { method: 'DELETE' }),
  previewReport: (id: string) => request<ReportPreview>(`/reports/${id}/preview`),
  sendReport: (id: string) => request<{ ok: boolean; state: string; message: string }>(`/reports/${id}/send`, { method: 'POST', body: JSON.stringify({ force: true }) }),

  listExecutionLogs: (filters: {run_id?:string;job_id?:string;log_id?:string;status?:string;task_type?:string;search?:string;page?:number} = {}) => {
    const params=new URLSearchParams();
    for(const [key,value] of Object.entries(filters)) if(value)params.set(key,String(value));
    return request<AIExecutionLogPage>(`/execution-logs?${params}`);
  },
  getExecutionLog: (id:string) => request<AIExecutionLogDetail>(`/execution-logs/${id}`),

  // Runs
  listRuns: (groupId?: string) =>
    request<Run[]>(groupId ? `/runs?group_id=${groupId}` : '/runs'),
  getRun: (id: string) => request<Run>(`/runs/${id}`),
  listPushDeliveries: () => request<PushDeliveryRecord[]>('/runs/pushes'),

  // Skills
  listSkills: (profileId?: string) => request<Skill[]>(profileId ? `/skills?profile_id=${encodeURIComponent(profileId)}` : '/skills'),
  getSkill: (id: string) => request<Skill>(`/skills/${id}`),

  // Library
  reviewArticles: (articleIds: string[], force = false) => request<{ queued: number }>('/library/review', {
    method: 'POST', body: JSON.stringify({ article_ids: articleIds, force }),
  }),
  listLibrary: (params?: LibraryFilterParams) => {
    const q = new URLSearchParams();
    for (const key of ['time_range', 'published_range', 'status_filter', 'discovered_from', 'discovered_to', 'published_from', 'published_to'] as const) {
      const value = params?.[key];
      if (value && value !== 'all') q.set(key, value);
    }
    if (params?.interested_only) q.set('interested_only', 'true');
    if (params?.source_id) q.set('source_id', params.source_id);
    if (params?.group_id) q.set('group_id', params.group_id);
    if (params?.search) q.set('search', params.search);
    if (params?.page) q.set('page', String(params.page));
    if (params?.page_size) q.set('page_size', String(params.page_size));
    const qs = q.toString() ? `?${q.toString()}` : '';
    return request<LibraryResponse>(`/library${qs}`);
  },
  startResearchOnArticle: (articleId: string, data: { group_id: string; instructions?: string }) =>
    request<ResearchTask>(`/library/${articleId}/research`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Research
  listResearch: (groupId?: string) =>
    request<ResearchTask[]>(groupId ? `/research?group_id=${groupId}` : '/research'),

  // Daily Feed
  getDailyFeed: (groupId?: string, date?: string) => {
    const params = new URLSearchParams();
    if (groupId) params.append('group_id', groupId);
    if (date) params.append('date', date);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<{
      group: Group | null;
      groups: Array<{ id: string; name: string }>;
      date: string;
      has_run_today: boolean;
      current_run?: {id:string;status:string;stage:string;error_message?:string|null};
      available_dates: string[];
      stats: {
        pool_count: number;
        deep_analyzed_count: number;
        pending_count: number;
      };
      deep_articles: DailyFeedArticle[];
    }>(`/feed${qs}`);
  },
  researchFeedArticle: (groupId: string, articleId: string) =>
    request<ResearchTask>('/feed/research', {
      method: 'POST',
      body: JSON.stringify({ group_id: groupId, article_id: articleId, source: 'user_interest' }),
    }),
  toggleArticleInterest: (articleId: string, data?: { interested?: boolean; group_id?: string }) =>
    request<{ ok: boolean; article_id: string; user_interested: boolean }>(`/articles/${articleId}/interest`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
};
