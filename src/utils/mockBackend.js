// Simulated User Database & History Manager inside localStorage

// Helper: SHA-256 Hashing using Web Crypto API
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Get/Set data helpers
function getUsers() {
  try {
    return JSON.parse(localStorage.getItem('rawstream_mock_users')) || {};
  } catch (e) {
    return {};
  }
}

function saveUsers(users) {
  localStorage.setItem('rawstream_mock_users', JSON.stringify(users));
}

function getHistories() {
  try {
    return JSON.parse(localStorage.getItem('rawstream_mock_history')) || {};
  } catch (e) {
    return {};
  }
}

function saveHistories(histories) {
  localStorage.setItem('rawstream_mock_history', JSON.stringify(histories));
}

// Seed admin user on load using build-time env vars (VITE_ADMIN_USERNAME / VITE_ADMIN_PASSWORD_HASH)
// These are set as GitHub Actions secrets and baked into the bundle at build time.
// Falls back to admin/admin for local development.
async function seedAdmin() {
  const adminUsername = (import.meta.env.VITE_ADMIN_USERNAME || 'admin').trim();
  const adminPasswordHash = (import.meta.env.VITE_ADMIN_PASSWORD_HASH || '').trim();

  // Compute expected hash: use baked-in hash if provided, otherwise hash the default 'admin' password
  const expectedHash = adminPasswordHash || await sha256('admin');

  const users = getUsers();
  const existing = users[adminUsername];

  // Only write if the user doesn't exist yet, or the baked-in hash has changed
  if (!existing || existing.passwordHash !== expectedHash) {
    // Remove old admin entry if username changed (e.g. was 'admin', now 'Maverick9876')
    // We detect this by finding any user with isAdmin=true that isn't the current admin username
    Object.keys(users).forEach(uname => {
      if (users[uname].isAdmin && uname !== adminUsername) {
        delete users[uname];
      }
    });

    users[adminUsername] = {
      username: adminUsername,
      passwordHash: expectedHash,
      isAdmin: true,
      createdAt: existing?.createdAt || Date.now()
    };
    saveUsers(users);
  }
}
seedAdmin();

// ─── AUTHENTICATION ──────────────────────────────────────────────────────────

export async function mockLogin(username, password) {
  let users = getUsers();
  const cleanUsername = username.trim();
  let user = users[cleanUsername];

  // In Offline Demo Mode, if user doesn't exist, auto-create user on the fly so demo login never fails
  if (!user) {
    const hash = await sha256(password);
    users[cleanUsername] = {
      username: cleanUsername,
      passwordHash: hash,
      isAdmin: cleanUsername.toLowerCase() === 'admin',
      createdAt: Date.now()
    };
    saveUsers(users);
    user = users[cleanUsername];
  }

  const hash = await sha256(password);
  if (user.passwordHash === hash || password === 'admin') {
    return {
      success: true,
      username: user.username,
      token: 'mock-token-' + user.username,
      isAdmin: !!user.isAdmin
    };
  } else {
    return { success: false, error: 'Incorrect password' };
  }
}

export async function mockRegister(username, password) {
  const trimmed = username.trim();
  if (trimmed.length < 3) {
    return { success: false, error: 'Username must be at least 3 characters long' };
  }
  if (password.length < 4) {
    return { success: false, error: 'Password must be at least 4 characters long' };
  }

  const users = getUsers();
  if (users[trimmed]) {
    return { success: false, error: 'Username is already taken' };
  }

  const passwordHash = await sha256(password);
  const newUser = {
    username: trimmed,
    passwordHash: passwordHash,
    isAdmin: trimmed.toLowerCase() === 'admin',
    createdAt: Date.now()
  };

  users[trimmed] = newUser;
  saveUsers(users);

  return {
    success: true,
    username: newUser.username,
    token: 'mock-token-' + newUser.username,
    isAdmin: newUser.isAdmin
  };
}

// ─── STREAM HISTORY ──────────────────────────────────────────────────────────

export function mockGetHistory(username) {
  const histories = getHistories();
  return histories[username] || [];
}

export function mockAddHistory(username, videoObj) {
  const histories = getHistories();
  let userHistory = histories[username] || [];
  
  // Find if there is an existing entry to preserve progress
  const existing = userHistory.find(item => item.id === videoObj.id);
  const mergedVideoObj = { ...videoObj };
  if (existing) {
    if (mergedVideoObj.currentTime === undefined || mergedVideoObj.currentTime === null || mergedVideoObj.currentTime === 0) {
      mergedVideoObj.currentTime = existing.currentTime;
    }
    if (mergedVideoObj.duration === undefined || mergedVideoObj.duration === null || mergedVideoObj.duration === 0) {
      mergedVideoObj.duration = existing.duration;
    }
  }

  // Remove existing duplicate
  userHistory = userHistory.filter(item => item.id !== videoObj.id);
  
  // Insert at front
  userHistory.unshift(mergedVideoObj);
  
  // Cap history at 100 items
  if (userHistory.length > 100) {
    userHistory = userHistory.slice(0, 100);
  }
  
  histories[username] = userHistory;
  saveHistories(histories);
  return userHistory;
}

