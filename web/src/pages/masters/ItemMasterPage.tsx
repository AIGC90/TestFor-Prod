import AddIcon from '@mui/icons-material/Add';
import ChevronRight from '@mui/icons-material/ChevronRight';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { Alert, Box, Button, Card, CardContent, Chip, Grid, IconButton, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { http } from '../../api/http';
import { EntityForm, EntityPage, type EntityConfig, errorMessage, type Field, type Option } from '../../components/EntityPage';
import { useAccess } from '../../lib/access';

export interface Category {
  id: number;
  parentId: number | null;
  name: string;
  level: number;
  unit: string | null;
  gstRate: number | null;
  hsn: string | null;
  countingMode: string | null;
}
export interface Item {
  id: number;
  code: string;
  name: string;
  categoryId: number;
  partNo: string | null;
  countingMode: string | null;
  unit: string | null;
  rate: number | null;
  gstRate: number | null;
  hsn: string | null;
  reorderLevel: number | null;
  tags: string[];
  active: boolean;
}

const COUNTING: Option[] = [
  { value: 'standard', label: 'Standard quantity' },
  { value: 'serial', label: 'Serial-tracked pieces' },
  { value: 'volume', label: 'Volume (litres / drums)' },
];
const SETTINGS = ['unit', 'gstRate', 'hsn', 'countingMode'] as const;
type Setting = (typeof SETTINGS)[number];

/** Settings flow down the tree: an item uses its own value, else the nearest category's. */
export function effective(item: Pick<Item, Setting | 'categoryId'>, byId: Map<number, Category>) {
  const out: Record<Setting, string | number | null> = { unit: null, gstRate: null, hsn: null, countingMode: null };
  for (const key of SETTINGS) {
    let value = item[key] as string | number | null;
    let cat = byId.get(item.categoryId);
    while ((value === null || value === undefined) && cat) {
      value = cat[key];
      cat = cat.parentId ? byId.get(cat.parentId) : undefined;
    }
    out[key] = value ?? null;
  }
  return out;
}

/** Category path "Main › Sub › Leaf". */
export function categoryPath(id: number, byId: Map<number, Category>) {
  const names: string[] = [];
  for (let c = byId.get(id); c; c = c.parentId ? byId.get(c.parentId) : undefined) names.unshift(c.name);
  return names.join(' › ');
}

function descendants(id: number, children: Map<number | null, Category[]>): Set<number> {
  const out = new Set([id]);
  const stack = [id];
  while (stack.length) for (const c of children.get(stack.pop()!) ?? []) if (!out.has(c.id)) (out.add(c.id), stack.push(c.id));
  return out;
}

const categoryFields: Field[] = [
  { path: 'name', label: 'Name', required: true, fullWidth: true },
  { path: 'unit', label: 'Unit (e.g. pcs, sets, ltr)' },
  { path: 'gstRate', label: 'GST %', type: 'number' },
  { path: 'hsn', label: 'HSN code' },
  { path: 'countingMode', label: 'Counting', type: 'select', options: COUNTING },
];

export function ItemMasterPage() {
  const qc = useQueryClient();
  const access = useAccess();
  const categories = useQuery({ queryKey: ['item-categories'], queryFn: () => http<Category[]>('/erp/masters/item-categories') });
  const items = useQuery({ queryKey: ['items'], queryFn: () => http<Item[]>('/erp/masters/items') });
  const [selected, setSelected] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<{ row: Partial<Category>; isNew: boolean } | null>(null);

  const byId = useMemo(() => new Map(categories.data?.map((c) => [c.id, c])), [categories.data]);
  const children = useMemo(() => {
    const m = new Map<number | null, Category[]>();
    categories.data?.forEach((c) => m.set(c.parentId, [...(m.get(c.parentId) ?? []), c]));
    return m;
  }, [categories.data]);
  const subtree = useMemo(() => (selected ? descendants(selected, children) : null), [selected, children]);
  const itemCount = (id: number) => {
    const ids = descendants(id, children);
    return (items.data ?? []).filter((i) => ids.has(i.categoryId)).length;
  };

  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) =>
      http<Category>(v.id ? `/erp/masters/item-categories/${v.id}` : '/erp/masters/item-categories', {
        method: v.id ? 'PUT' : 'POST',
        body: JSON.stringify(v.id ? { name: v.name, unit: v.unit, gstRate: v.gstRate, hsn: v.hsn, countingMode: v.countingMode } : v),
      }),
    onSuccess: (saved) => {
      setEditing(null);
      if (saved.parentId) setOpen((o) => new Set(o).add(saved.parentId!));
      setSelected(saved.id);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['item-categories'] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => http(`/erp/masters/item-categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => setSelected(null),
    onSettled: () => qc.invalidateQueries({ queryKey: ['item-categories'] }),
  });

  const itemsConfig: EntityConfig<Item> = {
    title: selected ? categoryPath(selected, byId) : 'All items',
    singular: 'item',
    endpoint: '/erp/masters/items',
    queryKey: 'items',
    docType: 'item',
    defaults: { categoryId: selected ?? undefined, active: true, tags: [] } as Partial<Item>,
    rowFilter: subtree ? (i) => subtree.has(i.categoryId) : undefined,
    searchText: (i) => `${i.code} ${i.name} ${i.partNo ?? ''} ${i.hsn ?? ''} ${i.tags.join(' ')}`,
    columns: [
      { label: 'Item', render: (i) => <Box><Typography variant="body2" sx={{ fontWeight: 600 }}>{i.name}</Typography><Typography variant="caption" color="text.secondary">{categoryPath(i.categoryId, byId)}</Typography></Box>, csv: (i) => i.name },
      { label: 'Code', render: (i) => i.code },
      { label: 'Part no.', render: (i) => i.partNo ?? '—' },
      { label: 'Counting', render: (i) => COUNTING.find((c) => c.value === effective(i, byId).countingMode)?.label ?? '—' },
      { label: 'Unit', render: (i) => String(effective(i, byId).unit ?? '—') },
      { label: 'Rate', render: (i) => (i.rate !== null ? `₹${i.rate.toLocaleString('en-IN')}` : '—'), csv: (i) => i.rate },
      { label: 'GST', render: (i) => (effective(i, byId).gstRate !== null ? `${effective(i, byId).gstRate}%` : '—') },
      { label: 'HSN', render: (i) => String(effective(i, byId).hsn ?? '—') },
      { label: 'Reorder at', render: (i) => i.reorderLevel ?? '—' },
      { label: 'Tags', render: (i) => i.tags.map((t) => <Chip key={t} size="small" label={t} sx={{ mr: 0.5 }} />), csv: (i) => i.tags.join('; ') },
    ],
    fields: [
      { section: 'Item', path: 'name', label: 'Name', required: true, fullWidth: true },
      { section: 'Item', path: 'categoryId', label: 'Category', type: 'select', required: true, options: (categories.data ?? []).map((c) => ({ value: c.id, label: categoryPath(c.id, byId) })) },
      { section: 'Item', path: 'code', label: 'Item code', helper: 'Leave blank to number automatically' },
      { section: 'Item', path: 'partNo', label: 'Part number / SKU' },
      { section: 'Item', path: 'tags', label: 'Tags', type: 'multiselect', options: ['gps', 'dashcam', 'tyre', 'battery', 'critical'].map((t) => ({ value: t, label: t })) },
      { section: 'Pricing & stock (blank = inherit from category)', path: 'rate', label: 'Standard rate (₹)', type: 'number' },
      { section: 'Pricing & stock (blank = inherit from category)', path: 'reorderLevel', label: 'Reorder level', type: 'number' },
      { section: 'Pricing & stock (blank = inherit from category)', path: 'unit', label: 'Unit' },
      { section: 'Pricing & stock (blank = inherit from category)', path: 'gstRate', label: 'GST %', type: 'number' },
      { section: 'Pricing & stock (blank = inherit from category)', path: 'hsn', label: 'HSN code' },
      { section: 'Pricing & stock (blank = inherit from category)', path: 'countingMode', label: 'Counting', type: 'select', options: COUNTING },
      { section: 'Pricing & stock (blank = inherit from category)', path: 'active', label: 'Active', type: 'switch' },
    ],
  };

  function Node({ cat }: { cat: Category }) {
    const kids = children.get(cat.id) ?? [];
    const isOpen = open.has(cat.id);
    return (
      <>
        <ListItemButton selected={selected === cat.id} onClick={() => setSelected(cat.id)} sx={{ pl: 1 + (cat.level - 1) * 2 }}>
          <IconButton
            size="small"
            sx={{ visibility: kids.length ? 'visible' : 'hidden', mr: 0.5 }}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => {
                const n = new Set(o);
                if (n.has(cat.id)) n.delete(cat.id);
                else n.add(cat.id);
                return n;
              });
            }}
            aria-label={isOpen ? 'collapse' : 'expand'}
          >
            {isOpen ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
          </IconButton>
          <ListItemText primary={cat.name} />
          <Chip size="small" label={itemCount(cat.id)} />
        </ListItemButton>
        {isOpen && kids.map((k) => <Node key={k.id} cat={k} />)}
      </>
    );
  }

  const sel = selected ? byId.get(selected) : null;
  const canCat = (a: 'create' | 'edit' | 'delete') => access.can('item_category', a);
  const roots = children.get(null) ?? [];
  const tagged = (items.data ?? []).filter((i) => effective(i, byId).countingMode === 'serial').length;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">Item Master</Typography>
        <Typography color="text.secondary">Four levels: main › sub › sub-sub › sub-sub-sub. Settings set on a category flow down to everything below it.</Typography>
      </Box>
      <Grid container spacing={2}>
        {([
          ['Main categories', roots.length],
          ['All categories', categories.data?.length ?? 0],
          ['Items', items.data?.length ?? 0],
          ['Serial-tracked items', tagged],
        ] as [string, number][]).map(([k, v]) => (
          <Grid key={k} size={{ xs: 6, md: 3 }}>
            <Card><CardContent><Typography variant="body2" color="text.secondary">{k}</Typography><Typography variant="h5">{v}</Typography></CardContent></Card>
          </Grid>
        ))}
      </Grid>
      <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', lg: 'row' }, alignItems: 'flex-start' }}>
        <Card sx={{ width: { lg: 330 }, flexShrink: 0, alignSelf: { xs: 'stretch', lg: 'flex-start' } }}>
          <CardContent sx={{ pb: 1 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6">Categories</Typography>
              {canCat('create') && (
                <Button size="small" startIcon={<AddIcon />} onClick={() => { save.reset(); setEditing({ row: {}, isNew: true }); }}>
                  Main
                </Button>
              )}
            </Stack>
          </CardContent>
          <List dense>
            <ListItemButton selected={selected === null} onClick={() => setSelected(null)}>
              <ListItemText primary="All categories" />
              <Chip size="small" label={items.data?.length ?? 0} />
            </ListItemButton>
            {roots.map((c) => <Node key={c.id} cat={c} />)}
          </List>
          {sel && (
            <CardContent sx={{ borderTop: 1, borderColor: 'divider' }}>
              {remove.isError && <Alert severity="error" sx={{ mb: 1 }}>{errorMessage(remove.error)}</Alert>}
              <Typography variant="subtitle2">{sel.name}</Typography>
              <Typography variant="caption" color="text.secondary" component="div">
                Level {sel.level} · Unit {sel.unit ?? 'inherited'} · GST {sel.gstRate ?? 'inherited'} · HSN {sel.hsn ?? 'inherited'}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 1 }}>
                {canCat('create') && sel.level < 4 && (
                  <Button size="small" startIcon={<AddIcon />} onClick={() => { save.reset(); setEditing({ row: { parentId: sel.id }, isNew: true }); }}>
                    Sub-category
                  </Button>
                )}
                {canCat('edit') && (
                  <IconButton size="small" aria-label="edit category" onClick={() => { save.reset(); setEditing({ row: sel, isNew: false }); }}>
                    <EditOutlined fontSize="small" />
                  </IconButton>
                )}
                {canCat('delete') && (
                  <IconButton size="small" aria-label="delete category" onClick={() => window.confirm(`Delete "${sel.name}"?`) && remove.mutate(sel.id)}>
                    <DeleteOutlined fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            </CardContent>
          )}
        </Card>
        <Box sx={{ flexGrow: 1, minWidth: 0, width: '100%' }}>
          <EntityPage key={selected ?? 'all'} config={itemsConfig} />
        </Box>
      </Box>
      {editing && (
        <EntityForm
          title={editing.isNew ? (editing.row.parentId ? `New sub-category under ${byId.get(editing.row.parentId)?.name}` : 'New main category') : `Edit ${editing.row.name}`}
          fields={categoryFields}
          initial={editing.row as Record<string, unknown>}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onSubmit={(v) => save.mutate(v)}
          busy={save.isPending}
          error={save.isError ? errorMessage(save.error) : null}
        />
      )}
    </Stack>
  );
}
