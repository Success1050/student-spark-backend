import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service.js';
import {
  FirstLoginChangePasswordDto,
  InstitutionLoginDto,
  LoginDto,
  RegisterDto,
  ResendLoginOtpDto,
  VerifyLoginOtpDto,
} from './dto/auth.dto.js';
import { EmailNotificationProvider } from '../notifications/providers/email-notification.provider.js';
import { NotificationsService } from '../notifications/notifications.service.js';

/**
 * Replaces supabase.auth.* (signUp, signInWithPassword, getSession, resetPasswordForEmail)
 * and /delete-account in studentspark_backend/server.js
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailProvider: EmailNotificationProvider,
    private readonly notifications: NotificationsService,
  ) {}

  private getJwtSecret(): Uint8Array {
    const secret =
      process.env.JWT_SECRET ||
      process.env.JWT_ACCESS_SECRET ||
      'studentspark-default-secret-key';
    return new TextEncoder().encode(secret);
  }

  private async signTokens(user: {
    id: string;
    email: string;
    role: string;
    schoolId?: string | null;
    plan: string;
  }) {
    const secret = this.getJwtSecret();

    const accessToken = await new SignJWT({
      sub: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId ?? null,
      plan: user.plan,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(secret);

    const refreshToken = await new SignJWT({
      sub: user.id,
      type: 'refresh',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('90d')
      .sign(secret);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshToken,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  private formatAuthUser(user: {
    id: string;
    email: string;
    fullName: string | null;
    username: string | null;
    avatarUrl: string | null;
    role: string;
    schoolId: string | null;
    classId: string | null;
    plan: string;
    referralCode: string;
  }) {
    return {
      id: user.id,
      user_id: user.id,
      email: user.email,
      fullName: user.fullName || user.username || user.email.split('@')[0],
      full_name: user.fullName || user.username || user.email.split('@')[0],
      username: user.username || user.fullName || user.email.split('@')[0],
      avatar_url: user.avatarUrl,
      role: user.role,
      schoolId: user.schoolId,
      school_id: user.schoolId,
      classId: user.classId,
      plan: user.plan,
      referralCode: user.referralCode,
      referral_code: user.referralCode,
    };
  }

  async register(dto: RegisterDto) {
    const email = dto.email?.trim()?.toLowerCase();
    if (!email || !dto.password) {
      throw new BadRequestException('Email and password are required');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const uniqueRefCode = `SPARK-${randomUUID().slice(0, 6).toUpperCase()}`;

    let referredById: string | null = null;
    if (dto.referralCode?.trim()) {
      const referrer = await this.prisma.user.findUnique({
        where: { referralCode: dto.referralCode.trim().toUpperCase() },
      });
      if (referrer) {
        referredById = referrer.id;
      }
    }

    let schoolId: string | null = null;
    let classId: string | null = null;
    if (dto.schoolInviteCode?.trim()) {
      const code = dto.schoolInviteCode.trim().toUpperCase();
      const schoolClass = await this.prisma.schoolClass.findUnique({
        where: { inviteCode: code },
      });
      if (schoolClass) {
        schoolId = schoolClass.schoolId;
        classId = schoolClass.id;
      } else {
        const school = await this.prisma.school.findUnique({
          where: { schoolCode: code },
        });
        if (school) {
          schoolId = school.id;
        }
      }
    }

    const userRole = dto.role === 'TEACHER' ? 'TEACHER' : 'STUDENT';

    const createdUser = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: dto.fullName?.trim() || email.split('@')[0],
        username: dto.fullName?.trim() || email.split('@')[0],
        role: userRole,
        referralCode: uniqueRefCode,
        referredById,
        schoolId,
        classId,
        wallet: {
          create: {
            availableBalanceKobo: 0,
            pendingBalanceKobo: 0,
            totalWithdrawnKobo: 0,
          },
        },
      },
    });

    if (referredById) {
      await this.prisma.referral
        .create({
          data: {
            referrerId: referredById,
            referredUserId: createdUser.id,
            commissionEarnedKobo: 0,
            hasRewarded: false,
          },
        })
        .catch(() => undefined);
    }

    const tokens = await this.signTokens(createdUser);
    const formattedUser = this.formatAuthUser(createdUser);

    void this.notifications.dispatchNotification({
      userId: createdUser.id,
      title: '🎉 Welcome to StudentSpark!',
      body: `Hi ${formattedUser.fullName}, your AI study companion, E-Library, and smart academic tracker are ready. Upload your first note to get started!`,
      category: 'SYSTEM',
      deepLink: '/(main)/notesQuizes',
      channels: { inApp: true, push: true, email: true },
      emailSubject: 'Welcome to StudentSpark — Your AI Academic Super-App!',
    });

    if (referredById) {
      void this.notifications.dispatchNotification({
        userId: referredById,
        title: '🤝 New Referral Signup!',
        body: `${formattedUser.fullName} just joined using your referral code (${dto.referralCode?.toUpperCase()}). You will earn cash commission when they upgrade!`,
        category: 'WALLET',
        deepLink: '/(main)/Profile',
        channels: { inApp: true, push: true, email: true },
      });
    }

    return {
      user: formattedUser,
      session: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        user: formattedUser,
      },
    };
  }

  private maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return email;
    const name = parts[0];
    const masked =
      name.length <= 2
        ? name[0] + '*'
        : name[0] + '***' + name[name.length - 1];
    return `${masked}@${parts[1]}`;
  }

  private async generateAndSendLoginOtp(user: { id: string; email: string; fullName: string | null }) {
    // Invalidate previous unused OTPs for this user
    await this.prisma.loginOtp.updateMany({
      where: { userId: user.id, isUsed: false },
      data: { isUsed: true },
    });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const tempTicket = `ticket_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await this.prisma.loginOtp.create({
      data: {
        userId: user.id,
        code,
        tempTicket,
        expiresAt,
      },
    });

    console.log(`[AUTH OTP] 🔑 Verification code for ${user.email} is: ${code} (Ticket: ${tempTicket})`);

    // Dispatch email notification
    void this.emailProvider
      .sendEmail({
        to: user.email,
        subject: `🔑 ${code} is your StudentSpark Verification Code`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #4f46e5; margin: 0; font-size: 24px; font-weight: 800;">StudentSpark 2.0</h2>
              <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Smart Multi-Tenant Academic Platform</p>
            </div>
            <p style="color: #1e293b; font-size: 15px; line-height: 22px;">Hello <b>${user.fullName || 'Scholar'}</b>,</p>
            <p style="color: #334155; font-size: 14px; line-height: 20px;">Use the 6-digit verification code below to complete your secure sign-in:</p>
            <div style="background: #f8fafc; border: 1.5px dashed #6366f1; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0;">
              <span style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #4338ca; font-family: monospace;">${code}</span>
            </div>
            <p style="color: #64748b; font-size: 12px; line-height: 18px; text-align: center;">This code will expire in <b>10 minutes</b>. Never share this code with anyone.</p>
          </div>
        `,
      })
      .catch((err) => {
        console.warn(`[OTP] Email delivery failed for ${user.email}. Code is: ${code}`, err?.message);
      });

    return {
      requiresOtp: true,
      tempTicket,
      maskedEmail: this.maskEmail(user.email),
      message: 'A 6-digit verification code has been sent to your registered email.',
      ...(process.env.NODE_ENV !== 'production' ? { devOtp: code } : {}),
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email?.trim()?.toLowerCase();
    if (!email || !dto.password) {
      throw new BadRequestException('Email and password are required');
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.generateAndSendLoginOtp(user);
  }

  async verifyLoginOtp(dto: VerifyLoginOtpDto) {
    const { tempTicket, code } = dto;
    if (!tempTicket || !code) {
      throw new BadRequestException('Verification ticket and code are required');
    }

    const otpRecord = await this.prisma.loginOtp.findUnique({
      where: { tempTicket },
      include: {
        user: {
          include: {
            memberships: { include: { school: true } },
            school: true,
            studentProfile: true,
            teacherProfile: true,
          },
        },
      },
    });

    if (!otpRecord) {
      throw new UnauthorizedException('Invalid or expired verification session. Please sign in again.');
    }

    if (otpRecord.isUsed) {
      throw new UnauthorizedException('This verification code has already been used. Please sign in again.');
    }

    if (new Date() > otpRecord.expiresAt) {
      throw new UnauthorizedException('Verification code has expired. Please request a new code.');
    }

    if (otpRecord.attempts >= 5) {
      throw new UnauthorizedException('Too many incorrect attempts. Please sign in again.');
    }

    if (otpRecord.code !== code.trim()) {
      await this.prisma.loginOtp.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      const remaining = 4 - otpRecord.attempts;
      throw new BadRequestException(`Incorrect verification code. ${remaining} attempt(s) remaining.`);
    }

    // Mark OTP as used
    await this.prisma.loginOtp.update({
      where: { id: otpRecord.id },
      data: { isUsed: true },
    });

    const targetUser = otpRecord.user;
    let targetMembership = targetUser.memberships?.[0] || null;
    const activeSchool = targetMembership?.school || targetUser.school;
    const effectiveRole = targetMembership?.role || targetUser.role;
    const mustChangePassword = !!(
      targetUser.mustChangePassword || targetMembership?.mustChangePassword
    );

    const secret = this.getJwtSecret();
    const accessToken = await new SignJWT({
      sub: targetUser.id,
      email: targetUser.email,
      role: effectiveRole,
      schoolId: activeSchool?.id || null,
      activeTenantId: activeSchool?.id || null,
      membershipId: targetMembership?.id || null,
      plan: targetUser.plan,
      mustChangePassword,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(secret);

    const refreshToken = await new SignJWT({
      sub: targetUser.id,
      type: 'refresh',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('90d')
      .sign(secret);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    await this.prisma.refreshToken.create({
      data: {
        userId: targetUser.id,
        tokenHash: refreshToken,
        expiresAt,
      },
    });

    const formattedUser = {
      ...this.formatAuthUser(targetUser),
      role: effectiveRole,
      schoolId: activeSchool?.id || null,
      schoolName: activeSchool?.name || null,
      schoolCode: activeSchool?.schoolCode || null,
      institutionType: activeSchool?.institutionType || null,
      loginId: targetMembership?.loginId || targetUser.loginId || null,
      mustChangePassword,
    };

    return {
      success: true,
      user: formattedUser,
      membership: targetMembership
        ? {
            id: targetMembership.id,
            role: targetMembership.role,
            status: targetMembership.status,
            schoolId: targetMembership.schoolId,
            schoolName: activeSchool?.name,
            institutionType: activeSchool?.institutionType,
            terminologyConfig: activeSchool?.terminologyConfig,
          }
        : null,
      mustChangePassword,
      session: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: formattedUser,
      },
    };
  }

  async resendLoginOtp(dto: ResendLoginOtpDto) {
    const { tempTicket } = dto;
    if (!tempTicket) {
      throw new BadRequestException('Session ticket is required');
    }

    const otpRecord = await this.prisma.loginOtp.findUnique({
      where: { tempTicket },
      include: { user: true },
    });

    if (!otpRecord) {
      throw new BadRequestException('Verification session expired. Please sign in again.');
    }

    return this.generateAndSendLoginOtp(otpRecord.user);
  }

  async getSessionFromToken(authHeader?: string) {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('No active session token');
    }
    const token = authHeader.slice(7).trim();
    try {
      const { payload } = await jwtVerify(token, this.getJwtSecret());
      const userId = String(payload.sub || '');
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new UnauthorizedException('User no longer exists');
      }
      const formattedUser = this.formatAuthUser(user);
      return {
        user: formattedUser,
        session: {
          access_token: token,
          user: formattedUser,
        },
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired session token');
    }
  }

  async requestPasswordReset(email: string) {
    if (!email?.trim()) {
      throw new BadRequestException('Email is required');
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (user) {
      await this.emailProvider
        .sendEmail({
          to: normalizedEmail,
          subject: 'StudentSpark Password Reset Request',
          html: `<p>Hi ${user.fullName || 'Scholar'},</p><p>Use the StudentSpark app to reset your password.</p>`,
        })
        .catch(() => undefined);
    }

    return {
      success: true,
      message: 'If that email is registered, a password reset link has been sent.',
    };
  }

  async institutionLogin(dto: InstitutionLoginDto) {
    const rawIdentifier = dto.identifier?.trim();
    if (!rawIdentifier || !dto.password) {
      throw new BadRequestException('Identifier (Email or Matric/Staff ID) and password are required');
    }

    const isEmail = rawIdentifier.includes('@');
    const lowerIdentifier = isEmail ? rawIdentifier.toLowerCase() : rawIdentifier;

    let targetUser: any = null;
    let targetMembership: any = null;

    if (isEmail) {
      targetUser = await this.prisma.user.findUnique({
        where: { email: lowerIdentifier },
        include: {
          memberships: {
            include: {
              school: true,
            },
          },
          school: true,
          studentProfile: true,
          teacherProfile: true,
        },
      });

      if (targetUser && targetUser.memberships?.length > 0) {
        if (dto.schoolCode?.trim()) {
          const code = dto.schoolCode.trim().toUpperCase();
          targetMembership = targetUser.memberships.find(
            (m: any) =>
              m.school.schoolCode === code ||
              m.school.slug === dto.schoolCode?.trim().toLowerCase(),
          );
        }
        if (!targetMembership) {
          targetMembership =
            targetUser.memberships.find((m: any) => m.isDefault) ||
            targetUser.memberships[0];
        }
      }
    } else {
      // It's a loginId / Matric No / Admission No / Staff ID
      let membershipWhere: any = { loginId: rawIdentifier };
      if (dto.schoolCode?.trim()) {
        const school = await this.prisma.school.findFirst({
          where: {
            OR: [
              { schoolCode: dto.schoolCode.trim().toUpperCase() },
              { slug: dto.schoolCode.trim().toLowerCase() },
            ],
          },
        });
        if (school) {
          membershipWhere.schoolId = school.id;
        }
      }

      targetMembership = await this.prisma.membership.findFirst({
        where: membershipWhere,
        include: {
          user: {
            include: {
              studentProfile: true,
              teacherProfile: true,
              school: true,
            },
          },
          school: true,
        },
      });

      if (targetMembership) {
        targetUser = targetMembership.user;
      } else {
        // Fallback: check User.loginId or StudentProfile.matricOrAdmissionNo or TeacherProfile.staffId
        targetUser = await this.prisma.user.findFirst({
          where: {
            OR: [
              { loginId: rawIdentifier },
              { studentProfile: { matricOrAdmissionNo: rawIdentifier } },
              { teacherProfile: { staffId: rawIdentifier } },
            ],
          },
          include: {
            memberships: { include: { school: true } },
            school: true,
            studentProfile: true,
            teacherProfile: true,
          },
        });

        if (targetUser?.memberships?.length > 0) {
          targetMembership = targetUser.memberships[0];
        }
      }
    }

    if (!targetUser || !targetUser.passwordHash) {
      throw new UnauthorizedException('Invalid credentials. Check your Email/ID and password.');
    }

    const isValidPassword = await bcrypt.compare(dto.password, targetUser.passwordHash);
    if (!isValidPassword) {
      throw new UnauthorizedException('Invalid credentials. Check your Email/ID and password.');
    }

    return this.generateAndSendLoginOtp(targetUser);
  }

  async firstLoginChangePassword(userId: string, newPassword: string) {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('New password must be at least 6 characters long');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          mustChangePassword: false,
        },
      }),
      this.prisma.membership.updateMany({
        where: { userId },
        data: {
          mustChangePassword: false,
          status: 'ACTIVE',
        },
      }),
    ]);

    return {
      success: true,
      message: 'Password successfully updated. You may now continue to your dashboard.',
    };
  }

  async deleteAccount(userId?: string, authHeader?: string) {
    let targetUserId = userId;
    if (!targetUserId && authHeader?.startsWith('Bearer ')) {
      const sessionData = await this.getSessionFromToken(authHeader);
      targetUserId = sessionData.user.id;
    }

    if (!targetUserId) {
      throw new BadRequestException('User ID or Bearer token is required to delete account');
    }

    await this.prisma.user.delete({ where: { id: targetUserId } });
    return {
      success: true,
      message: 'Account and all associated data deleted successfully',
    };
  }
}
