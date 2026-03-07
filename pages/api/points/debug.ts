import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { POINTS_CONFIG } from '../../../lib/purrPoints/config';

const UI_POOL_DATA_ABI = [
  {
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'user', type: 'address' },
    ],
    name: 'getUserReservesData',
    outputs: [
      {
        components: [
          { name: 'underlyingAsset', type: 'address' },
          { name: 'scaledATokenBalance', type: 'uint256' },
          { name: 'scaledVariableDebt', type: 'uint256' },
        ],
        name: 'userReserves',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const testWallet = '0x63ab25c168319388d6cf214ed95c05e29f459946';
  
  const provider = new ethers.JsonRpcProvider(POINTS_CONFIG.RPC_URL);
  const uiContract = new ethers.Contract(
    POINTS_CONFIG.UI_POOL_DATA_PROVIDER,
    UI_POOL_DATA_ABI,
    provider
  );

  const [userReserves] = await uiContract.getUserReservesData(
    POINTS_CONFIG.POOL_ADDRESS_PROVIDER,
    testWallet
  );

  return res.json({
    wallet: testWallet,
    reserveCount: userReserves.length,
    reserves: userReserves.map((r: any) => ({
      asset: r.underlyingAsset,
      supply: r.scaledATokenBalance.toString(),
      borrow: r.scaledVariableDebt.toString(),
    })),
  });
}
