// ─────────────────────────────────────────────────────────────────────────────
// GET /api/points/user?wallet=0x...&season=1
// Returns points + breakdown for a specific wallet
// ─────────────────────────────────────────────────────────────────────────────

import type { NextApiRequest, NextApiResponse } from 'next';
import { getWalletPoints, getWalletBreakdown } from '../../../lib/purrPoints/db';
import { getCurrentSeason } from '../../../lib/purrPoints/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const wallet = (req.query.wallet as string)?.toLowerCase();
  if (!wallet || !wallet.startsWith('0x')) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    const season = req.query.season ? Number(req.query.season) : getCurrentSeason();
    const points = getWalletPoints(wallet, season);
    const breakdown = getWalletBreakdown(wallet, season);

    if (!points) {
      return res.status(200).json({
        wallet,
        season,
        totalPoints: 0,
        supplyPoints: 0,
        borrowPoints: 0,
        breakdown: [],
        lastUpdated: null,
      });
    }

    return res.status(200).json({
      wallet: points.wallet,
      season: points.season,
      totalPoints: points.totalPoints,
      supplyPoints: points.supplyPoints,
      borrowPoints: points.borrowPoints,
      breakdown,
      lastUpdated: points.lastUpdated,
    });
  } catch (e: any) {
    console.error('[API] User points error:', e);
    return res.status(500).json({ error: e.message });
  }
}
