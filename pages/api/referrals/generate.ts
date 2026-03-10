import type { NextApiRequest, NextApiResponse } from 'next';
import { generateReferralCode } from '../../../lib/purrPoints/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { wallet } = req.body;

  if (!wallet) {
    return res.status(400).json({ error: 'Missing wallet address' });
  }

  try {
    const code = generateReferralCode(wallet);
    return res.status(200).json({ code });
  } catch (error: any) {
    console.error('[API] Generate referral code error:', error);
    return res.status(500).json({ error: error.message });
  }
}
