import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  ProcessWithdrawalStatusDto,
  ResolveAccountDto,
  SimulateReferralRewardDto,
  WithdrawalRequestDto,
} from './dto/referrals-wallet.dto.js';

export interface BankItem {
  id?: number | string;
  name: string;
  code: string;
  slug?: string;
}

const FALLBACK_NIGERIAN_BANKS: BankItem[] = [
  { name: 'Access Bank', code: '044', slug: 'access-bank' },
  { name: 'Guaranty Trust Bank (GTBank)', code: '058', slug: 'gtbank' },
  { name: 'Zenith Bank', code: '057', slug: 'zenith-bank' },
  { name: 'First Bank of Nigeria', code: '011', slug: 'first-bank' },
  { name: 'United Bank for Africa (UBA)', code: '033', slug: 'uba' },
  { name: 'Kuda Microfinance Bank', code: '50211', slug: 'kuda-bank' },
  { name: 'OPay Digital Services', code: '999992', slug: 'opay' },
  { name: 'PalmPay', code: '999991', slug: 'palmpay' },
  { name: 'Moniepoint Microfinance Bank', code: '50515', slug: 'moniepoint' },
  { name: 'Fidelity Bank', code: '070', slug: 'fidelity-bank' },
  { name: 'First City Monument Bank (FCMB)', code: '214', slug: 'fcmb' },
  { name: 'Stanbic IBTC Bank', code: '039', slug: 'stanbic-ibtc' },
  { name: 'Sterling Bank', code: '232', slug: 'sterling-bank' },
  { name: 'Union Bank of Nigeria', code: '032', slug: 'union-bank' },
  { name: 'Wema Bank (ALAT)', code: '035', slug: 'wema-bank' },
  { name: 'Polaris Bank', code: '076', slug: 'polaris-bank' },
  { name: 'Keystone Bank', code: '082', slug: 'keystone-bank' },
  { name: 'Jaiz Bank', code: '301', slug: 'jaiz-bank' },
  { name: 'Taj Bank', code: '302', slug: 'taj-bank' },
  { name: 'VFD Microfinance Bank', code: '566', slug: 'vfd' },
];

/**
 * StudentSpark 2.0 Viral Referral & Cash-Back Engine + Unified Wallet Ledger
 * Handles referral attribution (20% student sub commission, 10% school onboarding bounty),
 * Paystack NUBAN bank account verification, withdrawal requests, and 3-channel payout alerts.
 */
@Injectable()
export class ReferralsWalletService {
  private readonly logger = new Logger(ReferralsWalletService.name);
  private cachedBanks: BankItem[] | null = null;
  private lastBanksFetch = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private maskEmail(email?: string | null): string {
    if (!email) return 'Anonymous';
    const [name, domain] = email.split('@');
    if (!domain) return email;
    const maskedName =
      name.length > 2
        ? `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}`
        : `${name}*`;
    return `${maskedName}@${domain}`;
  }

  private async getOrCreatePlatformConfig() {
    let config = await this.prisma.platformConfig.findUnique({
      where: { key: 'GLOBAL' },
    });
    if (!config) {
      config = await this.prisma.platformConfig
        .create({
          data: {
            key: 'GLOBAL',
            studentReferralCommissionPercent: 20.0,
            schoolReferralBountyPercent: 10.0,
            marketplacePlatformPercent: 20.0,
            minimumWithdrawalKobo: 100000, // ₦1,000
          },
        })
        .catch(() => null);
    }
    return config;
  }

