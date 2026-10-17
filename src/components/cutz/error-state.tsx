import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageShell, type PageShellSize } from "./page-shell";

export function ErrorState({
  title,
  description,
  action,
  size = "md",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  size?: PageShellSize;
}) {
  return (
    <PageShell size={size}>
      <div className="flex min-h-[50vh] items-center">
        <Alert variant="destructive" role="alert" className="w-full">
          <AlertTitle className="text-lg">{title}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
          {action ? <div className="mt-4 flex flex-wrap gap-2">{action}</div> : null}
        </Alert>
      </div>
    </PageShell>
  );
}
