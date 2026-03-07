import type { NextApiRequest, NextApiResponse } from 'next';
import { getWalletCount, getActiveWallets } from '../../../lib/purrPoints/db';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return res.json({
    totalWallets: getWalletCount(),
    wallets: getActiveWallets().slice(0, 10), // show first 10
  });
}
