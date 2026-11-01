import { Global, Module } from '@nestjs/common';
import { OdometerService } from './odometer.service';
import { TraccarService } from './traccar.service';

@Global()
@Module({ providers: [TraccarService, OdometerService], exports: [TraccarService, OdometerService] })
export class TraccarModule {}
