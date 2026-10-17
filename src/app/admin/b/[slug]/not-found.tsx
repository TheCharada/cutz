import Link from "next/link";
import { PageShell } from "@/components/cutz/page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function AdminNotFound() {
  return (
    <PageShell size="md">
      <div className="flex min-h-[50vh] items-center">
        <Alert className="w-full" role="alert">
          <AlertTitle className="text-lg">Página administrativa não encontrada</AlertTitle>
          <AlertDescription>
            O recurso solicitado não existe ou não está disponível para este acesso.
          </AlertDescription>
          <div className="mt-4">
            <Link
              className="inline-flex h-10 items-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/35"
              href="/admin/login"
            >
              Voltar ao acesso administrativo
            </Link>
          </div>
        </Alert>
      </div>
    </PageShell>
  );
}
