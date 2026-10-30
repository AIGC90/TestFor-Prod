import { http } from './http';

export interface Me {
  id: number;
  name: string;
  email: string;
  administrator: boolean;
  role: string;
}

export const erp = {
  me: () => http<Me>('/erp/me'),
  readEvents: (ids: number[]) => (ids.length ? http<number[]>(`/erp/notifications/read?ids=${ids.join(',')}`) : Promise.resolve([])),
  markRead: (ids: number[]) => http<void>('/erp/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
  markUnread: (ids: number[]) => http<void>('/erp/notifications/unread', { method: 'POST', body: JSON.stringify({ ids }) }),
};
