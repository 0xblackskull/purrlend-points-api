// ─────────────────────────────────────────────────────────────────────────────
// Purr Points — Configuration
// New tier-based system with weekly distributions
// ─────────────────────────────────────────────────────────────────────────────

export const POINTS_CONFIG = {
  // Chain & Contract Addresses
  CHAIN_ID: 999,
  RPC_URL: process.env.ALCHEMY_RPC_URL || 'https://rpc.hyperliquid.xyz/evm',
  POOL_ADDRESS_PROVIDER: '0xf33e33b35163ce2f46bf7150e1592839ac199124',
  UI_POOL_DATA_PROVIDER: '0x0C591b5A3615c21cbd09F028F2E4509C2938F65E',
  LENDING_POOL: '0xb61218d3efE306f7579eE50D1a606d56bc222048',

  // Points Rates (NEW)
  SUPPLY_POINTS_PER_DOLLAR_PER_DAY: 1 / 25,    // 1 point per $25 per day
  BORROW_POINTS_PER_DOLLAR_PER_DAY: 1 / 10,    // 1 point per $10 per day
  
  // Convert to hourly for snapshots (runs every hour)
  SUPPLY_POINTS_PER_DOLLAR_PER_HOUR: (1 / 25) / 24,  // 0.00166667
  BORROW_POINTS_PER_DOLLAR_PER_HOUR: (1 / 10) / 24,  // 0.00416667

  // Referral Rate (NEW)
  REFERRAL_BONUS_PERCENTAGE: 0.12, // 12% of referee's points

  // Campaign Settings (NEW)
  TOTAL_POINTS_POOL: 10_000_000,           // 10M points total
  CAMPAIGN_DURATION_WEEKS: 26,             // ~6 months
  POINTS_PER_WEEK: 384_615,                // ~384,615 per week
  
  // Season 1 dates (6 months from Feb 17, 2026)
  SEASON_1_START: '2026-02-17T00:00:00Z',
  SEASON_1_END: '2026-08-17T00:00:00Z',    // ~6 months later
  SEASON_DURATION_DAYS: 182,               // ~26 weeks

  // Snapshot Settings
  SNAPSHOT_INTERVAL_SECONDS: 3600, // Run every hour

  // Asset Multipliers (all 1x - tier boost applies separately)
  ASSET_MULTIPLIERS: {
    // HYPE
    '0x5555555555555555555555555555555555555555': 1,
    // wstHYPE
    '0x94e8396e0869c9f2200760af0621afd240e1cf38': 1,
    // kHYPE
    '0xfd739d4e423301ce9385c1fb8850539d657c296d': 1,
    // UBTC
    '0x9fdbda0a5e284c32744d2f17ee5c74b284993463': 1,
    // UETH
    '0xbe6727b535545c67d5caa73dea54865b92cf7907': 1,
    // USDC
    '0xb88339cb7199b77e23db6e890353e22632ba630f': 1,
    // USD0
    '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb': 1,
  },
};

// ── Tier System (NEW) ────────────────────────────────────────────────────────

export enum Tier {
  BRONZE = 1,
  SILVER = 2,
  GOLD = 3,
  PLATINUM = 4,
  DIAMOND = 5,
}

export const TIER_CONFIG = {
  [Tier.BRONZE]: {
    name: 'Bronze',
    minPoints: 0,
    maxPoints: 10_000,
    boost: 0,      // 0% boost
  },
  [Tier.SILVER]: {
    name: 'Silver',
    minPoints: 10_000,
    maxPoints: 50_000,
    boost: 0.05,   // +5% boost
  },
  [Tier.GOLD]: {
    name: 'Gold',
    minPoints: 50_000,
    maxPoints: 150_000,
    boost: 0.10,   // +10% boost
  },
  [Tier.PLATINUM]: {
    name: 'Platinum',
    minPoints: 150_000,
    maxPoints: 500_000,
    boost: 0.15,   // +15% boost
  },
  [Tier.DIAMOND]: {
    name: 'Diamond',
    minPoints: 500_000,
    maxPoints: 1_000_000,
    boost: 0.20,   // +20% boost
  },
};

/**
 * Get user's tier based on their total points
 */
export function getUserTier(totalPoints: number): Tier {
  if (totalPoints >= 500_000) return Tier.DIAMOND;
  if (totalPoints >= 150_000) return Tier.PLATINUM;
  if (totalPoints >= 50_000) return Tier.GOLD;
  if (totalPoints >= 10_000) return Tier.SILVER;
  return Tier.BRONZE;
}

/**
 * Get tier boost percentage (e.g., 0.05 for 5% boost)
 */
export function getTierBoost(totalPoints: number): number {
  const tier = getUserTier(totalPoints);
  return TIER_CONFIG[tier].boost;
}

/**
 * Get tier name
 */
export function getTierName(totalPoints: number): string {
  const tier = getUserTier(totalPoints);
  return TIER_CONFIG[tier].name;
}

/**
 * Apply tier boost to points
 * Formula: basePoints × (1 + tierBoost)
 */
export function applyTierBoost(basePoints: number, totalPoints: number): number {
  const boost = getTierBoost(totalPoints);
  return basePoints * (1 + boost);
}

// ── Asset Names ──────────────────────────────────────────────────────────────

export const ASSET_NAMES: Record<string, string> = {
  '0x5555555555555555555555555555555555555555': 'HYPE',
  '0x94e8396e0869c9f2200760af0621afd240e1cf38': 'wstHYPE',
  '0xfd739d4e423301ce9385c1fb8850539d657c296d': 'kHYPE',
  '0x9fdbda0a5e284c32744d2f17ee5c74b284993463': 'UBTC',
  '0xbe6727b535545c67d5caa73dea54865b92cf7907': 'UETH',
  '0xb88339cb7199b77e23db6e890353e22632ba630f': 'USDC',
  '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb': 'USD0',
};

// ── Season Helpers ───────────────────────────────────────────────────────────

export function getCurrentSeason(): number {
  const now = Date.now();
  const s1Start = new Date(POINTS_CONFIG.SEASON_1_START).getTime();
  const s1End = new Date(POINTS_CONFIG.SEASON_1_END).getTime();

  if (now >= s1Start && now < s1End) return 1;
  return 1; // Default to season 1
}

export function getSeasonDates(season: number): { start: Date; end: Date } {
  if (season === 1) {
    return {
      start: new Date(POINTS_CONFIG.SEASON_1_START),
      end: new Date(POINTS_CONFIG.SEASON_1_END),
    };
  }
  throw new Error(`Season ${season} not configured`);
}
