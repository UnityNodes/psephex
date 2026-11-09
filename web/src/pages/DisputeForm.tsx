import { useState } from "react";
import { ChainBadge } from "../components/ChainBadge.js";
import { ARBITRUM, BASE, type EvmChainConfig } from "../evm-chains.js";
import { SOURCE_NAME, type Source } from "../sources.js";
import { EvmDisputeForm } from "./EvmDisputeForm.js";
import { CaseForm } from "./CaseForm.js";

const PAYS: Readonly<Record<Source, string>> = { near: "Stake and pay in NEAR", base: "Stake and pay in ETH", arbitrum: "Stake and pay in ETH" };

export function ChainPicker({ value, onChange, options }: { value: Source; onChange: (s: Source) => void; options: readonly Source[] }) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-2 text-sm font-medium">Chain</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((s) => (
          <label
            key={s}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line bg-paper/60 px-3 py-2.5 transition-colors duration-150 hover:border-bronze has-[:checked]:border-bronze has-[:checked]:bg-raised has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-bronze"
          >
            <input type="radio" name="chain" value={s} checked={value === s} onChange={() => onChange(s)} className="sr-only" />
            <ChainBadge source={s} decorative />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{SOURCE_NAME[s]}</span>
              <span className="block text-xs text-muted">{PAYS[s]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function DisputeForm({ arbitrum = ARBITRUM }: { arbitrum?: EvmChainConfig | null }) {
  const [source, setSource] = useState<Source>("near");
  const options: readonly Source[] = arbitrum ? ["near", "base", "arbitrum"] : ["near", "base"];
  const evm = source === "base" ? BASE : source === "arbitrum" ? arbitrum : null;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <ChainPicker value={source} onChange={setSource} options={options} />
        {!arbitrum && <p className="m-0 text-xs text-muted">Arbitrum Sepolia is not configured in this build, so it is not offered.</p>}
      </div>
      {source === "near" ? <CaseForm /> : evm && <EvmDisputeForm key={evm.source} cfg={evm} />}
    </div>
  );
}
