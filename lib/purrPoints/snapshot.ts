// ─────────────────────────────────────────────────────────────────────────────
// Purr Points — Snapshot Service
// Reads all positions from Purrlend on HyperEVM, awards points based on config
//
// Called by: cron job every hour
//
// What it does:
//   1. Get all reserve data (prices, indexes) from the UI data provider
//   2. Get list of all active wallets from static wallet list
//   3. For each wallet, read their current positions
//   4. Calculate points: depositUSD × multiplier × 1 hour
//   5. Save to database (accumulates on top of existing points)
// ─────────────────────────────────────────────────────────────────────────────

import { ethers } from 'ethers';
import { POINTS_CONFIG, ASSET_NAMES, getCurrentSeason, getBoostMultiplier } from './config';
import {
  upsertWalletPoints,
  logSnapshot,
  getLastSnapshotTime,
  AssetBreakdown,
} from './db';
import { getReferrer, awardReferralBonus } from './db';

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
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'decimals', type: 'uint256' },
          { name: 'baseLTVasCollateral', type: 'uint256' },
          { name: 'reserveLiquidationThreshold', type: 'uint256' },
          { name: 'reserveLiquidationBonus', type: 'uint256' },
          { name: 'reserveFactor', type: 'uint256' },
          { name: 'usageAsCollateralEnabled', type: 'bool' },
          { name: 'borrowingEnabled', type: 'bool' },
          { name: 'stableBorrowRateEnabled', type: 'bool' },
          { name: 'isActive', type: 'bool' },
          { name: 'isFrozen', type: 'bool' },
          { name: 'liquidityIndex', type: 'uint128' },
          { name: 'variableBorrowIndex', type: 'uint128' },
          { name: 'liquidityRate', type: 'uint128' },
          { name: 'variableBorrowRate', type: 'uint128' },
          { name: 'stableBorrowRate', type: 'uint128' },
          { name: 'lastUpdateTimestamp', type: 'uint40' },
          { name: 'aTokenAddress', type: 'address' },
          { name: 'stableDebtTokenAddress', type: 'address' },
          { name: 'variableDebtTokenAddress', type: 'address' },
          { name: 'interestRateStrategyAddress', type: 'address' },
          { name: 'availableLiquidity', type: 'uint256' },
          { name: 'totalPrincipalStableDebt', type: 'uint256' },
          { name: 'averageStableRate', type: 'uint256' },
          { name: 'stableDebtLastUpdateTimestamp', type: 'uint256' },
          { name: 'totalScaledVariableDebt', type: 'uint256' },
          { name: 'priceInMarketReferenceCurrency', type: 'uint256' },
          { name: 'priceOracle', type: 'address' },
          { name: 'variableRateSlope1', type: 'uint256' },
          { name: 'variableRateSlope2', type: 'uint256' },
          { name: 'stableRateSlope1', type: 'uint256' },
          { name: 'stableRateSlope2', type: 'uint256' },
          { name: 'baseStableBorrowRate', type: 'uint256' },
          { name: 'baseVariableBorrowRate', type: 'uint256' },
          { name: 'optimalUsageRatio', type: 'uint256' },
          { name: 'isPaused', type: 'bool' },
          { name: 'isSiloedBorrowing', type: 'bool' },
          { name: 'accruedToTreasury', type: 'uint128' },
          { name: 'unbacked', type: 'uint128' },
          { name: 'isolationModeTotalDebt', type: 'uint128' },
          { name: 'flashLoanEnabled', type: 'bool' },
          { name: 'debtCeiling', type: 'uint256' },
          { name: 'debtCeilingDecimals', type: 'uint256' },
          { name: 'eModeCategoryId', type: 'uint8' },
          { name: 'borrowCap', type: 'uint256' },
          { name: 'supplyCap', type: 'uint256' },
          { name: 'eModeLtv', type: 'uint16' },
          { name: 'eModeLiquidationThreshold', type: 'uint16' },
          { name: 'eModeLiquidationBonus', type: 'uint16' },
          { name: 'eModePriceSource', type: 'address' },
          { name: 'eModeLabel', type: 'string' },
          { name: 'borrowableInIsolation', type: 'bool' },
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
      console.log(`[DEBUG] Asset ${asset.slice(0,8)}: price=$${priceMap[asset].toFixed(4)}, priceInRef=${priceInRef}, decimals=${decimals}`);

  }
  console.log(`[DEBUG] marketRefUnit=${marketRefUnit}, marketRefPriceUsd=${marketRefPriceUsd}`);


  console.log(`[Snapshot] Loaded ${Object.keys(priceMap).length} reserves`);

  // ── Step 2: Get active wallets (database + auto-discovery) ────────────────
  console.log('[Snapshot] Loading wallets from database...');
  const { getActiveWallets, addWallet } = await import('./db');
  let wallets = getActiveWallets();
  console.log(`[Snapshot] Found ${wallets.length} existing wallets in database`);

  // Auto-discover new wallets from recent blocks
  console.log('[Snapshot] Scanning for new wallets...');
  const poolContract = new ethers.Contract(
    POINTS_CONFIG.LENDING_POOL,
    ['event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
     'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint256 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)'],
    provider
  );

  const currentBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 1000); // scan last 1000 blocks only

  try {
    const [supplyEvents, borrowEvents] = await Promise.all([
      poolContract.queryFilter(poolContract.filters.Supply(), fromBlock, currentBlock),
      poolContract.queryFilter(poolContract.filters.Borrow(), fromBlock, currentBlock),
    ]);

    const newWallets = new Set<string>();
    for (const e of [...supplyEvents, ...borrowEvents]) {
      const args = (e as ethers.EventLog).args;
      if (args?.onBehalfOf) {
        const wallet = args.onBehalfOf.toLowerCase();
        if (!wallets.includes(wallet)) {
          newWallets.add(wallet);
          addWallet(wallet); // add to database
        }
      }
    }

    if (newWallets.size > 0) {
      console.log(`[Snapshot] Discovered ${newWallets.size} new wallets`);
      wallets = [...wallets, ...Array.from(newWallets)];
    }
  } catch (err) {
    console.error('[Snapshot] Event scanning failed, using existing wallets:', err);
    // Continue with existing wallets if event scanning fails
  }

  console.log(`[Snapshot] Processing ${wallets.length} total wallets`);


  // ── Step 3: For each wallet, get positions and award points ──────────────
  let totalSupplyUsd = 0;
  let totalBorrowUsd = 0;
  let totalPointsAwarded = 0;

  const BATCH_SIZE = 3; // process 3 wallets at a time (avoid rate limits)
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);

    // Add 500ms delay between batches to avoid rate limits
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await Promise.all(batch.map(async (wallet) => {
      try {
        const [userReserves] = await uiContract.getUserReservesData(
          POINTS_CONFIG.POOL_ADDRESS_PROVIDER,
          wallet
        );

        console.log(`[DEBUG] Wallet ${wallet.slice(0,8)} has ${userReserves.length} reserves`);
          if (userReserves.length > 0) {
            console.log(`[DEBUG] First reserve:`, userReserves[0].underlyingAsset, 
              'Supply:', userReserves[0].scaledATokenBalance.toString());
          }

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

          const supplyBoost = getBoostMultiplier(asset, 'supply');
          const borrowBoost = getBoostMultiplier(asset, 'borrow');

        const assetSupplyPts = supplyUsd * POINTS_CONFIG.SUPPLY_POINTS_PER_DOLLAR_PER_HOUR * multiplier * supplyBoost;
         const assetBorrowPts = borrowUsd * POINTS_CONFIG.BORROW_POINTS_PER_DOLLAR_PER_HOUR * multiplier * borrowBoost;


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

    // Log progress
    if ((i + BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= wallets.length) {
      console.log(`[Snapshot] Processed ${Math.min(i + BATCH_SIZE, wallets.length)}/${wallets.length} wallets...`);
    }
  }

  const durationMs = Date.now() - startTime;
  logSnapshot(season, wallets.length, totalPointsAwarded, durationMs);
  updateWalletPoints(wallet, season, supplyPts, borrowPts);


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

// In snapshot.ts, after awarding points to each wallet, add referral bonus logic:


// ADD THIS NEW SECTION:
// ── Award Referral Bonuses ────────────────────────────────────────────────
// Check if this wallet was referred by someone
const referrer = getReferrer(wallet);
if (referrer) {
  // Calculate 20% bonus for referrer
  const totalPts = supplyPts + borrowPts;
  const bonusPoints = totalPts * 0.20; // 20% bonus
  
  // Award bonus to referrer
  awardReferralBonus(referrer, bonusPoints, season);
  
  console.log(`[Referral] ${wallet} earned ${totalPts.toFixed(2)} pts → ${referrer} gets ${bonusPoints.toFixed(2)} bonus`);
}
