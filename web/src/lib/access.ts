import { useQuery } from '@tanstack/react-query';
import { http } from '../api/http';

export type Action = 'view' | 'create' | 'edit' | 'delete' | 'approve';
interface DocAccess extends Record<Action, boolean> {
  hidden: string[];
  readonly: string[];
}
interface AccessMe {
  role: string;
  docTypes: Record<string, DocAccess>;
}

/** The current user's ERP role, permissions and field masks per document type. */
export function useAccess() {
  const q = useQuery({ queryKey: ['access-me'], queryFn: () => http<AccessMe>('/erp/access/me'), staleTime: 60_000 });
  const doc = (docType: string) => q.data?.docTypes[docType];
  return {
    loaded: q.isSuccess,
    role: q.data?.role,
    can: (docType: string, action: Action) => Boolean(doc(docType)?.[action]),
    hidden: (docType: string) => doc(docType)?.hidden ?? [],
    readonly: (docType: string) => doc(docType)?.readonly ?? [],
  };
}
