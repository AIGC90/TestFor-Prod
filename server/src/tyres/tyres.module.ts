import { Global, Module } from '@nestjs/common';
import { TyreRegisterController, TyresController } from './tyres.controller';
import { TyresService } from './tyres.service';

@Global()
@Module({
  // the register CRUD (tyres/register/...) is listed before the generic tyres/:id actions
  controllers: [TyreRegisterController, TyresController],
  providers: [TyresService],
  exports: [TyresService],
})
export class TyresModule {}
