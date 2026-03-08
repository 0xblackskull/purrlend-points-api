import type { NextApiRequest, NextApiResponse } from 'next';
import { getLeaderboard } from '../../../lib/purrPoints/db';
import { POINTS_CONFIG, getCurrentSeason } from '../../../lib/purrPoints/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const season = getCurrentSeason();
    const leaderboard = getLeaderboard(season, 100);

    // Calculate season dates
    const seasonStartMs = new Date(POINTS_CONFIG.SEASON_1_START).getTime();
    const seasonDurationMs = POINTS_CONFIG.SEASON_DURATION_DAYS * 24 * 60 * 60 * 1000;
    const seasonEndMs = seasonStartMs + seasonDurationMs;

    return res.status(200).json({
      season,
      seasonStart: new Date(seasonStartMs).toISOString(),
      seasonEnd: new Date(seasonEndMs).toISOString(),
      leaderboard,
    });
  } catch (error: any) {
    console.error('[API] Leaderboard error:', error);
    return res.status(500).json({ error: error.message });
  }
}
