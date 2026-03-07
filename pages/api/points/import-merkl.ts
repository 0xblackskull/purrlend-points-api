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
    console.log('[Import] Fetching Merkl campaigns...');

    // Your 3 Merkl campaign IDs
    const campaignIds = [
      '0xbc5377d3326d0aa6e2c6895338d1a16ee7c6a307a997a723ab504c37d30ea897', // wHYPE
      '0xa6a39fe7c1a132dda2816706e1c58e3e569105770188caf127df69fb4ff8ed44', // USDC
      '0xac6ee25a6c0e8ba505e8d2db5853880f2061a8fd31a6f79dbf410b2c77cecf07', // kHYPE
    ];

    const allWallets = new Set<string>();

    // Fetch each campaign's leaderboard
    for (const campaignId of campaignIds) {
      try {
        const url = `https://api.merkl.xyz/v4/opportunities/${campaignId}/leaderboard?chainId=999`;
        console.log(`[Import] Fetching ${url.slice(0, 80)}...`);
        
        const response = await fetch(url);
        const data = await response.json();

        console.log(`[Import] Response keys:`, Object.keys(data));

        // Try different possible response structures
        let wallets: string[] = [];
        
        if (Array.isArray(data)) {
          // If it's directly an array
          wallets = data.map((entry: any) => entry.user || entry.address || entry.wallet).filter(Boolean);
        } else if (data.leaderboard && Array.isArray(data.leaderboard)) {
          // If it's { leaderboard: [...] }
          wallets = data.leaderboard.map((entry: any) => entry.user || entry.address || entry.wallet).filter(Boolean);
        } else if (data.data && Array.isArray(data.data)) {
          // If it's { data: [...] }
          wallets = data.data.map((entry: any) => entry.user || entry.address || entry.wallet).filter(Boolean);
        }

        console.log(`[Import] Found ${wallets.length} wallets in campaign ${campaignId.slice(0, 10)}...`);
        wallets.forEach(w => allWallets.add(w.toLowerCase()));
      } catch (err: any) {
        console.error(`[Import] Failed to fetch campaign ${campaignId}:`, err.message);
      }
    }

    if (allWallets.size === 0) {
      return res.status(500).json({ 
        error: 'No wallets found in Merkl campaigns. Check logs for API response structure.',
      });
    }

    const walletArray = Array.from(allWallets);
    console.log(`[Import] Total unique wallets: ${walletArray.length}`);

    // Bulk insert into database
    bulkAddWallets(walletArray);

    console.log('[Import] Successfully imported wallets');

    return res.status(200).json({
      success: true,
      imported: walletArray.length,
      sample: walletArray.slice(0, 10), // show first 10 as sample
    });
  } catch (error: any) {
    console.error('[Import] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
