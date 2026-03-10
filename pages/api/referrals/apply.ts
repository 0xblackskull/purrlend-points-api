import type { NextApiRequest, NextApiResponse } from 'next';
import { applyReferralCode } from '../../../lib/purrPoints/db';

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

  const { wallet, code } = req.body;

  if (!wallet || !code) {
    return res.status(400).json({ error: 'Missing wallet or code' });
  }

  try {
    const success = applyReferralCode(wallet, code);
    
    if (!success) {
      return res.status(400).json({ 
        error: 'Invalid code or already used a referral code' 
      });
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('[API] Apply referral code error:', error);
    return res.status(500).json({ error: error.message });
  }
}