  /**
   * Retrieves the comprehensive wallet overview and referral statistics for a user.
   */
  async getWalletOverview(userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        referralCode: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    let referralCode = user.referralCode;
    if (!referralCode) {
      referralCode = `SPARK-${randomUUID().slice(0, 6).toUpperCase()}`;
      await this.prisma.user.update({
        where: { id: userId },
        data: { referralCode },
      });
    }

    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        availableBalanceKobo: 0,
        pendingBalanceKobo: 0,
        totalWithdrawnKobo: 0,
      },
    });

    const config = await this.getOrCreatePlatformConfig();
    const commissionPercent = config?.studentReferralCommissionPercent ?? 20.0;
    const minimumWithdrawalKobo = config?.minimumWithdrawalKobo ?? 100000;

    const totalReferrals = await this.prisma.referral.count({
      where: { referrerId: userId },
    });

    const rewardedReferrals = await this.prisma.referral.count({
      where: { referrerId: userId, hasRewarded: true },
    });

    const totalEarnedKobo =
      wallet.availableBalanceKobo +
      wallet.totalWithdrawnKobo +
      wallet.pendingBalanceKobo;

    const shareMessage = `Join me on the StudentSpark mobile app! Download the app, tap Create Account, and enter my referral code: *${referralCode}* to get started.`;

    return {
      userId,
      referralCode,
      shareMessage,
      availableBalanceKobo: wallet.availableBalanceKobo,
      pendingBalanceKobo: wallet.pendingBalanceKobo,
      totalWithdrawnKobo: wallet.totalWithdrawnKobo,
      totalEarnedKobo,
      commissionPercent,
      minimumWithdrawalKobo,
      totalReferrals,
      rewardedReferrals,
      savedBankDetails: {
        bankName: wallet.bankName,
        bankCode: wallet.bankCode,
        accountNumber: wallet.accountNumber,
        accountName: wallet.accountName,
      },
    };
  }

  /**
   * Returns transaction ledger history and withdrawal requests for the user's wallet.
   */
  async getLedgerHistory(userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      return {
        transactions: [],
        withdrawals: [],
      };
    }

    const [transactions, withdrawals] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.withdrawalRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    return {
      transactions,
      withdrawals,
    };
  }

  /**
   * Returns list of students referred by this user.
   */
  async getReferredUsers(userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referredUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
            email: true,
            plan: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return referrals.map((ref) => ({
      id: ref.id,
      referredUserId: ref.referredUserId,
      name:
        ref.referredUser.fullName ||
        ref.referredUser.username ||
        'StudentSpark Scholar',
      emailMasked: this.maskEmail(ref.referredUser.email),
      plan: ref.referredUser.plan,
      commissionEarnedKobo: ref.commissionEarnedKobo,
      hasRewarded: ref.hasRewarded,
      joinedAt: ref.createdAt,
    }));
  }

  /**
   * Returns the list of Nigerian commercial & microfinance banks for Paystack NUBAN transfers.
   */
  async getBankList(): Promise<BankItem[]> {
    const ONE_HOUR = 60 * 60 * 1000;
    if (this.cachedBanks && Date.now() - this.lastBanksFetch < ONE_HOUR) {
      return this.cachedBanks;
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (paystackSecret) {
      try {
        const response = await axios.get(
          'https://api.paystack.co/bank?country=nigeria&perPage=100',
          {
            headers: {
              Authorization: `Bearer ${paystackSecret}`,
              'Content-Type': 'application/json',
            },
            timeout: 7000,
          },
        );

        if (response.data?.status && Array.isArray(response.data?.data)) {
          const banks: BankItem[] = response.data.data.map((b: any) => ({
            id: b.id,
            name: b.name,
            code: b.code,
            slug: b.slug,
          }));
          this.cachedBanks = banks;
          this.lastBanksFetch = Date.now();
          return banks;
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to fetch live banks from Paystack: ${err.message}. Using built-in fallback banks.`,
        );
      }
    }

    this.cachedBanks = FALLBACK_NIGERIAN_BANKS;
    this.lastBanksFetch = Date.now();
    return FALLBACK_NIGERIAN_BANKS;
  }

  /**
   * Resolves a Nigerian 10-digit NUBAN account number against a specific bank code using Paystack.
   */
  async resolveBankAccount(dto: ResolveAccountDto) {
    const { accountNumber, bankCode } = dto;
    const cleanAccount = accountNumber?.trim();
    const cleanBank = bankCode?.trim();

    if (!cleanAccount || cleanAccount.length !== 10 || !/^\d{10}$/.test(cleanAccount)) {
      throw new BadRequestException('A valid 10-digit Nigerian NUBAN account number is required');
    }

    if (!cleanBank) {
      throw new BadRequestException('Bank code is required');
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (paystackSecret) {
      try {
        const response = await axios.get(
          `https://api.paystack.co/bank/resolve?account_number=${cleanAccount}&bank_code=${cleanBank}`,
          {
            headers: {
              Authorization: `Bearer ${paystackSecret}`,
              'Content-Type': 'application/json',
            },
            timeout: 8000,
          },
        );

        if (response.data?.status && response.data?.data) {
          return {
            accountNumber: cleanAccount,
            accountName: response.data.data.account_name,
            bankId: response.data.data.bank_id,
            bankCode: cleanBank,
          };
        }
      } catch (err: any) {
        this.logger.warn(
          `Paystack account resolution failed: ${err?.response?.data?.message || err.message}`,
        );
        // If Paystack reports invalid account, rethrow
        if (err?.response?.data?.message) {
          throw new BadRequestException(err.response.data.message);
        }
      }
    }

    // In dev / sandbox mode without live KYC or offline, simulate verification
    return {
      accountNumber: cleanAccount,
      accountName: 'VERIFIED SCHOLAR ACCOUNT',
      bankId: 0,
      bankCode: cleanBank,
      isSimulated: true,
    };
  }

  /**
   * Processes a bank withdrawal request for a student/user from their available referral balance.
   */
  async requestWithdrawal(userId: string, dto: WithdrawalRequestDto) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const amountKobo = Number(dto.amountKobo);
    if (!amountKobo || amountKobo <= 0) {
      throw new BadRequestException('A valid positive withdrawal amount is required');
    }

    const config = await this.getOrCreatePlatformConfig();
    const minimumWithdrawalKobo = config?.minimumWithdrawalKobo ?? 100000;

    if (amountKobo < minimumWithdrawalKobo) {
      const minNaira = (minimumWithdrawalKobo / 100).toLocaleString();
      throw new BadRequestException(
        `Minimum withdrawal amount is ₦${minNaira}`,
      );
    }

    const cleanAccount = dto.accountNumber?.trim();
    if (!cleanAccount || cleanAccount.length !== 10) {
      throw new BadRequestException('Please provide a valid 10-digit account number');
    }
    if (!dto.bankCode || !dto.bankName) {
      throw new BadRequestException('Bank selection is required');
    }
    if (!dto.accountName?.trim()) {
      throw new BadRequestException('Verified account name is required');
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new BadRequestException('No wallet found for this user');
    }

    if (wallet.availableBalanceKobo < amountKobo) {
      const availableNaira = (wallet.availableBalanceKobo / 100).toLocaleString();
      const requestedNaira = (amountKobo / 100).toLocaleString();
      throw new BadRequestException(
        `Insufficient available balance. You requested ₦${requestedNaira}, but your available balance is ₦${availableNaira}.`,
      );
    }

    const withdrawalRef = `WTH-${randomUUID().slice(0, 8).toUpperCase()}`;

    // Execute atomic wallet debit and withdrawal request creation
    const [updatedWallet, withdrawal] = await this.prisma.$transaction([
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalanceKobo: { decrement: amountKobo },
          pendingBalanceKobo: { increment: amountKobo },
          bankName: dto.bankName.trim(),
          bankCode: dto.bankCode.trim(),
          accountNumber: cleanAccount,
          accountName: dto.accountName.trim(),
        },
      }),
      this.prisma.withdrawalRequest.create({
        data: {
          walletId: wallet.id,
          userId,
          amountKobo,
          status: 'PENDING',
          bankDetailsJson: {
            bankName: dto.bankName.trim(),
            bankCode: dto.bankCode.trim(),
            accountNumber: cleanAccount,
            accountName: dto.accountName.trim(),
          },
        },
      }),
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'DEBIT',
          category: 'WITHDRAWAL',
          amountKobo,
          reference: withdrawalRef,
          description: `Withdrawal request to ${dto.bankName.trim()} (${cleanAccount})`,
        },
      }),
    ]);

    const amountNaira = (amountKobo / 100).toLocaleString();

    // Dispatch 3-channel alert: In-App, Push & Email
    void this.notifications.dispatchNotification({
      userId,
      title: '💸 Withdrawal Request Submitted!',
      body: `Your request to withdraw ₦${amountNaira} to ${dto.bankName} (${cleanAccount}) is currently being processed.`,
      category: 'WALLET',
      deepLink: '/referrals',
      channels: { inApp: true, push: true, email: true },
      emailSubject: `StudentSpark Withdrawal Notice: ₦${amountNaira} Pending`,
    });

    return {
      success: true,
      message: `Withdrawal request of ₦${amountNaira} submitted successfully and is pending review.`,
      withdrawal,
      wallet: updatedWallet,
    };
  }

  /**
   * Simulates or awards a referral reward manually (useful for testing or subscription webhook hooks).
   */
  async simulateReferralReward(dto: SimulateReferralRewardDto) {
    let referrerUser = null;
    if (dto.referralCode?.trim()) {
      referrerUser = await this.prisma.user.findUnique({
        where: { referralCode: dto.referralCode.trim().toUpperCase() },
      });
    } else if (dto.referrerId?.trim()) {
      referrerUser = await this.prisma.user.findUnique({
        where: { id: dto.referrerId.trim() },
      });
    }

    if (!referrerUser) {
      throw new NotFoundException(
        `Referrer with code "${dto.referralCode}" or ID not found`,
      );
    }

    const paidNaira = Number(dto.amountPaidNaira) || 3000; // default standard Premium subscription
    const config = await this.getOrCreatePlatformConfig();
    const commissionPercent = config?.studentReferralCommissionPercent ?? 20.0;
    const commissionNaira = Math.round((paidNaira * commissionPercent) / 100);
    const commissionKobo = commissionNaira * 100;

    const wallet = await this.prisma.wallet.upsert({
      where: { userId: referrerUser.id },
      update: {
        availableBalanceKobo: { increment: commissionKobo },
      },
      create: {
        userId: referrerUser.id,
        availableBalanceKobo: commissionKobo,
      },
    });

    const txRef = `REF-SIM-${randomUUID().slice(0, 8).toUpperCase()}`;

    await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'CREDIT',
        category: 'REFERRAL_COMMISSION',
        amountKobo: commissionKobo,
        reference: txRef,
        description: `${commissionPercent}% Referral reward earned (₦${commissionNaira.toLocaleString()})`,
      },
    });

    // Dispatch 3-channel alert
    void this.notifications.dispatchNotification({
      userId: referrerUser.id,
      title: `💰 You Earned ₦${commissionNaira.toLocaleString()} Referral Reward!`,
      body: `A friend subscribed with your code! ₦${commissionNaira.toLocaleString()} has been added to your StudentSpark Wallet.`,
      category: 'WALLET',
      deepLink: '/referrals',
      channels: { inApp: true, push: true, email: true },
      emailSubject: `💰 You earned ₦${commissionNaira.toLocaleString()} on StudentSpark!`,
    });

    return {
      success: true,
      message: `Credited ₦${commissionNaira.toLocaleString()} referral commission to ${referrerUser.email}`,
      referrerId: referrerUser.id,
      commissionNaira,
      commissionKobo,
      walletBalanceKobo: wallet.availableBalanceKobo,
    };
  }

  /**
   * SuperAdmin / Payout status processor (Approve, Pay, or Reject a withdrawal).
   */
  async processWithdrawalStatus(dto: ProcessWithdrawalStatusDto) {
    const { withdrawalId, action, reason } = dto;

    const withdrawal = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
      include: { wallet: true },
    });

    if (!withdrawal) {
      throw new NotFoundException(`Withdrawal request ${withdrawalId} not found`);
    }

    if (withdrawal.status === 'PAID') {
      throw new BadRequestException('This withdrawal has already been paid');
    }

    const amountNaira = (withdrawal.amountKobo / 100).toLocaleString();

    if (action === 'PAY' || action === 'APPROVE') {
      await this.prisma.$transaction([
        this.prisma.wallet.update({
          where: { id: withdrawal.walletId },
          data: {
            pendingBalanceKobo: { decrement: withdrawal.amountKobo },
            totalWithdrawnKobo: { increment: withdrawal.amountKobo },
          },
        }),
        this.prisma.withdrawalRequest.update({
          where: { id: withdrawalId },
          data: {
            status: 'PAID',
            processedAt: new Date(),
          },
        }),
      ]);

      void this.notifications.dispatchNotification({
        userId: withdrawal.userId,
        title: '🎉 Payout Sent to Your Bank Account!',
        body: `Your withdrawal of ₦${amountNaira} has been approved and paid out to your bank account.`,
        category: 'WALLET',
        deepLink: '/referrals',
        channels: { inApp: true, push: true, email: true },
        emailSubject: `StudentSpark Payout Complete: ₦${amountNaira} Sent`,
      });

      return {
        success: true,
        message: `Withdrawal of ₦${amountNaira} marked as PAID`,
        status: 'PAID',
      };
    }

    if (action === 'REJECT') {
      const rejectReason = reason || 'Bank details mismatch or compliance rejection';

      await this.prisma.$transaction([
        this.prisma.wallet.update({
          where: { id: withdrawal.walletId },
          data: {
            pendingBalanceKobo: { decrement: withdrawal.amountKobo },
            availableBalanceKobo: { increment: withdrawal.amountKobo },
          },
        }),
        this.prisma.withdrawalRequest.update({
          where: { id: withdrawalId },
          data: {
            status: 'REJECTED',
            rejectionReason: rejectReason,
            processedAt: new Date(),
          },
        }),
        this.prisma.walletTransaction.create({
          data: {
            walletId: withdrawal.walletId,
            type: 'CREDIT',
            category: 'REFUND',
            amountKobo: withdrawal.amountKobo,
            reference: `REFUND-${randomUUID().slice(0, 8).toUpperCase()}`,
            description: `Refund for rejected withdrawal: ${rejectReason}`,
          },
        }),
      ]);

      void this.notifications.dispatchNotification({
        userId: withdrawal.userId,
        title: '⚠️ Withdrawal Request Declined',
        body: `Your withdrawal of ₦${amountNaira} was declined (${rejectReason}). The funds have been refunded to your available balance.`,
        category: 'WALLET',
        deepLink: '/referrals',
        channels: { inApp: true, push: true, email: true },
        emailSubject: `StudentSpark Withdrawal Notice: Funds Refunded`,
      });

      return {
        success: true,
        message: `Withdrawal of ₦${amountNaira} rejected and refunded to wallet`,
        status: 'REJECTED',
      };
    }

    throw new BadRequestException(`Unsupported action: ${action}`);
  }
}
