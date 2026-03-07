// ─────────────────────────────────────────────────────────────────────────────
// POST /api/points/snapshot
// Triggers the hourly snapshot — awards points to all active wallets
// Protected by CRON_SECRET to prevent unauthorized calls
// ─────────────────────────────────────────────────────────────────────────────

import type { NextApiRequest, NextApiResponse } from 'next';
import { runSnapshot } from '../../../lib/purrPoints/snapshot';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify secret to prevent unauthorized calls
  const secret = req.headers['x-cron-secret'] ?? req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('[API] Snapshot triggered');
    const result = await runSnapshot();
    return res.status(200).json({ success: true, ...result });
  } catch (e: any) {
    console.error('[API] Snapshot failed:', e);
    return res.status(500).json({ error: e.message });
  }
}

// Increase timeout for snapshot endpoint — can take 30+ seconds for many wallets
export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    externalResolver: true,
  },
  maxDuration: 300, // 60 seconds max
};
