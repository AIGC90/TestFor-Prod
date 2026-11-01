import { Global, Module } from '@nestjs/common';
import { ComplianceController, ComplianceDocsController, ComplianceService } from './compliance';
import { DriverProfilesController, DriversController, DriversService } from './drivers';
import { ExpenseClaimsController, FieldController, FieldService, FieldStaffController, FieldTasksController } from './field';
import { ClaimsController, EmergencyContactsController, IncidentsController, SafetyController, SafetyService } from './safety';

@Global()
@Module({
  controllers: [
    ComplianceController,
    ComplianceDocsController,
    SafetyController,
    IncidentsController,
    ClaimsController,
    EmergencyContactsController,
    DriversController,
    DriverProfilesController,
    FieldController,
    FieldStaffController,
    FieldTasksController,
    ExpenseClaimsController,
  ],
  providers: [ComplianceService, SafetyService, DriversService, FieldService],
  exports: [ComplianceService, SafetyService, DriversService, FieldService],
})
export class PeopleModule {}
