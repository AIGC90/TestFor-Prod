// Shared demo fleet data used by the Traccar seeder and the GPS simulator.

export const CITIES = {
  delhi: [28.6139, 77.209],
  jaipur: [26.9124, 75.7873],
  ahmedabad: [23.0225, 72.5714],
  surat: [21.1702, 72.8311],
  mumbai: [19.076, 72.8777],
  pune: [18.5204, 73.8567],
  nagpur: [21.1458, 79.0882],
  indore: [22.7196, 75.8577],
  bengaluru: [12.9716, 77.5946],
  hyderabad: [17.385, 78.4867],
  chennai: [13.0827, 80.2707],
  kolkata: [22.5726, 88.3639],
  lucknow: [26.8467, 80.9462],
  jamshedpur: [22.8046, 86.2029],
};

// Freight corridors: list of city keys the truck drives through, back and forth.
export const CORRIDORS = [
  ['delhi', 'jaipur', 'ahmedabad'],
  ['mumbai', 'pune'],
  ['ahmedabad', 'surat', 'mumbai'],
  ['nagpur', 'hyderabad', 'bengaluru'],
  ['bengaluru', 'chennai'],
  ['kolkata', 'jamshedpur'],
  ['delhi', 'lucknow'],
  ['indore', 'nagpur'],
  ['pune', 'hyderabad'],
];

export const GROUPS = [
  'North-West Heavy Express',
  'Western Corridor Freightways',
  'Reefer & ColdChain Express',
  'Port & Container Logistics',
  'Industrial Tankers & Bulk',
  'Intra-City Distribution',
];

const MODELS = [
  'Tata Signa 4825.TK', 'Ashok Leyland 4220', 'BharatBenz 3523R', 'Eicher Pro 6028',
  'Tata Prima 5530.S', 'Volvo FM 420', 'Tata 1512 LPT', 'Mahindra Blazo X 35',
];
const STATES = ['DL', 'RJ', 'GJ', 'MH', 'KA', 'TN', 'WB', 'UP', 'MP', 'TS', 'HR'];

// Deterministic pseudo-random so every seed produces the same fleet.
function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function demoVehicles(count = 25) {
  const r = rng(42);
  return Array.from({ length: count }, (_, i) => {
    const state = STATES[i % STATES.length];
    const plate = `${state}-${String(1 + Math.floor(r() * 98)).padStart(2, '0')}-${
      String.fromCharCode(65 + Math.floor(r() * 26))}${String.fromCharCode(65 + Math.floor(r() * 26))}-${
      String(1000 + Math.floor(r() * 8999))}`;
    return {
      name: plate,
      uniqueId: String(867010075167001 + i),
      model: MODELS[i % MODELS.length],
      category: i % 6 === 5 ? 'van' : 'truck',
      group: GROUPS[i % GROUPS.length],
      corridor: i % CORRIDORS.length,
      phone: `+9198${String(10000000 + Math.floor(r() * 89999999))}`,
    };
  });
}

export const DRIVERS = [
  'Ramesh Kumar', 'Suresh Patil', 'Vikram Singh', 'Anil Deshmukh', 'Sunil Yadav',
  'Balwinder Singh', 'Mukesh Yadav', 'Ganesh Patil', 'Jagdish Sharma', 'Manpreet Gill',
  'Rajesh Verma', 'Ravinder Reddy', 'Karthik Sundaram', 'Basavaraj H.', 'Devendra Prasad',
];

export const GEOFENCES = [
  ['Delhi Freight Terminal', 'delhi'],
  ['Jaipur Metro Depot', 'jaipur'],
  ['Ahmedabad GIDC Hub', 'ahmedabad'],
  ['Mumbai Bhiwandi Warehousing', 'mumbai'],
  ['Pune Chakan Plant', 'pune'],
  ['Nagpur Central Depot', 'nagpur'],
  ['Bengaluru Nelamangala Hub', 'bengaluru'],
  ['Kolkata Dock Yard', 'kolkata'],
];
