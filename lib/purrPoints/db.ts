// ─────────────────────────────────────────────────────────────────────────────
// Purr Points — Database Layer (SQLite via better-sqlite3)
// Install: npm install better-sqlite3 @types/better-sqlite3
//
// This file does 3 things:
//   1. Creates the database file on first run (auto, no setup needed)
//   2. Creates tables if they don't exist
//   3. Exposes simple functions to read/write points
// ─────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import path from 'path';

// Database file lives in the project root — change path if needed
const DB_PATH = path.join(process.cwd(), 'purr-points.db');

// ── Open (or create) the database ────────────────────────────────────────────
// better-sqlite3 is synchronous — no async/await needed
let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);

  // Enable WAL mode — faster reads/writes on busy servers
  _db.pragma('journal_mode = WAL');

  // Create tables if they don't already exist
  _db.exec(`
    -- Stores total points per wallet per season
    CREATE TABLE IF NOT EXISTS wallet_points (
      wallet      TEXT NOT NULL,
      season      INTEGER NOT NULL DEFAULT 1,
      supply_points  REAL NOT NULL DEFAULT 0,
      borrow_points  REAL NOT NULL DEFAULT 0,
      total_points   REAL NOT NULL DEFAULT 0,
      last_updated   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (wallet, season)
    );

    -- Stores per-asset breakdown per wallet per season
    CREATE TABLE IF NOT EXISTS wallet_asset_breakdown (
      wallet         TEXT NOT NULL,
      season         INTEGER NOT NULL DEFAULT 1,
      asset          TEXT NOT NULL,
      symbol         TEXT NOT NULL,
      supply_points  REAL NOT NULL DEFAULT 0,
      borrow_points  REAL NOT NULL DEFAULT 0,
      supply_usd     REAL NOT NULL DEFAULT 0,
      borrow_usd     REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (wallet, season, asset)
    );

    -- Tracks when each snapshot ran
    CREATE TABLE IF NOT EXISTS snapshot_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      season      INTEGER NOT NULL,
      ran_at      INTEGER NOT NULL,
      wallets     INTEGER NOT NULL DEFAULT 0,
      points      REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0
    );
  `);

  return _db;
}

// ── Types ────────────────────────────────────────────────────────────────────
export type WalletPoints = {
  wallet: string;
  season: number;
  supplyPoints: number;
  borrowPoints: number;
  totalPoints: number;
  lastUpdated: number;
};

export type AssetBreakdown = {
  asset: string;
  symbol: string;
  supplyPoints: number;
  borrowPoints: number;
  supplyUsd: number;
  borrowUsd: number;
};

// ── Read: get points for one wallet ──────────────────────────────────────────
export function getWalletPoints(wallet: string, season: number): WalletPoints | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM wallet_points WHERE wallet = ? AND season = ?
  `).get(wallet.toLowerCase(), season) as any;

  if (!row) return null;
  return {
    wallet: row.wallet,
    season: row.season,
    supplyPoints: row.supply_points,
    borrowPoints: row.borrow_points,
    totalPoints: row.total_points,
    lastUpdated: row.last_updated,
  };
}

// ── Read: get asset breakdown for one wallet ──────────────────────────────────
export function getWalletBreakdown(wallet: string, season: number): AssetBreakdown[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM wallet_asset_breakdown WHERE wallet = ? AND season = ?
  `).all(wallet.toLowerCase(), season) as any[];

  return rows.map((r) => ({
    asset: r.asset,
    symbol: r.symbol,
    supplyPoints: r.supply_points,
    borrowPoints: r.borrow_points,
    supplyUsd: r.supply_usd,
    borrowUsd: r.borrow_usd,
  }));
}

// ── Read: leaderboard ─────────────────────────────────────────────────────────
export function getLeaderboard(season: number, limit = 100): WalletPoints[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM wallet_points
    WHERE season = ?
    ORDER BY total_points DESC
    LIMIT ?
  `).all(season, limit) as any[];

  return rows.map((r) => ({
    wallet: r.wallet,
    season: r.season,
    supplyPoints: r.supply_points,
    borrowPoints: r.borrow_points,
    totalPoints: r.total_points,
    lastUpdated: r.last_updated,
  }));
}

// ── Read: last snapshot time ───────────────────────────────────────────────────
export function getLastSnapshotTime(season: number): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT ran_at FROM snapshot_log WHERE season = ? ORDER BY ran_at DESC LIMIT 1
  `).get(season) as any;
  return row?.ran_at ?? 0;
}

// ── Write: upsert points for one wallet (accumulate, don't overwrite) ─────────
export function upsertWalletPoints(
  wallet: string,
  season: number,
  addSupplyPoints: number,
  addBorrowPoints: number,
  breakdown: AssetBreakdown[]
): void {
  const db = getDb();
  const now = Date.now();
  const w = wallet.toLowerCase();

  // Use a transaction so all writes succeed or none do
  const upsert = db.transaction(() => {
    // Upsert total points — add to existing
    db.prepare(`
      INSERT INTO wallet_points (wallet, season, supply_points, borrow_points, total_points, last_updated)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(wallet, season) DO UPDATE SET
        supply_points = supply_points + excluded.supply_points,
        borrow_points = borrow_points + excluded.borrow_points,
        total_points  = total_points  + excluded.supply_points + excluded.borrow_points,
        last_updated  = excluded.last_updated
    `).run(w, season, addSupplyPoints, addBorrowPoints, addSupplyPoints + addBorrowPoints, now);

    // Upsert per-asset breakdown
    for (const b of breakdown) {
      db.prepare(`
        INSERT INTO wallet_asset_breakdown
          (wallet, season, asset, symbol, supply_points, borrow_points, supply_usd, borrow_usd)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(wallet, season, asset) DO UPDATE SET
          supply_points = supply_points + excluded.supply_points,
          borrow_points = borrow_points + excluded.borrow_points,
          supply_usd    = excluded.supply_usd,
          borrow_usd    = excluded.borrow_usd
      `).run(w, season, b.asset, b.symbol, b.supplyPoints, b.borrowPoints, b.supplyUsd, b.borrowUsd);
    }
  });

  upsert();
}

// ── Write: log a completed snapshot ───────────────────────────────────────────
export function logSnapshot(
  season: number,
  wallets: number,
  points: number,
  durationMs: number
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO snapshot_log (season, ran_at, wallets, points, duration_ms)
    VALUES (?, ?, ?, ?, ?)
  `).run(season, Date.now(), wallets, points, durationMs);
}
