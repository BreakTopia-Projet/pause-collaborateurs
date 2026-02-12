// ===== A) Auth & Comptes - Test complet =====
const BASE = 'http://localhost:3001';
let pass = 0, fail = 0;
const results = [];

async function test(desc, method, url, body, expectStatus, checkFn) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(BASE + url, opts);
    const d = await r.json();
    let ok = r.status === expectStatus;
    let extra = '';
    if (ok && checkFn) {
      const checkResult = checkFn(d);
      if (checkResult !== true) { ok = false; extra = ` [CHECK FAIL: ${checkResult}]`; }
    }
    if (ok) pass++; else fail++;
    const status = ok ? 'PASS' : 'FAIL';
    console.log(`${status} ${desc}: ${r.status}${extra}`);
    results.push({ desc, status, httpStatus: r.status, extra });
    return { status: r.status, data: d };
  } catch (e) {
    fail++;
    console.log(`FAIL ${desc}: ${e.message}`);
    results.push({ desc, status: 'FAIL', error: e.message });
    return { status: 0, data: null };
  }
}

async function run() {
  console.log('========== A) AUTH & COMPTES ==========\n');

  // A1: Login tests
  console.log('--- A1: Login ---');
  await test('Login SuperAdmin bon mdp', 'POST', '/api/auth/login',
    { email: 'chupa.inc@protonmail.com', password: 'Admin5' }, 200,
    d => d.user?.role === 'superadmin' ? true : `role=${d.user?.role}`);

  await test('Login SuperAdmin mauvais mdp', 'POST', '/api/auth/login',
    { email: 'chupa.inc@protonmail.com', password: 'wrong' }, 401);

  await test('Login Admin bon mdp', 'POST', '/api/auth/login',
    { email: 'admin2@mail.com', password: 'Admin2' }, 200,
    d => d.user?.role === 'admin' ? true : `role=${d.user?.role}`);

  await test('Login Admin mauvais mdp', 'POST', '/api/auth/login',
    { email: 'admin2@mail.com', password: 'wrong' }, 401);

  await test('Login User bon mdp', 'POST', '/api/auth/login',
    { email: 'test1@mail.com', password: 'Test1' }, 200,
    d => d.user?.role === 'user' ? true : `role=${d.user?.role}`);

  await test('Login User mauvais mdp', 'POST', '/api/auth/login',
    { email: 'test1@mail.com', password: 'wrong' }, 401);

  await test('Login utilisateur inconnu', 'POST', '/api/auth/login',
    { email: 'nobody@mail.com', password: 'Test1' }, 401);

  // A2: Case insensitivity
  console.log('\n--- A2: Email case-insensitive ---');
  await test('Email MAJUSCULES', 'POST', '/api/auth/login',
    { email: 'TEST1@MAIL.COM', password: 'Test1' }, 200);

  await test('Email CaSe MiXtE', 'POST', '/api/auth/login',
    { email: 'Admin2@Mail.Com', password: 'Admin2' }, 200);

  // A3: Pending user blocked
  console.log('\n--- A3: Pending user ---');
  await test('User pending bloqué (test5)', 'POST', '/api/auth/login',
    { email: 'test5@mail.com', password: 'Test5' }, 403,
    d => d.errorCode === 'APPROVAL_PENDING' ? true : `errorCode=${d.errorCode}`);

  await test('User pending bloqué (newtest)', 'POST', '/api/auth/login',
    { email: 'newtest@mail.com', password: 'NewTest1' }, 403,
    d => d.errorCode === 'APPROVAL_PENDING' ? true : `errorCode=${d.errorCode}`);

  // A4: Register duplicate
  console.log('\n--- A4: Register ---');
  await test('Register email existant', 'POST', '/api/auth/register',
    { email: 'test1@mail.com', password: 'Test1', firstName: 'Dup', lastName: 'Test', teamCode: 'DMC-MM1' }, 409);

  await test('Register sans code équipe', 'POST', '/api/auth/register',
    { email: 'nocode@mail.com', password: 'NoCode1', firstName: 'No', lastName: 'Code' }, 400);

  await test('Register code équipe invalide', 'POST', '/api/auth/register',
    { email: 'badcode@mail.com', password: 'BadCode1', firstName: 'Bad', lastName: 'Code', teamCode: 'INVALID' }, 400);

  // A5: /auth/me with token
  console.log('\n--- A5: Auth /me ---');
  const loginRes = await test('Login pour obtenir token', 'POST', '/api/auth/login',
    { email: 'test1@mail.com', password: 'Test1' }, 200);

  if (loginRes.data?.token) {
    const r = await fetch(BASE + '/api/auth/me', {
      headers: { 'Authorization': `Bearer ${loginRes.data.token}` }
    });
    const d = await r.json();
    const ok = r.status === 200 && d.user?.email === 'test1@mail.com';
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} /auth/me avec token valide: ${r.status}`);
  }

  await test('/auth/me sans token', 'GET', '/api/auth/me', null, 401);

  // A6: Password change
  console.log('\n--- A6: Change password ---');
  const adminLogin = await test('Login admin pour token', 'POST', '/api/auth/login',
    { email: 'admin2@mail.com', password: 'Admin2' }, 200);

  if (adminLogin.data?.token) {
    // Wrong current password
    let r = await fetch(BASE + '/api/auth/me/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminLogin.data.token}` },
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'NewAdmin2' })
    });
    let ok = r.status === 403;
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} Change mdp mauvais current: ${r.status}`);

    // Correct change
    r = await fetch(BASE + '/api/auth/me/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminLogin.data.token}` },
      body: JSON.stringify({ currentPassword: 'Admin2', newPassword: 'Admin2New' })
    });
    ok = r.status === 200;
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} Change mdp correct: ${r.status}`);

    // Verify new password works
    const r2 = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin2@mail.com', password: 'Admin2New' })
    });
    ok = r2.status === 200;
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} Login avec nouveau mdp: ${r2.status}`);

    // Restore original password
    const r3 = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin2@mail.com', password: 'Admin2New' })
    });
    const d3 = await r3.json();
    await fetch(BASE + '/api/auth/me/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${d3.token}` },
      body: JSON.stringify({ currentPassword: 'Admin2New', newPassword: 'Admin2' })
    });
    console.log('  (mdp admin2 restauré à Admin2)');
  }

  console.log(`\n========== RÉSULTATS A: ${pass} PASS, ${fail} FAIL ==========`);
}

run();
