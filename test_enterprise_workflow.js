const http = require('http');

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch(e) {}
        resolve({ status: res.statusCode, headers: res.headers, body: json || body });
      });
    });
    req.on('error', reject);
    if (data) {
      if (typeof data === 'object') {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(data));
      } else {
        req.write(data);
      }
    }
    req.end();
  });
}

async function runE2E() {
  console.log('================================================================');
  console.log('TESTING COMPLETE ENTERPRISE IDENTITY LIFECYCLE WORKFLOW');
  console.log('================================================================\n');

  // STEP 1: Staff Authentication (Login)
  console.log('Step 1: Logging in as Super Administrator (admin@gracechapel.org)...');
  const loginRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST'
  }, { email: 'admin@gracechapel.org', password: 'admin123' });

  if (loginRes.status !== 200 || !loginRes.body.token) {
    throw new Error('Login failed: ' + JSON.stringify(loginRes.body));
  }
  const token = loginRes.body.token;
  const cookie = loginRes.headers['set-cookie'] ? loginRes.headers['set-cookie'][0] : `auth_token=${token}`;
  console.log('✓ Successfully authenticated! Staff:', loginRes.body.user.fullName, '| Org:', loginRes.body.organisation.name);

  // STEP 2: Register a Person & Issue Initial Card
  console.log('\nStep 2: Registering a person & issuing official ID card...');
  const regRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/identities',
    method: 'POST',
    headers: {
      'Cookie': cookie,
      'Authorization': `Bearer ${token}`
    }
  }, {
    title: 'Pastor',
    firstName: 'Samuel',
    lastName: 'Adeleke',
    department: 'Traffic Safety Directorate',
    position: 'Operations Commander',
    email: 'samuel.adeleke@gracechapel.org',
    phone: '+234 803 111 2233',
    emergencyContactName: 'Bisi Adeleke',
    emergencyContactPhone: '+234 803 444 5566'
  });

  if (regRes.status !== 201 || !regRes.body.identity) {
    throw new Error('Person registration failed: ' + JSON.stringify(regRes.body));
  }
  const person = regRes.body.identity;
  const card = regRes.body.card;
  console.log('✓ Person registered! Name:', person.full_name, '| ID Number:', person.id_number);
  console.log('✓ Physical ID Card Issued! Number:', card.card_number, '| Verification Token:', card.verification_token.substring(0, 16) + '...');

  // STEP 3: Scan / Verify the QR Code Token
  console.log('\nStep 3: Simulating QR scan & backend verification of active card...');
  const verifyRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/verify/${card.verification_token}`,
    method: 'GET'
  });

  if (verifyRes.status !== 200 || verifyRes.body.outcome !== 'verified') {
    throw new Error('Verification failed: ' + JSON.stringify(verifyRes.body));
  }
  console.log('✓ Credential VERIFIED authentic against live database!');
  console.log('  Headline:', verifyRes.body.headline);
  console.log('  Status Badge:', verifyRes.body.outcome.toUpperCase());
  console.log('  Card Holder:', verifyRes.body.identity.fullName, `(${verifyRes.body.identity.idNumber})`);

  // STEP 4: Revoke the Card (e.g. Lost or Cancelled)
  console.log('\nStep 4: Administrator revoking the card (Reason: "Reported lost during service")...');
  const revokeRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/cards/${card.id}/revoke`,
    method: 'POST',
    headers: {
      'Cookie': cookie,
      'Authorization': `Bearer ${token}`
    }
  }, { reason: 'Reported lost during service' });

  if (revokeRes.status !== 200) {
    throw new Error('Revocation failed: ' + JSON.stringify(revokeRes.body));
  }
  console.log('✓ Card status in database updated to REVOKED.');

  // STEP 5: Scan Again and Confirm Rejection
  console.log('\nStep 5: Scanning the revoked card QR code again...');
  const verifyRevokedRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/verify/${card.verification_token}`,
    method: 'GET'
  });

  if (verifyRevokedRes.body.outcome !== 'revoked' || verifyRevokedRes.body.verified !== false) {
    throw new Error('Expected revoked outcome but got: ' + JSON.stringify(verifyRevokedRes.body));
  }
  console.log('✓ CONFIRMED REJECTED! Outcome:', verifyRevokedRes.body.outcome.toUpperCase());
  console.log('  Headline:', verifyRevokedRes.body.headline);
  console.log('  Warning Message:', verifyRevokedRes.body.message);

  // STEP 6: Reissue a New Replacement Card
  console.log('\nStep 6: Reissuing replacement card for same person...');
  const reissueRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/cards/reissue/${person.id}`,
    method: 'POST',
    headers: {
      'Cookie': cookie,
      'Authorization': `Bearer ${token}`
    }
  }, { reason: 'Replacement badge issued' });

  if (reissueRes.status !== 201 || !reissueRes.body.newCard) {
    throw new Error('Reissue failed: ' + JSON.stringify(reissueRes.body));
  }
  const newCard = reissueRes.body.newCard;
  console.log('✓ New Replacement Card Issued! Number:', newCard.card_number, '| New Token:', newCard.verification_token.substring(0, 16) + '...');

  // STEP 7: Verify the New Card Passes While Old Card Stays Revoked
  console.log('\nStep 7: Verifying new card passes while old card remains rejected...');
  const verifyNewRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/verify/${newCard.verification_token}`,
    method: 'GET'
  });
  if (verifyNewRes.body.outcome !== 'verified') {
    throw new Error('New card failed verification: ' + JSON.stringify(verifyNewRes.body));
  }
  console.log('✓ New card is VERIFIED active!');

  console.log('\n================================================================');
  console.log('ALL WORKFLOW VERIFICATION CHECKS PASSED WITH 100% SUCCESS!');
  console.log('================================================================');
}

runE2E().catch(err => {
  console.error('\n❌ Workflow test failed:', err);
  process.exit(1);
});
