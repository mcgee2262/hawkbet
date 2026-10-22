'use strict';
// Set a new password for any account, straight in the database (for when even the admin is locked out).
// Usage: node reset-password.js <username> <new-password>
const crypto = require('crypto'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const [name, pw] = process.argv.slice(2);
if (!name || !pw || pw.length < 6) { console.log('Usage: node reset-password.js <username> <new-password (6+ characters)>'); process.exit(1); }
const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'data', 'hawkbet.db'));
const u = db.prepare('SELECT id FROM users WHERE username=?').get(name.toLowerCase());
if (!u) { console.log(`No account named "${name}"`); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex');
db.prepare('UPDATE users SET salt=?, hash=? WHERE id=?').run(salt, crypto.scryptSync(pw, salt, 64).toString('hex'), u.id); // same hashing as server.js
db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
console.log(`Password updated for "${name.toLowerCase()}". Log in with the new one.`);
