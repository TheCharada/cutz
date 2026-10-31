"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppointmentServicesPanel } from "./appointment-services-panel";

type Appointment = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  customer: { id: string; name: string; phoneE164: string };
  service: { id: string; name: string; durationMinutes: number };
  staff: { id: string; name: string };
};
type Customer = { id: string; name: string; phoneE164: string };
type PublicService = { id: string; name: string; durationMinutes: number };
type PublicStaff = { id: string; name: string };
type Slot = { staffId: string; startsAt: string; endsAt: string };
type ApiError = { error?: { message?: string } };

const appointmentStatuses: Record<Appointment["status"], { label: string; variant: BadgeVariant }> = {
  SCHEDULED: { label: "Agendado", variant: "neutral" },
  COMPLETED: { label: "Concluído", variant: "success" },
  CANCELLED: { label: "Cancelado", variant: "destructive" },
  NO_SHOW: { label: "No-show", variant: "warning" },
};

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function dateTimeLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function appointmentStatus(status: Appointment["status"]) {
  return appointmentStatuses[status];
}

export function AdminAgenda({
  slug,
  initialDate,
  timezone,
  appointments,
}: {
  slug: string;
  initialDate: string;
  timezone: string;
  appointments: Appointment[];
}) {
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();
  const [date, setDate] = useState(initialDate);
  const [error, setError] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [openServicesId, setOpenServicesId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<PublicService[]>([]);
  const [staff, setStaff] = useState<PublicStaff[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [createDate, setCreateDate] = useState(initialDate);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  function redirectExpired(response: Response) {
    if (response.status !== 401) return false;
    router.replace("/admin/login");
    router.refresh();
    return true;
  }

  function navigateToDate(targetDate: string) {
    setError(null);
    startTransition(() => {
      router.push(`/admin/b/${slug}/agenda?date=${encodeURIComponent(targetDate)}`);
    });
  }

  async function mutateAppointment(appointmentId: string, action: "complete" | "no-show" | "cancel") {
    setMutatingId(appointmentId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/b/${slug}/appointments/${appointmentId}/${action}`, {
        method: "POST",
      });
      if (redirectExpired(response)) return;
      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível atualizar o agendamento."));
      }
      startTransition(() => router.refresh());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o agendamento.");
    } finally {
      setMutatingId(null);
    }
  }

  async function openCreate() {
    setShowCreate(true);
    setCreateLoading(true);
    setError(null);
    try {
      const [customersResponse, servicesResponse, staffResponse] = await Promise.all([
        fetch(`/api/admin/b/${slug}/customers?page=1&pageSize=100`, { cache: "no-store" }),
        fetch(`/api/b/${slug}/services`, { cache: "no-store" }),
        fetch(`/api/b/${slug}/staff`, { cache: "no-store" }),
      ]);
      if (redirectExpired(customersResponse)) return;
      if (!customersResponse.ok || !servicesResponse.ok || !staffResponse.ok) {
        throw new Error("Não foi possível carregar os dados do novo agendamento.");
      }
      const customerBody = (await customersResponse.json()) as { customers: Customer[] };
      const servicesBody = (await servicesResponse.json()) as { services: PublicService[] };
      const staffBody = (await staffResponse.json()) as { staff: PublicStaff[] };
      setCustomers(customerBody.customers);
      setServices(servicesBody.services);
      setStaff(staffBody.staff);
      setCustomerId(customerBody.customers[0]?.id ?? "");
      setServiceId(servicesBody.services[0]?.id ?? "");
      setStaffId(staffBody.staff[0]?.id ?? "");
      setCreateDate(date);
      setSlots([]);
      setSelectedSlot("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível preparar o novo agendamento.");
    } finally {
      setCreateLoading(false);
    }
  }

  async function loadCreateSlots() {
    if (!serviceId || !staffId || !createDate) return;
    setCreateLoading(true);
    setError(null);
    setSelectedSlot("");
    try {
      const query = new URLSearchParams({ serviceId, staffId, date: createDate });
      const response = await fetch(`/api/b/${slug}/availability?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível consultar horários."));
      }
      const body = (await response.json()) as { slots: Slot[] };
      setSlots(body.slots);
    } catch (reason) {
      setSlots([]);
      setError(reason instanceof Error ? reason.message : "Não foi possível consultar horários.");
    } finally {
      setCreateLoading(false);
    }
  }

  async function createAppointment() {
    if (!customerId || !serviceId || !staffId || !selectedSlot) return;
    setCreateLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/b/${slug}/appointments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId, serviceId, staffId, startsAt: selectedSlot }),
      });
      if (redirectExpired(response)) return;
      if (!response.ok) {
        throw new Error(await responseMessage(response, "Não foi possível criar o agendamento."));
      }
      setShowCreate(false);
      if (createDate !== initialDate) {
        navigateToDate(createDate);
      } else {
        startTransition(() => router.refresh());
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o agendamento.");
    } finally {
      setCreateLoading(false);
    }
  }

  return (
    <div aria-busy={isNavigating}>
      <Card>
        <CardContent className="pt-5 sm:pt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full max-w-xs space-y-2">
              <Label htmlFor="agenda-date">Data da agenda</Label>
              <Input
                id="agenda-date"
                type="date"
                value={date}
                disabled={isNavigating}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isNavigating || !date}
                onClick={() => navigateToDate(date)}
              >
                {isNavigating ? "Atualizando…" : "Atualizar"}
              </Button>
              <Button type="button" disabled={isNavigating} onClick={openCreate}>
                Novo agendamento
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Alert className="mt-4" variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {showCreate ? (
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-lg font-semibold text-foreground">Novo agendamento</h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                Fechar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {createLoading && customers.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="status">Carregando dados…</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="create-customer">Cliente</Label>
                  <select
                    id="create-customer"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                    value={customerId}
                    onChange={(event) => setCustomerId(event.target.value)}
                  >
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>{customer.name} · {customer.phoneE164}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-service">Serviço</Label>
                  <select
                    id="create-service"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                    value={serviceId}
                    onChange={(event) => {
                      setServiceId(event.target.value);
                      setSlots([]);
                      setSelectedSlot("");
                    }}
                  >
                    {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-staff">Profissional</Label>
                  <select
                    id="create-staff"
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                    value={staffId}
                    onChange={(event) => {
                      setStaffId(event.target.value);
                      setSlots([]);
                      setSelectedSlot("");
                    }}
                  >
                    {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-date">Data</Label>
                  <Input
                    id="create-date"
                    type="date"
                    value={createDate}
                    onChange={(event) => {
                      setCreateDate(event.target.value);
                      setSlots([]);
                      setSelectedSlot("");
                    }}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="button" variant="outline" disabled={createLoading} onClick={loadCreateSlots}>
                    {createLoading ? "Buscando…" : "Buscar horários"}
                  </Button>
                  {slots.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2" aria-label="Horários disponíveis">
                      {slots.map((slot) => (
                        <button
                          key={slot.startsAt}
                          type="button"
                          aria-pressed={selectedSlot === slot.startsAt}
                          className={`rounded-xl border px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/35 ${
                            selectedSlot === slot.startsAt
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card text-foreground hover:bg-accent"
                          }`}
                          onClick={() => setSelectedSlot(slot.startsAt)}
                        >
                          {dateTimeLabel(slot.startsAt, timezone)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {!createLoading && createDate && slots.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">Busque os horários disponíveis para continuar.</p>
                  ) : null}
                </div>
                <div className="sm:col-span-2">
                  <Button type="button" disabled={createLoading || !selectedSlot || !customerId} onClick={createAppointment}>
                    Criar agendamento
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <section className="mt-6" aria-live="polite">
        {appointments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <h3 className="font-semibold text-foreground">Nenhum agendamento</h3>
            <p className="mt-1 text-sm text-muted-foreground">Não há atendimentos nesta data.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {appointments.map((appointment) => {
              const scheduled = appointment.status === "SCHEDULED";
              const busy = mutatingId === appointment.id;
              const status = appointmentStatus(appointment.status);
              return (
                <article key={appointment.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">{dateTimeLabel(appointment.startsAt, timezone)}</p>
                      <h3 className="mt-1 text-lg font-semibold text-foreground">{appointment.customer.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{appointment.service.name} · {appointment.staff.name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{appointment.customer.phoneE164}</p>
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  {scheduled ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="button" size="sm" disabled={busy} onClick={() => mutateAppointment(appointment.id, "complete")}>
                        Concluir
                      </Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => mutateAppointment(appointment.id, "no-show")}>
                        No-show
                      </Button>
                      <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => mutateAppointment(appointment.id, "cancel")}>
                        Cancelar
                      </Button>
                    </div>
                  ) : null}
                  <div className="mt-4">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setOpenServicesId((current) =>
                        current === appointment.id ? null : appointment.id)}
                      aria-expanded={openServicesId === appointment.id}
                    >
                      {openServicesId === appointment.id ? "Ocultar serviços" : "Ver atendimento"}
                    </Button>
                  </div>
                  {openServicesId === appointment.id ? (
                    <AppointmentServicesPanel
                      slug={slug}
                      appointmentId={appointment.id}
                      timezone={timezone}
                      onClose={() => setOpenServicesId(null)}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
