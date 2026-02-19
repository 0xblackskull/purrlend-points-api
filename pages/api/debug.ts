import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return res.status(200).json({
    hasCronSecret: !!process.env.CRON_SECRET,
    secretLength: process.env.CRON_SECRET?.length ?? 0,
  });
}
