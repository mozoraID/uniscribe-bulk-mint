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

/**
 * Isi ini setelah kamu inspect contract mint Uniscribe.
 * Cara ambil:
 * - buka https://uniscribe.app/mint
 * - connect wallet
 * - klik mint 1x
 * - lihat pending tx di wallet / explorer
 * - copy contract address, function, args, dan value
 */
const MINT_CONTRACT = "0x0000000000000000000000000000000000000000" as `0x${string}`;

const MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const;

// contoh kalau mint gratis: 0n
// kalau mint bayar 0.0001 ETH: 100000000000000n
const MINT_VALUE_WEI = 0n;

function MintApp() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();

  const [amount, setAmount] = useState(5);
  const [delayMs, setDelayMs] = useState(1500);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastHash, setLastHash] = useState<`0x${string}` | undefined>();

  const { writeContractAsync } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: lastHash,
  });

  const safeAmount = useMemo(() => {
    if (!Number.isFinite(amount)) return 1;
    return Math.max(1, Math.min(100, Math.floor(amount)));
  }, [amount]);

  function addLog(text: string) {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} - ${text}`, ...prev].slice(0, 80));
  }

  async function bulkMint() {
    if (!isConnected) {
      addLog("Connect wallet first.");
      return;
    }

    if (MINT_CONTRACT === "0x0000000000000000000000000000000000000000") {
      addLog("Set MINT_CONTRACT first in src/App.tsx.");
      return;
    }

    setRunning(true);
    addLog(`Starting bulk mint: ${safeAmount} tx`);

    try {
      for (let i = 1; i <= safeAmount; i++) {
        addLog(`Mint ${i}/${safeAmount}: sending tx...`);

        const hash = await writeContractAsync({
          address: MINT_CONTRACT,
          abi: MINT_ABI,
          functionName: "mint",
          args: [],
          value: MINT_VALUE_WEI,
        });

        setLastHash(hash);
        addLog(`Mint ${i}/${safeAmount}: tx sent ${hash}`);

        if (i < safeAmount) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
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
          This tool sends repeated normal mint transactions from your connected wallet.
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
              disabled={isConnectPending}
            >
              {isConnectPending ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>

        <div className="grid">
          <label>
            Mint count
            <input
              type="number"
              min={1}
              max={100}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              disabled={running}
            />
          </label>

          <label>
            Delay per tx, ms
            <input
              type="number"
              min={500}
              max={30000}
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
              disabled={running}
            />
          </label>
        </div>

        <button className="primary" onClick={bulkMint} disabled={!isConnected || running}>
          {running ? "Minting..." : `Bulk Mint ${safeAmount}x`}
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
          {logs.length === 0 ? (
            <p>No logs yet.</p>
          ) : (
            logs.map((log, i) => <p key={i}>{log}</p>)
          )}
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