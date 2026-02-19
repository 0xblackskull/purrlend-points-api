// ─────────────────────────────────────────────────────────────────────────────
// Purr Points — Config
// This is the ONLY file you need to edit to change how points work.
// Everything else reads from here.
// ─────────────────────────────────────────────────────────────────────────────

export const POINTS_CONFIG = {

  // ── Points Rate ────────────────────────────────────────────────────────────
  // How many Purr points a user earns per $1 per hour
  // Client confirmed: both supply and borrow = 1 point per $1 per hour
  SUPPLY_POINTS_PER_DOLLAR_PER_HOUR: 1,
  BORROW_POINTS_PER_DOLLAR_PER_HOUR: 1,

  // ── Asset Multipliers ──────────────────────────────────────────────────────
  // 1   = normal (1x)
  // 1.5 = bonus  (1.5x)
  // 2   = double (2x)
  // 0   = this asset earns NO points
  // To whitelist only specific assets, set unlisted assets to 0
  ASSET_MULTIPLIERS: {
    '0x5555555555555555555555555555555555555555': 1,    // HYPE
    '0x94e8396e0869c9f2200760af0621afd240e1cf38': 1,    // wstHYPE
    '0xfd739d4e423301ce9385c1fb8850539d657c296d': 1,    // kHYPE
    '0x9fdbda0a5e284c32744d2f17ee5c74b284993463': 1,    // UBTC
    '0xbe6727b535545c67d5caa73dea54865b92cf7907': 1,    // UETH
    '0xb88339cb7199b77e23db6e890353e22632ba630f': 1,    // USDC
    '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb': 1,    // USD0
  } as Record<string, number>,

  // ── Seasons ────────────────────────────────────────────────────────────────
  // Season 1 starts when you deploy. Each season is 3 months (90 days).
  // Points reset to 0 at the start of each new season.
  // At the end of a season, users can claim tokens based on their points share.
  SEASON_DURATION_DAYS: 90,

  // Season 1 start — set this to your actual launch date before deploying
  // Format: ISO date string
  SEASON_1_START: '2026-02-17T00:00:00Z',

  // ── Leaderboard ────────────────────────────────────────────────────────────
  LEADERBOARD_SIZE: 100, // show top 100 wallets

  // ── Snapshot ───────────────────────────────────────────────────────────────
  // How often points are calculated (every 1 hour = 3600 seconds)
  SNAPSHOT_INTERVAL_SECONDS: 3600,

  // ── Chain / Contracts ──────────────────────────────────────────────────────
  CHAIN_ID: 999,
  RPC_URL: 'https://rpc.hyperliquid.xyz/evm',
  LENDING_POOL:            '0xb61218d3efE306f7579eE50D1a606d56bc222048',
  UI_POOL_DATA_PROVIDER:   '0x0C591b5A3615c21cbd09F028F2E4509C2938F65E',
  POOL_ADDRESS_PROVIDER:   '0xf33e33b35163ce2f46bf7150e1592839ac199124',
};

// ── Asset display names ────────────────────────────────────────────────────
// Used in leaderboard breakdown tooltip
export const ASSET_NAMES: Record<string, string> = {
  '0x5555555555555555555555555555555555555555': 'HYPE',
  '0x94e8396e0869c9f2200760af0621afd240e1cf38': 'wstHYPE',
  '0xfd739d4e423301ce9385c1fb8850539d657c296d': 'kHYPE',
  '0x9fdbda0a5e284c32744d2f17ee5c74b284993463': 'UBTC',
  '0xbe6727b535545c67d5caa73dea54865b92cf7907': 'UETH',
  '0xb88339cb7199b77e23db6e890353e22632ba630f': 'USDC',
  '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb': 'USD0',
};

// ── Helper: get current season number ─────────────────────────────────────
export function getCurrentSeason(): number {
  const start = new Date(POINTS_CONFIG.SEASON_1_START).getTime();
  const now = Date.now();
  const elapsed = now - start;
  const seasonMs = POINTS_CONFIG.SEASON_DURATION_DAYS * 24 * 60 * 60 * 1000;
  return Math.floor(elapsed / seasonMs) + 1;
}

// ── Helper: get current season start/end timestamps ───────────────────────
export function getCurrentSeasonDates(): { start: Date; end: Date } {
  const season = getCurrentSeason();
  const seasonMs = POINTS_CONFIG.SEASON_DURATION_DAYS * 24 * 60 * 60 * 1000;
  const start = new Date(
    new Date(POINTS_CONFIG.SEASON_1_START).getTime() + (season - 1) * seasonMs
  );
  const end = new Date(start.getTime() + seasonMs);
  return { start, end };
}
