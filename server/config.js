/** Seuil en minutes : au-delà, la pause devient "Pause prolongée" (rouge) */
export const PAUSE_PROLONGEE_MINUTES = 15;

export const JWT_SECRET = process.env.JWT_SECRET || 'swisscom-pause-b2b-secret-change-in-prod';
export const PORT = process.env.PORT || 3001;

/**
 * Email du super-administrateur.
 * L'utilisateur dont l'email correspond exactement se voit automatiquement
 * attribuer le rôle "superadmin" à l'inscription et à chaque connexion.
 * Configurable via la variable d'environnement SUPER_ADMIN_EMAIL.
 */
export const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'chupa.inc@protonmail.com';

/* ── SMTP Configuration (Proton Mail) ── */
export const SMTP_HOST = process.env.SMTP_HOST || '';
export const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
export const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
export const SMTP_USER = process.env.SMTP_USER || '';
export const SMTP_PASS = process.env.SMTP_PASS || '';
export const MAIL_FROM = process.env.MAIL_FROM || 'Breaktopia <contact@breaktopia.io>';
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Token d'accès aux endpoints de diagnostic (/__debug/*).
 * À définir via la variable d'environnement DEBUG_TOKEN ou directement ici.
 * Si vide, les endpoints de debug sont désactivés (renvoient 404).
 */
export const DEBUG_TOKEN = process.env.DEBUG_TOKEN || '';
