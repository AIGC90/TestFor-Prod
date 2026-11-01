import { Injectable } from '@nestjs/common';
import { TraccarService } from './traccar.service';

/** "MH-12 rn 8821" and "MH12RN8821" are the same vehicle. */
export const vehicleKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

interface Device {
  id: number;
  name: string;
}
interface Position {
  deviceId: number;
  attributes: { odometer?: number; totalDistance?: number };
}

/** Current odometer (km) per vehicle number, from the latest Traccar positions. */
@Injectable()
export class OdometerService {
  constructor(private readonly traccar: TraccarService) {}

  async readings(cookie: string): Promise<Map<string, number>> {
    try {
      const [devices, positions] = await Promise.all([
        this.traccar.get<Device[]>(cookie, '/devices'),
        this.traccar.get<Position[]>(cookie, '/positions'),
      ]);
      const pos = new Map(positions.map((p) => [p.deviceId, p]));
      const out = new Map<string, number>();
      for (const d of devices) {
        const p = pos.get(d.id);
        const metres = p?.attributes.odometer ?? p?.attributes.totalDistance;
        if (metres !== undefined) out.set(vehicleKey(d.name), Math.round(metres / 100) / 10);
      }
      return out;
    } catch {
      return new Map();
    }
  }
}