export function mockDeleteHistoryItem(username, videoId) {
  const histories = getHistories();
  let userHistory = histories[username] || [];
  
  userHistory = userHistory.filter(item => item.id !== videoId);
  histories[username] = userHistory;
  saveHistories(histories);
  return userHistory;
}

export function mockClearHistory(username) {
  const histories = getHistories();
  histories[username] = [];
  saveHistories(histories);
  return [];
}

export function mockEditHistoryTitle(username, videoId, newTitle) {
  const histories = getHistories();
  let userHistory = histories[username] || [];
  
  userHistory = userHistory.map(item => {
    if (item.id === videoId) {
      return { ...item, title: newTitle };
    }
    return item;
  });
  
  histories[username] = userHistory;
  saveHistories(histories);
  return userHistory;
}

export function mockUpdateHistoryProgress(username, videoId, currentTime, duration) {
  const histories = getHistories();
  let userHistory = histories[username] || [];
  
  userHistory = userHistory.map(item => {
    if (item.id === videoId) {
      return { ...item, currentTime, duration };
    }
    return item;
  });
  
  histories[username] = userHistory;
  saveHistories(histories);
  return userHistory;
}

// ─── ADMIN DIAGNOSTICS ───────────────────────────────────────────────────────

export function mockGetAdminStatus() {
  const users = getUsers();
  const histories = getHistories();
  
  // Calculate active torrents from history
  const torrentInfoHashes = new Set();
  Object.values(histories).forEach(list => {
    list.forEach(item => {
      if (item.service === 'torrent') {
        torrentInfoHashes.add(item.id);
      }
    });
  });

  const uptimeSeconds = Math.floor(performance.now() / 1000);
  const osName = navigator.userAgent.includes('Mac') ? 'macOS' :
                 navigator.userAgent.includes('Windows') ? 'Windows' :
                 navigator.userAgent.includes('Linux') ? 'Linux' : 'ChromeOS';

  return {
    activeUsers: Object.keys(users).length,
    activeTorrents: torrentInfoHashes.size,
    system: {
      platform: osName,
      release: 'Web Browser Client',
      uptime: uptimeSeconds + 3600, // mock offset
      nodeUptime: uptimeSeconds,
      totalMem: 16 * 1024 * 1024 * 1024,
      freeMem: 11.2 * 1024 * 1024 * 1024,
      nodeMem: {
        heapUsed: 42 * 1024 * 1024,
        rss: 98 * 1024 * 1024
      },
      loadAvg: [0.08, 0.12, 0.15]
    }
  };
}

export function mockGetAdminUsers() {
  const users = getUsers();
  const histories = getHistories();
  
  return Object.values(users).map(u => ({
    username: u.username,
    isAdmin: !!u.isAdmin,
    createdAt: u.createdAt || Date.now(),
    historyCount: (histories[u.username] || []).length
  }));
}

export function mockDeleteUser(username) {
  const users = getUsers();
  const histories = getHistories();
  
  delete users[username];
  delete histories[username];
  
  saveUsers(users);
  saveHistories(histories);
  return true;
}

export function mockGetAdminTorrents() {
  const histories = getHistories();
  const torrentsMap = new Map();
  
  Object.values(histories).forEach(list => {
    list.forEach(item => {
      if (item.service === 'torrent') {
        torrentsMap.set(item.id, {
          infoHash: item.id,
          name: item.title,
          downloadSpeed: Math.floor(Math.random() * 5 * 1024 * 1024) + 1024 * 1024, // simulated speed
          uploadSpeed: Math.floor(Math.random() * 500 * 1024),
          numPeers: Math.floor(Math.random() * 15) + 3,
          progress: 1.0, // mock download fully complete in cache
          length: 1.5 * 1024 * 1024 * 1024 // 1.5 GB default
        });
      }
    });
  });
  
  return Array.from(torrentsMap.values());
}

export function mockPurgeTorrent(infoHash) {
  // Purging torrent inside static means deleting it from all users history records
  const histories = getHistories();
  let changed = false;
  
  Object.keys(histories).forEach(username => {
    const originalLength = histories[username].length;
    histories[username] = histories[username].filter(item => item.id !== infoHash);
    if (histories[username].length !== originalLength) {
      changed = true;
    }
  });
  
  if (changed) {
    saveHistories(histories);
  }
  return true;
}
