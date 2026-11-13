import {
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { ReferralsWalletService } from './referrals-wallet.service.js';
import {
  ProcessWithdrawalStatusDto,
  ResolveAccountDto,
  SimulateReferralRewardDto,
  WithdrawalRequestDto,
} from './dto/referrals-wallet.dto.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';

@Controller('referrals-wallet')
export class ReferralsWalletController {
  constructor(private readonly referralsWalletService: ReferralsWalletService) {}

  @Get('overview')
  getOverview(@UserId() userId: string) {
    return this.referralsWalletService.getWalletOverview(userId);
  }

  @Get('history')
  getLedgerHistory(@UserId() userId: string) {
    return this.referralsWalletService.getLedgerHistory(userId);
  }

  @Get('referred-users')
  getReferredUsers(@UserId() userId: string) {
    return this.referralsWalletService.getReferredUsers(userId);
  }

  @Get('banks')
  getBankList() {
    return this.referralsWalletService.getBankList();
  }

  @Post('resolve-account')
  resolveAccount(@Body() dto: ResolveAccountDto) {
    return this.referralsWalletService.resolveBankAccount(dto);
  }

  @Post('withdraw')
  requestWithdrawal(
    @Body() dto: WithdrawalRequestDto,
    @UserId() userId: string,
  ) {
    return this.referralsWalletService.requestWithdrawal(userId, dto);
  }

  @Post('simulate-reward')
  simulateReward(@Body() dto: SimulateReferralRewardDto) {
    return this.referralsWalletService.simulateReferralReward(dto);
  }

  @Post('process-status')
  processStatus(@Body() dto: ProcessWithdrawalStatusDto) {
    return this.referralsWalletService.processWithdrawalStatus(dto);
  }
}
