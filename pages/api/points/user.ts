import type { NextApiRequest, NextApiResponse } from 'next';
import { getWalletPoints, getCurrentSeason } from '../../../lib/purrPoints/db';

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

  const { wallet } = req.query;

  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({ error: 'Missing wallet parameter' });
  }

  try {
    const season = getCurrentSeason();
    const points = getWalletPoints(wallet, season);

    if (!points) {
      return res.status(200).json({
        wallet,
        season,
        totalPoints: 0,
        supplyPoints: 0,
        borrowPoints: 0,
        rank: 0,
      });
    }

    return res.status(200).json({
      wallet: points.wallet,
      season: points.season,
      totalPoints: points.totalPoints,
      supplyPoints: points.supplyPoints,
      borrowPoints: points.borrowPoints,
      rank: 0, // TODO: calculate rank
    });
  } catch (error: any) {
    console.error('[API] User points error:', error);
    return res.status(500).json({ error: error.message });
  }
}
