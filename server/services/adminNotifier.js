/**
 * Batched Super-Admin notification for new pending registrations.
 * Uses a cooldown (5 min) to avoid spamming.
 * Collects pending users and sends a single digest email.
 */
import db from '../db.js';
import { SUPER_ADMIN_EMAIL } from '../config.js';
import { sendMail } from './mailService.js';
import { newPendingRegistrationsEmail } from './emailTemplates.js';

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

let pendingBatch = [];
let cooldownTimer = null;
let lastSentAt = 0;

/**
 * Queue a newly registered user for the Super-Admin digest email.
 * The email is sent after a cooldown period, batching all registrations.
 *
 * @param {{ firstName: string, lastName: string, email: string, teamCode: string }} userInfo
 */
export function queuePendingNotification(userInfo) {
  pendingBatch.push(userInfo);

  // If cooldown timer is already running, do nothing — it will flush
  if (cooldownTimer) return;

  const elapsed = Date.now() - lastSentAt;
  const delay = elapsed >= COOLDOWN_MS ? 3000 : COOLDOWN_MS - elapsed; // 3s if ready, else wait

  cooldownTimer = setTimeout(flushBatch, delay);
}

/** Flush the batch and send the digest email. */
async function flushBatch() {
  cooldownTimer = null;

  if (pendingBatch.length === 0) return;

  const users = [...pendingBatch];
  pendingBatch = [];
  lastSentAt = Date.now();

  const { subject, html } = newPendingRegistrationsEmail({ pendingUsers: users });

  try {
    await sendMail({
      to: SUPER_ADMIN_EMAIL,
      subject,
      html,
    });
    console.log(`[AdminNotifier] Digest sent to ${SUPER_ADMIN_EMAIL} (${users.length} user(s))`);
  } catch (err) {
    console.error('[AdminNotifier] Failed to send digest:', err.message);
  }
}

/**
 * Get count of pending approvals (for badge).
 * @returns {number}
 */
export function getPendingApprovalsCount() {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE approval_status = 'pending'").get();
  return row?.cnt ?? 0;
}
