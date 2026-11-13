export class RegisterDto {
  email: string;
  password: string;
  fullName: string;
  role?: 'STUDENT' | 'TEACHER'; // Independent Student or Educator (Admin roles are strictly provisioned by SuperAdmin)
  referralCode?: string;
  schoolInviteCode?: string;
}

export class LoginDto {
  email: string;
  password: string;
}

export class InstitutionLoginDto {
  identifier: string; // Email OR Matric No / Admission No / Staff ID
  password: string;
  schoolCode?: string; // Optional: e.g. "UNZ-2026" or slug
}

export class FirstLoginChangePasswordDto {
  newPassword: string;
}

export class VerifyLoginOtpDto {
  tempTicket: string;
  code: string;
}

export class ResendLoginOtpDto {
  tempTicket: string;
}
