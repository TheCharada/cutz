import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell, type PageShellSize } from "./page-shell";

function LoadingStatus({ children }: { children: string }) {
  return <p className="sr-only" role="status">{children}</p>;
}

function HeaderSkeleton({ actions = false }: { actions?: boolean }) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between" aria-hidden="true">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {actions ? <div className="flex gap-2"><Skeleton className="h-9 w-24" /><Skeleton className="h-9 w-24" /></div> : null}
    </header>
  );
}

function FormCardSkeleton() {
  return (
    <Card aria-hidden="true">
      <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-10 w-full" /></div>
          <div className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-10 w-full" /></div>
        </div>
        <div className="space-y-2"><Skeleton className="h-3 w-28" /><Skeleton className="h-10 w-full" /></div>
        <Skeleton className="h-10 w-40" />
      </CardContent>
    </Card>
  );
}

export function PublicBookingSkeleton() {
  return (
    <PageShell size="md" aria-busy="true">
      <LoadingStatus>Carregando agenda…</LoadingStatus>
      <div className="space-y-8">
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-9 w-52" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-4 w-4/5 max-w-lg" />
        </div>
        <FormCardSkeleton />
        <FormCardSkeleton />
      </div>
    </PageShell>
  );
}

export function CapabilityPageSkeleton({ label }: { label: string }) {
  return (
    <PageShell size="md" aria-busy="true">
      <LoadingStatus>{label}</LoadingStatus>
      <div className="space-y-6">
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-9 w-64 max-w-full" />
        </div>
        <Card aria-hidden="true">
          <CardHeader><Skeleton className="h-6 w-56 max-w-full" /></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => <div className="space-y-2" key={index}><Skeleton className="h-3 w-20" /><Skeleton className="h-5 w-36 max-w-full" /></div>)}
          </CardContent>
        </Card>
        <Card aria-hidden="true"><CardContent className="flex gap-3 pt-5 sm:pt-6"><Skeleton className="h-10 w-36" /><Skeleton className="h-10 w-28" /></CardContent></Card>
      </div>
    </PageShell>
  );
}

export function AdminPageSkeleton({
  label,
  size = "xl",
  kind = "list",
}: {
  label: string;
  size?: PageShellSize;
  kind?: "list" | "form" | "analytics";
}) {
  return (
    <PageShell size={size} aria-busy="true">
      <LoadingStatus>{label}</LoadingStatus>
      <div className="space-y-6">
        <HeaderSkeleton actions />
        {kind === "form" ? <FormCardSkeleton /> : null}
        {kind === "list" ? (
          <>
            <Card aria-hidden="true"><CardContent className="grid gap-3 pt-5 sm:grid-cols-3 sm:pt-6"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-32" /></CardContent></Card>
            <div className="grid gap-4 lg:grid-cols-2" aria-hidden="true">
              <Card><CardContent className="space-y-3 pt-5 sm:pt-6">{Array.from({ length: 4 }, (_, index) => <Skeleton className="h-16 w-full" key={index} />)}</CardContent></Card>
              <FormCardSkeleton />
            </div>
          </>
        ) : null}
        {kind === "analytics" ? (
          <>
            <Card aria-hidden="true"><CardContent className="grid gap-3 pt-5 sm:grid-cols-[1fr_1fr_auto] sm:pt-6"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-28" /></CardContent></Card>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <Card key={index}><CardContent className="space-y-3 pt-5 sm:pt-6"><Skeleton className="h-4 w-24" /><Skeleton className="h-9 w-20" /></CardContent></Card>)}</div>
            <div className="grid gap-6 lg:grid-cols-2" aria-hidden="true"><FormCardSkeleton /><FormCardSkeleton /></div>
          </>
        ) : null}
      </div>
    </PageShell>
  );
}

export function AdminLoginSkeleton() {
  return (
    <PageShell size="sm" className="flex items-center" aria-busy="true">
      <LoadingStatus>Carregando acesso administrativo…</LoadingStatus>
      <Card className="w-full" aria-hidden="true">
        <CardHeader className="space-y-3"><Skeleton className="h-3 w-16" /><Skeleton className="h-8 w-64 max-w-full" /><Skeleton className="h-4 w-full" /></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><Skeleton className="h-3 w-16" /><Skeleton className="h-10 w-full" /></div>
          <div className="space-y-2"><Skeleton className="h-3 w-16" /><Skeleton className="h-10 w-full" /></div>
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    </PageShell>
  );
}
