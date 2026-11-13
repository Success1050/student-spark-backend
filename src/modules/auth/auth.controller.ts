import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import {
  FirstLoginChangePasswordDto,
  InstitutionLoginDto,
  LoginDto,
  RegisterDto,
  ResendLoginOtpDto,
  VerifyLoginOtpDto,
} from './dto/auth.dto.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';
import { AuditAction } from '../../common/decorators/audit-action.decorator.js';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('auth/register')
  @AuditAction('USER_REGISTER', 'User')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('auth/login')
  @AuditAction('USER_LOGIN', 'User')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('auth/institution-login')
  @AuditAction('INSTITUTION_LOGIN', 'Membership')
  institutionLogin(@Body() dto: InstitutionLoginDto) {
    return this.authService.institutionLogin(dto);
  }

  @Public()
  @Post('auth/verify-login-otp')
  @AuditAction('VERIFY_LOGIN_OTP', 'User')
  verifyLoginOtp(@Body() dto: VerifyLoginOtpDto) {
    return this.authService.verifyLoginOtp(dto);
  }

  @Public()
  @Post('auth/resend-login-otp')
  @AuditAction('RESEND_LOGIN_OTP', 'User')
  resendLoginOtp(@Body() dto: ResendLoginOtpDto) {
    return this.authService.resendLoginOtp(dto);
  }

  @Post('auth/first-login-change-password')
  @AuditAction('FIRST_LOGIN_PASSWORD_CHANGED', 'User')
  firstLoginChangePassword(
    @UserId() userId: string,
    @Body() dto: FirstLoginChangePasswordDto,
  ) {
    return this.authService.firstLoginChangePassword(userId, dto.newPassword);
  }

  @Get('auth/session')
  getSession(@Headers('authorization') authHeader?: string) {
    return this.authService.getSessionFromToken(authHeader);
  }

  @Public()
  @Post('auth/forgot-password')
  forgotPassword(@Body('email') email: string) {
    return this.authService.requestPasswordReset(email);
  }

  @Delete('auth/delete-account')
  deleteAccount(
    @UserId() userId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    return this.authService.deleteAccount(userId, authHeader);
  }

  /**
   * Compatibility route for studentspark_backend/server.js DELETE /delete-account
   */
  @Delete('delete-account')
  deleteAccountCompat(
    @UserId() userId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    return this.authService.deleteAccount(userId, authHeader);
  }
}
