import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { initializeSchema } from './schema';
import { isDbQuiesceActive } from '../maintenance/state';

export const DB_PATH = process.env.RAID_TRACKER_DB_PATH
    ? path.resolve(process.env.RAID_TRACKER_DB_PATH)
    : path.join(process.cwd(), 'data', 'raid-tracker.db');

let dbInstance: Database.Database | null = null;

export class DatabaseMaintenanceError extends Error {
    constructor(message: string = 'Database maintenance is in progress') {
        super(message);
        this.name = 'DatabaseMaintenanceError';
    }
}

function configureDatabase(db: Database.Database): void {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000'); // 64MB cache
    db.pragma('foreign_keys = ON');
}

export function isDatabaseMaintenanceError(error: unknown): error is DatabaseMaintenanceError {
    return error instanceof DatabaseMaintenanceError;
}

export function getDb(): Database.Database {
    if (isDbQuiesceActive()) {
        closeDb();
        throw new DatabaseMaintenanceError();
    }

    if (!dbInstance) {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

        dbInstance = new Database(DB_PATH);

        configureDatabase(dbInstance);

        initializeSchema(dbInstance);

        console.log(`📂 SQLite database initialized at ${DB_PATH}`);
    }
    return dbInstance;
}

export function closeDb(): void {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
        console.log('📂 SQLite database closed');
    }
}

export function openMaintenanceDb(): Database.Database {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    configureDatabase(db);
    db.pragma('busy_timeout = 30000');
    return db;
}
