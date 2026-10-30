import AddIcon from '@mui/icons-material/Add';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import SearchIcon from '@mui/icons-material/Search';
import {
  AppBar,
  Avatar,
  Badge,
  Box,
  Button,
  Collapse,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  Snackbar,
  Alert,
  MenuItem,
  TextField,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { onLiveEvents, useLiveSocket } from '../lib/live';
import { eventTitle, useNotifications } from '../lib/notifications';
import { APP_NAME, APP_TAGLINE } from '../config';
import { NAV } from '../nav';

const DRAWER_WIDTH = 272;

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NAV.map((s) => [s.title, s.items.some((i) => pathname.startsWith(i.path))])),
  );

  return (
    <Box sx={{ overflowY: 'auto', height: '100%', bgcolor: '#0f1e33', color: '#cfd8e3' }}>
      <Box sx={{ px: 2.5, py: 2 }}>
        <Typography variant="h6" sx={{ color: '#fff', lineHeight: 1.1 }}>
          {APP_NAME}
        </Typography>
        <Typography variant="caption" sx={{ letterSpacing: 1, opacity: 0.7 }}>
          {APP_TAGLINE}
        </Typography>
      </Box>
      <List dense disablePadding>
        {NAV.map((section) => {
          const Icon = section.icon;
          const isOpen = open[section.title] ?? false;
          return (
            <Box key={section.title}>
              <ListItemButton onClick={() => setOpen((o) => ({ ...o, [section.title]: !isOpen }))}>
                <ListItemIcon sx={{ minWidth: 34, color: 'inherit' }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={section.title}
                  slotProps={{ primary: { sx: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 } } }}
                />
                {isOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
              </ListItemButton>
              <Collapse in={isOpen} unmountOnExit>
                {section.items.map((item) => (
                  <ListItemButton
                    key={item.path}
                    component={NavLink}
                    to={item.path}
                    onClick={onNavigate}
                    sx={{
                      pl: 6.5,
                      py: 0.5,
                      '&.active': { bgcolor: 'rgba(255,255,255,0.12)', color: '#fff', borderRight: '3px solid #f57c00' },
                    }}
                  >
                    <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontSize: 13.5 } } }} />
                    {item.day && (
                      <Typography variant="caption" sx={{ opacity: 0.45 }}>
                        D{item.day}
                      </Typography>
                    )}
                  </ListItemButton>
                ))}
              </Collapse>
            </Box>
          );
        })}
      </List>
    </Box>
  );
}

export function AppShell() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  useLiveSocket(Boolean(user));
  const { unreadCount } = useNotifications();
  const [toast, setToast] = useState<string | null>(null);
  useEffect(
    () =>
      onLiveEvents((events) => {
        const important = events.find((e) => e.type === 'alarm' || e.type.startsWith('geofence'));
        if (important) setToast(eventTitle(important));
      }),
    [],
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Drawer
        variant={desktop ? 'permanent' : 'temporary'}
        open={desktop || mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH, border: 0 } }}
      >
        <Sidebar onNavigate={() => setMobileOpen(false)} />
      </Drawer>
      <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar sx={{ gap: 1.5 }}>
            {!desktop && (
              <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="open menu">
                <MenuIcon />
              </IconButton>
            )}
            <TextField
              size="small"
              placeholder="Search vehicles, drivers or locations..."
              sx={{ flexGrow: 1, maxWidth: 480 }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Box sx={{ flexGrow: 1 }} />
            {desktop && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/devices?new=1')}>
                Add Device
              </Button>
            )}
            <IconButton aria-label="notifications" onClick={() => navigate('/notifications')}>
              <Badge color="error" badgeContent={unreadCount} max={99}>
                <NotificationsOutlined />
              </Badge>
            </IconButton>
            <Button onClick={(e) => setMenuEl(e.currentTarget)} sx={{ color: 'text.primary', gap: 1 }}>
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
                {user?.name?.[0]?.toUpperCase()}
              </Avatar>
              {desktop && (
                <Box sx={{ textAlign: 'left', lineHeight: 1.1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {user?.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {user?.administrator ? 'Administrator' : 'User'}
                  </Typography>
                </Box>
              )}
            </Button>
            <Menu anchorEl={menuEl} open={Boolean(menuEl)} onClose={() => setMenuEl(null)}>
              <MenuItem onClick={() => { setMenuEl(null); navigate('/settings/preferences'); }}>Preferences</MenuItem>
              <MenuItem onClick={() => { setMenuEl(null); void logout(); }}>Log out</MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>
        <Box component="main" sx={{ p: { xs: 2, md: 3 }, flexGrow: 1 }}>
          <Outlet />
        </Box>
        <Snackbar open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
          <Alert severity="warning" variant="filled" onClose={() => setToast(null)} onClick={() => navigate('/notifications')} sx={{ cursor: 'pointer' }}>
            {toast}
          </Alert>
        </Snackbar>
      </Box>
    </Box>
  );
}
