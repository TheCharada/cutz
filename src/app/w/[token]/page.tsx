import { notFound } from "next/navigation";
import { CapabilityDetails } from "@/components/cutz/capability-details";
import { PageHeader } from "@/components/cutz/page-header";
import { PageShell } from "@/components/cutz/page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getWaitlistEntryCapability } from "@/workflows/waitlist-capability";
import { WaitlistManagement } from "./waitlist-management";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

function waitlistStatus(status: "ACTIVE" | "FULFILLED" | "CANCELLED" | "EXPIRED"): {
  heading: string;
  badge: string;
  variant: BadgeVariant;
} {
  if (status === "ACTIVE") {
    return { heading: "Você está na lista de espera", badge: "Ativa", variant: "success" };
  }
  if (status === "FULFILLED") {
    return { heading: "Esta entrada já gerou um agendamento", badge: "Atendida", variant: "success" };
  }
  if (status === "CANCELLED") {
    return { heading: "Entrada cancelada", badge: "Cancelada", variant: "destructive" };
  }
  return { heading: "Entrada expirada", badge: "Expirada", variant: "neutral" };
}

export default async function WaitlistPage({ params }: PageProps) {
  const { token } = await params;
  const result = await getWaitlistEntryCapability(token);
  if (result.status === "not-found") notFound();

  const status = waitlistStatus(result.entry.status);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Cutz"
        title="Gerenciar lista de espera"
        description="Acompanhe sua entrada e saia da fila quando não quiser mais receber uma vaga liberada."
      />

      <div className="mt-8 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>{status.heading}</CardTitle>
              <Badge variant={status.variant}>{status.badge}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <CapabilityDetails
              items={[
                { label: "Cliente", value: result.customer.name },
                { label: "Serviço", value: result.service.name },
                {
                  label: "Profissional",
                  value: result.staff?.name ?? "Qualquer profissional compatível",
                },
                { label: "Data", value: result.entry.desiredDate },
                {
                  label: "Janela",
                  value: `${result.entry.earliestTime.slice(0, 5)} – ${result.entry.latestTime.slice(0, 5)}`,
                },
              ]}
            />

            {result.pendingOffer ? (
              <Alert variant="warning" role="status">
                <AlertTitle>Há uma vaga reservada para você</AlertTitle>
                <AlertDescription>
                  Use o link da oferta enviado a você para aceitar ou rejeitar antes do prazo.
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        {result.entry.status === "ACTIVE" ? <WaitlistManagement token={token} /> : null}
      </div>
    </PageShell>
  );
}
