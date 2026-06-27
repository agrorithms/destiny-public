import Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database): void {
    db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      membership_id TEXT PRIMARY KEY,
      membership_type INTEGER NOT NULL,
      display_name TEXT,
      bungie_global_display_name TEXT,
      bungie_global_display_name_code INTEGER,
      last_crawled_at INTEGER DEFAULT 0,
      discovered_at INTEGER NOT NULL DEFAULT (unixepoch()),
      is_active INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pgcrs (
      instance_id TEXT PRIMARY KEY,
      activity_hash INTEGER NOT NULL,
      raid_key TEXT,
      period INTEGER NOT NULL,
      starting_phase_index INTEGER DEFAULT 0,
      activity_was_started_from_beginning INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      source TEXT DEFAULT 'unknown',
      player_count INTEGER DEFAULT 0,
      fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS pgcr_players (
      instance_id TEXT NOT NULL,
      membership_id TEXT NOT NULL,
      membership_type INTEGER NOT NULL,
      display_name TEXT,
      bungie_global_display_name TEXT,
      character_class TEXT,
      light_level INTEGER,
      completed INTEGER DEFAULT 0,
      kills INTEGER DEFAULT 0,
      deaths INTEGER DEFAULT 0,
      assists INTEGER DEFAULT 0,
      time_played_seconds INTEGER DEFAULT 0,
      PRIMARY KEY (instance_id, membership_id),
      FOREIGN KEY (instance_id) REFERENCES pgcrs(instance_id)
    );

    CREATE TABLE IF NOT EXISTS active_sessions (
      membership_id TEXT NOT NULL,
      membership_type INTEGER NOT NULL,
      display_name TEXT,
      activity_hash INTEGER,
      activity_mode_hash INTEGER,
      activity_mode_type INTEGER,
      raid_key TEXT,
      started_at TEXT,
      party_members_json TEXT,
      player_count INTEGER DEFAULT 0,
      checked_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (membership_id)
    );

    CREATE TABLE IF NOT EXISTS crawler_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- idx_pgcrs_period retained: still serves cleanupOldPGCRs (period < ?) and MIN/MAX(period).
    CREATE INDEX IF NOT EXISTS idx_pgcrs_period ON pgcrs(period);
    CREATE INDEX IF NOT EXISTS idx_pgcrs_raid_key ON pgcrs(raid_key);
    CREATE INDEX IF NOT EXISTS idx_pgcr_players_membership ON pgcr_players(membership_id);
    CREATE INDEX IF NOT EXISTS idx_players_last_crawled ON players(last_crawled_at);
    CREATE INDEX IF NOT EXISTS idx_players_priority ON players(priority DESC, last_crawled_at ASC);
    CREATE INDEX IF NOT EXISTS idx_active_sessions_raid ON active_sessions(raid_key);
    CREATE INDEX IF NOT EXISTS idx_active_sessions_checked_at ON active_sessions(checked_at);

    CREATE TABLE IF NOT EXISTS crawl_queue (
      membership_id   TEXT PRIMARY KEY,
      membership_type INTEGER NOT NULL,
      display_name    TEXT,
      source          TEXT NOT NULL DEFAULT 'unknown',
      priority        INTEGER NOT NULL DEFAULT 0,
      enqueued_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_crawl_queue_drain ON crawl_queue(priority DESC, enqueued_at ASC);
  `);

    // Migration guard for existing DBs created before "source" was added.
    try {
        db.prepare(`ALTER TABLE pgcrs ADD COLUMN source TEXT DEFAULT 'unknown'`).run();
    } catch {
        // Column already exists.
    }

    // Migration guards for active session mode metadata.
    try {
        db.prepare(`ALTER TABLE active_sessions ADD COLUMN activity_mode_hash INTEGER`).run();
    } catch {
        // Column already exists.
    }
    try {
        db.prepare(`ALTER TABLE active_sessions ADD COLUMN activity_mode_type INTEGER`).run();
    } catch {
        // Column already exists.
    }

    // Migration guards for character ID caching on the players table.
    try {
        db.prepare(`ALTER TABLE players ADD COLUMN character_ids TEXT`).run();
    } catch {
        // Column already exists.
    }
    try {
        db.prepare(`ALTER TABLE players ADD COLUMN character_ids_updated_at INTEGER DEFAULT 0`).run();
    } catch {
        // Column already exists.
    }

    // Migration guard for denormalized run end-time (ended_at = period + duration).
    // Nullable with no default; populated at insert for new rows (Phase 1 writer).
    try {
        db.prepare(`ALTER TABLE pgcrs ADD COLUMN ended_at INTEGER`).run();
    } catch {
        // Column already exists.
    }

    // Phase 3 indexes for the ended_at reader cutover. Created here (after the
    // ended_at column exists) so fresh/dev DBs get them automatically; on the
    // large prod DB they are pre-built in an ingestion-paused window via
    // scripts/create-phase3-indexes.ts, making these IF NOT EXISTS no-ops.
    // No partial predicates: idx_pgcrs_ended is shared by the leaderboard
    // (all-raids) and the crawler recency queries, which do NOT filter
    // completed/started at the outer level — a predicate would exclude them.
    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pgcrs_raid_ended ON pgcrs(raid_key, ended_at);
    CREATE INDEX IF NOT EXISTS idx_pgcrs_ended ON pgcrs(ended_at);
    CREATE INDEX IF NOT EXISTS idx_pgcr_players_instance_completed_member ON pgcr_players(instance_id, completed, membership_id);
    CREATE INDEX IF NOT EXISTS idx_pgcr_players_member_completed_instance ON pgcr_players(membership_id, completed, instance_id);
  `);
}
