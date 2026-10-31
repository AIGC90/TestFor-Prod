import { Box, Chip, Stack, Tab, Tabs } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { http } from '../../api/http';
import { EntityPage, type EntityConfig, type Option } from '../../components/EntityPage';

export interface Plant {
  id: number;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  gstin: string | null;
  address: string | null;
  active: boolean;
}
export interface Store {
  id: number;
  code: string;
  name: string;
  plantId: number | null;
  kind: string;
  active: boolean;
}
export interface Party {
  id: number;
  code: string;
  name: string;
  kinds: string[];
  gstin: string | null;
  pan: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  creditDays: number | null;
  active: boolean;
}

const opts = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));
export const STORE_KINDS = opts([['central', 'Central depot'], ['workshop', 'Workshop'], ['tyre', 'Tyre yard'], ['site', 'Site / plant store'], ['general', 'General']]);
export const PARTY_KINDS = opts([
  ['customer', 'Customer'], ['vendor', 'Vendor / supplier'], ['garage', 'Garage'], ['broker', 'Broker'],
  ['transporter', 'Transporter'], ['sister_company', 'Sister company'], ['buyer', 'Scrap buyer'],
]);
const label = (list: Option[], v: string) => list.find((o) => o.value === v)?.label ?? v;
const active = (a: boolean) => <Chip size="small" label={a ? 'Active' : 'Inactive'} color={a ? 'success' : 'default'} />;

export const plantOptions = async (): Promise<Option[]> =>
  (await http<Plant[]>('/erp/masters/plants')).map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }));
export const storeOptions = async (): Promise<Option[]> =>
  (await http<Store[]>('/erp/masters/stores')).map((s) => ({ value: s.id, label: s.name }));
export const partyOptions = (kind?: string) => async (): Promise<Option[]> =>
  (await http<Party[]>(`/erp/masters/parties${kind ? `?kind=${kind}` : ''}`)).map((p) => ({ value: p.id, label: p.name }));

export const plantsConfig: EntityConfig<Plant> = {
  title: 'Plants',
  singular: 'plant',
  subtitle: 'Your plants, depots and hubs.',
  endpoint: '/erp/masters/plants',
  queryKey: 'plants',
  docType: 'plant',
  defaults: { active: true },
  searchText: (p) => `${p.code} ${p.name} ${p.city ?? ''} ${p.gstin ?? ''}`,
  columns: [
    { label: 'Code', render: (p) => p.code },
    { label: 'Name', render: (p) => p.name },
    { label: 'City', render: (p) => p.city ?? '—' },
    { label: 'State', render: (p) => p.state ?? '—' },
    { label: 'GSTIN', render: (p) => p.gstin ?? '—' },
    { label: 'Status', render: (p) => active(p.active), csv: (p) => (p.active ? 'Active' : 'Inactive') },
  ],
  fields: [
    { path: 'code', label: 'Code', required: true, helper: 'Short code, e.g. PUN' },
    { path: 'name', label: 'Name', required: true },
    { path: 'city', label: 'City' },
    { path: 'state', label: 'State' },
    { path: 'gstin', label: 'GSTIN' },
    { path: 'active', label: 'Active', type: 'switch' },
    { path: 'address', label: 'Address', type: 'textarea' },
  ],
};

export const storesConfig = (plantNames: Map<number, string>): EntityConfig<Store> => ({
  title: 'Stores',
  singular: 'store',
  subtitle: 'Store locations that hold stock.',
  endpoint: '/erp/masters/stores',
  queryKey: 'stores',
  docType: 'store',
  defaults: { kind: 'general', active: true },
  searchText: (s) => `${s.code} ${s.name}`,
  columns: [
    { label: 'Code', render: (s) => s.code },
    { label: 'Name', render: (s) => s.name },
    { label: 'Type', render: (s) => label(STORE_KINDS, s.kind) },
    { label: 'Plant', render: (s) => (s.plantId ? (plantNames.get(s.plantId) ?? `#${s.plantId}`) : '—') },
    { label: 'Status', render: (s) => active(s.active), csv: (s) => (s.active ? 'Active' : 'Inactive') },
  ],
  fields: [
    { path: 'code', label: 'Code', required: true },
    { path: 'name', label: 'Name', required: true },
    { path: 'kind', label: 'Type', type: 'select', required: true, options: STORE_KINDS },
    { path: 'plantId', label: 'Plant', type: 'select', options: plantOptions, optionsKey: 'plant-options' },
    { path: 'active', label: 'Active', type: 'switch' },
  ],
});

export function PlantsStoresPage() {
  const [tab, setTab] = useState<'plants' | 'stores'>('plants');
  const plants = useQuery({ queryKey: ['plants'], queryFn: () => http<Plant[]>('/erp/masters/plants') });
  const stores = useMemo(() => storesConfig(new Map(plants.data?.map((p) => [p.id, p.name]))), [plants.data]);
  return (
    <Stack spacing={2}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab value="plants" label="Plants" />
          <Tab value="stores" label="Stores" />
        </Tabs>
      </Box>
      {tab === 'plants' ? <EntityPage config={plantsConfig} /> : <EntityPage config={stores} />}
    </Stack>
  );
}

export const partiesConfig: EntityConfig<Party> = {
  title: 'Business Partners',
  singular: 'partner',
  subtitle: 'Customers, vendors, garages, brokers, sister companies and scrap buyers.',
  endpoint: '/erp/masters/parties',
  queryKey: 'parties',
  docType: 'party',
  defaults: { kinds: ['customer'], active: true },
  searchText: (p) => `${p.code} ${p.name} ${p.kinds.join(' ')} ${p.gstin ?? ''} ${p.city ?? ''} ${p.phone ?? ''}`,
  columns: [
    { label: 'Code', render: (p) => p.code },
    { label: 'Name', render: (p) => p.name },
    {
      label: 'Type',
      render: (p) => p.kinds.map((k) => <Chip key={k} size="small" label={label(PARTY_KINDS, k)} sx={{ mr: 0.5 }} />),
      csv: (p) => p.kinds.join('; '),
    },
    { label: 'City', render: (p) => p.city ?? '—' },
    { label: 'GSTIN', render: (p) => p.gstin ?? '—' },
    { label: 'Phone', render: (p) => p.phone ?? '—' },
    { label: 'Credit days', render: (p) => p.creditDays ?? '—' },
    { label: 'Status', render: (p) => active(p.active), csv: (p) => (p.active ? 'Active' : 'Inactive') },
  ],
  fields: [
    { section: 'Identity', path: 'name', label: 'Name', required: true },
    { section: 'Identity', path: 'code', label: 'Code', helper: 'Leave blank to number automatically' },
    { section: 'Identity', path: 'kinds', label: 'Partner type', type: 'multiselect', required: true, options: PARTY_KINDS, fullWidth: true },
    { section: 'Tax', path: 'gstin', label: 'GSTIN' },
    { section: 'Tax', path: 'pan', label: 'PAN' },
    { section: 'Contact', path: 'contactPerson', label: 'Contact person' },
    { section: 'Contact', path: 'phone', label: 'Phone' },
    { section: 'Contact', path: 'email', label: 'Email' },
    { section: 'Contact', path: 'city', label: 'City' },
    { section: 'Contact', path: 'state', label: 'State' },
    { section: 'Contact', path: 'address', label: 'Address', type: 'textarea' },
    { section: 'Terms', path: 'creditDays', label: 'Credit days', type: 'number' },
    { section: 'Terms', path: 'active', label: 'Active', type: 'switch' },
    { section: 'Terms', path: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

export const PartiesPage = () => <EntityPage config={partiesConfig} />;
