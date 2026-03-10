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



// Add these new tables and functions to your existing db.ts

// ── Referral Tables ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS referral_codes (
    wallet TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS referrals (
    referrer_wallet TEXT NOT NULL,
    referee_wallet TEXT PRIMARY KEY,
    referral_code TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (referrer_wallet) REFERENCES referral_codes(wallet)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS referral_points (
    wallet TEXT NOT NULL,
    season INTEGER NOT NULL,
    referral_points REAL DEFAULT 0,
    last_updated INTEGER NOT NULL,
    PRIMARY KEY (wallet, season)
  );
`);

// ── Referral Functions ───────────────────────────────────────────────────────
/**
 * Generate a unique referral code for a wallet
 */
export function generateReferralCode(wallet: string): string {
  const normalized = wallet.toLowerCase();
  
  // Check if code already exists
  const existing: any = db.prepare('SELECT code FROM referral_codes WHERE wallet = ?').get(normalized);
  if (existing) {
    return existing.code;
  }

  // Generate unique code: PURR-XXXXXX (6 random chars)
  let code: string;
  let attempts = 0;
  
  while (attempts < 10) {
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    code = `PURR-${randomPart}`;
    
    // Check if code is unique
    const codeExists: any = db.prepare('SELECT code FROM referral_codes WHERE code = ?').get(code);
    if (!codeExists) {
      // Insert new code
      db.prepare('INSERT INTO referral_codes (wallet, code, created_at) VALUES (?, ?, ?)').run(
        normalized,
        code,
        Date.now()
      );
      return code;
    }
    attempts++;
  }

  throw new Error('Failed to generate unique referral code');
}

/**
 * Apply a referral code (one-time only)
 */
export function applyReferralCode(refereeWallet: string, code: string): boolean {
  const normalizedReferee = refereeWallet.toLowerCase();
  const normalizedCode = code.toUpperCase().trim();

  // Check if user already has a referrer
  const existing: any = db.prepare('SELECT * FROM referrals WHERE referee_wallet = ?').get(normalizedReferee);
  if (existing) {
    return false; // Already used a code
  }

  // Find the referrer by code
  const referrer: any = db.prepare('SELECT wallet FROM referral_codes WHERE code = ?').get(normalizedCode);
  if (!referrer) {
    return false; // Invalid code
  }

  // Don't allow self-referral
  if (referrer.wallet === normalizedReferee) {
    return false;
  }

  // Create referral relationship
  db.prepare('INSERT INTO referrals (referrer_wallet, referee_wallet, referral_code, created_at) VALUES (?, ?, ?, ?)').run(
    referrer.wallet,
    normalizedReferee,
    normalizedCode,
    Date.now()
  );

  return true;
}

/**
 * Get referral code for a wallet
 */
export function getReferralCode(wallet: string): string | null {
  const normalized = wallet.toLowerCase();
  const result: any = db.prepare('SELECT code FROM referral_codes WHERE wallet = ?').get(normalized);
  return result ? result.code : null;
}

/**
 * Get referrer for a wallet (if they used a code)
 */
export function getReferrer(wallet: string): string | null {
  const normalized = wallet.toLowerCase();
  const result: any = db.prepare('SELECT referrer_wallet FROM referrals WHERE referee_wallet = ?').get(normalized);
  return result ? result.referrer_wallet : null;
}

/**
 * Get all referees for a wallet
 */
export function getReferees(wallet: string): string[] {
  const normalized = wallet.toLowerCase();
  const results: any[] = db.prepare('SELECT referee_wallet FROM referrals WHERE referrer_wallet = ?').all(normalized);
  return results.map(r => r.referee_wallet);
}

/**
 * Get referral stats for a wallet
 */
export function getReferralStats(wallet: string, season: number): {
  code: string | null;
  referralCount: number;
  referralPoints: number;
  referees: string[];
} {
  const normalized = wallet.toLowerCase();
  
  const code = getReferralCode(normalized);
  const referees = getReferees(normalized);
  
  // Get referral points for this season
  const pointsResult: any = db.prepare(
    'SELECT referral_points FROM referral_points WHERE wallet = ? AND season = ?'
  ).get(normalized, season);
  
  return {
    code,
    referralCount: referees.length,
    referralPoints: pointsResult ? pointsResult.referral_points : 0,
    referees,
  };
}

/**
 * Award referral bonus points
 */
export function awardReferralBonus(referrerWallet: string, bonusPoints: number, season: number): void {
  const normalized = referrerWallet.toLowerCase();
  
  // Upsert referral points
  db.prepare(`
    INSERT INTO referral_points (wallet, season, referral_points, last_updated)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(wallet, season) DO UPDATE SET
      referral_points = referral_points + excluded.referral_points,
      last_updated = excluded.last_updated
  `).run(normalized, season, bonusPoints, Date.now());
}

/**
 * Check if wallet has used a referral code
 */
export function hasUsedReferralCode(wallet: string): boolean {
  const normalized = wallet.toLowerCase();
  const result: any = db.prepare('SELECT 1 FROM referrals WHERE referee_wallet = ?').get(normalized);
  return !!result;
}
