import { Module } from '@nestjs/common';
import { ReferralsWalletController } from './referrals-wallet.controller.js';
import { ReferralsWalletService } from './referrals-wallet.service.js';

@Module({
  controllers: [ReferralsWalletController],
  providers: [ReferralsWalletService],
  exports: [ReferralsWalletService],
})
export class ReferralsWalletModule {}
