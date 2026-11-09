import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, keccak256, numberToHex, pad, stringToBytes, toHex, type Hex } from "viem";
import { aiOracleAbi } from "../src/abi.js";
import { BaseChain } from "../src/base.js";

const AIORACLE = "0x792bca54672763af3b1faa1fb62d3cb2fcff6111" as const;
const DISPUTE = "0xca744c595a6c2ee470257d2b873aed2b1a78e092" as const;
const TX = `0x${"11".repeat(32)}` as Hex;

type Handler = (params: readonly unknown[]) => unknown;

function chain(handlers: Record<string, Handler>): { base: BaseChain; calls: { method: string; params: readonly unknown[] }[] } {
  const calls: { method: string; params: readonly unknown[] }[] = [];
  const request = async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
    calls.push({ method, params: params ?? [] });
    const h = handlers[method];
    if (!h) throw new Error(`unexpected rpc ${method}`);
    return h(params ?? []);
  };
  return { base: new BaseChain({ request, aiOracle: AIORACLE, chainId: 84532 }), calls };
}

function askedLog(id: bigint, question: string, paid: bigint) {
  const topics = encodeEventTopics({ abi: aiOracleAbi, eventName: "Asked", args: { id, requester: DISPUTE } });
  const data = encodeAbiParameters(
    [{ type: "string" }, { type: "bytes32" }, { type: "uint256" }],
    [question, keccak256(stringToBytes(question)), paid],
  );
  return {
    address: AIORACLE,
    topics,
    data,
    blockNumber: numberToHex(120n),
    transactionHash: TX,
    logIndex: "0x2",
    blockHash: `0x${"22".repeat(32)}`,
    transactionIndex: "0x0",
    removed: false,
  };
}

describe("BaseChain", () => {
  it("decodes Asked logs from the AiOracle address", async () => {
    const { base, calls } = chain({ eth_getLogs: () => [askedLog(7n, "Did it ship?", 100n)] });
    const events = await base.askedEvents(100n, 130n);
    expect(events).toEqual([
      {
        id: 7n,
        requester: "0xCa744C595A6C2EE470257D2B873aEd2b1a78E092",
        question: "Did it ship?",
        questionHash: keccak256(stringToBytes("Did it ship?")),
        paidWei: 100n,
        blockNumber: 120n,
        txHash: TX,
        logIndex: 2,
      },
    ]);
    const filter = calls[0]?.params[0] as { address: string; fromBlock: string; toBlock: string };
    expect(filter.address.toLowerCase()).toBe(AIORACLE);
    expect(filter).toMatchObject({ fromBlock: "0x64", toBlock: "0x82" });
  });

  it("reads head, sender, nonce and fees", async () => {
    const { base } = chain({
      eth_blockNumber: () => "0x10",
      eth_getTransactionByHash: () => ({ hash: TX, from: DISPUTE, to: AIORACLE, nonce: "0x1", value: "0x0", input: "0x", blockHash: null, blockNumber: null, transactionIndex: null, gas: "0x5208", type: "0x2", maxFeePerGas: "0x1", maxPriorityFeePerGas: "0x1", chainId: "0x14a34", v: "0x0", r: "0x1", s: "0x1", yParity: "0x0", accessList: [] }),
      eth_getTransactionCount: (p) => (p[1] === "pending" ? "0x5" : "0x0"),
      eth_getBlockByNumber: () => ({ number: "0x10", baseFeePerGas: "0x5b8d80", hash: `0x${"33".repeat(32)}`, timestamp: "0x1", transactions: [] }),
      eth_maxPriorityFeePerGas: () => "0xf4240",
    });
    expect(await base.headBlock()).toBe(16n);
    expect(await base.txSender(TX)).toBe("0xCa744C595A6C2EE470257D2B873aEd2b1a78E092");
    expect(await base.pendingNonce(DISPUTE)).toBe(5);
    expect(await base.feeQuote()).toEqual({ baseFeePerGas: 6_000_000n, maxPriorityFeePerGas: 1_000_000n });
  });

  it("reads whether a request is fulfilled on Base", async () => {
    const encoded = encodeAbiParameters(
      [{ type: "tuple", components: [{ type: "address" }, { type: "bytes32" }, { type: "bool" }] }],
      [[DISPUTE, pad("0x01"), true]],
    );
    const { base, calls } = chain({ eth_call: () => encoded });
    expect(await base.isFulfilledOnBase(7n)).toBe(true);
    expect((calls[0]?.params[0] as { to: string }).to.toLowerCase()).toBe(AIORACLE);
  });

  it("returns null for a missing receipt and decodes events of a mined one", async () => {
    const fulfilledLog = {
      address: AIORACLE,
      topics: encodeEventTopics({ abi: aiOracleAbi, eventName: "Fulfilled", args: { id: 7n } }),
      data: encodeAbiParameters([{ type: "uint8" }], [1]),
      blockNumber: "0x78",
      transactionHash: TX,
      logIndex: "0x0",
      blockHash: `0x${"22".repeat(32)}`,
      transactionIndex: "0x0",
      removed: false,
    };
    let mined = false;
    const { base } = chain({
      eth_getTransactionReceipt: () =>
        mined
          ? { transactionHash: TX, status: "0x1", blockNumber: "0x78", gasUsed: "0xee48", logs: [fulfilledLog], blockHash: `0x${"22".repeat(32)}`, transactionIndex: "0x0", from: DISPUTE, to: AIORACLE, cumulativeGasUsed: "0x1", effectiveGasPrice: "0x1", type: "0x2", logsBloom: `0x${"00".repeat(256)}`, contractAddress: null }
          : null,
    });
    expect(await base.receipt(TX)).toBeNull();
    mined = true;
    const receipt = await base.receipt(TX);
    expect(receipt).toMatchObject({ status: "success", blockNumber: 120n, gasUsed: 61_000n });
    expect(JSON.parse(receipt?.eventsJson ?? "[]")).toEqual([{ event: "Fulfilled", args: { id: "7", answer: 1 } }]);
  });

  it("reads an address balance at the latest block", async () => {
    const { base, calls } = chain({ eth_getBalance: () => "0x3e8" });
    expect(await base.balance(DISPUTE)).toBe(1000n);
    expect(calls[0]?.params).toEqual([DISPUTE, "latest"]);
  });

  it("reads the AiOracle fee", async () => {
    const { base } = chain({ eth_call: () => encodeAbiParameters([{ type: "uint256" }], [100_000_000_000_000n]) });
    expect(await base.fee()).toBe(100_000_000_000_000n);
  });

  it("sends a raw transaction", async () => {
    const { base, calls } = chain({ eth_sendRawTransaction: () => TX });
    expect(await base.sendRawTransaction("0x02f8")).toBe(TX);
    expect(calls[0]?.params).toEqual(["0x02f8"]);
  });

  it("refuses to run against the wrong chain", async () => {
    const { base } = chain({ eth_chainId: () => toHex(1) });
    await expect(base.assertChain()).rejects.toThrow(/chain id 1/);
  });
});
