import axios from 'axios';

const API_BASE = process.env.API_BASE || 'http://localhost:3000/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

export interface Project {
  id: string;
  name: string;
  owner: string;
  ownerName: string;
  ddl: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
  category: string;
  fileToken?: string;
  parentId?: string;
  children?: Project[];
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceLog {
  id: string;
  version: string;
  content: string;
  createdAt: string;
}

export interface KeywordRecord {
  record_id: string;
  fields: Record<string, any>;
}

export interface DDLAlert {
  projectId: string;
  projectName: string;
  ownerName: string;
  ddl: string;
  daysLeft: number;
  priority: string;
}

export const projectApi = {
  getProjects: () =>
    api.get<Project[]>('/projects').then(r => r.data),

  getProjectsWithHierarchy: () =>
    api.get<Project[]>('/projects/hierarchy').then(r => r.data),

  createProject: (data: Partial<Project>) =>
    api.post<Project>('/projects', data).then(r => r.data),

  updateProject: (id: string, data: Partial<Project>) =>
    api.put<Project>(`/projects/${id}`, data).then(r => r.data),

  deleteProject: (id: string) =>
    api.delete(`/projects/${id}`).then(r => r.data),

  getDDLAlerts: (days?: number) =>
    api.get<DDLAlert[]>(`/projects/ddl-alerts`, { params: { days } }).then(r => r.data),
};

export const botApi = {
  testBroadcast: () =>
    api.post('/bot/test-broadcast').then(r => r.data),

  getBroadcastHistory: () =>
    api.get('/bot/history').then(r => r.data),
};

export const logApi = {
  createLog: (version: string, content: string) =>
    api.post('/logs', { version, content }).then(r => r.data),

  getLogs: (pageSize?: number, pageToken?: string) =>
    api.get<{ items: MaintenanceLog[]; hasMore: boolean; pageToken: string; total: number }>('/logs', { params: { pageSize, pageToken } }).then(r => r.data),
};

export const keywordApi = {
  getConfig: () =>
    api.get<{ enabled: boolean; keywords: string[] }>('/keywords/config').then(r => r.data),

  getRecords: (pageSize?: number, pageToken?: string) =>
    api.get<{ items: KeywordRecord[]; hasMore: boolean; pageToken: string; total: number }>('/keywords/records', { params: { pageSize, pageToken } }).then(r => r.data),
};

export default api;
