// ── API Endpoint 1: Generate Referral Code ───────────────────────────────────
// File: pages/api/referrals/generate.ts

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

// ── API Endpoint 2: Apply Referral Code ──────────────────────────────────────
// File: pages/api/referrals/apply.ts

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

// ── API Endpoint 3: Get Referral Stats ───────────────────────────────────────
// File: pages/api/referrals/stats.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { getReferralStats, getCurrentSeason } from '../../../lib/purrPoints/db';

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
    const season = getCurrentSeason();
    const stats = getReferralStats(wallet, season);
    
    return res.status(200).json(stats);
  } catch (error: any) {
    console.error('[API] Referral stats error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// ── API Endpoint 4: Check if used referral code ──────────────────────────────
// File: pages/api/referrals/check.ts

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
