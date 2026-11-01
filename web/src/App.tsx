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
  scheduledReportsConfig,
  DevicesPage,
  driversConfig,
  GroupsPage,
  maintenanceConfig,
  UsersPage,
} from './pages/settings/entities';
import { EntityPage } from './components/EntityPage';
import { GeofencesPage } from './pages/GeofencesPage';
import { ItemMasterPage } from './pages/masters/ItemMasterPage';
import { DocumentPermissionsPage, FieldMasksPage } from './pages/admin/AccessPages';
import { IntegrationsPage } from './pages/admin/IntegrationsPage';
import { GroupLoansPage, ReceivePage, RequestsPage, SalesPage } from './pages/inventory/documents';
import { InventoryGlPage, MovementsPage, OpeningStockPage, StockPage } from './pages/inventory/stock';
import { CustomersPage, FreightMemosPage, FuelIndentsPage, IncomingVehiclesPage, LoadingSheetPage, LrRegisterPage, MaterialReceivedPage } from './pages/ops/operations';
import { TripsPage } from './pages/ops/TripsPage';
import { PendingInboxPage } from './pages/admin/PendingInboxPage';
import { PartiesPage, PlantsStoresPage } from './pages/masters/masters';
import { AnnouncementPage, PreferencesPage, ServerConfigPage } from './pages/settings/ServerPages';
import { LogsPage } from './pages/reports/LogsPage';
import {
  AuditReport,
  ChartReport,
  CombinedReport,
  EventsReport,
  GeofencesReport,
  ReportsHub,
  RouteReport,
  StatisticsReport,
  StopsReport,
  SummaryReport,
  TripsReport,
} from './pages/reports/reports';
import { Placeholder } from './pages/Placeholder';
import { DriverChargesPage, GatePassesPage, JobCardsPage, PmSchedulesPage, RepairBillsPage, ToolChecklistsPage, WorkshopHubPage } from './pages/workshop/workshop';
import { NsdAlertsPage, TyreCostKmPage, TyreInterchangesPage, TyreMapPage, TyreOverviewPage, TyrePerformancePage, TyreRegisterPage } from './pages/tyres/tyres';

const IMPLEMENTED: Record<string, React.ComponentType> = {
  '/dashboard': Dashboard,
  '/map': MapPage,
  '/replay': ReplayPage,
  '/notifications': NotificationsPage,
  '/devices': DevicesPage,
  '/geofences': GeofencesPage,
  '/item-master': ItemMasterPage,
  '/stock': StockPage,
  '/movements': MovementsPage,
  '/requests': RequestsPage,
  '/receive': ReceivePage,
  '/opening-stock': OpeningStockPage,
  '/sales': SalesPage,
  '/group-loans': GroupLoansPage,
  '/inventory-gl': InventoryGlPage,
  '/trips': TripsPage,
  '/customers': CustomersPage,
  '/fuel-indents': FuelIndentsPage,
  '/loading-sheet': LoadingSheetPage,
  '/lr-register': LrRegisterPage,
  '/freight-memos': FreightMemosPage,
  '/incoming-vehicles': IncomingVehiclesPage,
  '/material-received': MaterialReceivedPage,
  '/pending-inbox': PendingInboxPage,
  '/workshop': WorkshopHubPage,
  '/job-cards': JobCardsPage,
  '/pm-schedules': PmSchedulesPage,
  '/gate-passes': GatePassesPage,
  '/repair-bills': RepairBillsPage,
  '/tools-checklists': ToolChecklistsPage,
  '/driver-charges': DriverChargesPage,
  '/tyres': TyreOverviewPage,
  '/tyre-map': TyreMapPage,
  '/tyre-register': TyreRegisterPage,
  '/tyre-interchanges': TyreInterchangesPage,
  '/nsd-alerts': NsdAlertsPage,
  '/tyre-cost-km': TyreCostKmPage,
  '/tyre-performance': TyrePerformancePage,
  '/document-permissions': DocumentPermissionsPage,
  '/field-masks': FieldMasksPage,
  '/settings/integrations': IntegrationsPage,
  '/settings/plants': PlantsStoresPage,
  '/settings/partners': PartiesPage,
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
  '/reports': ReportsHub,
  '/reports/combined': CombinedReport,
  '/reports/route': RouteReport,
  '/reports/trips': TripsReport,
  '/reports/stops': StopsReport,
  '/reports/summary': SummaryReport,
  '/reports/chart': ChartReport,
  '/reports/events': EventsReport,
  '/reports/geofences': GeofencesReport,
  '/reports/statistics': StatisticsReport,
  '/reports/audit': AuditReport,
  '/reports/logs': LogsPage,
  '/reports/scheduled': () => <EntityPage config={scheduledReportsConfig} />,
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
