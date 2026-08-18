const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'registry.db');
const PORT = process.env.PORT || 3000;
const DEFAULT_ADMIN_PASSWORD = 'Admin123!';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_FILE);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function runGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function runExec(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function initializeDatabase() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT,
      device_name TEXT,
      permissions TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registry_id TEXT UNIQUE,
      name TEXT,
      surname TEXT,
      age INTEGER,
      city TEXT,
      origin_city TEXT,
      region TEXT,
      tribe TEXT,
      id_number TEXT,
      id_type TEXT,
      org_id TEXT,
      ethnicity TEXT,
      education TEXT,
      notes TEXT,
      phone TEXT,
      phone2 TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS cities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      region TEXT,
      auto_added INTEGER DEFAULT 0
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS tribes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      auto_added INTEGER DEFAULT 0
    );
  `);

  // Migration: Add device_name column if it doesn't exist
  try {
    await run('ALTER TABLE users ADD COLUMN device_name TEXT');
  } catch (err) {
    // Column already exists, ignore error
  }

  // Migration: Add region column (for supervisors) if it doesn't exist
  try {
    await run('ALTER TABLE users ADD COLUMN region TEXT');
  } catch (err) { }

  // Migration: Add supervisor_id column (link members -> supervisor) if it doesn't exist
  try {
    await run('ALTER TABLE users ADD COLUMN supervisor_id INTEGER');
  } catch (err) { }

  // Migration: Add user detail columns
  const detailCols = ['full_name', 'surname', 'age', 'city', 'origin_city', 'tribe', 'id_number', 'id_type', 'education', 'phone', 'phone2', 'notes'];
  for (const col of detailCols) {
    try { await run(`ALTER TABLE users ADD COLUMN ${col} TEXT`); } catch (err) { }
  }

  // Migration: Add created_by column if it doesn't exist
  try {
    await run('ALTER TABLE people ADD COLUMN created_by TEXT');
  } catch (err) {
    // Column already exists, ignore error
  }

  // Migration: Add id_type column if it doesn't exist
  try {
    await run('ALTER TABLE people ADD COLUMN id_type TEXT');
  } catch (err) {
    // Column already exists, ignore error
  }

  // Migration: Add org_id column if it doesn't exist
  try {
    await run('ALTER TABLE people ADD COLUMN org_id TEXT');
  } catch (err) {
    // Column already exists, ignore error
  }

  // Migration: Add active column if it doesn't exist
  try {
    await run('ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1');
  } catch (err) { }

  // The organizational/conference ID must be unique across ALL devices/users.
  // (Existing rows are NULL, which SQLite allows multiple times in a unique index.)
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_people_org_id ON people(org_id)`);

  // Migration: Add ethnicity column if it doesn't exist
  try {
    await run('ALTER TABLE people ADD COLUMN ethnicity TEXT');
  } catch (err) {
    // Column already exists, ignore error
  }

  await run(`
    CREATE TABLE IF NOT EXISTS ethnicities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      auto_added INTEGER DEFAULT 0
    );
  `);

  // Assign any legacy rows (no created_by) to the admin device so scoping is
  // unambiguous and no record stays visible/editable by every team.
  await run(`UPDATE people SET created_by = 'ADMIN' WHERE created_by IS NULL OR TRIM(created_by) = ''`);

  const count = await runGet('SELECT COUNT(*) AS c FROM users');
  if (!count || count.c === 0) {
    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    await runExec(
      `INSERT INTO users (username,email,password_hash,role,permissions) VALUES (?,?,?,?,?)`,
      ['admin', 'admin@example.com', passwordHash, 'super_admin', 'manage_users,edit,delete,export']
    );
    console.log('Default super admin created: admin / Admin123!');
  }
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    device_name: user.device_name || '',
    region: user.region || '',
    supervisor_id: user.supervisor_id || null,
    permissions: user.permissions || '',
    active: user.active !== undefined ? user.active : 1,
    full_name: user.full_name || '',
    surname: user.surname || '',
    age: user.age || null,
    city: user.city || '',
    origin_city: user.origin_city || '',
    tribe: user.tribe || '',
    id_number: user.id_number || '',
    id_type: user.id_type || '',
    education: user.education || '',
    phone: user.phone || '',
    phone2: user.phone2 || '',
    notes: user.notes || ''
  };
}

function getUserPermissions(user) {
  if (!user) return new Set();
  return new Set(String(user.permissions || '').split(',').map(p => p.trim().toLowerCase()).filter(Boolean));
}

