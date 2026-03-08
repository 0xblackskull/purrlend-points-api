// ─────────────────────────────────────────────────────────────────────────────
// Manual wallet import endpoint
// POST /api/points/import-manual
// Body: { "wallets": ["0x123...", "0x456..."] }
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
    const { wallets } = req.body;

    if (!wallets || !Array.isArray(wallets)) {
      return res.status(400).json({ error: 'Invalid request. Send { "wallets": [...] }' });
    }

    // Validate addresses
    const validWallets = wallets.filter((addr: string) => {
      return typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42;
    });

    if (validWallets.length === 0) {
      return res.status(400).json({ error: 'No valid wallet addresses provided' });
    }

    console.log(`[Import] Adding ${validWallets.length} wallets manually`);

    // Bulk insert into database
    bulkAddWallets(validWallets);

    console.log('[Import] Successfully imported wallets');

    return res.status(200).json({
      success: true,
      imported: validWallets.length,
      sample: validWallets.slice(0, 10),
    });
  } catch (error: any) {
    console.error('[Import] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
