import { useState } from "react";
import type { ModelView } from "../api.js";
import { attestationUrl } from "../deployment.js";
import { useModels, usePageTitle } from "../hooks.js";

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ModelEntry({ m }: { m: ModelView }) {
  const [nonce, setNonce] = useState<string | null>(null);
  const attestation = m.attestation;
  const link = attestation ? attestationUrl(attestation.url) : null;
  return (
    <li className="flex flex-col gap-2 border-b border-line py-5">
      <h2 className="m-0 font-display text-xl font-semibold break-words">{m.model}</h2>
      <p className="m-0 text-sm text-muted">
        Provider {m.provider}, signature scheme {m.scheme}
      </p>
      <p className="m-0 text-sm">
        Public key registered on NEAR: <code className="font-mono text-xs break-all">{m.publicKey}</code>
      </p>
      {!link && <p className="m-0 text-sm text-muted">No attestation link is published for this provider.</p>}
      {attestation && link && (
        <div className="flex flex-col gap-1 text-sm">
          <a
            href={`${link}${nonce ?? ""}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setNonce(nonce ?? randomNonce())}
            onFocus={() => setNonce((n) => n ?? randomNonce())}
            onMouseEnter={() => setNonce((n) => n ?? randomNonce())}
            className="self-start underline underline-offset-2 hover:text-bronze"
          >
            Fetch a fresh TEE attestation
          </a>
          <span className="text-xs text-muted">{attestation.howTo}</span>
          {nonce && <code className="font-mono text-xs break-all text-muted">nonce {nonce}</code>}
        </div>
      )}
    </li>
  );
}

export function ModelsPage() {
  usePageTitle("The three models - Psephex");
  const models = useModels();
  return (
    <article className="flex max-w-3xl flex-col gap-4">
      <h1 className="m-0 font-display text-4xl font-semibold">The three models</h1>
      <p className="m-0 max-w-[65ch] text-muted">
        Two models run on NEAR AI Cloud and sign with a key that never leaves their enclave. Gemma runs on Phala, where an attested Dstack gateway signs for the model it routes to. The NEAR contract only accepts answers signed by these registered keys.
      </p>
      {models.isError && <p className="text-no">The Psephex API did not answer. Reload the page in a moment.</p>}
      <ul className="m-0 list-none p-0">
        {models.data?.map((m) => (
          <ModelEntry key={m.model} m={m} />
        ))}
      </ul>
    </article>
  );
}
