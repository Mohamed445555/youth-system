const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'data', 'registry.db'));
db.get('SELECT COUNT(*) c FROM people', (e, r) => console.log('people:', r.c));
db.get('SELECT COUNT(*) c FROM cities', (e, r) => console.log('cities:', r.c));
db.get('SELECT COUNT(*) c FROM tribes', (e, r) => console.log('tribes:', r.c));
db.get("SELECT COUNT(*) c FROM people WHERE created_by IS NULL OR TRIM(created_by)=''", (e, r) => console.log('legacy people:', r.c));
db.all("SELECT COUNT(*) c FROM (SELECT 1 FROM people GROUP BY name,surname,COALESCE(age,''),city,origin_city,region,tribe,COALESCE(id_number,''),COALESCE(education,''),COALESCE(notes,''),COALESCE(phone,''),COALESCE(phone2,'') HAVING COUNT(*)>1)", (e, r) => { console.log('duplicate groups:', r[0].c); db.close(); });