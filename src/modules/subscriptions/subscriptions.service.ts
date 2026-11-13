import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { BillingCycle, SubscriptionPlanType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service.js';

/**
 * Merged from studentspark_backend/AIRoutes/paystackRoute.js + plansActions.tsx
 * Provides GET /subscriptions/plans, POST /api/verify-paystack, and automatic Referral Commission credit.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getSubscriptionPlans() {
    let plans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      include: { features: true },
      orderBy: { price: 'asc' },
    });

    if (plans.length === 0) {
      await this.seedDefaultPlans();
      plans = await this.prisma.subscriptionPlan.findMany({
        where: { isActive: true },
        include: { features: true },
        orderBy: { price: 'asc' },
      });
    }

    const colorMap: Record<string, string> = {
      free: '#64748b',
      premium: '#6366f1',
      pro: '#f59e0b',
    };
    const iconMap: Record<string, string> = {
      free: 'leaf-outline',
      premium: 'sparkles',
      pro: 'rocket',
    };

    const formatted: Record<
      string,
      {
        name: string;
        color: string;
        icon: string;
        price: number;
        features: string[];
      }
    > = {};

    for (const plan of plans) {
      formatted[plan.code] = {
        name: plan.name,
        color: colorMap[plan.code] || '#6366f1',
        icon: iconMap[plan.code] || 'sparkles',
        price: plan.price,
        features: plan.features.map((f) => f.feature),
      };
    }

    return formatted;
  }

  private async seedDefaultPlans() {
    const defaults = [
      {
        code: 'free',
        name: 'Free Starter',
        price: 0,
        features: [
          '2 AI Note Summaries per day',
          '1 AI Study Plan per day',
          '2 AI Quiz & PQ Generations per day',
          'Access to Free E-Library Handouts',
          'Educative Brain Games Arcade',
        ],
      },
      {
        code: 'premium',
        name: 'Premium Scholar',
        price: 3000,
        features: [
          '5 AI Note Summaries per day',
          '3 AI Study Plans per day',
          '5 AI Quiz & PQ Generations per day',
          'Scanned PDF Vision OCR Support',
          'Priority Study Community Creation',
        ],
      },
      {
        code: 'pro',
        name: 'Unlimited Pro',
        price: 5000,
        features: [
          'Unlimited AI Note Summaries & Vision OCR',
          'Unlimited AI Study Plans & Smart Reminders',
          'Unlimited AI Quizzes & Exam PQ Predictions',
          'Full 1v1 Live Quiz Battle & Scholar Ladder',
          'Zero Seller Fee Boost on E-Library Uploads',
        ],
      },
    ];

    for (const item of defaults) {
      await this.prisma.subscriptionPlan
        .upsert({
          where: { code: item.code },
          update: {},
          create: {
            code: item.code,
            name: item.name,
            price: item.price,
            features: {
              create: item.features.map((feature) => ({ feature })),
            },
          },
        })
        .catch(() => undefined);
    }
  }

  async verifyPaystackPayment(params: {
    reference: string;
    userId: string;
    planType?: string;
    selectedPlan?: string;
    billingCycle: 'monthly' | 'yearly';
  }) {
    const { reference, userId, billingCycle } = params;
    const resolvedPlanType = params.planType || params.selectedPlan;

    if (!reference || !userId || !resolvedPlanType || !billingCycle) {
      throw new BadRequestException(
        'Missing required fields: reference, userId, planType, billingCycle',
      );
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      throw new BadRequestException('PAYSTACK_SECRET_KEY is not configured on the server');
    }

    const verifyResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const verifyData = verifyResponse.data;
    if (!verifyData.status || verifyData.data?.status !== 'success') {
      throw new BadRequestException({
        error: 'Payment verification failed or transaction was not successful.',
        details: verifyData.message,
      });
    }

    const now = new Date();
    const subscriptionEnd = new Date(now);
    if (billingCycle === 'yearly') {
      subscriptionEnd.setFullYear(subscriptionEnd.getFullYear() + 1);
    } else {
      subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);
    }

    const normalizedPlan = resolvedPlanType.toLowerCase() as SubscriptionPlanType;
    const normalizedCycle = billingCycle as BillingCycle;

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        plan: normalizedPlan,
        billingCycle: normalizedCycle,
        subscriptionStart: now,
        subscriptionEnd,
      },
    });

    const amountPaidKobo: number = Number(verifyData.data?.amount) || 0;
    if (updatedUser.referredById && amountPaidKobo > 0) {
      await this.creditReferrerOnSubscription(
        updatedUser.referredById,
        updatedUser.id,
        amountPaidKobo,
        reference,
      );
    }

    void this.notifications.dispatchNotification({
      userId: updatedUser.id,
      title: `🚀 Upgraded to ${normalizedPlan.toUpperCase()} (${normalizedCycle})!`,
      body: `Your payment was verified and your ${normalizedPlan.toUpperCase()} subscription is now active until ${subscriptionEnd.toLocaleDateString('en-GB')}.`,
      category: 'FINANCE',
      deepLink: '/(main)/Profile',
      channels: { inApp: true, push: true, email: true },
      emailSubject: `StudentSpark Receipt: ${normalizedPlan.toUpperCase()} Subscription Activated`,
    });

    return {
      success: true,
      message: 'Payment verified and subscription updated.',
      subscription: {
        plan: updatedUser.plan,
        billingCycle: updatedUser.billingCycle,
        subscriptionStart: updatedUser.subscriptionStart,
        subscriptionEnd: updatedUser.subscriptionEnd,
      },
    };
  }

  private async creditReferrerOnSubscription(
    referrerId: string,
    referredUserId: string,
    amountPaidKobo: number,
    paystackRef: string,
  ) {
    try {
      const config = await this.prisma.platformConfig.findUnique({
        where: { key: 'GLOBAL' },
      });
      const commissionPercent = config?.studentReferralCommissionPercent ?? 20.0;
      const commissionKobo = Math.round((amountPaidKobo * commissionPercent) / 100);

      if (commissionKobo <= 0) return;

      const wallet = await this.prisma.wallet.upsert({
        where: { userId: referrerId },
        update: {
          availableBalanceKobo: { increment: commissionKobo },
        },
        create: {
          userId: referrerId,
          availableBalanceKobo: commissionKobo,
        },
      });

      await this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'CREDIT',
          category: 'REFERRAL_COMMISSION',
          amountKobo: commissionKobo,
          reference: `REF-${paystackRef}-${randomUUID().slice(0, 6)}`,
          description: `${commissionPercent}% Referral commission earned from student subscription`,
        },
      });

      await this.prisma.referral.upsert({
        where: { referredUserId },
        update: {
          commissionEarnedKobo: { increment: commissionKobo },
          hasRewarded: true,
        },
        create: {
          referrerId,
          referredUserId,
          commissionEarnedKobo: commissionKobo,
          hasRewarded: true,
        },
      });

      const nairaEarned = (commissionKobo / 100).toLocaleString();
      void this.notifications.dispatchNotification({
        userId: referrerId,
        title: `💰 You Earned ₦${nairaEarned} Referral Commission!`,
        body: `Your referred friend upgraded their subscription and ₦${nairaEarned} has been credited to your wallet.`,
        category: 'WALLET',
        deepLink: '/(main)/Profile',
        channels: { inApp: true, push: true, email: true },
        emailSubject: `💰 You earned ₦${nairaEarned} on StudentSpark!`,
      });
    } catch (error) {
      this.logger.warn('Referral commission attribution skipped or already processed', error);
    }
  }
}
