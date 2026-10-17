import { notFound } from "next/navigation";
import { CapabilityDetails } from "@/components/cutz/capability-details";
import { PageHeader } from "@/components/cutz/page-header";
import { PageShell } from "@/components/cutz/page-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppointmentCapability } from "@/workflows/appointment-capability";
import { listPublicStaffForBarbershop } from "@/workflows/public-catalog";
import { AppointmentManagement } from "./appointment-management";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ token: string }>;
};

function formatDateTime(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: timezone,
  }).format(value);
}

function appointmentStatus(appointment: {
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  cancellationKind: "CANCELLATION" | "RESCHEDULED" | null;
}): { heading: string; badge: string; variant: BadgeVariant } {
  if (appointment.status === "CANCELLED" && appointment.cancellationKind === "RESCHEDULED") {
    return { heading: "Agendamento reagendado", badge: "Reagendado", variant: "neutral" };
  }
  if (appointment.status === "CANCELLED") {
    return { heading: "Agendamento cancelado", badge: "Cancelado", variant: "destructive" };
  }
  if (appointment.status === "COMPLETED") {
    return { heading: "Atendimento concluído", badge: "Concluído", variant: "success" };
  }
  if (appointment.status === "NO_SHOW") {
    return { heading: "Atendimento marcado como ausência", badge: "Ausência", variant: "warning" };
  }
  return { heading: "Agendamento confirmado", badge: "Agendado", variant: "success" };
}

export default async function AppointmentCapabilityPage({ params }: PageProps) {
  const { token } = await params;
  const result = await getAppointmentCapability(token);
  if (result.status === "not-found") {
    notFound();
  }

  const staff = await listPublicStaffForBarbershop(result.barbershop.slug);
  if (!staff) {
    notFound();
  }

  const status = appointmentStatus(result.appointment);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Cutz"
        title="Gerenciar agendamento"
        description="Consulte seu horário, cancele o atendimento ou escolha uma nova data sem criar uma conta."
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
                { label: "Profissional", value: result.staff.name },
                {
                  label: "Horário",
                  value: formatDateTime(result.appointment.startsAt, result.barbershop.timezone),
                },
              ]}
            />
            {result.appointment.cancellationReason ? (
              <Alert>
                <AlertDescription>
                  Motivo informado: {result.appointment.cancellationReason}
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        {result.appointment.status === "SCHEDULED" ? (
          <AppointmentManagement
            token={token}
            timezone={result.barbershop.timezone}
            currentStaffId={result.staff.id}
            staff={staff}
          />
        ) : null}
      </div>
    </PageShell>
  );
}
