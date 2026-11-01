import type { SvgIconComponent } from '@mui/icons-material';
import AdminPanelSettings from '@mui/icons-material/AdminPanelSettings';
import Build from '@mui/icons-material/Build';
import Inventory2 from '@mui/icons-material/Inventory2';
import LocalShipping from '@mui/icons-material/LocalShipping';
import Insights from '@mui/icons-material/Insights';
import RadioButtonChecked from '@mui/icons-material/RadioButtonChecked';
import Shield from '@mui/icons-material/Shield';
import TireRepair from '@mui/icons-material/TireRepair';

export interface NavItem {
  label: string;
  path: string;
  /** Build plan day the screen lands on; omitted once it is implemented. */
  day?: number;
  /** One-line purpose shown on the placeholder until the screen exists. */
  summary?: string;
}

export interface NavSection {
  title: string;
  icon: SvgIconComponent;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: 'Live operations & fleet',
    icon: RadioButtonChecked,
    items: [
      { label: 'Dashboard', path: '/dashboard' },
      { label: 'Map', path: '/map' },
      { label: 'Route Replay', path: '/replay' },
      { label: 'Dashcam Streams', path: '/dashcam', day: 6, summary: 'Live front/driver cameras, recordings, ADAS & DMS alerts.' },
      { label: 'SOS Emergency', path: '/sos', day: 6, summary: 'Panic and crash alarms, response tracking, emergency contacts.' },
      { label: 'Notifications Center', path: '/notifications' },
    ],
  },
  {
    title: 'Operations & trips',
    icon: LocalShipping,
    items: [
      { label: 'Trip Dispatch Hub', path: '/trips' },
      { label: 'Customer & Orders', path: '/customers' },
      { label: 'Revenue & Financials', path: '/revenue', day: 6, summary: 'Revenue, costs, profit by vehicle, lane and customer; receivables.' },
      { label: 'Fuel Indents', path: '/fuel-indents' },
      { label: 'Loading Sheet', path: '/loading-sheet' },
      { label: 'Material Received', path: '/material-received' },
      { label: 'LR Register', path: '/lr-register' },
      { label: 'Freight Memos', path: '/freight-memos' },
      { label: 'Incoming Vehicles', path: '/incoming-vehicles' },
      { label: 'FASTag & Tolls', path: '/fastag', day: 6, summary: 'Toll transactions and tag wallet balances.' },
      { label: 'Subscriptions & Licenses', path: '/subscriptions', day: 6, summary: 'Device licences, plans and GST invoices.' },
    ],
  },
  {
    title: 'Inventory & store',
    icon: Inventory2,
    items: [
      { label: 'Stock Inventory', path: '/stock' },
      { label: 'Stock Movements', path: '/movements' },
      { label: 'Stock Requests', path: '/requests' },
      { label: 'Goods to Receive', path: '/receive' },
      { label: 'Item Master', path: '/item-master' },
      { label: 'Opening Stock', path: '/opening-stock' },
      { label: 'Stock Sales', path: '/sales' },
      { label: 'Group Loans', path: '/group-loans' },
      { label: 'Inventory GL Settings', path: '/inventory-gl' },
    ],
  },
  {
    title: 'Tyre management',
    icon: TireRepair,
    items: [
      { label: 'Tyre Overview', path: '/tyres', day: 5, summary: 'Tread health, spend, replacement forecast, alerts.' },
      { label: 'Tyre Map & Fitment', path: '/tyre-map', day: 5, summary: 'Axle layout per vehicle with fitted tyres and NSD.' },
      { label: 'Tyre Register', path: '/tyre-register', day: 5, summary: 'Fitment, removal, inspection, rotation and scrap history.' },
      { label: 'Tyre Interchanges', path: '/tyre-interchanges', day: 5, summary: 'Rotations and cross-vehicle swaps.' },
      { label: 'NSD Wear Alerts', path: '/nsd-alerts', day: 5, summary: 'Tyres at or below the tread threshold.' },
      { label: 'Tyre Cost / KM', path: '/tyre-cost-km', day: 5, summary: 'Tyre spend per km by vehicle.' },
      { label: 'Tyre Performance', path: '/tyre-performance', day: 5, summary: 'Life and cost per km by make, model or size.' },
    ],
  },
  {
    title: 'Workshop & maintenance',
    icon: Build,
    items: [
      { label: 'Workshop Hub', path: '/workshop', day: 5, summary: 'Open jobs, PM due, gate passes, garage dues and spend.' },
      { label: 'Job Cards', path: '/job-cards', day: 5, summary: 'Own workshop, market garage and AMC repair visits.' },
      { label: 'PM Schedules', path: '/pm-schedules', day: 5, summary: 'Preventive maintenance by km (GPS) and days.' },
      { label: 'Gate Passes', path: '/gate-passes', day: 5, summary: 'Returnable, claim and transfer material passes.' },
      { label: 'Repair Bills', path: '/repair-bills', day: 5, summary: 'Garage bills with GST split and TDS.' },
      { label: 'Maintenance Rules', path: '/settings/maintenance' },
      { label: 'Tools Checklists', path: '/tools-checklists', day: 5, summary: 'Driver toolkit handover and return audits.' },
      { label: 'Driver Charges', path: '/driver-charges', day: 5, summary: 'Debits for missing tools or damage, payroll recovery.' },
    ],
  },
  {
    title: 'Compliance, safety & personnel',
    icon: Shield,
    items: [
      { label: 'Statutory Compliance', path: '/compliance', day: 6, summary: 'RC, insurance, permits, fitness, PUC, licences and expiry.' },
      { label: 'Safety & Incidents', path: '/safety', day: 6, summary: 'Incidents, roadside assistance, insurance claims.' },
      { label: 'Field Staff Ops', path: '/field-staff', day: 6, summary: 'Technicians and agents: tasks, attendance, claims.' },
      { label: 'Driver Management', path: '/driver-management', day: 6, summary: 'Assignment, hours, attendance and payroll.' },
      { label: 'Registered Drivers', path: '/drivers' },
      { label: 'Users Management', path: '/settings/users' },
    ],
  },
  {
    title: 'Reports & analytics',
    icon: Insights,
    items: [
      { label: 'Fleet Executive BI', path: '/fleet-analytics', day: 6, summary: 'Utilisation, revenue and cost per km, corridor margins.' },
      { label: 'Reports Hub', path: '/reports' },
      { label: 'Combined Report', path: '/reports/combined' },
      { label: 'Route & Positions', path: '/reports/route' },
      { label: 'Trips Report', path: '/reports/trips' },
      { label: 'Stops Report', path: '/reports/stops' },
      { label: 'Summary Report', path: '/reports/summary' },
      { label: 'Chart Analytics', path: '/reports/chart' },
      { label: 'Events Report', path: '/reports/events' },
      { label: 'Geofences Report', path: '/reports/geofences' },
      { label: 'Statistics Report', path: '/reports/statistics' },
      { label: 'Audit Trail', path: '/reports/audit' },
      { label: 'System Logs', path: '/reports/logs' },
      { label: 'Scheduled Reports', path: '/reports/scheduled' },
    ],
  },
  {
    title: 'Settings & administration',
    icon: AdminPanelSettings,
    items: [
      { label: 'Plants & Stores', path: '/settings/plants' },
      { label: 'Business Partners', path: '/settings/partners' },
      { label: 'Devices', path: '/devices' },
      { label: 'Vehicle Groups', path: '/settings/groups' },
      { label: 'Geofences', path: '/geofences' },
      { label: 'Alert Notification Rules', path: '/settings/notifications' },
      { label: 'User Preferences', path: '/settings/preferences' },
      { label: 'Automation Calendars', path: '/settings/calendars' },
      { label: 'Computed Attributes', path: '/settings/attributes' },
      { label: 'Saved Commands', path: '/settings/commands' },
      { label: 'Pending Inbox', path: '/pending-inbox' },
      { label: 'Document Permissions', path: '/document-permissions' },
      { label: 'Field Masks', path: '/field-masks' },
      { label: 'Server Announcements', path: '/settings/announcement' },
      { label: 'Server Configuration', path: '/settings/server' },
      { label: 'Integrations (flespi)', path: '/settings/integrations' },
    ],
  },
];

export const NAV_ITEMS = NAV.flatMap((s) => s.items);
