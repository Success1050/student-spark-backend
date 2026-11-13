export class ResolveAccountDto {
  accountNumber: string;
  bankCode: string;
}

export class WithdrawalRequestDto {
  userId?: string;
  amountKobo: number;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export class ProcessWithdrawalStatusDto {
  withdrawalId: string;
  action: 'APPROVE' | 'PAY' | 'REJECT';
  reason?: string;
}

export class SimulateReferralRewardDto {
  referralCode?: string;
  referrerId?: string;
  amountPaidNaira?: number;
}
