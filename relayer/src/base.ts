import {
  createPublicClient,
  custom,
  getAbiItem,
  getAddress,
  http,
  parseEventLogs,
  TransactionReceiptNotFoundError,
  type Address,
  type EIP1193RequestFn,
  type Hex,
  type PublicClient,
} from "viem";
import { aiOracleAbi } from "./abi.js";
import type { AskedEvent, BaseChainPort, BaseReceipt, FeeQuote } from "./types.js";

const askedEvent = getAbiItem({ abi: aiOracleAbi, name: "Asked" });

export interface BaseChainOptions {
  readonly aiOracle: Address;
  readonly chainId: number;
  readonly url?: string;
  readonly request?: (args: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
  readonly timeoutMs?: number;
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
}

export class BaseChain implements BaseChainPort {
  readonly #client: PublicClient;
  readonly #aiOracle: Address;
  readonly #chainId: number;

  constructor(opts: BaseChainOptions) {
    const transport = opts.request
      ? custom({ request: opts.request as EIP1193RequestFn })
      : http(opts.url, { timeout: opts.timeoutMs ?? 20_000, retryCount: 2 });
    this.#client = createPublicClient({ transport });
    this.#aiOracle = getAddress(opts.aiOracle);
    this.#chainId = opts.chainId;
  }

  async assertChain(): Promise<void> {
    const id = await this.#client.getChainId();
    if (id !== this.#chainId) throw new Error(`Base RPC reports chain id ${id}, expected ${this.#chainId}`);
  }

  async fee(): Promise<bigint> {
    return this.#client.readContract({ address: this.#aiOracle, abi: aiOracleAbi, functionName: "fee" });
  }

  async headBlock(): Promise<bigint> {
    return this.#client.getBlockNumber({ cacheTime: 0 });
  }

  async balance(address: Address): Promise<bigint> {
    return this.#client.getBalance({ address, blockTag: "latest" });
  }

  async askedEvents(fromBlock: bigint, toBlock: bigint): Promise<AskedEvent[]> {
    const logs = await this.#client.getLogs({ address: this.#aiOracle, event: askedEvent, fromBlock, toBlock, strict: true });
    return logs.map((log) => {
      if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) throw new Error("pending log returned");
      return {
        id: log.args.id,
        requester: getAddress(log.args.requester),
        question: log.args.question,
        questionHash: log.args.questionHash,
        paidWei: log.args.paid,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
      };
    });
  }

  async txSender(txHash: Hex): Promise<Address> {
    const tx = await this.#client.getTransaction({ hash: txHash });
    return getAddress(tx.from);
  }

  async isFulfilledOnBase(requestId: bigint): Promise<boolean> {
    const req = await this.#client.readContract({ address: this.#aiOracle, abi: aiOracleAbi, functionName: "getRequest", args: [requestId] });
    return req.fulfilled;
  }

  async pendingNonce(address: Address): Promise<number> {
    return this.#client.getTransactionCount({ address, blockTag: "pending" });
  }

  async feeQuote(): Promise<FeeQuote> {
    const [block, priority] = await Promise.all([
      this.#client.getBlock({ blockTag: "latest" }),
      this.#client.request({ method: "eth_maxPriorityFeePerGas" }),
    ]);
    if (block.baseFeePerGas === null) throw new Error("latest block has no baseFeePerGas");
    return { baseFeePerGas: block.baseFeePerGas, maxPriorityFeePerGas: BigInt(priority) };
  }

  async sendRawTransaction(signedTx: Hex): Promise<Hex> {
    return this.#client.sendRawTransaction({ serializedTransaction: signedTx });
  }

  async receipt(txHash: Hex): Promise<BaseReceipt | null> {
    try {
      const r = await this.#client.getTransactionReceipt({ hash: txHash });
      const events = parseEventLogs({ abi: aiOracleAbi, logs: r.logs, strict: false }).map((e) => ({ event: e.eventName, args: jsonSafe(e.args) }));
      return { status: r.status, blockNumber: r.blockNumber, gasUsed: r.gasUsed, eventsJson: JSON.stringify(events) };
    } catch (err) {
      if (err instanceof TransactionReceiptNotFoundError) return null;
      throw err;
    }
  }
}
