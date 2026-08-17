const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'registry.db');

// Delete existing database
if (fs.existsSync(DB_FILE)) {
  fs.unlinkSync(DB_FILE);
  console.log('Deleted existing database');
}

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

function runExec(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function setup() {
  try {
    // Create tables
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
        created_by TEXT,
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
      CREATE TABLE IF NOT EXISTS ethnicities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        auto_added INTEGER DEFAULT 0
      );
    `);

    // Create users
    console.log('Creating users...');
    
    // Admin
    const adminHash = await bcrypt.hash('Admin123!', 10);
    await runExec(
      'INSERT INTO users (username,email,password_hash,role,device_name,permissions) VALUES (?,?,?,?,?,?)',
      ['admin', 'admin@example.com', adminHash, 'super_admin', 'ADMIN', 'manage_users,edit,delete,export']
    );
    console.log('✓ Admin created (Admin123!)');

    // User 1: Ahmed
    const ahmed1Hash = await bcrypt.hash('Ahmed123!', 10);
    await runExec(
      'INSERT INTO users (username,email,password_hash,role,device_name,permissions) VALUES (?,?,?,?,?,?)',
      ['ahmed', 'ahmed@example.com', ahmed1Hash, 'manager', 'AHMED', 'edit,delete,export']
    );
    console.log('✓ User "ahmed" created (Ahmed123!) - Device: AHMED');

    // User 2: Fatima
    const fatima1Hash = await bcrypt.hash('Fatima123!', 10);
    await runExec(
      'INSERT INTO users (username,email,password_hash,role,device_name,permissions) VALUES (?,?,?,?,?,?)',
      ['fatima', 'fatima@example.com', fatima1Hash, 'manager', 'FATIMA', 'edit,delete,export']
    );
    console.log('✓ User "fatima" created (Fatima123!) - Device: FATIMA');

    // User 3: Mohammed
    const mohammedHash = await bcrypt.hash('Mohammed123!', 10);
    await runExec(
      'INSERT INTO users (username,email,password_hash,role,device_name,permissions) VALUES (?,?,?,?,?,?)',
      ['mohammed', 'mohammed@example.com', mohammedHash, 'member', 'MOHAMMED', 'edit']
    );
    console.log('✓ User "mohammed" created (Mohammed123!) - Device: MOHAMMED');

    // Add sample cities
    console.log('\nAdding sample cities...');
    const cities = [
      { name: 'طرابلس', region: 'West' },
      { name: 'بنغازي', region: 'East' },
      { name: 'مصراتة', region: 'West' },
      { name: 'الزاوية', region: 'West' },
      { name: 'درنة', region: 'East' },
      { name: 'سبها', region: 'South' },
      { name: 'غات', region: 'South' }
    ];

    for (const city of cities) {
      await runExec('INSERT INTO cities (name, region, auto_added) VALUES (?, ?, ?)', [city.name, city.region, 0]);
    }
    console.log(`✓ Added ${cities.length} cities`);

    // Add sample ethnicities
    console.log('Adding sample ethnicities...');
    const ethnicities = ['عربي', 'أمازيغي', 'تبو', 'طوارق', 'زنجي', 'صحراوي'];
    for (const name of ethnicities) {
      await runExec('INSERT INTO ethnicities (name, auto_added) VALUES (?, 0)', [name]);
    }
    console.log(`✓ Added ${ethnicities.length} ethnicities`);

    // Add sample people entries for each user
    console.log('\nAdding sample registrations...');
    
    const samplePeople = [
      // Admin's registrations
      {
        registry_id: 'ADMIN-0001',
        name: 'محمود',
        surname: 'علي',
        age: 28,
        city: 'طرابلس',
        origin_city: 'طرابلس',
        region: 'West',
        tribe: 'قريش',
        id_type: 'جواز سفر',
        org_id: 'ADMIN-00101',
        id_number: '123456789',
        education: 'بكالوريوس',
        notes: 'تم التسجيل من قبل الإدارة',
        phone: '+218912345678',
        phone2: '',
        created_by: 'ADMIN'
      },
      {
        registry_id: 'ADMIN-0002',
        name: 'فاطمة',
        surname: 'محمد',
        age: 35,
        city: 'طرابلس',
        origin_city: 'الزاوية',
        region: 'West',
        tribe: 'بني هاشم',
        id_type: 'بطاقة شخصية',
        org_id: 'ADMIN-00102',
        id_number: '987654321',
        education: 'دبلوم',
        notes: '',
        phone: '+218923456789',
        phone2: '+218933456789',
        created_by: 'ADMIN'
      },
      // Ahmed's registrations
      {
        registry_id: 'AHMED-0001',
        name: 'علي',
        surname: 'حسن',
        age: 42,
        city: 'بنغازي',
        origin_city: 'درنة',
        region: 'East',
        tribe: 'القرافة',
        id_type: 'بطاقة شخصية',
        org_id: 'AHMED-00103',
        id_number: '111111111',
        education: 'ثانوي',
        notes: 'مرحب به جداً',
        phone: '+218934567890',
        phone2: '',
        created_by: 'AHMED'
      },
      {
        registry_id: 'AHMED-0002',
        name: 'سارة',
        surname: 'إبراهيم',
        age: 26,
        city: 'مصراتة',
        origin_city: 'مصراتة',
        region: 'West',
        tribe: 'هنتاتة',
        id_type: 'بطاقة شخصية',
        org_id: 'AHMED-00104',
        id_number: '222222222',
        education: 'بكالوريوس',
        notes: '',
        phone: '+218945678901',
        phone2: '',
        created_by: 'AHMED'
      },
      // Fatima's registrations
      {
        registry_id: 'FATIMA-0001',
        name: 'نور',
        surname: 'عمر',
        age: 19,
        city: 'سبها',
        origin_city: 'سبها',
        region: 'South',
        tribe: 'التبو',
        id_type: 'بطاقة شخصية',
        org_id: 'FATIMA-00105',
        id_number: '333333333',
        education: 'طالب',
        notes: 'حديث التسجيل',
        phone: '+218956789012',
        phone2: '',
        created_by: 'FATIMA'
      },
      {
        registry_id: 'FATIMA-0002',
        name: 'ليلى',
        surname: 'حسين',
        age: 31,
        city: 'غات',
        origin_city: 'غات',
        region: 'South',
        tribe: 'الطوارق',
        id_type: 'بطاقة شخصية',
        org_id: 'FATIMA-00106',
        id_number: '444444444',
        education: 'دراسات عليا',
        notes: 'متخصصة',
        phone: '+218967890123',
        phone2: '+218977890123',
        created_by: 'FATIMA'
      },
      // Mohammed's registrations
      {
        registry_id: 'MOHAMMED-0001',
        name: 'خالد',
        surname: 'أحمد',
        age: 45,
        city: 'الزاوية',
        origin_city: 'الزاوية',
        region: 'West',
        tribe: 'أولاد محمود',
        id_type: 'بطاقة شخصية',
        org_id: 'MOHAMMED-00107',
        id_number: '555555555',
        education: 'ثانوي',
        notes: '',
        phone: '+218978901234',
        phone2: '',
        created_by: 'MOHAMMED'
      }
    ];

    for (const person of samplePeople) {
      await runExec(
        `INSERT INTO people (registry_id,name,surname,age,city,origin_city,region,tribe,id_type,id_number,org_id,ethnicity,education,notes,phone,phone2,created_by) 
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [person.registry_id, person.name, person.surname, person.age, person.city, person.origin_city, 
         person.region, person.tribe, person.id_type || '', person.id_number, person.org_id || '', person.ethnicity || '', person.education, person.notes, person.phone, person.phone2, person.created_by]
      );
    }
    console.log(`✓ Added ${samplePeople.length} sample registrations`);

    console.log('\n✅ Setup completed successfully!\n');
    console.log('Users created:');
    console.log('  1. admin (Admin123!) - Super Admin - Device: ADMIN');
    console.log('  2. ahmed (Ahmed123!) - Manager - Device: AHMED');
    console.log('  3. fatima (Fatima123!) - Manager - Device: FATIMA');
    console.log('  4. mohammed (Mohammed123!) - Member - Device: MOHAMMED');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
    process.exit(1);
  }
}

setup();
