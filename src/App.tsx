import { useMemo, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import {
  createConfig,
  http,
  WagmiProvider,
  useAccount,
  useConnect,
  useDisconnect,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useWatchContractEvent,
} from "wagmi";
import { simulateContract } from "wagmi/actions";
import { injected } from "wagmi/connectors";
import { mainnet } from "wagmi/chains";
import { custom, encodeFunctionData, fallback, parseEther } from "viem";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./App.css";

const queryClient = new QueryClient();

const walletTransport =
  typeof window !== "undefined" && (window as any).ethereum
    ? custom((window as any).ethereum)
    : http();

const config = createConfig({
  chains: [mainnet],
  connectors: [injected()],
  transports: {
    [mainnet.id]: fallback([
      walletTransport,
      http("https://eth.llamarpc.com"),
      http("https://rpc.ankr.com/eth"),
    ]),
  },
});

const ROUTER_CONTRACT = "0x67820c9E1a8aFbA469cB4503086d2266055c8Cff" as `0x${string}`;

const ROUTER_ABI = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      {
        name: "testSettings",
        type: "tuple",
        components: [
          { name: "takeClaims", type: "bool" },
          { name: "settleUsingBurn", type: "bool" },
        ],
      },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

// Multicall3 — deployed on all major chains, same address
const MULTICALL3_CONTRACT = "0xcA11bde05977b3631167028862bE2a173976CA11" as `0x${string}`;

const MULTICALL3_ABI = [
  {
    type: "function",
    name: "aggregate3Value",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "value", type: "uint256" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

const SWAP_KEY = {
  currency0: "0x0000000000000000000000000000000000000000",
  currency1: "0x0cEbB99d04967aD397F5c4d568993e43DC12BabA",
  fee: 10000,
  tickSpacing: 200,
  hooks: "0xDD3bEEF2b5993F42532021D0654fbfEf2d3280cC",
} as const;

const TEST_SETTINGS = { takeClaims: false, settleUsingBurn: false } as const;

const HOOK_DATA =
  "0x0000000000000000000000000000000000000000000000000000000000000001554e4900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

const UNI20_TOKEN = "0x0cEbB99d04967aD397F5c4d568993e43DC12BabA" as `0x${string}`;
const TOKENS_PER_MINT = 1000n * 10n ** 18n;

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", indexed: true, type: "address" },
      { name: "to", indexed: true, type: "address" },
      { name: "value", indexed: false, type: "uint256" },
    ],
  },
] as const;

const ETH_PER_MINT = "0.0005";
const MINT_VALUE_WEI = parseEther(ETH_PER_MINT);
const SQRT_PRICE_LIMIT = 4295128740n;

