import { http } from './http';

export interface DocTypeInfo {
  label: string;
  module: string;
}
export interface DocTypesMeta {
  roles: string[];
  actions: string[];
  docTypes: Record<string, DocTypeInfo>;
  fields: Record<string, string[]>;
}
export interface ApprovalRequest {
  id: number;
  docType: string;
  docId: number;
  docNo: string | null;
  title: string;
  summary: string | null;
  amount: number | null;
  priority: 'normal' | 'high';
  approverRole: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
  meta: { link?: string; vehicle?: string } | null;
  createdAt: string;
}
export interface ApprovalRule {
  docType: string;
  enabled: boolean;
  minAmount: number;
  approverRole: string;
}

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  fleet_supervisor: 'Fleet supervisor',
  workshop_manager: 'Workshop manager',
  technician: 'Technician / lead mechanic',
  storekeeper: 'Storekeeper / inventory',
  accountant: 'Accountant / finance',
  driver: 'Driver',
  viewer: 'Viewer (read only)',
};

export const erpAdmin = {
  meta: () => http<DocTypesMeta>('/erp/access/doc-types'),
  approvals: (status: 'pending' | 'history') => http<ApprovalRequest[]>(`/erp/approvals?status=${status}`),
  approve: (id: number, comment?: string) => http<ApprovalRequest>(`/erp/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({ comment }) }),
  reject: (id: number, comment: string) => http<ApprovalRequest>(`/erp/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify({ comment }) }),
  approveBulk: (ids: number[]) =>
    http<{ id: number; ok: boolean; error?: string }[]>('/erp/approvals/approve-bulk', { method: 'POST', body: JSON.stringify({ ids }) }),
  rules: () => http<ApprovalRule[]>('/erp/approvals/rules'),
  setRule: (rule: ApprovalRule) => http<ApprovalRule>('/erp/approvals/rules', { method: 'PUT', body: JSON.stringify(rule) }),
  permissions: (role: string) => http<Record<string, Record<string, boolean>>>(`/erp/access/permissions?role=${role}`),
  setPermission: (body: Record<string, unknown>) => http('/erp/access/permissions', { method: 'PUT', body: JSON.stringify(body) }),
  masks: (docType: string) => http<{ id: number; role: string; field: string; mode: string }[]>(`/erp/access/field-masks?docType=${docType}`),
  addMask: (body: Record<string, unknown>) => http('/erp/access/field-masks', { method: 'POST', body: JSON.stringify(body) }),
  removeMask: (id: number) => http(`/erp/access/field-masks/${id}`, { method: 'DELETE' }),
};
