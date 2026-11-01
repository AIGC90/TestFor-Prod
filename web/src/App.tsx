import { Box, CircularProgress } from '@mui/material';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { useAuth } from './auth/AuthProvider';
import { AppShell } from './layout/AppShell';
import { NAV_ITEMS } from './nav';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
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
import { Placeholder } from './pages/Placeholder';

// Pages load on first visit, so the first screen does not wait for every module.
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const ReplayPage = lazy(() => import('./pages/ReplayPage').then((m) => ({ default: m.ReplayPage })));
const GeofencesPage = lazy(() => import('./pages/GeofencesPage').then((m) => ({ default: m.GeofencesPage })));
const ItemMasterPage = lazy(() => import('./pages/masters/ItemMasterPage').then((m) => ({ default: m.ItemMasterPage })));
const DocumentPermissionsPage = lazy(() => import('./pages/admin/AccessPages').then((m) => ({ default: m.DocumentPermissionsPage })));
const FieldMasksPage = lazy(() => import('./pages/admin/AccessPages').then((m) => ({ default: m.FieldMasksPage })));
const IntegrationsPage = lazy(() => import('./pages/admin/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })));
const GroupLoansPage = lazy(() => import('./pages/inventory/documents').then((m) => ({ default: m.GroupLoansPage })));
const ReceivePage = lazy(() => import('./pages/inventory/documents').then((m) => ({ default: m.ReceivePage })));
const RequestsPage = lazy(() => import('./pages/inventory/documents').then((m) => ({ default: m.RequestsPage })));
const SalesPage = lazy(() => import('./pages/inventory/documents').then((m) => ({ default: m.SalesPage })));
const InventoryGlPage = lazy(() => import('./pages/inventory/stock').then((m) => ({ default: m.InventoryGlPage })));
const MovementsPage = lazy(() => import('./pages/inventory/stock').then((m) => ({ default: m.MovementsPage })));
const OpeningStockPage = lazy(() => import('./pages/inventory/stock').then((m) => ({ default: m.OpeningStockPage })));
const StockPage = lazy(() => import('./pages/inventory/stock').then((m) => ({ default: m.StockPage })));
const CustomersPage = lazy(() => import('./pages/ops/operations').then((m) => ({ default: m.CustomersPage })));
const FreightMemosPage = lazy(() => import('./pages/ops/operations').then((m) => ({ default: m.FreightMemosPage })));
const FuelIndentsPage = lazy(() => import('./pages/ops/operations').then((m) => ({ default: m.FuelIndentsPage })));
const IncomingVehiclesPage = lazy(() => import('./pages/ops/operations').then((m) => ({ default: m.IncomingVehiclesPage })));
const LoadingSheetPage = lazy(() => import('./pages/ops/operations').then((m) => ({ default: m.LoadingSheetPage })));
const LrRegisterPage = lazy(() => import('./pages/ops/operations').then((m) => ({ default: m.LrRegisterPage })));
const MaterialReceivedPage = lazy(() => import('./pages/ops/operations').then((m) => ({ default: m.MaterialReceivedPage })));
const TripsPage = lazy(() => import('./pages/ops/TripsPage').then((m) => ({ default: m.TripsPage })));
const PendingInboxPage = lazy(() => import('./pages/admin/PendingInboxPage').then((m) => ({ default: m.PendingInboxPage })));
const PartiesPage = lazy(() => import('./pages/masters/masters').then((m) => ({ default: m.PartiesPage })));
const PlantsStoresPage = lazy(() => import('./pages/masters/masters').then((m) => ({ default: m.PlantsStoresPage })));
const AnnouncementPage = lazy(() => import('./pages/settings/ServerPages').then((m) => ({ default: m.AnnouncementPage })));
const PreferencesPage = lazy(() => import('./pages/settings/ServerPages').then((m) => ({ default: m.PreferencesPage })));
const ServerConfigPage = lazy(() => import('./pages/settings/ServerPages').then((m) => ({ default: m.ServerConfigPage })));
const LogsPage = lazy(() => import('./pages/reports/LogsPage').then((m) => ({ default: m.LogsPage })));
const AuditReport = lazy(() => import('./pages/reports/reports').then((m) => ({ default: m.AuditReport })));
const ChartReport = lazy(() => import('./pages/reports/reports').then((m) => ({ default: m.ChartReport })));
const CombinedReport = lazy(() => import('./pages/reports/reports').then((m) => ({ default: m.CombinedReport })));
const EventsReport = lazy(() => import('./pages/reports/reports').then((m) => ({ default: m.EventsReport })));
const GeofencesReport = lazy(() => import('./pages/reports/reports').then((m) => ({ default: m.GeofencesReport })));
const ReportsHub = lazy(() => import('./pages/reports/reports').then((m) => ({ default: m.ReportsHub })));
const RouteReport = lazy(() => import('./pages/reports/reports').then((m) => ({ default: m.RouteReport })));
const StatisticsReport = lazy(() => import('./pages/reports/reports').then((m) => ({ default: m.StatisticsReport })));
const StopsReport = lazy(() => import('./pages/reports/reports').then((m) => ({ default: m.StopsReport })));
const SummaryReport = lazy(() => import('./pages/reports/reports').then((m) => ({ default: m.SummaryReport })));
const TripsReport = lazy(() => import('./pages/reports/reports').then((m) => ({ default: m.TripsReport })));
const CompliancePage = lazy(() => import('./pages/people/compliance').then((m) => ({ default: m.CompliancePage })));
const SafetyPage = lazy(() => import('./pages/people/safety').then((m) => ({ default: m.SafetyPage })));
const SosPage = lazy(() => import('./pages/people/safety').then((m) => ({ default: m.SosPage })));
const DriverManagementPage = lazy(() => import('./pages/people/drivers').then((m) => ({ default: m.DriverManagementPage })));
const FieldStaffPage = lazy(() => import('./pages/people/field').then((m) => ({ default: m.FieldStaffPage })));
const FleetAnalyticsPage = lazy(() => import('./pages/finance/revenue').then((m) => ({ default: m.FleetAnalyticsPage })));
const RevenuePage = lazy(() => import('./pages/finance/revenue').then((m) => ({ default: m.RevenuePage })));
const FastagPage = lazy(() => import('./pages/finance/fastag').then((m) => ({ default: m.FastagPage })));
const SubscriptionsPage = lazy(() => import('./pages/finance/subscriptions').then((m) => ({ default: m.SubscriptionsPage })));
const DashcamPage = lazy(() => import('./pages/finance/dashcam').then((m) => ({ default: m.DashcamPage })));
const AiOpsPage = lazy(() => import('./pages/ai/AiOpsPage').then((m) => ({ default: m.AiOpsPage })));
const DriverChargesPage = lazy(() => import('./pages/workshop/workshop').then((m) => ({ default: m.DriverChargesPage })));
const GatePassesPage = lazy(() => import('./pages/workshop/workshop').then((m) => ({ default: m.GatePassesPage })));
const JobCardsPage = lazy(() => import('./pages/workshop/workshop').then((m) => ({ default: m.JobCardsPage })));
const PmSchedulesPage = lazy(() => import('./pages/workshop/workshop').then((m) => ({ default: m.PmSchedulesPage })));
const RepairBillsPage = lazy(() => import('./pages/workshop/workshop').then((m) => ({ default: m.RepairBillsPage })));
const ToolChecklistsPage = lazy(() => import('./pages/workshop/workshop').then((m) => ({ default: m.ToolChecklistsPage })));
const WorkshopHubPage = lazy(() => import('./pages/workshop/workshop').then((m) => ({ default: m.WorkshopHubPage })));
const NsdAlertsPage = lazy(() => import('./pages/tyres/tyres').then((m) => ({ default: m.NsdAlertsPage })));
const TyreCostKmPage = lazy(() => import('./pages/tyres/tyres').then((m) => ({ default: m.TyreCostKmPage })));
const TyreInterchangesPage = lazy(() => import('./pages/tyres/tyres').then((m) => ({ default: m.TyreInterchangesPage })));
const TyreMapPage = lazy(() => import('./pages/tyres/tyres').then((m) => ({ default: m.TyreMapPage })));
const TyreOverviewPage = lazy(() => import('./pages/tyres/tyres').then((m) => ({ default: m.TyreOverviewPage })));
const TyrePerformancePage = lazy(() => import('./pages/tyres/tyres').then((m) => ({ default: m.TyrePerformancePage })));
const TyreRegisterPage = lazy(() => import('./pages/tyres/tyres').then((m) => ({ default: m.TyreRegisterPage })));

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
  '/compliance': CompliancePage,
  '/safety': SafetyPage,
  '/sos': SosPage,
  '/driver-management': DriverManagementPage,
  '/field-staff': FieldStaffPage,
  '/revenue': RevenuePage,
  '/fleet-analytics': FleetAnalyticsPage,
  '/fastag': FastagPage,
  '/subscriptions': SubscriptionsPage,
  '/dashcam': DashcamPage,
  '/ai-ops': AiOpsPage,
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
        return {
          path: item.path.slice(1),
          element: Page ? (
            <Suspense fallback={<Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress /></Box>}>
              <Page />
            </Suspense>
          ) : (
            <Placeholder item={item} />
          ),
        };
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
