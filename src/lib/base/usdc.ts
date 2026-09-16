/**
 * USDC on Base. Circle's native USDC — same address family on mainnet;
 * Base Sepolia uses the official Circle testnet token.
 *
 *   mainnet  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 *   sepolia  0x036CbD53842c5426634e7929541eC2318f3dCF7e
 *
 * BASE_SIGNER_KEY is the single funded hot wallet: gas + USDC for the
 * login faucet and agent payouts. Never used for anchoring alone.
 */

import { baseConfig } from "./config";

export const USDC_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

export function usdcAddress(): string {
  const override = process.env["BASE_USDC_ADDRESS"]?.trim();
  if (override) return override;
  const { network } = baseConfig();
  return network === "mainnet" ? USDC_MAINNET : USDC_SEPOLIA;
}

export function usdToUnits(amountUsd: number, decimals = 6): bigint {
  // Avoid float dust: round to the token's smallest unit.
  const scaled = Math.round(amountUsd * 10 ** decimals);
  return BigInt(scaled);
}

type Ethers = typeof import("ethers");

async function loadEthers(): Promise<Ethers> {
  return import("ethers");
}

async function usdcContract(signerOrProvider?: unknown) {
  const ethers = await loadEthers();
  const config = baseConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const runner = (signerOrProvider ?? provider) as import("ethers").ContractRunner;
  const contract = new ethers.Contract(usdcAddress(), ERC20_ABI, runner) as unknown as {
    balanceOf(a: string): Promise<bigint>;
    decimals(): Promise<bigint>;
    transfer(to: string, amount: bigint): Promise<{
      hash: string;
      wait(): Promise<{ hash: string; status?: number | null }>;
    }>;
  };
  return { ethers, provider, config, contract };
}

export async function getUsdcBalance(address: string): Promise<{
  raw: bigint;
  amount: number;
  decimals: number;
  address: string;
  network: string;
  explorer: string;
}> {
  const { contract, config } = await usdcContract();
  const [raw, decBig] = await Promise.all([contract.balanceOf(address), contract.decimals()]);
  const decimals = Number(decBig);
  return {
    raw,
    amount: Number(raw) / 10 ** decimals,
    decimals,
    address: usdcAddress(),
    network: config.network,
    explorer: config.explorer,
  };
}

export async function getNativeBalance(address: string): Promise<bigint> {
  const { ethers, provider } = await usdcContract();
  void ethers;
  return provider.getBalance(address);
}

/** One signer = one nonce stream. Serialise every USDC transfer. */
let transferQueue: Promise<unknown> = Promise.resolve();
function enqueueTransfer<T>(task: () => Promise<T>): Promise<T> {
  const run = transferQueue.then(task, task);
  transferQueue = run.catch(() => undefined);
  return run;
}

export type UsdcTransferResult = {
  txHash: string;
  amount: number;
  to: string;
  token: string;
  explorerUrl: string;
};

export async function sendUsdc(to: string, amountUsd: number): Promise<UsdcTransferResult> {
  const config = baseConfig();
  if (!config.privateKey) {
    throw new Error("BASE_SIGNER_KEY not set — faucet/payout cannot send USDC");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
    throw new Error(`invalid recipient wallet: ${to}`);
  }

  return enqueueTransfer(async () => {
    const ethers = await loadEthers();
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const signer = new ethers.Wallet(config.privateKey!, provider);
    const { contract } = await usdcContract(signer);
    const decimals = Number(await contract.decimals());
    const amount = usdToUnits(amountUsd, decimals);

    // Gas sanity — a few cents of ETH covers ERC-20 transfer on Base.
    const eth = await provider.getBalance(signer.address);
    if (eth < ethers.parseEther("0.0005")) {
      throw new Error(
        `signer ${signer.address} needs Base ETH for gas (have ${ethers.formatEther(eth)})`,
      );
    }

    const tx = await contract.transfer(to, amount);
    const receipt = await tx.wait();
    if (receipt.status === 0) throw new Error(`USDC transfer reverted: ${tx.hash}`);

    const { baseExplorerTx } = await import("./config");
    return {
      txHash: tx.hash,
      amount: amountUsd,
      to,
      token: usdcAddress(),
      explorerUrl: baseExplorerTx(tx.hash, config.network),
    };
  });
}

export function baseSignerAddress(): string | null {
  return baseConfig().walletAddress ?? null;
}

export function usdcReady(): boolean {
  return Boolean(baseConfig().privateKey);
}
