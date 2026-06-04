import { spawn } from 'child_process';
import assert from 'assert';

const PORT = 3007;
console.log('Starting server with admin environment variables on port', PORT);
const server = spawn('node', ['server.js'], {
  env: { 
    ...process.env, 
    PORT: PORT.toString(),
    ADMIN_USERNAME: 'owner',
    ADMIN_PASSWORD: 'ownerpassword'
  },
  cwd: '/Users/abhishekmishra/.gemini/antigravity/scratch/cloudstream'
});

server.stdout.on('data', (data) => {
  console.log(`[Server Log] ${data.toString().trim()}`);
});

server.stderr.on('data', (data) => {
  console.error(`[Server Err] ${data.toString().trim()}`);
});

// Wait 3 seconds for server to start
setTimeout(async () => {
  try {
    // 1. Try to register with the reserved username 'owner'
    console.log('\n1. Verifying reserved admin registration is blocked...');
    const regReservedRes = await fetch(`http://127.0.0.1:${PORT}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'randompassword' })
    });
    const regReservedData = await regReservedRes.json();
    assert.strictEqual(regReservedRes.status, 400);
    assert.strictEqual(regReservedData.error, 'Username is reserved');
    console.log('OK: Reserved username registration was blocked.');

    // 2. Register a normal user 'john'
    console.log('\n2. Registering normal user john...');
    const regJohnRes = await fetch(`http://127.0.0.1:${PORT}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'john', password: 'johnpassword' })
    });
    const regJohnData = await regJohnRes.json();
    assert.strictEqual(regJohnRes.status, 200);
    assert.ok(regJohnData.success);
    const johnToken = regJohnData.token;
    console.log('OK: Normal user registered.');

    // 3. Normal user accessing admin status endpoint
    console.log('\n3. Verifying normal user is forbidden from admin endpoints...');
    const johnAdminRes = await fetch(`http://127.0.0.1:${PORT}/api/admin/status`, {
      headers: { 'Authorization': `Bearer ${johnToken}` }
    });
    const johnAdminData = await johnAdminRes.json();
    assert.strictEqual(johnAdminRes.status, 403);
    assert.strictEqual(johnAdminData.error, 'Forbidden: Admin access required');
    console.log('OK: Access forbidden for normal user.');

    // 4. Log in as admin 'owner'
    console.log('\n4. Logging in as admin owner...');
    const loginAdminRes = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'ownerpassword' })
    });
    const loginAdminData = await loginAdminRes.json();
    assert.strictEqual(loginAdminRes.status, 200);
    assert.ok(loginAdminData.success);
    assert.strictEqual(loginAdminData.isAdmin, true);
    const adminToken = loginAdminData.token;
    console.log('OK: Admin logged in.');

    // 5. Admin profile check via /api/auth/me
    console.log('\n5. Verifying admin profile metadata...');
    const meRes = await fetch(`http://127.0.0.1:${PORT}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const meData = await meRes.json();
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meData.username, 'owner');
    assert.strictEqual(meData.isAdmin, true);
    console.log('OK: Admin profile is correct.');

    // 6. Admin accessing admin status endpoint
    console.log('\n6. Fetching admin system status...');
    const adminStatusRes = await fetch(`http://127.0.0.1:${PORT}/api/admin/status`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const adminStatusData = await adminStatusRes.json();
    assert.strictEqual(adminStatusRes.status, 200);
    assert.ok(adminStatusData.system);
    assert.strictEqual(typeof adminStatusData.activeUsers, 'number');
    console.log('OK: Status fetched, active users count:', adminStatusData.activeUsers);

    // 7. Get users list
    console.log('\n7. Fetching registered users list...');
    const adminUsersRes = await fetch(`http://127.0.0.1:${PORT}/api/admin/users`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const adminUsersData = await adminUsersRes.json();
    assert.strictEqual(adminUsersRes.status, 200);
    assert.ok(Array.isArray(adminUsersData));
    const johnRecord = adminUsersData.find(u => u.username === 'john');
    const ownerRecord = adminUsersData.find(u => u.username === 'owner');
    assert.ok(johnRecord);
    assert.ok(ownerRecord);
    assert.strictEqual(johnRecord.isAdmin, false);
    assert.strictEqual(ownerRecord.isAdmin, true);
    console.log('OK: Users list fetched with roles correctly.');

    // 8. Delete admin check (should be blocked)
    console.log('\n8. Attempting to delete active admin account...');
    const delAdminRes = await fetch(`http://127.0.0.1:${PORT}/api/admin/users/owner`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const delAdminData = await delAdminRes.json();
    assert.strictEqual(delAdminRes.status, 400);
    assert.strictEqual(delAdminData.error, 'Cannot delete the active admin account');
    console.log('OK: Blocked active admin deletion.');

    // 9. Delete normal user john
    console.log('\n9. Deleting normal user john...');
    const delJohnRes = await fetch(`http://127.0.0.1:${PORT}/api/admin/users/john`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const delJohnData = await delJohnRes.json();
    assert.strictEqual(delJohnRes.status, 200);
    assert.ok(delJohnData.success);
    console.log('OK: User john deleted successfully.');

    // 10. Verify john session is invalidated
    console.log('\n10. Verifying deleted user session is invalidated...');
    const johnSessionRes = await fetch(`http://127.0.0.1:${PORT}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${johnToken}` }
    });
    assert.strictEqual(johnSessionRes.status, 401);
    console.log('OK: John session was invalidated.');

    console.log('\n==================================');
    console.log('🎉 ALL ADMIN OPERATIONS VERIFIED!');
    console.log('==================================');

  } catch (err) {
    console.error('\n❌ TEST ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    server.kill();
    process.exit();
  }
}, 3000);
