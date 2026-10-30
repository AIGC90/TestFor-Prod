import { Box, CircularProgress } from '@mui/material';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './layout/AppShell';
import { NAV_ITEMS } from './nav';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { MapPage } from './pages/MapPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ReplayPage } from './pages/ReplayPage';
import {
  alertRulesConfig,
  attributesConfig,
  calendarsConfig,
  commandsConfig,
  DevicesPage,
  driversConfig,
  GroupsPage,
  maintenanceConfig,
  UsersPage,
} from './pages/settings/entities';
import { EntityPage } from './components/EntityPage';
import { GeofencesPage } from './pages/GeofencesPage';
import { AnnouncementPage, PreferencesPage, ServerConfigPage } from './pages/settings/ServerPages';
import { Placeholder } from './pages/Placeholder';

const IMPLEMENTED: Record<string, React.ComponentType> = {
  '/dashboard': Dashboard,
  '/map': MapPage,
  '/replay': ReplayPage,
  '/notifications': NotificationsPage,
  '/devices': DevicesPage,
  '/geofences': GeofencesPage,
  '/settings/preferences': PreferencesPage,
  '/settings/server': ServerConfigPage,
  '/settings/announcement': AnnouncementPage,
  '/settings/groups': GroupsPage,
  '/settings/users': UsersPage,
  '/drivers': () => <EntityPage config={driversConfig} />,
  '/settings/notifications': () => <EntityPage config={alertRulesConfig} />,
  '/settings/maintenance': () => <EntityPage config={maintenanceConfig} />,
  '/settings/calendars': () => <EntityPage config={calendarsConfig} />,
  '/settings/attributes': () => <EntityPage config={attributesConfig} />,
  '/settings/commands': () => <EntityPage config={commandsConfig} />,
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
