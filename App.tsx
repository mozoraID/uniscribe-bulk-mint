import { useMemo, useState } from "react";
import {
  createConfig,
  http,
  WagmiProvider,
  useAccount,
  useConnect,
  useDisconnect,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { mainnet } from "wagmi/chains";
import { parseEther } from "viem";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./App.css";

const queryClient = new QueryClient();

const config = createConfig({
  chains: [mainnet],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
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

const SWAP_KEY = {
  currency0: "0x0000000000000000000000000000000000000000",
  currency1: "0x0cEbB99d04967aD397F5c4d568993e43DC12BabA",
  fee: 10000,
  tickSpacing: 200,
  hooks: "0xDD3bEEF2b5993F42532021D0654fbfEf2d3280cC",
} as const;

const TEST_SETTINGS = {
  takeClaims: false,
  settleUsingBurn: false,
} as const;

const HOOK_DATA =
  "0x0000000000000000000000000000000000000000000000000000000000000001554e4900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

const ETH_PER_MINT = "0.0005";
const MINT_VALUE_WEI = parseEther(ETH_PER_MINT);

function formatWeiToEth(wei: bigint) {
  const whole = wei / 1000000000000000000n;
  const fraction = (wei % 1000000000000000000n).toString().padStart(18, "0");
  const shortFraction = fraction.slice(0, 8).replace(/0+$/, "");
  return shortFraction ? `${whole}.${shortFraction}` : whole.toString();
}

function MintApp() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();

  const [amount, setAmount] = useState(1);
  const [delayMs, setDelayMs] = useState(500);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastHash, setLastHash] = useState<`0x${string}` | undefined>();

  const { writeContractAsync } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: lastHash,
  });

  const safeAmount = useMemo(() => {
    if (!Number.isFinite(amount)) return 1;
    return Math.max(1, Math.min(10, Math.floor(amount)));
  }, [amount]);

  const safeDelayMs = useMemo(() => {
    if (!Number.isFinite(delayMs)) return 500;
    return Math.max(0, Math.min(10000, Math.floor(delayMs)));
  }, [delayMs]);

  const totalValueWei = useMemo(() => MINT_VALUE_WEI * BigInt(safeAmount), [safeAmount]);
  const amountSpecified = useMemo(() => -MINT_VALUE_WEI, []);

  function addLog(text: string) {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} - ${text}`, ...prev].slice(0, 80));
  }

  async function bulkMint() {
    if (!isConnected) {
      addLog("Connect wallet first.");
      return;
    }

    setRunning(true);
    addLog(`Starting bulk mint: ${safeAmount} tx | total fee ${formatWeiToEth(totalValueWei)} ETH + gas`);

    try {
      for (let i = 1; i <= safeAmount; i++) {
        addLog(`Mint ${i}/${safeAmount}: sending router swap with ${formatWeiToEth(MINT_VALUE_WEI)} ETH...`);

        const hash = await writeContractAsync({
          address: ROUTER_CONTRACT,
          abi: ROUTER_ABI,
          functionName: "swap",
          args: [
            SWAP_KEY,
            {
              zeroForOne: true,
              amountSpecified,
              sqrtPriceLimitX96: 4295128740n,
            },
            TEST_SETTINGS,
            HOOK_DATA,
          ],
          value: MINT_VALUE_WEI,
        });

        setLastHash(hash);
        addLog(`Mint ${i}/${safeAmount}: tx sent ${hash}`);

        if (i < safeAmount) {
          await new Promise((resolve) => setTimeout(resolve, safeDelayMs));
        }
      }

      addLog("Bulk mint finished.");
    } catch (err: any) {
      addLog(`Error: ${err?.shortMessage || err?.message || "Transaction failed"}`);
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
          Sends repeated normal Uniscribe router swap + inscription transactions from your connected wallet.
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

        <div className="status">
          <p>Router: {ROUTER_CONTRACT}</p>
          <p>UNI20 Hook: {SWAP_KEY.hooks}</p>
          <p>ETH per mint: {formatWeiToEth(MINT_VALUE_WEI)} ETH</p>
          <p>Total fee: {formatWeiToEth(totalValueWei)} ETH + gas</p>
        </div>

        <div className="grid">
          <label>
            Mint count
            <input
              type="number"
              min={1}
              max={10}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              disabled={running}
            />
          </label>

          <label>
            Delay per tx, ms
            <input
              type="number"
              min={0}
              max={10000}
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
              disabled={running}
            />
          </label>
        </div>

        <button className="primary" onClick={bulkMint} disabled={!isConnected || running}>
          {running
            ? "Minting..."
            : `Bulk Mint ${safeAmount}x (${formatWeiToEth(totalValueWei)} ETH + gas)`}
        </button>

        <div className="status">
          {lastHash && <p>Last tx: {lastHash}</p>}
          {isConfirming && <p>Waiting confirmation...</p>}
          {isSuccess && <p>Last tx confirmed.</p>}
        </div>
      </section>

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
      </QueryClientProvider>
    </WagmiProvider>
  );
}
