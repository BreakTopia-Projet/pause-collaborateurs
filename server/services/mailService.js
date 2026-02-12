/**
 * Centralized email service for Breaktopia.
 * Uses nodemailer with SMTP (Proton Mail).
 * In development mode (NODE_ENV !== 'production'), emails are logged to console.
 */
import nodemailer from 'nodemailer';
import {
  SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS,
  MAIL_FROM, IS_PRODUCTION,
} from '../config.js';

let transporter = null;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

/**
 * Initialize the SMTP transport.
 * Called once at server startup.
 */
export function initTransport() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log('[Mail] SMTP not configured — emails will be logged to console only.');
    return;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE, // false = STARTTLS
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    tls: {
      // Proton Mail requires STARTTLS on port 587
      rejectUnauthorized: true,
    },
  });

  // Verify connection on startup (non-blocking)
  transporter.verify()
    .then(() => console.log('[Mail] SMTP transport verified successfully.'))
    .catch((err) => console.error('[Mail] SMTP transport verification failed:', err.message));
}

/**
 * Send an email.
 * In development mode, logs to console instead of sending.
 *
 * @param {{ to: string, subject: string, html: string }} options
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
export async function sendMail({ to, subject, html }) {
  const mailOptions = {
    from: MAIL_FROM,
    to,
    subject,
    html,
  };

  // DEV mode: log instead of sending
  if (!IS_PRODUCTION || !transporter) {
    console.log('[Mail][DEV] Would send email:');
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  From: ${MAIL_FROM}`);
    console.log(`  HTML length: ${html.length} chars`);
    return { success: true, messageId: 'dev-mode' };
  }

  // Production: send with retry
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`[Mail] Sent to ${to} — messageId: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`[Mail] Attempt ${attempt} failed for ${to}:`, err.message);
      if (attempt <= MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        console.error(`[Mail] All attempts failed for ${to}.`);
        return { success: false, error: err.message };
      }
    }
  }
  return { success: false, error: 'Unknown error' };
}

/**
 * Check if the mail service is configured and ready.
 * @returns {boolean}
 */
export function isMailReady() {
  return IS_PRODUCTION && !!transporter;
}
