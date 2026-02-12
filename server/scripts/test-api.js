// ===== B-G) API & Permissions - Tests complets =====
const BASE = 'http://localhost:3001';
let pass = 0, fail = 0;

async function login(email, password) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const d = await r.json();
  return { token: d.token, user: d.user };
}

async function api(token, method, url, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + url, opts);
  let d;
  try { d = await r.json(); } catch { d = null; }
  return { status: r.status, data: d };
}

function check(desc, condition) {
  if (condition) { pass++; console.log(`  PASS ${desc}`); }
  else { fail++; console.log(`  FAIL ${desc}`); }
}

async function run() {
  // Login all roles
  const sa = await login('chupa.inc@protonmail.com', 'Admin5');
  const admin = await login('admin2@mail.com', 'Admin2');
  const user = await login('test1@mail.com', 'Test1');

  console.log('SA:', sa.user?.role, 'team:', sa.user?.teamId);
  console.log('Admin:', admin.user?.role, 'team:', admin.user?.teamId);
  console.log('User:', user.user?.role, 'team:', user.user?.teamId);

  // ========== B) Accès & Permissions ==========
  console.log('\n========== B) ACCÈS & PERMISSIONS ==========');

  console.log('\n--- B1: Admin /team-members (scope) ---');
  let r;
  r = await api(user.token, 'GET', '/api/admin/team-members');
  check('User ne peut pas accéder à /admin/team-members', r.status === 403);

  r = await api(admin.token, 'GET', '/api/admin/team-members');
  check('Admin peut accéder à /admin/team-members', r.status === 200);
  if (r.status === 200 && Array.isArray(r.data)) {
    const adminMembers = r.data;
    console.log(`    Admin voit ${adminMembers.length} membres`);
    const allSameTeam = adminMembers.every(u => u.teamId === admin.user.teamId);
    check('Admin ne voit QUE sa team', allSameTeam);
  }

  r = await api(sa.token, 'GET', '/api/admin/team-members');
  check('SuperAdmin peut accéder à /admin/team-members', r.status === 200);
  if (r.status === 200 && Array.isArray(r.data)) {
    console.log(`    SuperAdmin voit ${r.data.length} membres (toutes équipes)`);
    const teams = new Set(r.data.map(u => u.teamName));
    check('SuperAdmin voit plusieurs équipes', teams.size > 1);
  }

  console.log('\n--- B2: Approvals (super-admin only) ---');
  r = await api(user.token, 'GET', '/api/admin/approvals?status=pending');
  check('User ne peut pas voir les approbations', r.status === 403);

  r = await api(admin.token, 'GET', '/api/admin/approvals?status=pending');
  check('Admin ne peut pas voir les approbations', r.status === 403);

  r = await api(sa.token, 'GET', '/api/admin/approvals?status=pending');
  check('SuperAdmin peut voir les approbations', r.status === 200);
  if (r.status === 200 && Array.isArray(r.data)) {
    console.log(`    ${r.data.length} approbations pending`);
    check('Au moins 1 pending', r.data.length >= 1);
  }

  r = await api(sa.token, 'GET', '/api/admin/approvals/count');
  check('SuperAdmin /approvals/count OK', r.status === 200 && typeof r.data?.count === 'number');
  if (r.data) console.log(`    Count: ${r.data.count}`);

  console.log('\n--- B3: Audit logs (scope) ---');
  r = await api(user.token, 'GET', '/api/admin/audit-logs');
  check('User ne peut pas lire audit logs', r.status === 403);

  r = await api(admin.token, 'GET', '/api/admin/audit-logs');
  check('Admin peut lire audit logs (sa team)', r.status === 200);

  r = await api(sa.token, 'GET', '/api/admin/audit-logs');
  check('SuperAdmin peut lire audit logs', r.status === 200);
  if (Array.isArray(r.data)) console.log(`    ${r.data.length} entrées audit`);

  console.log('\n--- B4: Teams management ---');
  r = await api(user.token, 'GET', '/api/teams');
  check('User peut lister les équipes (public)', r.status === 200);

  r = await api(sa.token, 'GET', '/api/admin/teams');
  check('SuperAdmin /admin/teams OK', r.status === 200);

  // ========== C) Tableau de bord (data) ==========
  console.log('\n========== C) TABLEAU DE BORD ==========');

  console.log('\n--- C1: Status /team ---');
  r = await api(user.token, 'GET', '/api/status/team');
  check('User peut accéder aux statuts', r.status === 200);
  if (Array.isArray(r.data) && r.data.length > 0) {
    const first = r.data[0];
    console.log(`    ${r.data.length} statuts retournés`);
    check('Statut a firstName', first.firstName !== undefined);
    check('Statut a status', first.status !== undefined);
    check('Statut a teamId', first.teamId !== undefined);
    check('Statut a teamName', first.teamName !== undefined);
    check('Statut a role', first.role !== undefined);
    check('Statut a elapsedSeconds', first.elapsedSeconds !== undefined);
    check('Statut a dailyCompletedPauseSeconds', first.dailyCompletedPauseSeconds !== undefined);
  }

  console.log('\n--- C2: Capacity ---');
  r = await api(user.token, 'GET', '/api/config/team-capacity');
  check('User peut accéder à la capacité', r.status === 200);
  if (r.data) {
    check('Capacité a breakCapacity', r.data.breakCapacity !== undefined);
    check('Capacité a onBreakNow', r.data.onBreakNow !== undefined);
    console.log(`    Team: ${r.data.teamName}, Cap: ${r.data.breakCapacity}, OnBreak: ${r.data.onBreakNow}`);
  }

  r = await api(sa.token, 'GET', '/api/config/team-capacity');
  check('SuperAdmin capacité retourne teams[]', r.status === 200 && Array.isArray(r.data?.teams));
  if (r.data?.teams) {
    console.log(`    ${r.data.teams.length} teams avec capacité`);
    const t = r.data.teams[0];
    check('Team capacité a teamName', t?.teamName !== undefined);
    check('Team capacité a breakCapacity', t?.breakCapacity !== undefined);
    check('Team capacité a onBreakNow', t?.onBreakNow !== undefined);
  }

  // ========== D) Administration ==========
  console.log('\n========== D) ADMINISTRATION ==========');

  console.log('\n--- D1: Config (pause prolongée) ---');
  r = await api(sa.token, 'GET', '/api/config');
  check('GET /api/config OK', r.status === 200 && r.data?.pauseProlongeeMinutes !== undefined);
  console.log(`    pauseProlongeeMinutes: ${r.data?.pauseProlongeeMinutes}`);

  // Test update config (restore afterwards)
  const origPPM = r.data?.pauseProlongeeMinutes ?? 20;
  r = await api(sa.token, 'PATCH', '/api/config', { pauseProlongeeMinutes: 25 });
  check('PATCH /api/config OK', r.status === 200 && r.data?.pauseProlongeeMinutes === 25);
  // Restore
  await api(sa.token, 'PATCH', '/api/config', { pauseProlongeeMinutes: origPPM });

  // User cannot change config
  r = await api(user.token, 'PATCH', '/api/config', { pauseProlongeeMinutes: 99 });
  check('User ne peut pas modifier config', r.status === 401 || r.status === 403);

  console.log('\n--- D2: Break sessions (historique) ---');
  r = await api(admin.token, 'GET', '/api/admin/break-sessions');
  check('Admin peut lire break-sessions', r.status === 200);
  if (Array.isArray(r.data)) console.log(`    ${r.data.length} sessions`);

  r = await api(sa.token, 'GET', '/api/admin/break-sessions');
  check('SuperAdmin peut lire break-sessions', r.status === 200);

  r = await api(user.token, 'GET', '/api/admin/break-sessions');
  check('User ne peut pas lire break-sessions', r.status === 403);

  console.log('\n--- D3: Break summary ---');
  r = await api(admin.token, 'GET', '/api/admin/break-summary');
  check('Admin peut lire break-summary', r.status === 200);

  r = await api(sa.token, 'GET', '/api/admin/break-summary');
  check('SuperAdmin peut lire break-summary', r.status === 200);

  // ========== E-F) Status change + capacity ==========
  console.log('\n========== E-F) STATUS CHANGE & CAPACITY ==========');

  // Start break
  r = await api(user.token, 'POST', '/api/status/me', { status: 'break' });
  check('User peut démarrer une pause (200 ou 409)', r.status === 200 || r.status === 409);
  console.log(`    Start break: ${r.status} ${JSON.stringify(r.data).substring(0, 100)}`);

  if (r.status === 200) {
    // Verify status changed
    const r2 = await api(user.token, 'GET', '/api/status/team');
    if (Array.isArray(r2.data)) {
      const me = r2.data.find(u => u.id === user.user.id);
      check('Statut est maintenant "break"', me?.status === 'break' || me?.status === 'extended_break');
    }

    // Stop break
    r = await api(user.token, 'POST', '/api/status/me', { status: 'working' });
    check('User peut reprendre le travail', r.status === 200);
    console.log(`    Stop break: ${r.status}`);
  }

  // Test invalid status
  r = await api(user.token, 'POST', '/api/status/me', { status: 'invalid' });
  check('Statut invalide rejeté', r.status === 400);

  // ========== G) Presence ==========
  console.log('\n========== G) PRESENCE ==========');

  r = await api(user.token, 'GET', '/api/presence/online');
  check('User peut voir les utilisateurs en ligne', r.status === 200);
  if (r.data) {
    check('Présence a onlineUserIds', Array.isArray(r.data.onlineUserIds));
    console.log(`    ${r.data.onlineUserIds?.length} en ligne`);
  }

  // ========== RÉSUMÉ ==========
  console.log(`\n========================================`);
  console.log(`RÉSULTATS B-G: ${pass} PASS, ${fail} FAIL`);
  console.log(`========================================`);
}

run().catch(e => console.error('CRASH:', e));
