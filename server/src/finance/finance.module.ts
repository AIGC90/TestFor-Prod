import { Global, Module } from '@nestjs/common';
import { AnalyticsController, AnalyticsService } from './analytics';
import { FastagAccountsController, FastagController, FastagService } from './fastag';
import { InvoiceActionsController, InvoicesController, InvoicesService } from './invoices';
import { DashcamController, DeviceLicensesController, SubscriptionsController, SubscriptionsService } from './subscriptions';

@Global()
@Module({
  controllers: [InvoicesController, InvoiceActionsController, AnalyticsController, FastagAccountsController, FastagController, DeviceLicensesController, SubscriptionsController, DashcamController],
  providers: [InvoicesService, AnalyticsService, FastagService, SubscriptionsService],
  exports: [InvoicesService, AnalyticsService, FastagService, SubscriptionsService],
})
export class FinanceModule {}
