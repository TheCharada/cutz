import { notFound } from "next/navigation";
import { CapabilityDetails } from "@/components/cutz/capability-details";
import { PageHeader } from "@/components/cutz/page-header";
import { PageShell } from "@/components/cutz/page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getWaitlistOfferCapability } from "@/workflows/waitlist-capability";
import { OfferActions } from "./offer-actions";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

function formatDateTime(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: timezone,
  }).format(value);
}

function offerStatus(
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED",
  expiredByTime: boolean,
): { heading: string; badge: string; variant: BadgeVariant } {
  if (status === "PENDING" && !expiredByTime) {
    return { heading: "Uma vaga foi reservada para você", badge: "Responder agora", variant: "warning" };
  }
  if (status === "ACCEPTED") {
    return { heading: "Oferta aceita", badge: "Aceita", variant: "success" };
  }
  if (status === "REJECTED") {
    return { heading: "Oferta rejeitada", badge: "Rejeitada", variant: "neutral" };
  }
  if (status === "PENDING") {
    return { heading: "Prazo de resposta encerrado", badge: "Em processamento", variant: "warning" };
  }
  return { heading: "Oferta expirada", badge: "Expirada", variant: "neutral" };
}

export default async function WaitlistOfferPage({ params }: PageProps) {
  const { token } = await params;
  const result = await getWaitlistOfferCapability(token);
  if (result.status === "not-found") notFound();

  const expiredByTime = result.offer.status === "PENDING" && result.offer.expiresAt <= new Date();
  const status = offerStatus(result.offer.status, expiredByTime);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Cutz"
        title="Oferta da lista de espera"
        description="Este horário está reservado temporariamente para você. Aceite para criar o agendamento ou rejeite para liberar a vaga."
      />

      <div className="mt-8 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>{status.heading}</CardTitle>
              <Badge variant={status.variant}>{status.badge}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <CapabilityDetails
              items={[
                { label: "Cliente", value: result.customer.name },
                { label: "Serviço", value: result.service.name },
                { label: "Profissional", value: result.staff.name },
                {
                  label: "Horário",
                  value: formatDateTime(result.offer.startsAt, result.barbershop.timezone),
                },
                {
                  label: "Responder até",
                  value: formatDateTime(result.offer.expiresAt, result.barbershop.timezone),
                },
              ]}
            />
          </CardContent>
        </Card>

        {expiredByTime ? (
          <Alert variant="warning" role="status">
            <AlertTitle>O prazo de aceite terminou</AlertTitle>
            <AlertDescription>
              A vaga continua reservada até o worker processar a expiração e consultar o próximo candidato.
            </AlertDescription>
          </Alert>
        ) : null}

        {result.offer.status === "PENDING" && !expiredByTime ? (
          <OfferActions token={token} expiresAt={result.offer.expiresAt.toISOString()} />
        ) : null}
      </div>
    </PageShell>
  );
}
