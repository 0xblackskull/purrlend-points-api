// ─────────────────────────────────────────────────────────────────────────────
// Purr Points — Database Layer
// SQLite database for storing wallet points, breakdowns, and snapshot logs
// ─────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import * as path from 'path';

// Database file location (persists across deployments on Railway)
const dbPath = path.join(process.cwd(), 'purr-points.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// ── Create Tables ────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS wallet_points (
    wallet TEXT NOT NULL,
    season INTEGER NOT NULL,
    supply_points REAL NOT NULL DEFAULT 0,
    borrow_points REAL NOT NULL DEFAULT 0,
    total_points REAL NOT NULL DEFAULT 0,
    last_updated INTEGER NOT NULL,
    PRIMARY KEY (wallet, season)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS wallet_asset_breakdown (
    wallet TEXT NOT NULL,
    season INTEGER NOT NULL,
    asset TEXT NOT NULL,
    symbol TEXT NOT NULL,
    supply_points REAL NOT NULL DEFAULT 0,
    borrow_points REAL NOT NULL DEFAULT 0,
    supply_usd REAL NOT NULL DEFAULT 0,
    borrow_usd REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (wallet, season, asset)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS snapshot_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season INTEGER NOT NULL,
    ran_at INTEGER NOT NULL,
    wallets INTEGER NOT NULL,
    points REAL NOT NULL,
    duration_ms INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS active_wallets (
    wallet TEXT PRIMARY KEY,
    first_seen INTEGER NOT NULL,
    last_active INTEGER NOT NULL
  ) WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS idx_active_wallets_last_active 
    ON active_wallets(last_active);
`);

// ── Types ────────────────────────────────────────────────────────────────────

export type WalletPoints = {
  wallet: string;
  season: number;
  supplyPoints: number;
  borrowPoints: number;
  totalPoints: number;
  lastUpdated: number;
  rank?: number;
};

export type AssetBreakdown = {
  asset: string;
  symbol: string;
  supplyPoints: number;
  borrowPoints: number;
  supplyUsd: number;
  borrowUsd: number;
};

// ── Wallet Points Functions ──────────────────────────────────────────────────

export function getWalletPoints(wallet: string, season: number): WalletPoints | null {
  const row: any = db
    .prepare(
      `SELECT wallet, season, supply_points, borrow_points, total_points, last_updated
       FROM wallet_points
       WHERE wallet = ? AND season = ?`
    )
    .get(wallet.toLowerCase(), season);

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

export function getWalletBreakdown(wallet: string, season: number): AssetBreakdown[] {
  const rows: any[] = db
    .prepare(
      `SELECT asset, symbol, supply_points, borrow_points, supply_usd, borrow_usd
       FROM wallet_asset_breakdown
       WHERE wallet = ? AND season = ?
       ORDER BY (supply_points + borrow_points) DESC`
    )
    .all(wallet.toLowerCase(), season);

  return rows.map((r) => ({
    asset: r.asset,
    symbol: r.symbol,
    supplyPoints: r.supply_points,
    borrowPoints: r.borrow_points,
    supplyUsd: r.supply_usd,
    borrowUsd: r.borrow_usd,
  }));
}

export function getLeaderboard(season: number, limit: number): WalletPoints[] {
  const rows: any[] = db
    .prepare(
      `SELECT wallet, season, supply_points, borrow_points, total_points, last_updated
       FROM wallet_points
       WHERE season = ?
       ORDER BY total_points DESC
       LIMIT ?`
    )
    .all(season, limit);

  return rows.map((r, index) => ({
    wallet: r.wallet,
    season: r.season,
    supplyPoints: r.supply_points,
    borrowPoints: r.borrow_points,
    totalPoints: r.total_points,
    lastUpdated: r.last_updated,
    rank: index + 1, // Add rank based on position
  }));
}

export function getLastSnapshotTime(season: number): number {
  const row: any = db
    .prepare(
      `SELECT MAX(ran_at) as last_run
       FROM snapshot_log
       WHERE season = ?`
    )
    .get(season);

  return row?.last_run ?? 0;
}

export function upsertWalletPoints(
  wallet: string,
  season: number,
  addSupplyPoints: number,
  addBorrowPoints: number,
  breakdown: AssetBreakdown[]
): void {
  const walletLower = wallet.toLowerCase();
  const now = Date.now();
  const addTotal = addSupplyPoints + addBorrowPoints;

  const transaction = db.transaction(() => {
    // Upsert wallet_points (accumulate points)
    db.prepare(
      `INSERT INTO wallet_points (wallet, season, supply_points, borrow_points, total_points, last_updated)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet, season) DO UPDATE SET
         supply_points = supply_points + excluded.supply_points,
         borrow_points = borrow_points + excluded.borrow_points,
         total_points = total_points + excluded.total_points,
         last_updated = excluded.last_updated`
    ).run(walletLower, season, addSupplyPoints, addBorrowPoints, addTotal, now);

    // Upsert asset breakdown (accumulate per-asset points)
    const stmt = db.prepare(
      `INSERT INTO wallet_asset_breakdown 
         (wallet, season, asset, symbol, supply_points, borrow_points, supply_usd, borrow_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet, season, asset) DO UPDATE SET
         supply_points = supply_points + excluded.supply_points,
         borrow_points = borrow_points + excluded.borrow_points,
         supply_usd = excluded.supply_usd,
         borrow_usd = excluded.borrow_usd`
    );

    for (const b of breakdown) {
      stmt.run(
        walletLower,
        season,
        b.asset.toLowerCase(),
        b.symbol,
        b.supplyPoints,
        b.borrowPoints,
        b.supplyUsd,
        b.borrowUsd
      );
    }
  });

  transaction();
}

export function logSnapshot(
  season: number,
  wallets: number,
  points: number,
  durationMs: number
): void {
  db.prepare(
    `INSERT INTO snapshot_log (season, ran_at, wallets, points, duration_ms)
     VALUES (?, ?, ?, ?, ?)`
  ).run(season, Date.now(), wallets, points, durationMs);
}

// ── Active Wallets Functions ─────────────────────────────────────────────────

export function addWallet(wallet: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO active_wallets (wallet, first_seen, last_active)
     VALUES (?, ?, ?)
     ON CONFLICT(wallet) DO UPDATE SET last_active = ?`
  ).run(wallet.toLowerCase(), now, now, now);
}

export function bulkAddWallets(wallets: string[]): void {
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO active_wallets (wallet, first_seen, last_active)
     VALUES (?, ?, ?)
     ON CONFLICT(wallet) DO UPDATE SET last_active = ?`
  );

  const transaction = db.transaction((walletList: string[]) => {
    for (const wallet of walletList) {
      stmt.run(wallet.toLowerCase(), now, now, now);
    }
  });

  transaction(wallets);
}

export function getActiveWallets(): string[] {
  const rows: any[] = db
    .prepare('SELECT wallet FROM active_wallets ORDER BY last_active DESC')
    .all();
  
  return rows.map((r) => r.wallet);
}

export function getWalletCount(): number {
  const row: any = db.prepare('SELECT COUNT(*) as count FROM active_wallets').get();
  return row.count;
}
