// Shared demo fleet data used by the Traccar seeder and the GPS simulator.

export const CITIES = {
  riyadh: [24.7136, 46.6753],
  jeddah: [21.4858, 39.1925],
  makkah: [21.3891, 39.8579],
  madinah: [24.5247, 39.5692],
  dammam: [26.4207, 50.0888],
  khobar: [26.2172, 50.1971],
  jubail: [27.0046, 49.646],
  hofuf: [25.38, 49.588],
  buraidah: [26.326, 43.975],
  hail: [27.5114, 41.7208],
  tabuk: [28.3835, 36.5662],
  yanbu: [24.089, 38.0618],
  taif: [21.2703, 40.4158],
  abha: [18.2164, 42.5053],
  jazan: [16.8892, 42.5511],
};

// Freight corridors along the main highways: list of city keys the truck drives through, back and forth.
export const CORRIDORS = [
  ['riyadh', 'dammam'],
  ['riyadh', 'taif', 'makkah', 'jeddah'],
  ['jeddah', 'madinah'],
  ['dammam', 'jubail'],
  ['riyadh', 'buraidah', 'hail'],
  ['dammam', 'hofuf', 'riyadh'],
  ['jeddah', 'yanbu'],
  ['madinah', 'tabuk'],
  ['taif', 'abha', 'jazan'],
  ['dammam', 'khobar'],
];

export const GROUPS = [
  'Riyadh–Dammam Express',
  'Western Region Freight',
  'Cold Chain & Reefer',
  'Port & Container (Jeddah / Dammam)',
  'Tankers & Bulk',
  'Riyadh City Distribution',
];

const MODELS = [
  'Mercedes-Benz Actros 1845', 'Volvo FH 460', 'MAN TGS 40.440', 'Scania R450',
  'Isuzu FVR 34', 'Hino 700 SH', 'Mercedes-Benz Arocs 3345', 'Isuzu NPR 75',
];
// Letters used on Saudi plates (Latin side)
const PLATE_LETTERS = 'ABDEGHJKLNRSTUVXZ';

// Deterministic pseudo-random so every seed produces the same fleet.
function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function demoVehicles(count = 25) {
  const r = rng(42);
  const letter = () => PLATE_LETTERS[Math.floor(r() * PLATE_LETTERS.length)];
  return Array.from({ length: count }, (_, i) => {
    const plate = `${String(1000 + Math.floor(r() * 8999))} ${letter()}${letter()}${letter()}`;
    return {
      name: plate,
      uniqueId: String(867010075167001 + i),
      model: MODELS[i % MODELS.length],
      category: i % 6 === 5 ? 'van' : 'truck',
      group: GROUPS[i % GROUPS.length],
      corridor: i % CORRIDORS.length,
      phone: `+9665${String(10000000 + Math.floor(r() * 89999999))}`,
    };
  });
}

export const DRIVERS = [
  'Abdullah Al-Harbi', 'Mohammed Al-Qahtani', 'Fahad Al-Otaibi', 'Khalid Al-Ghamdi', 'Saad Al-Dosari',
  'Faisal Al-Shehri', 'Nasser Al-Mutairi', 'Sultan Al-Zahrani', 'Ahmed Hassan', 'Imran Khan',
  'Rashid Ali', 'Tariq Mahmood', 'Omar Farouk', 'Yasir Ahmed', 'Bilal Hussain',
];

export const GEOFENCES = [
  ['Riyadh Dry Port', 'riyadh'],
  ['Dammam King Abdulaziz Port', 'dammam'],
  ['Jeddah Islamic Port', 'jeddah'],
  ['Jubail Industrial City', 'jubail'],
  ['Makkah Distribution Centre', 'makkah'],
  ['Madinah Logistics Hub', 'madinah'],
  ['Khobar Warehouse', 'khobar'],
  ['Hail Agricultural Depot', 'hail'],
];

// Demo groups and geofences from the earlier India dataset; the seeder removes them.
export const LEGACY_GROUPS = [
  'North-West Heavy Express', 'Western Corridor Freightways', 'Reefer & ColdChain Express',
  'Port & Container Logistics', 'Industrial Tankers & Bulk', 'Intra-City Distribution',
];
export const LEGACY_GEOFENCES = [
  'Delhi Freight Terminal', 'Jaipur Metro Depot', 'Ahmedabad GIDC Hub', 'Mumbai Bhiwandi Warehousing',
  'Pune Chakan Plant', 'Nagpur Central Depot', 'Bengaluru Nelamangala Hub', 'Kolkata Dock Yard',
];
