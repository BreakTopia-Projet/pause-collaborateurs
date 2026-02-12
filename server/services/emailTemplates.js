/**
 * HTML email templates for Breaktopia.
 * All emails use a consistent branded layout.
 */

const BRAND_COLOR = '#001155';
const ACCENT_COLOR = '#e68a00';

/** Shared wrapper for all emails */
function layout(content) {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f6f8;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);max-width:600px;width:100%;">
        <!-- Header -->
        <tr><td style="background:${BRAND_COLOR};padding:28px 32px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:0.5px;">breaktopia</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 32px 24px;">
          ${content}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px 24px;border-top:1px solid #eee;text-align:center;">
          <p style="margin:0;font-size:12px;color:#999;">
            &copy; ${new Date().getFullYear()} Breaktopia &mdash; Developed by Cédric Pellé
          </p>
          <p style="margin:4px 0 0;font-size:11px;color:#bbb;">
            Cet email a été envoyé automatiquement. Merci de ne pas y répondre.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/* ── User-facing emails ───────────────────────────────── */

/**
 * Email sent to user after registration (pending approval).
 */
export function registrationPendingEmail({ firstName, lastName }) {
  return {
    subject: 'Breaktopia – Inscription en attente d\'approbation',
    html: layout(`
      <h2 style="margin:0 0 16px;color:${BRAND_COLOR};font-size:20px;">Bienvenue, ${firstName} ${lastName} !</h2>
      <p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.6;">
        Votre compte a été créé avec succès sur <strong>Breaktopia</strong>.
      </p>
      <p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.6;">
        Il est actuellement <strong style="color:${ACCENT_COLOR};">en attente d'approbation</strong> par un administrateur.
        Vous recevrez une confirmation sous 48h si les informations sont conformes.
      </p>
      <p style="margin:0 0 0;font-size:14px;color:#666;line-height:1.5;">
        Une fois approuvé, vous pourrez vous connecter et accéder à l'application.
      </p>
    `),
  };
}

/**
 * Email sent to user when their account is approved.
 */
export function accountApprovedEmail({ firstName, lastName }) {
  return {
    subject: 'Breaktopia – Votre compte a été approuvé ✓',
    html: layout(`
      <h2 style="margin:0 0 16px;color:#2e7d32;font-size:20px;">Compte approuvé !</h2>
      <p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.6;">
        Bonne nouvelle, <strong>${firstName} ${lastName}</strong> !
        Votre compte Breaktopia a été <strong style="color:#2e7d32;">approuvé</strong>.
      </p>
      <p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.6;">
        Vous pouvez dès maintenant vous connecter à l'application.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://breaktopia.io" style="display:inline-block;background:${BRAND_COLOR};color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
          Se connecter
        </a>
      </div>
    `),
  };
}

/**
 * Email sent to user when their account is rejected.
 */
export function accountRejectedEmail({ firstName, lastName, reason }) {
  const reasonBlock = reason
    ? `<p style="margin:12px 0;padding:12px 16px;background:#fef3f3;border-left:3px solid #c62828;font-size:14px;color:#333;border-radius:4px;">
        <strong>Motif :</strong> ${reason}
      </p>`
    : '';

  return {
    subject: 'Breaktopia – Votre demande de compte a été refusée',
    html: layout(`
      <h2 style="margin:0 0 16px;color:#c62828;font-size:20px;">Demande refusée</h2>
      <p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.6;">
        Bonjour <strong>${firstName} ${lastName}</strong>,
      </p>
      <p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.6;">
        Nous sommes désolés, votre demande de création de compte sur Breaktopia a été <strong style="color:#c62828;">refusée</strong>.
      </p>
      ${reasonBlock}
      <p style="margin:0;font-size:14px;color:#666;line-height:1.5;">
        Si vous pensez qu'il s'agit d'une erreur, veuillez contacter votre administrateur.
      </p>
    `),
  };
}

/* ── Super-Admin notification emails ──────────────────── */

/**
 * Email sent to Super-Admin when new registrations are pending.
 * Supports batching (multiple users in one email).
 */
export function newPendingRegistrationsEmail({ pendingUsers }) {
  const count = pendingUsers.length;
  const rows = pendingUsers.map((u) =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">${u.firstName} ${u.lastName}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">${u.email}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">${u.teamCode || '–'}</td>
    </tr>`
  ).join('');

  return {
    subject: `Breaktopia – ${count} nouvelle${count > 1 ? 's' : ''} inscription${count > 1 ? 's' : ''} en attente`,
    html: layout(`
      <h2 style="margin:0 0 16px;color:${ACCENT_COLOR};font-size:20px;">
        ${count} inscription${count > 1 ? 's' : ''} en attente d'approbation
      </h2>
      <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;">
        De nouvelles inscriptions nécessitent votre validation :
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="background:#f8f9fa;">
            <th style="padding:10px 12px;text-align:left;font-size:13px;color:#555;">Nom</th>
            <th style="padding:10px 12px;text-align:left;font-size:13px;color:#555;">Email</th>
            <th style="padding:10px 12px;text-align:left;font-size:13px;color:#555;">Code équipe</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://breaktopia.io/#/super-admin" style="display:inline-block;background:${BRAND_COLOR};color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
          Gérer les approbations
        </a>
      </div>
    `),
  };
}
