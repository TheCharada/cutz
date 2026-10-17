"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PublicStaffMember } from "@/modules/catalog";
import type { PublicAvailabilitySlot } from "@/modules/scheduling";

type ApiError = { error?: { message?: string } };

function formatTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(iso));
}

export function AppointmentManagement({
  token,
  timezone,
  currentStaffId,
  staff,
}: {
  token: string;
  timezone: string;
  currentStaffId: string;
  staff: PublicStaffMember[];
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const initialStaffId = staff.some((member) => member.id === currentStaffId)
    ? currentStaffId
    : (staff[0]?.id ?? "");
  const [staffId, setStaffId] = useState(initialStaffId);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<PublicAvailabilitySlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PublicAvailabilitySlot | null>(null);
  const [searched, setSearched] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function readError(response: Response, fallback: string) {
    try {
      const body = (await response.json()) as ApiError;
      return body.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  function invalidateSlots() {
    setSlots([]);
    setSelectedSlot(null);
    setSearched(false);
    setError(null);
  }

  async function cancelAppointment() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/capabilities/appointments/${encodeURIComponent(token)}/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível cancelar o agendamento."));
      }
      setCancelDialogOpen(false);
      setReason("");
      invalidateSlots();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível cancelar o agendamento.");
    } finally {
      setSubmitting(false);
    }
  }

  async function loadSlots() {
    setError(null);
    setSelectedSlot(null);
    setSearched(true);
    if (!staffId || !date) {
      setSlots([]);
      setError("Selecione profissional e data.");
      return;
    }

    setLoadingSlots(true);
    try {
      const query = new URLSearchParams({ staffId, date });
      const response = await fetch(
        `/api/capabilities/appointments/${encodeURIComponent(token)}/availability?${query.toString()}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível consultar os horários."));
      }
      const body = (await response.json()) as { slots: PublicAvailabilitySlot[] };
      setSlots(body.slots);
    } catch (cause) {
      setSlots([]);
      setError(cause instanceof Error ? cause.message : "Não foi possível consultar os horários.");
    } finally {
      setLoadingSlots(false);
    }
  }

  async function rescheduleAppointment() {
    if (!selectedSlot) {
      setError("Selecione um novo horário.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/capabilities/appointments/${encodeURIComponent(token)}/reschedule`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ staffId, startsAt: selectedSlot.startsAt }),
        },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "O novo horário não está mais disponível."));
      }
      const body = (await response.json()) as { managementUrl: string };
      window.location.assign(body.managementUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível reagendar o atendimento.");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Reagendar</CardTitle>
          <CardDescription>
            O serviço permanece o mesmo. Escolha outro profissional e um horário disponível.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {staff.length === 0 ? (
            <Alert role="status">
              <AlertDescription>
                Não há profissionais disponíveis para reagendamento no momento.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="reschedule-staff">Profissional</Label>
              <select
                id="reschedule-staff"
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70"
                value={staffId}
                disabled={staff.length === 0 || loadingSlots || submitting}
                onChange={(event) => {
                  setStaffId(event.target.value);
                  invalidateSlots();
                }}
              >
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reschedule-date">Nova data</Label>
              <Input
                id="reschedule-date"
                type="date"
                value={date}
                disabled={staff.length === 0 || loadingSlots || submitting}
                onChange={(event) => {
                  setDate(event.target.value);
                  invalidateSlots();
                }}
              />
            </div>
          </div>

          <Button
            type="button"
            disabled={staff.length === 0 || loadingSlots || submitting}
            aria-busy={loadingSlots}
            onClick={loadSlots}
          >
            {loadingSlots ? "Buscando horários…" : "Buscar novos horários"}
          </Button>

          <div aria-live="polite" aria-busy={loadingSlots}>
            {!loadingSlots && searched && slots.length === 0 && !error ? (
              <p className="text-sm text-muted-foreground">Não há horários disponíveis nessa data.</p>
            ) : null}
            {slots.length > 0 ? (
              <fieldset disabled={submitting}>
                <legend className="mb-3 text-sm font-medium text-foreground">Novos horários</legend>
                <div className="flex flex-wrap gap-2">
                  {slots.map((slot) => {
                    const label = formatTime(slot.startsAt, timezone);
                    const selected = selectedSlot?.startsAt === slot.startsAt;
                    return (
                      <button
                        key={`${slot.staffId}:${slot.startsAt}`}
                        type="button"
                        aria-pressed={selected}
                        aria-label={`Selecionar novo horário ${label}`}
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 ${
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-foreground hover:bg-accent"
                        }`}
                        onClick={() => setSelectedSlot(slot)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={staff.length === 0 || submitting || !selectedSlot}
            aria-busy={submitting}
            onClick={rescheduleAppointment}
          >
            {submitting ? "Reagendando…" : "Confirmar reagendamento"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Cancelar agendamento</CardTitle>
          <CardDescription>
            O horário será liberado e poderá ser oferecido a alguém da lista de espera.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cancellation-reason">Motivo (opcional)</Label>
            <textarea
              id="cancellation-reason"
              className="min-h-24 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70"
              maxLength={500}
              value={reason}
              disabled={submitting}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={() => setCancelDialogOpen(true)}
          >
            Cancelar agendamento
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <AlertDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title="Cancelar este agendamento?"
        description="Essa ação não pode ser desfeita. O horário será liberado e poderá seguir para a lista de espera."
        confirmLabel="Confirmar cancelamento"
        busy={submitting}
        onConfirm={cancelAppointment}
      />
    </div>
  );
}
