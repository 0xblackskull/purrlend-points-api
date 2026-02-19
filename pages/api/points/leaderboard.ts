// ─────────────────────────────────────────────────────────────────────────────
// GET /api/points/leaderboard?season=1&limit=100
// Returns top wallets ranked by total points for the given season
// ─────────────────────────────────────────────────────────────────────────────

import type { NextApiRequest, NextApiResponse } from 'next';
import { getLeaderboard } from '../../../lib/purrPoints/db';
import { getCurrentSeason, getCurrentSeasonDates } from '../../../lib/purrPoints/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Get season from query or default to current
    const season = req.query.season ? Number(req.query.season) : getCurrentSeason();
    const limit = Math.min(Number(req.query.limit ?? 100), 500);

    const entries = getLeaderboard(season, limit);
    const { start, end } = getCurrentSeasonDates();

    return res.status(200).json({
      season,
      seasonStart: start.toISOString(),
      seasonEnd: end.toISOString(),
      leaderboard: entries.map((e, i) => ({
        rank: i + 1,
        wallet: e.wallet,
        totalPoints: e.totalPoints,
        supplyPoints: e.supplyPoints,
        borrowPoints: e.borrowPoints,
        lastUpdated: e.lastUpdated,
      })),
    });
  } catch (e: any) {
    console.error('[API] Leaderboard error:', e);
    return res.status(500).json({ error: e.message });
  }
}
