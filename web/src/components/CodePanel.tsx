import { CopyButton } from "./Commands.js";

interface CodePanelProps {
  readonly name: string;
  readonly code: string;
  readonly wrap?: boolean;
  readonly tall?: boolean;
}

export function CodePanel({ name, code, wrap = false, tall = false }: CodePanelProps) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-vault-line bg-vault text-vault-ink">
      <div className="flex items-center justify-between gap-2 border-b border-vault-line px-4 py-3">
        <span className="font-mono text-xs text-bronze-hi">{name}</span>
        <CopyButton text={code} />
      </div>
      <pre tabIndex={0} className={`m-0 overflow-auto p-4 font-mono text-xs leading-relaxed focus-visible:outline-2 focus-visible:outline-bronze ${tall ? "max-h-[30rem]" : ""} ${wrap ? "break-all whitespace-pre-wrap" : ""}`}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
