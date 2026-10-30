import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';
import { traccar, type User } from '../api/traccar';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => traccar.session().catch(() => null),
    staleTime: Infinity,
  });

  const value: AuthState = {
    user: session.data ?? null,
    loading: session.isLoading,
    login: async (email, password) => {
      const user = await traccar.login(email, password);
      qc.setQueryData(['session'], user);
    },
    logout: async () => {
      await traccar.logout().catch(() => undefined);
      qc.clear();
      qc.setQueryData(['session'], null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
