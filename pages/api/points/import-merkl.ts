// ─────────────────────────────────────────────────────────────────────────────
// One-time script: Import existing Merkl leaderboard wallets into database
// POST /api/points/import-merkl
// ─────────────────────────────────────────────────────────────────────────────

import type { NextApiRequest, NextApiResponse } from 'next';
import { bulkAddWallets } from '../../../lib/purrPoints/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify secret
  const secret = req.headers['x-cron-secret'] ?? req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('[Import] Fetching Merkl leaderboard...');

    // Fetch from Merkl API
    const response = await fetch('https://api.merkl.xyz/v4/leaderboard?chainId=999');
    const data = await response.json();

    if (!data.leaderboard || !Array.isArray(data.leaderboard)) {
      return res.status(500).json({ error: 'Invalid Merkl response' });
    }

    // Extract wallet addresses
    const wallets = data.leaderboard
      .map((entry: any) => entry.user)
      .filter((addr: string) => addr && addr.startsWith('0x'));

    console.log(`[Import] Found ${wallets.length} wallets from Merkl`);

    // Bulk insert into database
    bulkAddWallets(wallets);

    console.log('[Import] Successfully imported wallets');

    return res.status(200).json({
      success: true,
      imported: wallets.length,
      wallets: wallets.slice(0, 10), // show first 10 as sample
    });
  } catch (error: any) {
    console.error('[Import] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
