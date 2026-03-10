import type { NextApiRequest, NextApiResponse } from 'next';
import { hasUsedReferralCode } from '../../../lib/purrPoints/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
    const hasUsed = hasUsedReferralCode(wallet);
    return res.status(200).json({ hasUsed });
  } catch (error: any) {
    console.error('[API] Check referral error:', error);
    return res.status(500).json({ error: error.message });
  }
}
