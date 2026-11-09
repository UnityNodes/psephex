import { useState, type ReactNode } from "react";
import { useConfig, useConnection, useWriteContract } from "wagmi";
import { simulateContract, waitForTransactionReceipt } from "wagmi/actions";
import { disputeAbi } from "../abi.js";
import { NearAccount } from "../components/NearAccount.js";
import { Button } from "../components/ui/button.js";
import { Wallet } from "../components/Wallet.js";
import { NEAR_DISPUTE_CONTRACT } from "../deployment.js";
import type { EvmChainConfig } from "../evm-chains.js";
import { describeTxError } from "../lib/dispute.js";
import { describeNearError, REFUND_GAS } from "../lib/near-dispute.js";
import { useNearRpc } from "../near/rpc.js";
import { useNearWallet } from "../near/wallet.js";
import { SOURCE_NAME } from "../sources.js";

const LABEL = "Refund the stake to the claimant";

function RefundShell({ ready, busy, onRefund, wallet, note, message }: { ready: boolean; busy: boolean; onRefund: () => void; wallet: ReactNode; note: string; message: string | null }) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Button type="button" disabled={!ready || busy} onClick={onRefund} className="self-start">
        {busy ? "Refunding…" : LABEL}
      </Button>
      {!ready && (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-xs text-muted">{note} Anyone can send the refund; the stake always goes to the claimant.</p>
          {wallet}
        </div>
      )}
      {message && (
        <p role="alert" className="m-0 text-sm text-no">
          {message}
        </p>
      )}
    </div>
  );
}

export function EvmRefundButton({ cfg, id, onDone }: { cfg: EvmChainConfig; id: number; onDone: () => void }) {
  const config = useConfig();
  const { status, chainId, address } = useConnection();
  const write = useWriteContract();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = status === "connected" && chainId === cfg.chain.id;

  async function handleRefund() {
    setBusy(true);
    setMessage(null);
    try {
      const { request } = await simulateContract(config, { address: cfg.dispute, abi: disputeAbi, functionName: "refund", args: [BigInt(id)], chainId: cfg.chain.id, ...(address ? { account: address } : {}) });
      const hash = await write.mutateAsync(request);
      await waitForTransactionReceipt(config, { hash, chainId: cfg.chain.id });
      onDone();
    } catch (err) {
      setMessage(describeTxError(err, SOURCE_NAME[cfg.source]));
    } finally {
      setBusy(false);
    }
  }

  return <RefundShell ready={ready} busy={busy} onRefund={() => void handleRefund()} wallet={<Wallet chain={cfg.chain} />} note={`Connect a wallet on ${SOURCE_NAME[cfg.source]}.`} message={message} />;
}

export function NearRefundButton({ id, onDone }: { id: number; onDone: () => void }) {
  const wallet = useNearWallet();
  const rpc = useNearRpc();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const account = wallet.accountId;

  async function handleRefund() {
    if (!account) return;
    setBusy(true);
    setMessage(null);
    try {
      const hash = await wallet.call({ receiverId: NEAR_DISPUTE_CONTRACT, methodName: "refund", args: { request_id: id }, gas: REFUND_GAS, deposit: 0n });
      const result = await rpc.txResult(hash, account);
      if (!result.ok) throw new Error(result.error);
      onDone();
    } catch (err) {
      setMessage(describeNearError(err));
    } finally {
      setBusy(false);
    }
  }

  return <RefundShell ready={account !== null} busy={busy} onRefund={() => void handleRefund()} wallet={<NearAccount align="start" />} note="Connect a NEAR testnet wallet." message={message} />;
}
