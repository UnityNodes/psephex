import { Plus } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "../components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog.js";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../components/ui/sheet.js";
import { usePageTitle } from "../hooks.js";
import { isSource, SOURCE_NAME } from "../sources.js";
import { DisputeForm } from "../pages/DisputeForm.js";
import { RecentDisputes } from "../pages/RecentDisputes.js";
import { RequestPage } from "../pages/RequestPage.js";
import { MetricsStrip } from "./MetricsStrip.js";

type Overlay = "none" | "new" | "detail";

function NewDisputeDialog() {
  const navigate = useNavigate();
  return (
    <Dialog open onOpenChange={(open) => !open && navigate("/app")}>
      <DialogContent className="max-h-[92dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto border-line bg-paper sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-bold">Open a dispute</DialogTitle>
          <DialogDescription>Stake test NEAR on NEAR testnet, or test ETH on an EVM testnet. Three models answer, NEAR checks that two agree, and the dispute contract pays out.</DialogDescription>
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
  const source = params.source && isSource(params.source) ? SOURCE_NAME[params.source] : "";
  return (
    <Sheet open onOpenChange={(open) => !open && navigate("/app")}>
      <SheetContent side="right" className="w-full overflow-y-auto border-line bg-stone p-6 sm:max-w-3xl sm:p-8">
        <SheetTitle className="sr-only">{`Dispute #${id}`}</SheetTitle>
        <SheetDescription className="sr-only">{`Votes, the path through ${source || "the chains"} and NEAR, and commands to check it yourself`}</SheetDescription>
        <RequestPage />
      </SheetContent>
    </Sheet>
  );
}

export function Overview({ overlay = "none" }: { overlay?: Overlay }) {
  usePageTitle(overlay === "new" ? "Open a dispute - Psephex" : "Disputes - Psephex");
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-display text-4xl font-extrabold sm:text-5xl">Disputes</h1>
          <p className="m-0 max-w-[62ch] text-muted">Every yes-or-no dispute on NEAR testnet, Base Sepolia and Arbitrum Sepolia, answered by three TEE models and checked two of three on NEAR. NEAR disputes settle in NEAR; EVM disputes get the verdict through NEAR Chain Signatures.</p>
        </div>
        <Button asChild size="lg">
          <Link to="/app/new">
            <Plus aria-hidden="true" />
            New dispute
          </Link>
        </Button>
      </header>
      <MetricsStrip />
      <RecentDisputes />
      {overlay === "new" && <NewDisputeDialog />}
      {overlay === "detail" && <DetailSheet />}
    </div>
  );
}
