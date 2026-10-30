import ConstructionIcon from '@mui/icons-material/Construction';
import { Card, CardContent, Stack, Typography } from '@mui/material';
import type { NavItem } from '../nav';

export function Placeholder({ item }: { item: NavItem }) {
  return (
    <Stack spacing={2}>
      <Typography variant="h5">{item.label}</Typography>
      <Card>
        <CardContent sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <ConstructionIcon color="secondary" />
          <div>
            <Typography sx={{ fontWeight: 600 }}>Scheduled for day {item.day} of the build</Typography>
            {item.summary && <Typography color="text.secondary">{item.summary}</Typography>}
          </div>
        </CardContent>
      </Card>
    </Stack>
  );
}
