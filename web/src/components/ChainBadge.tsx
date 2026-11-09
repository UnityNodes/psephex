import { SOURCE_NAME, SOURCE_SHORT, type Source } from "../sources.js";

const DOT: Readonly<Record<Source, string>> = { near: "bg-bronze", base: "bg-ink", arbitrum: "bg-muted" };

export function ChainBadge({ source, decorative = false }: { source: Source; decorative?: boolean }) {
  return (
    <span aria-hidden={decorative || undefined} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink" title={SOURCE_NAME[source]}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[source]}`} />
      <span aria-hidden="true">{SOURCE_SHORT[source]}</span>
      {!decorative && <span className="sr-only">{SOURCE_NAME[source]}</span>}
    </span>
  );
}
