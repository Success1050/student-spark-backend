import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * Transactional & Academic Email Notification Provider using Nodemailer
 */
@Injectable()
export class EmailNotificationProvider {
  private readonly logger = new Logger(EmailNotificationProvider.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly configService: ConfigService) {
    const host =
      this.configService.get<string>('SMTP_HOST') ||
      this.configService.get<string>('EMAIL_HOST') ||
      process.env.SMTP_HOST ||
      process.env.EMAIL_HOST;
    const port = Number(
      this.configService.get<string>('SMTP_PORT') ||
        this.configService.get<string>('EMAIL_PORT') ||
        process.env.SMTP_PORT ||
        process.env.EMAIL_PORT ||
        587,
    );
    const user =
      this.configService.get<string>('SMTP_USER') ||
      this.configService.get<string>('EMAIL_USER') ||
      process.env.SMTP_USER ||
      process.env.EMAIL_USER;
    const pass =
      this.configService.get<string>('SMTP_PASS') ||
      this.configService.get<string>('EMAIL_PASS') ||
      process.env.SMTP_PASS ||
      process.env.EMAIL_PASS;

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
    }
  }

  buildBrandedEmailHtml(params: {
    recipientName?: string;
    title: string;
    body: string;
    category?: string;
    ctaLabel?: string;
    ctaUrl?: string;
  }) {
    const greeting = params.recipientName ? `Hi ${params.recipientName},` : 'Hello,';
    const badge = params.category || 'NOTIFICATION';
    const ctaBlock =
      params.ctaLabel && params.ctaUrl
        ? `<div style="margin-top: 24px;">
             <a href="${params.ctaUrl}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:10px;font-size:14px;">
               ${params.ctaLabel}
             </a>
           </div>`
        : '';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(15,23,42,0.05);">
    <div style="background:linear-gradient(135deg,#6366f1 0%,#4f46e5 100%);padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;opacity:0.9;margin-bottom:6px;">
        ⚡ StudentSpark • ${badge}
      </div>
      <h1 style="margin:0;font-size:20px;font-weight:800;line-height:1.3;">${params.title}</h1>
    </div>
    <div style="padding:28px;color:#334155;font-size:15px;line-height:1.6;">
      <p style="margin-top:0;font-weight:600;color:#0f172a;">${greeting}</p>
      <p style="margin:12px 0;white-space:pre-line;">${params.body}</p>
      ${ctaBlock}
    </div>
    <div style="padding:16px 28px;background:#f1f5f9;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:center;">
      You received this email because Email Notifications are enabled on your StudentSpark account.
    </div>
  </div>
</body>
</html>`;
  }

  async sendEmail(params: {
    to: string;
    subject: string;
    html: string;
  }) {
    if (!params.to) {
      return { delivered: false, reason: 'missing_recipient' };
    }

    const from =
      this.configService.get<string>('SMTP_FROM') ||
      this.configService.get<string>('FROM_EMAIL') ||
      process.env.SMTP_FROM ||
      process.env.FROM_EMAIL ||
      '"StudentSpark" <no-reply@studentspark.app>';

    if (!this.transporter) {
      this.logger.log(
        `[DEV EMAIL PREVIEW] To: ${params.to} | Subject: "${params.subject}"`,
      );
      return { delivered: true, simulated: true };
    }

    try {
      await this.transporter.sendMail({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
      });
      this.logger.log(`Delivered email "${params.subject}" to ${params.to}`);
      return { delivered: true };
    } catch (error) {
      this.logger.warn(
        `Failed to send email "${params.subject}" to ${params.to}: ${String(error)}`,
      );
      return { delivered: false, error: String(error) };
    }
  }
}
