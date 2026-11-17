import {
  Controller,
  Post,
  Req,
  Res,
  Headers,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as crypto from 'crypto';
import { FinanceService } from './finance.service.js';

@Controller(['api/finance/paystack-webhook', 'finance/paystack-webhook', 'api/webhook/paystack', 'webhooks/paystack'])
export class FinanceWebhookController {
  private readonly logger = new Logger(FinanceWebhookController.name);

  constructor(private readonly financeService: FinanceService) {}

  @Post()
  async handleWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    const paystackSecret =
      process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_WEBHOOK_SECRET;

    if (paystackSecret && signature) {
      const hash = crypto
        .createHmac('sha512', paystackSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');

      if (hash !== signature) {
        this.logger.warn('Paystack Webhook signature mismatch.');
        return res.status(HttpStatus.BAD_REQUEST).json({ message: 'Invalid signature' });
      }
    }

    try {
      this.logger.log(`Received Paystack Webhook event: ${req.body?.event}`);
      const result = await this.financeService.handlePaystackWebhook(req.body);
      return res.status(HttpStatus.OK).json(result);
    } catch (err: any) {
      this.logger.error(`Webhook processing error: ${err.message}`, err.stack);
      return res.status(HttpStatus.OK).json({ status: 'error', message: err.message });
    }
  }
}
