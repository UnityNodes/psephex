import { Plus } from "lucide-react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "../components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog.js";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../components/ui/sheet.js";
import { usePageTitle } from "../hooks.js";
import { isSource, SOURCE_NAME, type Source } from "../sources.js";
import { DisputeForm } from "../pages/DisputeForm.js";
import { AgentLookup } from "../pages/AgentLookup.js";
import { CasePage } from "../pages/CasePage.js";
import { RecentCases } from "../pages/RecentCases.js";
import { RecentRequests } from "../pages/RecentRequests.js";
import { RequestPage } from "../pages/RequestPage.js";
import { OVERVIEW_TITLE, requestName } from "../lib/status.js";
import { MetricsStrip } from "./MetricsStrip.js";

type Overlay = "none" | "new" | "detail" | "case";

const OVERVIEW_DESCRIPTION = "Live court cases between agents on NEAR testnet and every oracle request on NEAR, Base Sepolia and Arbitrum Sepolia, with the votes of three TEE models.";

/**
 * NEAR wallets such as HOT, HERE, Intear and NEAR Mobile draw their sign-in screen as an overlay
 * on the page. A modal Radix dialog turns off pointer events and traps focus outside itself, so
 * those overlays showed up but could not be clicked or typed into. The new case dialog and the
 * detail sheets are therefore non-modal, with their own backdrop and Escape and close button.
 */
function Backdrop({ onClose }: { onClose: () => void }) {
  return createPortal(<div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-black/50 animate-in fade-in-0" />, document.body);
}

const keepOpenOnOutsideClick = (event: Event) => event.preventDefault();

function NewCaseDialog() {
  const navigate = useNavigate();
  const close = () => navigate("/app");
  return (
    <Dialog open modal={false} onOpenChange={(open) => !open && close()}>
      <Backdrop onClose={close} />
      <DialogContent onInteractOutside={keepOpenOnOutsideClick} className="max-h-[92dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto border-line bg-paper sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">Open a case</DialogTitle>
          <DialogDescription>On NEAR testnet you open a court case: the other side answers with its own evidence, three TEE models decide, and either side can appeal to a human arbiter. On an EVM testnet you open a one-sided dispute in test ETH.</DialogDescription>
        </DialogHeader>
        <DisputeForm />
      </DialogContent>
    </Dialog>
  );
}

function DetailSheet() {
  const navigate = useNavigate();
  const params = useParams();
  const id = params.id ?? "";
  const source: Source | null = params.source && isSource(params.source) ? params.source : null;
  const path = source === null ? "the chains and NEAR" : source === "near" ? SOURCE_NAME.near : `${SOURCE_NAME[source]} and NEAR`;
  return (
    <Sheet open modal={false} onOpenChange={(open) => !open && navigate("/app")}>
      <Backdrop onClose={() => navigate("/app")} />
      <SheetContent side="right" onInteractOutside={keepOpenOnOutsideClick} className="w-full overflow-y-auto border-line bg-stone p-6 sm:max-w-3xl sm:p-8">
        <SheetTitle className="sr-only">{source === null ? `Request #${id}` : requestName(source, id)}</SheetTitle>
        <SheetDescription className="sr-only">{`Votes, the path through ${path}, and commands to check it yourself`}</SheetDescription>
        <RequestPage />
      </SheetContent>
    </Sheet>
  );
}

function CaseSheet() {
  const navigate = useNavigate();
  const id = useParams().id ?? "";
  return (
    <Sheet open modal={false} onOpenChange={(open) => !open && navigate("/app")}>
      <Backdrop onClose={() => navigate("/app")} />
      <SheetContent side="right" onInteractOutside={keepOpenOnOutsideClick} className="w-full overflow-y-auto border-line bg-stone p-6 sm:max-w-3xl sm:p-8">
        <SheetTitle className="sr-only">{`Case #${id}`}</SheetTitle>
        <SheetDescription className="sr-only">Both sides' evidence, the stages of the case and what you can do now</SheetDescription>
        <CasePage />
      </SheetContent>
    </Sheet>
  );
}

export function Overview({ overlay = "none" }: { overlay?: Overlay }) {
  usePageTitle(overlay === "new" ? "Open a case - Psephex" : overlay === "none" ? `${OVERVIEW_TITLE} - Psephex` : null, OVERVIEW_DESCRIPTION);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-display text-4xl font-extrabold sm:text-5xl">{OVERVIEW_TITLE}</h1>
          <p className="m-0 max-w-[62ch] text-muted">Court cases between agents on NEAR testnet, and every question the oracle answered on NEAR, Base Sepolia and Arbitrum Sepolia. Three TEE models answer, NEAR checks two of three, and EVM chains get the verdict through NEAR Chain Signatures.</p>
        </div>
        <Button asChild size="lg">
          <Link to="/app/new">
            <Plus aria-hidden="true" />
            New case
          </Link>
        </Button>
      </header>
      <MetricsStrip />
      <AgentLookup />
      <RecentCases />
      <RecentRequests />
      {overlay === "new" && <NewCaseDialog />}
      {overlay === "detail" && <DetailSheet />}
      {overlay === "case" && <CaseSheet />}
    </div>
  );
}
