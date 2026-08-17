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
    permissions: user.permissions || ''
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
  if (req.user.role === 'super_admin' || req.user.role === 'manager' || hasPermission(req.user, 'edit')) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}

function requireCanDeleteRecords(req, res, next) {
  if (req.user.role === 'super_admin' || req.user.role === 'manager' || hasPermission(req.user, 'delete')) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}

async function generateRegistryId(deviceName) {
  const prefix = deviceName && String(deviceName).trim() ? String(deviceName).trim().toUpperCase() : 'REG';
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

async function generateOrgId(deviceName) {
  const prefix = deviceName && String(deviceName).trim() ? String(deviceName).trim().toUpperCase() : 'REG';
  // A single GLOBAL counter shared by every device/user so the conference ID is
  // unique across the whole system. First registrant gets ...00101.
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
// super admin). This keeps each team from touching other teams' registrations.
function ownsRecord(user, record) {
  if (!user || !record) return false;
  if (user.role === 'super_admin') return true;
  return String(record.created_by || '').trim() === String(user.device_name || '').trim();
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
app.use(express.static(path.join(__dirname, 'public')));

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
  const rows = await run('SELECT id, username, email, role, device_name, permissions, created_at FROM users ORDER BY id DESC');
  res.json(rows);
});

app.post('/api/users', requireAuth, requireSuperAdmin, async (req, res) => {
  const { username, email, password, role, device_name, permissions } = req.body;
  if (!username || !email || !password || !role) {
    return res.status(400).json({ error: 'username, email, password, and role are required.' });
  }
  const devName = String(device_name || '').trim();
  if (!devName) {
    return res.status(400).json({ error: 'اسم الجهاز/الفريق (device_name) مطلوب — لضمان عزل بيانات كل فريق.' });
  }
  const duplicateDevice = await runGet('SELECT id FROM users WHERE LOWER(device_name) = LOWER(?)', [devName]);
  if (duplicateDevice) {
    return res.status(400).json({ error: 'اسم الجهاز/الفريق مستخدم بالفعل. يجب أن يكون فريداً.' });
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
    `INSERT INTO users (username,email,password_hash,role,device_name,permissions) VALUES (?,?,?,?,?,?)`,
    [username, email, passwordHash, role, devName, String(permissions || '')]
  );
  const newUser = await getUserByIdentifier(username);
  res.json(sanitizeUser(newUser));
});

app.put('/api/users/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { username, email, password, role, device_name, permissions } = req.body;
  const existing = await getUserById(id);
  if (!existing) {
    return res.status(404).json({ error: 'User not found.' });
  }
  if (existing.id === req.user.id && role !== existing.role) {
    return res.status(400).json({ error: 'Cannot change your own role.' });
  }
  const devName = String(device_name || '').trim();
  if (!devName) {
    return res.status(400).json({ error: 'اسم الجهاز/الفريق (device_name) مطلوب — لضمان عزل بيانات كل فريق.' });
  }
  const duplicateDevice = await runGet('SELECT id FROM users WHERE LOWER(device_name) = LOWER(?) AND id != ?', [devName, id]);
  if (duplicateDevice) {
    return res.status(400).json({ error: 'اسم الجهاز/الفريق مستخدم بالفعل. يجب أن يكون فريداً.' });
  }
  const conflictUsername = await getUserByIdentifier(username);
  if (conflictUsername && conflictUsername.id !== id) {
    return res.status(400).json({ error: 'Username already exists.' });
  }
  const conflictEmail = await getUserByIdentifier(email);
  if (conflictEmail && conflictEmail.id !== id) {
    return res.status(400).json({ error: 'Email already exists.' });
  }
  const updates = ['username = ?', 'email = ?', 'role = ?', 'device_name = ?', 'permissions = ?'];
  const params = [username, email, role, devName, String(permissions || '')];
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
    return res.status(400).json({ error: 'Cannot delete your own account.' });
  }
  await runExec('DELETE FROM users WHERE id = ?', [id]);
  res.json({ success: true });
});

app.get('/api/devices', requireAuth, requireSuperAdmin, async (req, res) => {
  const users = await run('SELECT id, username, device_name FROM users');
  const people = await run('SELECT created_by FROM people');
  const counts = people.reduce((map, p) => {
    const key = String(p.created_by || '').trim() || 'LEGACY';
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  const devices = users.map(u => ({
    id: u.id,
    device_name: u.device_name || '',
    username: u.username,
    count: counts[u.device_name || ''] || 0
  })).sort((a, b) => (b.count - a.count) || a.device_name.localeCompare(b.device_name));
  res.json(devices);
});

app.get('/api/people', requireAuth, async (req, res) => {
  let rows = await run('SELECT * FROM people ORDER BY id DESC');
  const { query, field, region, createdBy } = req.query;
  const isSuper = req.user.role === 'super_admin';

  // Non-super users can ONLY ever see their own device's records. The
  // createdBy query param is ignored for them so they can't view other teams'
  // data. Legacy rows (empty created_by) are migrated to ADMIN on startup.
  if (!isSuper) {
    const userDeviceName = String(req.user.device_name || '').trim();
    rows = rows.filter(p => String(p.created_by || '').trim() === userDeviceName);
  } else if (createdBy) {
    // Devices tab: show that device's records (plus any remaining legacy rows).
    rows = rows.filter(p => String(p.created_by || '').trim() === String(createdBy).trim() || String(p.created_by || '').trim() === '');
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
  
  const registryId = await generateRegistryId(req.user.device_name);
  const createdBy = req.user.device_name || '';
  const orgId = await generateOrgId(req.user.device_name);
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
