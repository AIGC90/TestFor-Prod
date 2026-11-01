import { Chip } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { http } from '../../api/http';
import type { Option } from '../../components/EntityPage';
import type { Item } from '../masters/ItemMasterPage';
import type { Party, Store } from '../masters/masters';

export const inr = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
export const num = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 }));

export const itemOptions = async (): Promise<Option[]> =>
  (await http<Item[]>('/erp/masters/items')).filter((i) => i.active).map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }));
export const storeOptions = async (): Promise<Option[]> =>
  (await http<Store[]>('/erp/masters/stores')).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }));
export const partyOptions = (kind: string) => async (): Promise<Option[]> =>
  (await http<Party[]>(`/erp/masters/parties?kind=${kind}`)).map((p) => ({ value: p.id, label: p.name }));

/** Id → name lookups for items, stores and partners, for table cells. */
export function useNames() {
  const items = useQuery({ queryKey: ['items'], queryFn: () => http<Item[]>('/erp/masters/items'), staleTime: 60_000 });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => http<Store[]>('/erp/masters/stores'), staleTime: 60_000 });
  const parties = useQuery({ queryKey: ['parties'], queryFn: () => http<Party[]>('/erp/masters/parties'), staleTime: 60_000 });
  return useMemo(() => {
    const i = new Map(items.data?.map((x) => [x.id, x]));
    const s = new Map(stores.data?.map((x) => [x.id, x.name]));
    const p = new Map(parties.data?.map((x) => [x.id, x.name]));
    return {
      item: (id: number) => i.get(id)?.name ?? `#${id}`,
      itemUnit: (id: number) => i.get(id)?.unit ?? '',
      store: (id: number | null | undefined) => (id ? (s.get(id) ?? `#${id}`) : '—'),
      party: (id: number | null | undefined) => (id ? (p.get(id) ?? `#${id}`) : '—'),
      ready: items.isSuccess && stores.isSuccess && parties.isSuccess,
    };
  }, [items.data, stores.data, parties.data, items.isSuccess, stores.isSuccess, parties.isSuccess]);
}

const STATUS_COLOR: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'secondary'> = {
  open: 'info', draft: 'default', expected: 'info', ready: 'primary', pending_approval: 'warning', approved: 'primary',
  rejected: 'error', cancelled: 'default', in_procurement: 'secondary', fulfilled: 'success', landed: 'success',
  invoiced: 'primary', dispatched: 'secondary', paid: 'success', active: 'warning', returned: 'success', overdue: 'error',
  completed: 'success', in_transit: 'warning', in_stock: 'success', damaged: 'warning', issued: 'info', written_off: 'default', sold: 'default',
};

export const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export function StatusChip({ status }: { status: string }) {
  return <Chip size="small" label={statusLabel(status)} color={STATUS_COLOR[status] ?? 'default'} />;
}
