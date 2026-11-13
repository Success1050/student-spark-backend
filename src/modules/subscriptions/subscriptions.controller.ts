import { Body, Controller, Get, Post } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';

@Controller()
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('subscriptions/plans')
  getPlans() {
    return this.subscriptionsService.getSubscriptionPlans();
  }

  @Post('api/verify-paystack')
  verifyPaystack(
    @Body()
    body: {
      reference: string;
      userId?: string;
      planType?: string;
      selectedPlan?: string;
      billingCycle: 'monthly' | 'yearly';
    },
    @UserId() userId: string,
  ) {
    return this.subscriptionsService.verifyPaystackPayment({
      ...body,
      userId: userId || body.userId || '',
    });
  }
}
