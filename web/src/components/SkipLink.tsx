export const MAIN_ID = "main";

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_ID}`}
      className="fixed top-3 left-3 z-50 inline-flex min-h-11 -translate-y-[calc(100%+1rem)] items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-transform duration-150 outline-none focus:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze motion-reduce:transition-none"
    >
      Skip to content
    </a>
  );
}
