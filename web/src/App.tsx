import { Box, CircularProgress } from '@mui/material';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './layout/AppShell';
import { NAV_ITEMS } from './nav';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Placeholder } from './pages/Placeholder';

const IMPLEMENTED: Record<string, React.ComponentType> = {
  '/dashboard': Dashboard,
};

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      ...NAV_ITEMS.map((item) => {
        const Page = IMPLEMENTED[item.path];
        return { path: item.path.slice(1), element: Page ? <Page /> : <Placeholder item={item} /> };
      }),
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
]);

export function App() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }
  return user ? <RouterProvider router={router} /> : <Login />;
}
