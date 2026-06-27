import 'dotenv/config';
import Database from 'better-sqlite3';
import { DB_PATH } from '../src/lib/db';

const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const out = DB_PATH.replace(/\.db$/, '') + `.backup-${stamp}.db`;

const db = new Database(DB_PATH);
db.pragma('wal_checkpoint(TRUNCATE)'); // fold committed WAL into the snapshot
db.exec(`VACUUM INTO '${out}'`);
db.close();
console.log('Backup written:', out);