function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const perms = getUserPermissions(user);
  return perms.has(permission);
}

async function getUserById(id) {
  return runGet('SELECT * FROM users WHERE id = ?', [id]);
}

async function getUserByIdentifier(value) {
  return runGet('SELECT * FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', [value, value]);
}

async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = await getUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  next();
}

function requireSuperAdmin(req, res, next) {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function requireManageUsers(req, res, next) {
  if (req.user.role === 'super_admin' || hasPermission(req.user, 'manage_users')) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}

function requireCanEditRecords(req, res, next) {
  if (req.user.role === 'super_admin' || req.user.role === 'supervisor' || req.user.role === 'manager' || hasPermission(req.user, 'edit')) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}

function requireCanDeleteRecords(req, res, next) {
  if (req.user.role === 'super_admin' || req.user.role === 'supervisor' || req.user.role === 'manager' || hasPermission(req.user, 'delete')) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}

async function generateRegistryId(fullPrefix) {
  // fullPrefix for supervisor "AH" = "AH"
  // fullPrefix for member "GT" under supervisor "AH" = "AHGT"
  const prefix = fullPrefix && String(fullPrefix).trim() ? String(fullPrefix).trim().toUpperCase() : 'REG';
  // Find the last registry_id for this device and extract the number
  const rows = await run('SELECT registry_id FROM people WHERE registry_id LIKE ? ORDER BY registry_id DESC LIMIT 1', [`${prefix}-%`]);
  let next = 1;
  if (rows && rows.length > 0) {
    const match = rows[0].registry_id.match(/-(\d+)$/);
    if (match) {
      next = parseInt(match[1], 10) + 1;
    }
  }
  return `${prefix}-${String(next).padStart(4, '0')}`;
}

async function generateOrgId(fullPrefix) {
  const prefix = fullPrefix && String(fullPrefix).trim() ? String(fullPrefix).trim().toUpperCase() : 'REG';
  // GLOBAL counter shared by all devices: first entry gets 00101, second 00102, etc.
  const row = await runGet(
    `SELECT COALESCE(MAX(CAST(SUBSTR(org_id, LENGTH(org_id) - 4) AS INTEGER)), 100) AS last
     FROM people WHERE org_id IS NOT NULL AND org_id != ''`
  );
  const next = ((row && row.last ? Number(row.last) : 100) || 100) + 1;
  return `${prefix}-${String(next).padStart(5, '0')}`;
}

// Fields that uniquely identify a person. Two records with identical values in
// ALL of these fields are treated as the same person (duplicate).
const PERSON_UNIQUE_FIELDS = ['name','surname','age','city','origin_city','region','tribe','id_type','id_number','education','notes','phone','phone2'];

async function findDuplicatePerson(values) {
  const params = PERSON_UNIQUE_FIELDS.map(f => String(values?.[f] ?? '').trim());
  const where = PERSON_UNIQUE_FIELDS.map(f => `COALESCE(CAST(${f} AS TEXT),'') = ?`).join(' AND ');
  const row = await runGet(`SELECT id, registry_id FROM people WHERE ${where} LIMIT 1`, params);
  return row;
}

// A record may only be edited/deleted by the device that created it (or the
// super admin). Also, a supervisor can edit/delete records created by their own
// team members. This keeps each team from touching other teams' registrations.
function ownsRecord(user, record) {
  if (!user || !record) return false;
  if (user.role === 'super_admin') return true;
  const recordDevice = String(record.created_by || '').trim();
  // Own device record
  if (recordDevice === String(user.device_name || '').trim()) return true;
  // Supervisor can edit/delete their team members' records
  if (user.role === 'supervisor') {
    // Team members' devices end with the supervisor's device prefix
    return recordDevice.endsWith(String(user.device_name || '').trim());
  }
  return false;
}

// Get all device names whose records are visible to this user.
// For super_admin: null means "all devices".
// For supervisor: their own device + all their team members' devices.
// For member: only their own device.
async function getVisibleDevices(user) {
  if (user.role === 'super_admin') return null; // see all
  const ownDevice = String(user.device_name || '').trim();
  if (user.role === 'supervisor') {
    const members = await run('SELECT device_name FROM users WHERE supervisor_id = ? AND device_name IS NOT NULL AND device_name != ?', [user.id, ownDevice]);
    const devices = [ownDevice];
    members.forEach(m => {
      const d = String(m.device_name || '').trim();
      if (d && !devices.includes(d)) devices.push(d);
    });
    return devices;
  }
  // member / other - only their own device
  return [ownDevice];
}

// Compute the full registry_id prefix for a user.
// For supervisor (device "AH"): returns "AH"
// For member (device "GT" under supervisor "AH"): returns "AHGT"
async function getRegistryPrefix(user) {
  const deviceName = String(user.device_name || '').trim().toUpperCase();
  if (user.role === 'super_admin' || user.role === 'supervisor') return deviceName;
  // member: find supervisor and combine prefixes
  if (user.role === 'member' && user.supervisor_id) {
    const supervisor = await runGet('SELECT device_name FROM users WHERE id = ?', [user.supervisor_id]);
    if (supervisor) {
      const supDevice = String(supervisor.device_name || '').trim().toUpperCase();
      return supDevice + deviceName;
    }
  }
  return deviceName;
}

function requireSupervisorOrSuperAdmin(req, res, next) {
  if (req.user.role === 'super_admin' || req.user.role === 'supervisor') {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden — supervisor or super_admin only.' });
}

// Keep the shared lookup lists (cities + tribes) filled automatically from the
// people being registered, and keep the person's region consistent with their
// (already-known) city so regional reports are accurate.
async function autoSavePersonLookups(values) {
  const region = String(values.region || '').trim();
  const tryInsert = async (sql, params) => { try { await runExec(sql, params); } catch (e) { /* ignore unique races */ } };

  const city = String(values.city || '').trim();
  if (city) {
    const found = await runGet('SELECT id, region FROM cities WHERE LOWER(name) = LOWER(?)', [city]);
    if (found) {
      // City is already known -> use its canonical region for this person.
      if (found.region) values.region = found.region;
    } else {
      await tryInsert('INSERT INTO cities (name, region, auto_added) VALUES (?,?,1)', [city, region]);
    }
  }

  const originCity = String(values.origin_city || '').trim();
  if (originCity) {
    const found = await runGet('SELECT id FROM cities WHERE LOWER(name) = LOWER(?)', [originCity]);
    if (!found) await tryInsert('INSERT INTO cities (name, region, auto_added) VALUES (?,?,1)', [originCity, region]);
  }

  const tribe = String(values.tribe || '').trim();
  if (tribe) {
    const found = await runGet('SELECT id FROM tribes WHERE LOWER(name) = LOWER(?)', [tribe]);
    if (!found) await tryInsert('INSERT INTO tribes (name, auto_added) VALUES (?,1)', [tribe]);
  }
}

const app = express();
app.use(express.json());
app.use(session({
  secret: 'replace-this-secret-with-a-secure-value',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

app.post('/api/login', async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Identifier and password are required.' });
  }
  const user = await getUserByIdentifier(identifier);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }
  if (user.active === 0) {
    return res.status(403).json({ error: 'هذا الحساب غير نشط. تواصل مع المشرف.' });
  }
  req.session.userId = user.id;
  res.json(sanitizeUser(user));
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json(sanitizeUser(req.user));
});

app.get('/api/users', requireAuth, requireSuperAdmin, async (req, res) => {
  const rows = await run('SELECT id, username, email, role, device_name, region, supervisor_id, full_name, surname, age, city, origin_city, tribe, id_number, id_type, education, phone, phone2, notes, active, permissions, created_at FROM users ORDER BY id DESC');
  res.json(rows);
});

// ---------- Single user detail (for supervisors to view their team) ----------
app.get('/api/user/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const user = await runGet('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  // Super admin can view any user. Supervisor can only view their own team members.
  if (req.user.role !== 'super_admin') {
    if (req.user.role !== 'supervisor' || (user.supervisor_id !== req.user.id && user.id !== req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  res.json(sanitizeUser(user));
});

app.post('/api/users', requireAuth, requireSuperAdmin, async (req, res) => {
  const { username, email, password, role, device_name, permissions, region, supervisor_id,
    full_name, surname, age, city, origin_city, tribe, id_number, id_type, education, phone, phone2, notes } = req.body;
  if (!username || !email || !password || !role) {
    return res.status(400).json({ error: 'username, email, password, and role are required.' });
  }
  if (role === 'supervisor' && !region) {
    return res.status(400).json({ error: 'المنطقة (region) مطلوبة للمشرفين.' });
  }
  const devName = String(device_name || '').trim();
  if (!devName) {
    return res.status(400).json({ error: 'اسم الجهاز (device_name) مطلوب — لضمان عزل بيانات كل فريق.' });
  }
  const duplicateDevice = await runGet('SELECT id FROM users WHERE LOWER(device_name) = LOWER(?)', [devName]);
  if (duplicateDevice) {
    return res.status(400).json({ error: 'اسم الجهاز مستخدم بالفعل. يجب أن يكون فريداً.' });
  }
  const existingByUsername = await getUserByIdentifier(username);
  if (existingByUsername) {
    return res.status(400).json({ error: 'Username already exists.' });
  }
  const existingByEmail = await getUserByIdentifier(email);
  if (existingByEmail) {
    return res.status(400).json({ error: 'Email already exists.' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await runExec(
    `INSERT INTO users (username,email,password_hash,role,device_name,permissions,region,supervisor_id,
      full_name,surname,age,city,origin_city,tribe,id_number,id_type,education,phone,phone2,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [username, email, passwordHash, role, devName, String(permissions || ''), region || null, supervisor_id || null,
      full_name || '', surname || '', age || null, city || '', origin_city || '', tribe || '', id_number || '', id_type || '', education || '', phone || '', phone2 || '', notes || '']
  );
  const newUser = await getUserByIdentifier(username);
  res.json(sanitizeUser(newUser));
});

app.put('/api/users/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { username, email, password, role, device_name, permissions, region, supervisor_id,
    full_name, surname, age, city, origin_city, tribe, id_number, id_type, education, phone, phone2, notes } = req.body;
  const existing = await getUserById(id);
  if (!existing) {
    return res.status(404).json({ error: 'User not found.' });
  }
  if (existing.id === req.user.id && role !== existing.role) {
    return res.status(400).json({ error: 'Cannot change your own role.' });
  }
  const devName = String(device_name || '').trim();
  if (!devName) {
    return res.status(400).json({ error: 'اسم الجهاز (device_name) مطلوب — لضمان عزل بيانات كل فريق.' });
  }
  const duplicateDevice = await runGet('SELECT id FROM users WHERE LOWER(device_name) = LOWER(?) AND id != ?', [devName, id]);
  if (duplicateDevice) {
    return res.status(400).json({ error: 'اسم الجهاز مستخدم بالفعل. يجب أن يكون فريداً.' });
  }
  const conflictUsername = await getUserByIdentifier(username);
  if (conflictUsername && conflictUsername.id !== id) {
    return res.status(400).json({ error: 'Username already exists.' });
  }
  const conflictEmail = await getUserByIdentifier(email);
  if (conflictEmail && conflictEmail.id !== id) {
    return res.status(400).json({ error: 'Email already exists.' });
  }
  const updates = ['username = ?', 'email = ?', 'role = ?', 'device_name = ?', 'permissions = ?', 'region = ?', 'supervisor_id = ?',
    'full_name = ?', 'surname = ?', 'age = ?', 'city = ?', 'origin_city = ?', 'tribe = ?', 'id_number = ?', 'id_type = ?', 'education = ?', 'phone = ?', 'phone2 = ?', 'notes = ?'];
  const params = [username, email, role, devName, String(permissions || ''), region || null, supervisor_id || null,
    full_name || '', surname || '', age || null, city || '', origin_city || '', tribe || '', id_number || '', id_type || '', education || '', phone || '', phone2 || '', notes || ''];
  if (password) {
    const passwordHash = await bcrypt.hash(password, 10);
    updates.push('password_hash = ?');
    params.push(passwordHash);
  }
  params.push(id);
  await runExec(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = await getUserById(id);
  res.json(sanitizeUser(updated));
});

app.delete('/api/users/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Cannot deactivate your own account.' });
  }
  await runExec('UPDATE users SET active = 0 WHERE id = ?', [id]);
  res.json({ success: true, active: false });
});

app.put('/api/users/:id/activate', requireAuth, requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await runExec('UPDATE users SET active = 1 WHERE id = ?', [id]);
  const updated = await getUserById(id);
  res.json(sanitizeUser(updated));
});

app.get('/api/devices', requireAuth, requireSuperAdmin, async (req, res) => {
  const users = await run('SELECT id, username, device_name, region, supervisor_id FROM users');
  const people = await run('SELECT created_by FROM people');
  // Get supervisor names
  const supervisors = {};
  users.forEach(u => { if (u.region) supervisors[u.id] = u.username; });
  const counts = people.reduce((map, p) => {
    const key = String(p.created_by || '').trim() || 'LEGACY';
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  const devices = users.map(u => ({
    id: u.id,
    device_name: u.device_name || '',
    username: u.username,
    region: u.region || '',
    supervisor_id: u.supervisor_id || null,
    supervisor_name: u.supervisor_id ? (supervisors[u.supervisor_id] || '') : '',
    count: counts[u.device_name || ''] || 0
  })).sort((a, b) => (b.count - a.count) || a.device_name.localeCompare(b.device_name));
  res.json(devices);
});
// ---------- Supervisors (super_admin only) ----------
app.get('/api/supervisors', requireAuth, requireSuperAdmin, async (req, res) => {
  const supervisors = await run('SELECT id, username, email, device_name, region, full_name, phone, created_at FROM users WHERE role = ? ORDER BY region, username', ['supervisor']);
  const people = await run('SELECT created_by FROM people');
  const teamMembers = await run('SELECT supervisor_id, id, username, device_name FROM users WHERE supervisor_id IS NOT NULL');

  const result = supervisors.map(sup => {
    const supDevice = String(sup.device_name || '').trim();
    const teamDevices = [supDevice];
    teamMembers.filter(tm => tm.supervisor_id === sup.id).forEach(tm => {
      const d = String(tm.device_name || '').trim();
      if (d && !teamDevices.includes(d)) teamDevices.push(d);
    });
    const totalEntries = people.filter(p => teamDevices.includes(String(p.created_by || '').trim())).length;
    const teamCount = teamMembers.filter(tm => tm.supervisor_id === sup.id).length;
    return {
      id: sup.id,
      username: sup.username,
      email: sup.email,
      device_name: supDevice,
      region: sup.region || '',
      team_member_count: teamCount,
      total_entries: totalEntries
    };
  });
  res.json(result);
});

app.get('/api/supervisors/:id/team', requireAuth, requireSuperAdmin, async (req, res) => {
  const supId = Number(req.params.id);
  const supervisor = await runGet('SELECT id, username, device_name, region FROM users WHERE id = ? AND role = ?', [supId, 'supervisor']);
  if (!supervisor) {
    return res.status(404).json({ error: 'Supervisor not found.' });
  }
  const members = await run('SELECT id, username, email, device_name, full_name, phone, active, created_at FROM users WHERE supervisor_id = ? ORDER BY username', [supId]);
  const supDevice = String(supervisor.device_name || '').trim();
  const allDevices = [supDevice, ...members.map(m => String(m.device_name || '').trim()).filter(Boolean)];
  const people = await run('SELECT created_by FROM people');
  const membersWithCounts = members.map(m => {
    const d = String(m.device_name || '').trim();
    return { ...m, device_name: d, entry_count: people.filter(p => String(p.created_by || '').trim() === d).length };
  });
  const supEntryCount = people.filter(p => String(p.created_by || '').trim() === supDevice).length;
  res.json({
    supervisor: { id: supervisor.id, username: supervisor.username, device_name: supDevice, region: supervisor.region, entry_count: supEntryCount },
    members: membersWithCounts,
    total_entries: people.filter(p => allDevices.includes(String(p.created_by || '').trim())).length
  });
});

app.get('/api/supervisors/:id/entries', requireAuth, requireSuperAdmin, async (req, res) => {
  const supId = Number(req.params.id);
  const supervisor = await runGet('SELECT id, device_name FROM users WHERE id = ? AND role = ?', [supId, 'supervisor']);
  if (!supervisor) {
    return res.status(404).json({ error: 'Supervisor not found.' });
  }
  const supDevice = String(supervisor.device_name || '').trim();
  const members = await run('SELECT device_name FROM users WHERE supervisor_id = ?', [supId]);
  const visibleDevices = [supDevice, ...members.map(m => String(m.device_name || '').trim()).filter(Boolean)];
  const rows = await run('SELECT * FROM people ORDER BY id DESC');
  const filtered = rows.filter(p => visibleDevices.includes(String(p.created_by || '').trim()));
  res.json(filtered);
});

// ---------- My Team (supervisor only) ----------
app.get('/api/my-team', requireAuth, requireSupervisorOrSuperAdmin, async (req, res) => {
  if (req.user.role !== 'supervisor') {
    return res.status(403).json({ error: 'Only supervisors can access this endpoint.' });
  }
  const supDevice = String(req.user.device_name || '').trim();
  const members = await run('SELECT id, username, email, device_name, full_name, phone, active, created_at FROM users WHERE supervisor_id = ? ORDER BY username', [req.user.id]);
  const people = await run('SELECT created_by FROM people');
  const allDevices = [supDevice, ...members.map(m => String(m.device_name || '').trim()).filter(Boolean)];
  const membersWithCounts = members.map(m => {
    const d = String(m.device_name || '').trim();
    return { ...m, device_name: d, entry_count: people.filter(p => String(p.created_by || '').trim() === d).length };
  });
  const supEntryCount = people.filter(p => String(p.created_by || '').trim() === supDevice).length;
  const totalEntries = people.filter(p => allDevices.includes(String(p.created_by || '').trim())).length;
  res.json({
    supervisor: { id: req.user.id, username: req.user.username, device_name: supDevice, region: req.user.region || '', full_name: req.user.full_name || '', phone: req.user.phone || '', entry_count: supEntryCount },
    members: membersWithCounts,
    total_entries: totalEntries
  });
});

app.post('/api/my-team', requireAuth, requireSupervisorOrSuperAdmin, async (req, res) => {
  if (req.user.role !== 'supervisor') {
    return res.status(403).json({ error: 'Only supervisors can add team members.' });
  }
  const { username, email, password, device_name, full_name, surname, phone, id_number, id_type, age, city, origin_city, tribe, education, notes } = req.body;
  if (!username || !email || !password || !device_name) {
    return res.status(400).json({ error: 'username, email, password, and device_name are required.' });
  }
  const devName = String(device_name).trim().toUpperCase();
  if (!devName) {
    return res.status(400).json({ error: 'اسم الجهاز مطلوب.' });
  }
  const duplicateDevice = await runGet('SELECT id FROM users WHERE LOWER(device_name) = LOWER(?)', [devName]);
  if (duplicateDevice) {
    return res.status(400).json({ error: 'اسم الجهاز مستخدم بالفعل.' });
  }
  const existingByUsername = await getUserByIdentifier(username);
  if (existingByUsername) {
    return res.status(400).json({ error: 'Username already exists.' });
  }
  const existingByEmail = await getUserByIdentifier(email);
  if (existingByEmail) {
    return res.status(400).json({ error: 'Email already exists.' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await runExec(
    `INSERT INTO users (username,email,password_hash,role,device_name,permissions,supervisor_id,
      full_name,surname,age,city,origin_city,tribe,id_number,id_type,education,phone,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [username, email, passwordHash, 'member', devName, 'edit,delete,export', req.user.id,
      full_name || '', surname || '', age || null, city || '', origin_city || '', tribe || '', id_number || '', id_type || '', education || '', phone || '', notes || '']
  );
  const newMember = await getUserByIdentifier(username);
  res.json(sanitizeUser(newMember));
});
// ---------- My Team: update/delete members (supervisor only) ----------
app.put('/api/my-team/:id', requireAuth, requireSupervisorOrSuperAdmin, async (req, res) => {
  if (req.user.role !== 'supervisor') {
    return res.status(403).json({ error: 'Only supervisors can update team members.' });
  }
  const id = Number(req.params.id);
  const member = await runGet('SELECT * FROM users WHERE id = ? AND supervisor_id = ?', [id, req.user.id]);
  if (!member) {
    return res.status(404).json({ error: 'Team member not found or not under your supervision.' });
  }
  const { username, email, password, device_name, full_name, surname, phone, id_number, id_type, age, city, origin_city, tribe, education, notes } = req.body;
  const devName = String(device_name || member.device_name).trim().toUpperCase();
  const updates = ['username = ?', 'email = ?', 'device_name = ?', 'full_name = ?', 'surname = ?', 'age = ?', 'city = ?', 'origin_city = ?', 'tribe = ?', 'id_number = ?', 'id_type = ?', 'education = ?', 'phone = ?', 'notes = ?'];
  const params = [username || member.username, email || member.email, devName, full_name || '', surname || '', age || null, city || '', origin_city || '', tribe || '', id_number || '', id_type || '', education || '', phone || '', notes || ''];
  if (password) {
    const passwordHash = await bcrypt.hash(password, 10);
    updates.push('password_hash = ?');
    params.push(passwordHash);
  }
  params.push(id);
  await runExec(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = await getUserById(id);
  res.json(sanitizeUser(updated));
});

app.delete('/api/my-team/:id', requireAuth, requireSupervisorOrSuperAdmin, async (req, res) => {
  if (req.user.role !== 'supervisor') {
    return res.status(403).json({ error: 'Only supervisors can manage team members.' });
  }
  const id = Number(req.params.id);
  const member = await runGet('SELECT * FROM users WHERE id = ? AND supervisor_id = ?', [id, req.user.id]);
  if (!member) {
    return res.status(404).json({ error: 'Team member not found or not under your supervision.' });
  }
  // Deactivate instead of delete
  await runExec('UPDATE users SET active = 0 WHERE id = ?', [id]);
  res.json({ success: true, active: false });
});

app.put('/api/my-team/:id/activate', requireAuth, requireSupervisorOrSuperAdmin, async (req, res) => {
  if (req.user.role !== 'supervisor') {
    return res.status(403).json({ error: 'Only supervisors can manage team members.' });
  }
  const id = Number(req.params.id);
  const member = await runGet('SELECT * FROM users WHERE id = ? AND supervisor_id = ?', [id, req.user.id]);
  if (!member) {
    return res.status(404).json({ error: 'Team member not found or not under your supervision.' });
  }
  await runExec('UPDATE users SET active = 1 WHERE id = ?', [id]);
  const updated = await getUserById(id);
  res.json(sanitizeUser(updated));
});

// ---------- People CRUD ----------
app.get('/api/people', requireAuth, async (req, res) => {
  let rows = await run('SELECT * FROM people ORDER BY id DESC');
  const { query, field, region, createdBy } = req.query;
  const isSuper = req.user.role === 'super_admin';

  // Supervisor can see their own records + their team members' records.
  // Members can only see their own device's records.
  // If createdBy is specified, filter by that specific device regardless of role.
  if (createdBy) {
    rows = rows.filter(p => String(p.created_by || '').trim() === String(createdBy).trim());
  } else if (!isSuper) {
    const visibleDevices = await getVisibleDevices(req.user);
    if (visibleDevices) {
      rows = rows.filter(p => visibleDevices.includes(String(p.created_by || '').trim()));
    }
  }
  
  if (query) {
    const q = String(query).trim().toLowerCase();
    rows = rows.filter(p => {
      if (!q) return true;
      if (field === 'name_surname') {
        return String(p.name || '').toLowerCase().includes(q) || String(p.surname || '').toLowerCase().includes(q);
      }
      return String(p[field] || '').toLowerCase().includes(q);
    });
  }
  if (region) {
    rows = rows.filter(p => p.region === region);
  }
  res.json(rows);
});

app.post('/api/people', requireAuth, requireCanEditRecords, async (req, res) => {
  const values = req.body;
  if (!values.name || !String(values.name).trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  // Reject exact duplicates so re-importing the same sheet (or same form data)
  // cannot create a second record.
  const existing = await findDuplicatePerson(values);
  if (existing) {
    return res.status(409).json({
      error: `سجل مطابق موجود بالفعل برقم ${existing.registry_id}`,
      existingRegistryId: existing.registry_id,
      existingId: existing.id
    });
  }
  
  // Auto-save cities/tribe and derive region from the (known) city.
  await autoSavePersonLookups(values);
  
  const registryPrefix = await getRegistryPrefix(req.user);
  const registryId = await generateRegistryId(registryPrefix);
  const createdBy = req.user.device_name || '';
  const orgId = await generateOrgId(registryPrefix);
  await runExec(
    `INSERT INTO people (registry_id,name,surname,age,city,origin_city,region,tribe,ethnicity,id_type,id_number,education,notes,phone,phone2,created_by,org_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      registryId,
      values.name || '',
      values.surname || '',
      values.age || null,
      values.city || '',
      values.origin_city || '',
      values.region || '',
      values.tribe || '',
      values.ethnicity || '',
      values.id_type || '',
      values.id_number || '',
      values.education || '',
      values.notes || '',
      values.phone || '',
      values.phone2 || '',
      createdBy,
      orgId
    ]
  );
  const person = await runGet('SELECT * FROM people WHERE registry_id = ?', [registryId]);
  res.json(person);
});

app.put('/api/people/:id', requireAuth, requireCanEditRecords, async (req, res) => {
  const id = Number(req.params.id);
  const values = req.body;
  const existing = await runGet('SELECT * FROM people WHERE id = ?', [id]);
  if (!existing) {
    return res.status(404).json({ error: 'Person not found.' });
  }

  // Only the device that created this record (or the super admin) may edit it.
  if (!ownsRecord(req.user, existing)) {
    return res.status(403).json({ error: 'لا يمكنك تعديل سجلات جهاز/فريق آخر.' });
  }

  // Reject if the new values would make this record an exact duplicate of a
  // DIFFERENT existing record. If the match is the record being edited itself,
  // that's just "saving without changes" and is allowed.
  const dup = await findDuplicatePerson(values);
  if (dup && dup.id !== id) {
    return res.status(409).json({
      error: `سجل مطابق موجود بالفعل برقم ${dup.registry_id}`,
      existingRegistryId: dup.registry_id,
      existingId: dup.id
    });
  }
  // Auto-save cities/tribe and derive region from the (known) city.
  await autoSavePersonLookups(values);
  await runExec(
    `UPDATE people SET name = ?, surname = ?, age = ?, city = ?, origin_city = ?, region = ?, tribe = ?, ethnicity = ?, id_type = ?, id_number = ?, education = ?, notes = ?, phone = ?, phone2 = ? WHERE id = ?`,
    [
      values.name || '',
      values.surname || '',
      values.age || null,
      values.city || '',
      values.origin_city || '',
      values.region || '',
      values.tribe || '',
      values.ethnicity || '',
      values.id_type || '',
      values.id_number || '',
      values.education || '',
      values.notes || '',
      values.phone || '',
      values.phone2 || '',
      id
    ]
  );
  const updated = await runGet('SELECT * FROM people WHERE id = ?', [id]);
  res.json(updated);
});

app.delete('/api/people/:id', requireAuth, requireCanDeleteRecords, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await runGet('SELECT * FROM people WHERE id = ?', [id]);
  if (!existing) {
    return res.status(404).json({ error: 'Person not found.' });
  }
  // Only the device that created this record (or the super admin) may delete it.
  if (!ownsRecord(req.user, existing)) {
    return res.status(403).json({ error: 'لا يمكنك حذف سجلات جهاز/فريق آخر.' });
  }
  await runExec('DELETE FROM people WHERE id = ?', [id]);
  res.json({ success: true });
});

app.get('/api/cities', requireAuth, async (req, res) => {
  const rows = await run('SELECT * FROM cities ORDER BY name ASC');
  res.json(rows);
});

app.post('/api/cities', requireAuth, requireSuperAdmin, async (req, res) => {
  const { name, region, auto_added } = req.body;
  if (!name || !region) {
    return res.status(400).json({ error: 'City name and region are required.' });
  }
  try {
    await runExec('INSERT INTO cities (name, region, auto_added) VALUES (?, ?, ?)', [name, region, auto_added ? 1 : 0]);
    const row = await runGet('SELECT * FROM cities WHERE name = ?', [name]);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: 'City already exists.' });
  }
});

app.delete('/api/cities/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await runExec('DELETE FROM cities WHERE id = ?', [id]);
  res.json({ success: true });
});

app.get('/api/tribes', requireAuth, async (req, res) => {
  const rows = await run('SELECT * FROM tribes ORDER BY name ASC');
  res.json(rows);
});

app.post('/api/tribes', requireAuth, requireSuperAdmin, async (req, res) => {
  const { name } = req.body;
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return res.status(400).json({ error: 'Tribe name is required.' });
  }
  try {
    await runExec('INSERT INTO tribes (name, auto_added) VALUES (?, 0)', [trimmed]);
    const row = await runGet('SELECT * FROM tribes WHERE name = ?', [trimmed]);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: 'Tribe already exists.' });
  }
});

app.delete('/api/tribes/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await runExec('DELETE FROM tribes WHERE id = ?', [id]);
  res.json({ success: true });
});

// ---------- Ethnicities ----------
app.get('/api/ethnicities', requireAuth, async (req, res) => {
  const rows = await run('SELECT * FROM ethnicities ORDER BY name ASC');
  res.json(rows);
});

app.post('/api/ethnicities', requireAuth, requireSuperAdmin, async (req, res) => {
  const { name } = req.body;
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return res.status(400).json({ error: 'Ethnicity name is required.' });
  }
  try {
    await runExec('INSERT INTO ethnicities (name, auto_added) VALUES (?, 0)', [trimmed]);
    const row = await runGet('SELECT * FROM ethnicities WHERE name = ?', [trimmed]);
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: 'Ethnicity already exists.' });
  }
});

app.delete('/api/ethnicities/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await runExec('DELETE FROM ethnicities WHERE id = ?', [id]);
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
