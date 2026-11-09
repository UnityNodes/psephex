import { Cpu, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { ModelView } from "../api.js";
import { CopyButton } from "../components/Commands.js";
import { Badge } from "../components/ui/badge.js";
import { attestationUrl } from "../deployment.js";
import { useModels, usePageTitle } from "../hooks.js";

const PROVIDER: Readonly<Record<string, string>> = { "near-ai": "NEAR AI Cloud", phala: "Phala" };

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ModelEntry({ m }: { m: ModelView }) {
  const [nonce, setNonce] = useState<string | null>(null);
  const attestation = m.attestation;
  const link = attestation ? attestationUrl(attestation.url) : null;
  const vendor = m.model.includes("/") ? m.model.split("/")[0] : null;
  return (
    <li className="flex min-w-0 flex-col gap-5 rounded-2xl border border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-raised text-bronze-text">
          <Cpu className="size-5" aria-hidden="true" />
        </span>
        <Badge variant="outline" className="border-line text-muted">
          {PROVIDER[m.provider] ?? m.provider}
        </Badge>
      </div>
      <div className="flex flex-col gap-1">
        {vendor && <p className="m-0 text-xs text-muted">{vendor}</p>}
        <h2 className="m-0 font-display text-xl leading-tight font-bold break-words">{m.model}</h2>
        <p className="m-0 text-sm text-muted">
          Signature scheme <code className="font-mono text-xs text-ink">{m.scheme}</code>
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="m-0 flex items-center gap-2 text-xs font-medium text-muted">
          <KeyRound className="size-3.5" aria-hidden="true" />
          Public key registered on NEAR
        </p>
        <div className="flex items-start gap-2 rounded-lg border border-vault-line bg-vault p-2 text-vault-ink">
          <code className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed break-all">{m.publicKey}</code>
          <CopyButton text={m.publicKey} />
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-2 text-sm">
        {!link && <p className="m-0 text-sm text-muted">No attestation link is published for this provider.</p>}
        {attestation && link && (
          <>
            <a
              href={`${link}${nonce ?? ""}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setNonce(nonce ?? randomNonce())}
              onFocus={() => setNonce((n) => n ?? randomNonce())}
              onMouseEnter={() => setNonce((n) => n ?? randomNonce())}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line px-4 font-medium transition-colors duration-150 hover:border-bronze hover:text-bronze-text"
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
              Fetch a fresh TEE attestation
            </a>
            <span className="text-xs text-muted">{attestation.howTo}</span>
            {nonce && <code className="font-mono text-[11px] break-all text-muted">nonce {nonce}</code>}
          </>
        )}
      </div>
    </li>
  );
}

export function ModelsPage() {
  usePageTitle("The three models - Psephex");
  const models = useModels();
  return (
    <article className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="m-0 font-display text-4xl font-extrabold sm:text-5xl">The three models</h1>
        <p className="m-0 max-w-[68ch] text-muted">
          Two models run on NEAR AI Cloud and sign with a key that never leaves their enclave. Gemma runs on Phala, where an attested Dstack gateway signs for the model it routes to. The NEAR contract only accepts answers signed by these registered keys.
        </p>
      </header>
      {models.isError && <p className="text-no">The Psephex API did not answer. Reload the page in a moment.</p>}
      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
        {models.data?.map((m) => (
          <ModelEntry key={m.model} m={m} />
        ))}
      </ul>
    </article>
  );
}