function formatToken(wei: bigint) {
  const n = Number(wei) / 1e18;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

type MintEvent = { to: string; value: bigint; time: Date };

function LiveStats() {
  const { address, isConnected } = useAccount();
  const [activity, setActivity] = useState<MintEvent[]>([]);

  const { data: balance } = useReadContract({
    address: UNI20_TOKEN,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: isConnected && !!address, refetchInterval: 12_000 },
  });

  const { data: totalSupply } = useReadContract({
    address: UNI20_TOKEN,
    abi: ERC20_ABI,
    functionName: "totalSupply",
    query: { refetchInterval: 12_000 },
  });

  useWatchContractEvent({
    address: UNI20_TOKEN,
    abi: ERC20_ABI,
    eventName: "Transfer",
    onLogs(logs) {
      const mints = logs
        .filter((log) => log.args.from === "0x0000000000000000000000000000000000000000")
        .map((log) => ({ to: log.args.to as string, value: log.args.value as bigint, time: new Date() }));
      if (mints.length > 0) {
        setActivity((prev) => [...mints, ...prev].slice(0, 20));
      }
    },
  });

  const totalMints = totalSupply != null ? totalSupply / TOKENS_PER_MINT : null;

  return (
    <section className="card">
      <h2 style={{ marginBottom: 16 }}>Live Stats</h2>
      <div className="stats-grid">
        <div className="stat-box">
          <p className="stat-label">Total Mints</p>
          <p className="stat-value">{totalMints != null ? Number(totalMints).toLocaleString() : "..."}</p>
        </div>
        <div className="stat-box">
          <p className="stat-label">My UNI20 Balance</p>
          <p className="stat-value">
            {isConnected && balance != null ? `${formatToken(balance)} UNI20` : isConnected ? "..." : "—"}
          </p>
        </div>
      </div>

      <h3 className="activity-title">Live Activity</h3>
      <div className="activity">
        {activity.length === 0 ? (
          <p className="activity-empty">Watching for new mints...</p>
        ) : (
          activity.map((a, i) => (
            <div key={i} className="activity-row">
              <span className="activity-addr">
                {a.to.slice(0, 6)}...{a.to.slice(-4)}
              </span>
              <span className="activity-badge">+{formatToken(a.value)} UNI20</span>
              <span className="activity-time">{a.time.toLocaleTimeString()}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatWeiToEth(wei: bigint) {
  const whole = wei / 1000000000000000000n;
  const fraction = (wei % 1000000000000000000n).toString().padStart(18, "0");
  const shortFraction = fraction.slice(0, 6).replace(/0+$/, "");
  return shortFraction ? `${whole}.${shortFraction}` : whole.toString();
}

function MintApp() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();

  const [amount, setAmount] = useState(1);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastHash, setLastHash] = useState<`0x${string}` | undefined>();

  const { writeContractAsync } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: lastHash,
  });

  const safeAmount = useMemo(() => {
    if (!Number.isFinite(amount)) return 1;
    return Math.max(1, Math.min(20, Math.floor(amount)));
  }, [amount]);

  const totalValueWei = useMemo(() => MINT_VALUE_WEI * BigInt(safeAmount), [safeAmount]);
  const amountSpecified = useMemo(() => -MINT_VALUE_WEI, []);

  function addLog(text: string) {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} - ${text}`, ...prev].slice(0, 80));
  }

  const swapArgs = useMemo(
    () =>
      [
        SWAP_KEY,
        { zeroForOne: true, amountSpecified, sqrtPriceLimitX96: SQRT_PRICE_LIMIT },
        TEST_SETTINGS,
        HOOK_DATA,
      ] as const,
    [amountSpecified]
  );

  async function bulkMint() {
    if (!isConnected || !address) {
      addLog("Connect wallet first.");
      return;
    }

    setRunning(true);
    addLog("Simulating to check for revert...");

    // Simulate 1 swap first — if it reverts, show the reason without wasting gas
    try {
      await simulateContract(config, {
        address: ROUTER_CONTRACT,
        abi: ROUTER_ABI,
        functionName: "swap",
        args: swapArgs,
        value: MINT_VALUE_WEI,
        account: address,
      });
      addLog("Simulation OK.");
    } catch (err: any) {
      const msg: string = err?.message || "";
      const isNetworkError =
        msg.includes("HTTP request failed") ||
        msg.includes("fetch") ||
        msg.includes("network") ||
        err?.name === "FetchError";

      if (isNetworkError) {
        addLog("Simulation skipped (RPC error) — proceeding to send tx...");
      } else {
        const reason = err?.cause?.reason || err?.shortMessage || msg || "Unknown revert";
        addLog(`Simulation FAILED: ${reason}`);
        addLog("Check: sufficient value? pool exists? hookData correct?");
        setRunning(false);
        return;
      }
    }

    addLog(
      `Sending ${safeAmount}x mint in 1 tx via Multicall3 — total ${formatWeiToEth(totalValueWei)} ETH + gas`
    );

    try {
      let hash: `0x${string}`;

      if (safeAmount === 1) {
        // Single mint directly to router
        hash = await writeContractAsync({
          address: ROUTER_CONTRACT,
          abi: ROUTER_ABI,
          functionName: "swap",
          args: swapArgs,
          value: MINT_VALUE_WEI,
        });
      } else {
        // Batch N mints in 1 tx via Multicall3.aggregate3Value
        const swapCalldata = encodeFunctionData({
          abi: ROUTER_ABI,
          functionName: "swap",
          args: swapArgs,
        });

        const calls = Array.from({ length: safeAmount }, () => ({
          target: ROUTER_CONTRACT,
          allowFailure: false,
          value: MINT_VALUE_WEI,
          callData: swapCalldata,
        }));

        hash = await writeContractAsync({
          address: MULTICALL3_CONTRACT,
          abi: MULTICALL3_ABI,
          functionName: "aggregate3Value",
          args: [calls],
          value: totalValueWei,
        });
      }

      setLastHash(hash);
      addLog(`Tx sent: ${hash}`);
      addLog(`Waiting for confirmation...`);
    } catch (err: any) {
      const reason =
        err?.cause?.reason || err?.shortMessage || err?.message || "Transaction failed";
      addLog(`Error: ${reason}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="page">
      <section className="card">
        <p className="badge">Uniscribe Bulk Mint Helper</p>
        <h1>Bulk Mint for Uniscribe</h1>
        <p className="sub">
          {safeAmount === 1
            ? "1 mint = 1 tx directly to router."
            : `${safeAmount} mints = 1 tx via Multicall3 (only 1 wallet confirmation needed).`}
        </p>

        <div className="walletBox">
          {isConnected ? (
            <>
              <span className="addr">{address}</span>
              <button onClick={() => disconnect()} disabled={running}>
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={() => connect({ connector: connectors[0] })}
              disabled={isConnectPending || connectors.length === 0}
            >
              {isConnectPending ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>

        <div className="status" style={{ fontSize: 12, marginBottom: 8 }}>
          <p>Router: {ROUTER_CONTRACT}</p>
          <p>UNI20 Hook: {SWAP_KEY.hooks}</p>
          <p>ETH per mint: {formatWeiToEth(MINT_VALUE_WEI)} ETH</p>
          <p>Total: {formatWeiToEth(totalValueWei)} ETH + gas</p>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          <label>
            Mint count (max 20)
            <input
              type="number"
              min={1}
              max={20}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              disabled={running}
            />
          </label>
        </div>

        <button className="primary" onClick={bulkMint} disabled={!isConnected || running}>
          {running
            ? "Minting..."
            : `Bulk Mint ${safeAmount}x — ${formatWeiToEth(totalValueWei)} ETH`}
        </button>

        <div className="status">
          {lastHash && <p>Tx: {lastHash}</p>}
          {isConfirming && <p>Waiting for confirmation...</p>}
          {isSuccess && <p>Confirmed!</p>}
        </div>
      </section>

      <LiveStats />

      <section className="card">
        <h2>Logs</h2>
        <div className="logs">
          {logs.length === 0 ? <p>No logs yet.</p> : logs.map((log, i) => <p key={i}>{log}</p>)}
        </div>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <MintApp />
        <Analytics />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
