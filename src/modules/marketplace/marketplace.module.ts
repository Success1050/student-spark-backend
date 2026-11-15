import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller.js';
import { MarketplaceService } from './marketplace.service.js';
import { DrmWatermarkService } from './drm/drm-watermark.service.js';
import { ReferralsWalletModule } from '../referrals-wallet/referrals-wallet.module.js';

@Module({
  imports: [ReferralsWalletModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, DrmWatermarkService],
  exports: [MarketplaceService, DrmWatermarkService],
})
export class MarketplaceModule {}
