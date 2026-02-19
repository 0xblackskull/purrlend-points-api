// ─────────────────────────────────────────────────────────────────────────────
// Purr Points — Snapshot Service
// Reads all positions from Purrlend on HyperEVM, awards points based on config
//
// Called by: cron job every hour
//
// What it does:
//   1. Get all reserve data (prices, indexes) from the UI data provider
//   2. Get list of all active wallets from on-chain events (Supply/Borrow)
//   3. For each wallet, read their current positions
//   4. Calculate points: depositUSD × multiplier × 1 hour
//   5. Save to database (accumulates on top of existing points)
// ─────────────────────────────────────────────────────────────────────────────

import { ethers } from 'ethers';
import { POINTS_CONFIG, ASSET_NAMES, getCurrentSeason } from './config';
import {
  upsertWalletPoints,
  logSnapshot,
  getLastSnapshotTime,
  AssetBreakdown,
} from './db';

// ── ABIs (minimal, only what we need) ────────────────────────────────────────

const UI_POOL_DATA_ABI = [
  // Get all reserve data (prices, liquidity indexes, etc.)
  {
    inputs: [{ name: 'provider', type: 'address' }],
    name: 'getReservesData',
    outputs: [
      {
        components: [
          { name: 'underlyingAsset', type: 'address' },
          { name: 'priceInMarketReferenceCurrency', type: 'uint256' },
          { name: 'marketReferenceCurrencyDecimals', type: 'uint8' },
          { name: 'decimals', type: 'uint256' },
          { name: 'liquidityIndex', type: 'uint128' },
          { name: 'variableBorrowIndex', type: 'uint128' },
        ],
        name: 'reservesData',
        type: 'tuple[]',
      },
      {
        components: [
          { name: 'marketReferenceCurrencyUnit', type: 'uint256' },
          { name: 'marketReferenceCurrencyPriceInUsd', type: 'int256' },
          { name: 'networkBaseTokenPriceInUsd', type: 'int256' },
          { name: 'networkBaseTokenPriceDecimals', type: 'uint8' },
        ],
        name: 'baseCurrencyInfo',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // Get user's positions in all reserves
  {
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'user', type: 'address' },
    ],
    name: 'getUserReservesData',
    outputs: [
      {
        components: [
          { name: 'underlyingAsset', type: 'address' },
          { name: 'scaledATokenBalance', type: 'uint256' },
          { name: 'usageAsCollateralEnabledOnUser', type: 'bool' },
          { name: 'stableBorrowRate', type: 'uint256' },
          { name: 'scaledVariableDebt', type: 'uint256' },
          { name: 'principalStableDebt', type: 'uint256' },
          { name: 'stableBorrowLastUpdateTimestamp', type: 'uint256' },
        ],
        name: 'userReserves',
        type: 'tuple[]',
      },
      { name: 'userEmodeCategoryId', type: 'uint8' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

// Lending pool events to find all active wallets
const LENDING_POOL_ABI = [
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
  'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint256 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)',
];

// ── Main snapshot function ───────────────────────────────────────────────────

export type SnapshotResult = {
  season: number;
  walletsProcessed: number;
  totalSupplyUsd: number;
  totalBorrowUsd: number;
  pointsAwarded: number;
  durationMs: number;
};

export async function runSnapshot(): Promise<SnapshotResult> {
  const startTime = Date.now();
  const season = getCurrentSeason();

  // Don't run too frequently (client said hourly)
  const lastRun = getLastSnapshotTime(season);
  const timeSince = Date.now() - lastRun;
  const minInterval = POINTS_CONFIG.SNAPSHOT_INTERVAL_SECONDS * 1000;
  if (timeSince < minInterval * 0.95) {
    throw new Error(`Too soon. Last snapshot was ${Math.round(timeSince / 1000)}s ago. Wait ${Math.round((minInterval - timeSince) / 1000)}s`);
  }

  console.log(`[Snapshot] Starting Season ${season}...`);

  const provider = new ethers.JsonRpcProvider(POINTS_CONFIG.RPC_URL);
  const uiContract = new ethers.Contract(
    POINTS_CONFIG.UI_POOL_DATA_PROVIDER,
    UI_POOL_DATA_ABI,
    provider
  );

  // ── Step 1: Get all reserve data (prices + indexes) ──────────────────────
  console.log('[Snapshot] Fetching reserve data...');
  const [reservesData, baseCurrencyInfo] = await uiContract.getReservesData(
    POINTS_CONFIG.POOL_ADDRESS_PROVIDER
  );

  // Build price map: asset address → price in USD
  const priceMap: Record<string, number> = {};
  const indexMap: Record<string, { liquidity: number; borrow: number; decimals: number }> = {};

  const marketRefUnit = Number(baseCurrencyInfo.marketReferenceCurrencyUnit);
  const marketRefPriceUsd = Number(baseCurrencyInfo.marketReferenceCurrencyPriceInUsd) / 1e8;

  for (const reserve of reservesData) {
    const asset = reserve.underlyingAsset.toLowerCase();
    const priceInRef = Number(reserve.priceInMarketReferenceCurrency);
    const decimals = Number(reserve.decimals);

    priceMap[asset] = (priceInRef / marketRefUnit) * marketRefPriceUsd;
    indexMap[asset] = {
      liquidity: Number(reserve.liquidityIndex) / 1e27,
      borrow: Number(reserve.variableBorrowIndex) / 1e27,
      decimals,
    };
  }

  console.log(`[Snapshot] Loaded ${Object.keys(priceMap).length} reserves`);

  // ── Step 2: Get all unique wallets from events ───────────────────────────
  console.log('[Snapshot] Fetching active wallets...');
  const poolContract = new ethers.Contract(
    POINTS_CONFIG.LENDING_POOL,
    LENDING_POOL_ABI,
    provider
  );

  const currentBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 100000); // ~100k blocks back

  const [supplyEvents, borrowEvents] = await Promise.all([
    poolContract.queryFilter(poolContract.filters.Supply(), fromBlock, currentBlock),
    poolContract.queryFilter(poolContract.filters.Borrow(), fromBlock, currentBlock),
  ]);

  const walletSet = new Set<string>();
  for (const e of [...supplyEvents, ...borrowEvents]) {
    const args = (e as ethers.EventLog).args;
    if (args?.onBehalfOf) walletSet.add(args.onBehalfOf.toLowerCase());
  }

  const wallets = Array.from(walletSet);
  console.log(`[Snapshot] Found ${wallets.length} unique wallets`);

  // ── Step 3: For each wallet, get positions and award points ──────────────
  let totalSupplyUsd = 0;
  let totalBorrowUsd = 0;
  let totalPointsAwarded = 0;

  const BATCH_SIZE = 10; // process 10 wallets at a time to avoid RPC rate limits
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (wallet) => {
      try {
        const [userReserves] = await uiContract.getUserReservesData(
          POINTS_CONFIG.POOL_ADDRESS_PROVIDER,
          wallet
        );

        let supplyPts = 0;
        let borrowPts = 0;
        const breakdown: AssetBreakdown[] = [];

        for (const r of userReserves) {
          const asset = r.underlyingAsset.toLowerCase();
          const price = priceMap[asset] ?? 0;
          const idx = indexMap[asset];
          const multiplier = POINTS_CONFIG.ASSET_MULTIPLIERS[asset] ?? 0;

          if (!idx || multiplier === 0) continue; // asset not whitelisted

          const symbol = ASSET_NAMES[asset] ?? asset.slice(0, 6);

          // Convert scaled balances to actual balances
          const supplyBalance =
            (Number(r.scaledATokenBalance) * idx.liquidity) / 10 ** idx.decimals;
          const borrowBalance =
            (Number(r.scaledVariableDebt) * idx.borrow) / 10 ** idx.decimals;

          const supplyUsd = supplyBalance * price;
          const borrowUsd = borrowBalance * price;

          // Points = USD × rate × multiplier × 1 hour
          const assetSupplyPts =
            supplyUsd * POINTS_CONFIG.SUPPLY_POINTS_PER_DOLLAR_PER_HOUR * multiplier;
          const assetBorrowPts =
            borrowUsd * POINTS_CONFIG.BORROW_POINTS_PER_DOLLAR_PER_HOUR * multiplier;

          if (supplyUsd > 0 || borrowUsd > 0) {
            breakdown.push({
              asset,
              symbol,
              supplyPoints: assetSupplyPts,
              borrowPoints: assetBorrowPts,
              supplyUsd,
              borrowUsd,
            });
            supplyPts += assetSupplyPts;
            borrowPts += assetBorrowPts;
            totalSupplyUsd += supplyUsd;
            totalBorrowUsd += borrowUsd;
          }
        }

        const earnedThisHour = supplyPts + borrowPts;
        if (earnedThisHour > 0) {
          upsertWalletPoints(wallet, season, supplyPts, borrowPts, breakdown);
          totalPointsAwarded += earnedThisHour;
        }
      } catch (e) {
        console.error(`[Snapshot] Failed for ${wallet}:`, e);
      }
    }));

    // Log progress every 50 wallets
    if ((i + BATCH_SIZE) % 50 === 0) {
      console.log(`[Snapshot] Processed ${i + BATCH_SIZE}/${wallets.length} wallets...`);
    }
  }

  const durationMs = Date.now() - startTime;
  logSnapshot(season, wallets.length, totalPointsAwarded, durationMs);

  console.log(`[Snapshot] Complete in ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Wallets: ${wallets.length}`);
  console.log(`  Supply TVL: $${totalSupplyUsd.toFixed(2)}`);
  console.log(`  Borrow TVL: $${totalBorrowUsd.toFixed(2)}`);
  console.log(`  Points awarded: ${totalPointsAwarded.toFixed(0)}`);

  return {
    season,
    walletsProcessed: wallets.length,
    totalSupplyUsd,
    totalBorrowUsd,
    pointsAwarded: totalPointsAwarded,
    durationMs,
  };
}
