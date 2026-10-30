export const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'FleetOne';
export const APP_TAGLINE = import.meta.env.VITE_APP_TAGLINE ?? 'Track · Operate · Grow';

/** Base map styles offered in the map switcher (OpenFreeMap vector tiles, no key needed). */
export const MAP_STYLES: { id: string; label: string; style: string }[] = [
  { id: 'liberty', label: 'Streets', style: 'https://tiles.openfreemap.org/styles/liberty' },
  { id: 'positron', label: 'Light', style: 'https://tiles.openfreemap.org/styles/positron' },
  { id: 'bright', label: 'Bright', style: 'https://tiles.openfreemap.org/styles/bright' },
];
export const DEFAULT_CENTER: [number, number] = [78.9629, 22.5937]; // India
