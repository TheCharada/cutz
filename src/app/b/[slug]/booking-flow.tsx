"use client";

import { useState, type FormEvent } from "react";
import { TelegramLinkCard } from "@/components/cutz/telegram-link-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PublicService, PublicStaffMember } from "@/modules/catalog";
import type { PublicAvailabilitySlot } from "@/modules/scheduling";
import type { RememberedCustomer } from "./customer-session-types";
import { OtpVerification, type PublicOtpChallenge } from "./otp-verification";

type BookingFlowProps = {
  telegramEnabled: boolean;
  slug: string;
  timezone: string;
  services: PublicService[];
  staff: PublicStaffMember[];
  customer: RememberedCustomer | null;
  switchingCustomer: boolean;
  onCustomerSessionReady: (customer: RememberedCustomer) => void;
  onCustomerSessionInvalid: () => void;
  onSwitchCustomer: () => Promise<void>;
};

type ApiError = { error?: { message?: string } };
type SessionStartResponse = {
  verificationRequired?: boolean;
  challengeId?: string;
  expiresAt?: string;
  customer?: RememberedCustomer;
};

const selectClassName =
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70";

function localSlotLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(iso));
}

export function BookingFlow({
  telegramEnabled,
  slug,
  timezone,
  services,
  staff,
  customer,
  switchingCustomer,
  onCustomerSessionReady,
  onCustomerSessionInvalid,
  onSwitchCustomer,
}: BookingFlowProps) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [staffId, setStaffId] = useState(staff[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<PublicAvailabilitySlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PublicAvailabilitySlot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [managementUrl, setManagementUrl] = useState<string | null>(null);
  const [otpChallenge, setOtpChallenge] = useState<PublicOtpChallenge | null>(null);

  function invalidateAvailability() {
    setSlots([]);
    setSelectedSlot(null);
    setSearched(false);
    setError(null);
  }

  async function readError(response: Response, fallback: string) {
    try {
      const body = (await response.json()) as ApiError;
      return body.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function fetchSlots() {
    const query = new URLSearchParams({ serviceId, staffId, date });
    const response = await fetch(`/api/b/${slug}/availability?${query.toString()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await readError(response, "Não foi possível consultar os horários."));
    const body = (await response.json()) as { slots: PublicAvailabilitySlot[] };
    setSlots(body.slots);
  }

  async function loadSlots() {
    setError(null);
    setManagementUrl(null);
    setSelectedSlot(null);
    setSearched(true);

    if (!serviceId || !staffId || !date) {
      setSlots([]);
      setError("Selecione serviço, profissional e data.");
      return;
    }

    setLoadingSlots(true);
    try {
      await fetchSlots();
    } catch (reason) {
      setSlots([]);
      setError(reason instanceof Error ? reason.message : "Não foi possível consultar os horários.");
    } finally {
      setLoadingSlots(false);
    }
  }

  async function refreshSlotsAfterConflict() {
    setSelectedSlot(null);
    setSearched(true);
    setLoadingSlots(true);
    try {
      await fetchSlots();
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }

  async function createAppointment() {
    if (!selectedSlot) throw new Error("Selecione um horário antes de concluir.");
    const appointmentResponse = await fetch(`/api/b/${slug}/appointments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId, staffId, startsAt: selectedSlot.startsAt }),
    });
    if (appointmentResponse.status === 409) {
      await refreshSlotsAfterConflict();
      throw new Error("Esse horário não está mais disponível. Atualizamos os horários para você escolher outro.");
    }
    if (appointmentResponse.status === 401) {
      onCustomerSessionInvalid();
      throw new Error(await readError(appointmentResponse, "Identifique-se novamente para concluir o agendamento."));
    }
    if (!appointmentResponse.ok) {
      throw new Error(await readError(appointmentResponse, "Não foi possível concluir o agendamento."));
    }
    const body = (await appointmentResponse.json()) as { managementUrl: string };
    setManagementUrl(body.managementUrl);
  }

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!selectedSlot) {
      setError("Selecione um horário antes de concluir.");
      return;
    }

    setSubmitting(true);
    try {
      if (!customer) {
        const sessionResponse = await fetch(`/api/b/${slug}/customer-session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, phone }),
        });
        if (!sessionResponse.ok) {
          throw new Error(await readError(sessionResponse, "Não foi possível identificar o cliente."));
        }
        const body = (await sessionResponse.json()) as SessionStartResponse;
        if (sessionResponse.status === 202) {
          if (!body.verificationRequired || !body.challengeId || !body.expiresAt) {
            throw new Error("Não foi possível iniciar a verificação do telefone.");
          }
          setOtpChallenge({ id: body.challengeId, expiresAt: body.expiresAt });
          return;
        }
        if (!body.customer) {
          throw new Error("Não foi possível recuperar os dados da sessão do cliente.");
        }
        onCustomerSessionReady(body.customer);
      }

      await createAppointment();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível concluir o agendamento.");
    } finally {
      setSubmitting(false);
    }
  }

  async function finishOtpBooking(verifiedCustomer: RememberedCustomer) {
    onCustomerSessionReady(verifiedCustomer);
    setOtpChallenge(null);
    setError(null);
    try {
      await createAppointment();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Não foi possível concluir o agendamento.";
      setError(message);
      throw new Error(message);
    }
  }

  if (services.length === 0 || staff.length === 0) {
    return (
      <Alert role="status">
        <AlertTitle>Agenda indisponível</AlertTitle>
        <AlertDescription>Ainda não há serviços e profissionais disponíveis para agendamento.</AlertDescription>
      </Alert>
    );
  }

  if (managementUrl) {
    return (
      <Card className="p-6 sm:p-7" aria-live="polite">
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-success/10 text-xl font-semibold text-success" aria-hidden="true">✓</div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Agendamento confirmado</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Seu horário foi reservado. Guarde o link abaixo para cancelar ou remarcar quando precisar.</p>
          <a
            className="mt-6 inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            href={managementUrl}
          >
            Gerenciar agendamento
          </a>
          {telegramEnabled ? (
            <div className="mt-6 text-left">
              <TelegramLinkCard scope="appointment" managementUrl={managementUrl} />
            </div>
          ) : null}
        </div>
      </Card>
    );
  }

  if (otpChallenge) {
    return (
      <OtpVerification
        slug={slug}
        challenge={otpChallenge}
        onChallengeChange={setOtpChallenge}
        onVerified={finishOtpBooking}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="p-5 sm:p-6">
          <h2 className="flex items-center gap-3 text-lg font-semibold text-foreground">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">1</span>
            <span>1. Escolha o horário</span>
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">Defina o serviço, quem vai atender e a data para consultar a agenda.</p>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="booking-service">Serviço</Label>
              <select
                id="booking-service"
                className={selectClassName}
                value={serviceId}
                disabled={loadingSlots || submitting}
                onChange={(event) => {
                  setServiceId(event.target.value);
                  invalidateAvailability();
                }}
              >
                {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-staff">Profissional</Label>
              <select
                id="booking-staff"
                className={selectClassName}
                value={staffId}
                disabled={loadingSlots || submitting}
                onChange={(event) => {
                  setStaffId(event.target.value);
                  invalidateAvailability();
                }}
              >
                {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="booking-date">Data</Label>
              <Input
                id="booking-date"
                type="date"
                value={date}
                disabled={loadingSlots || submitting}
                onChange={(event) => {
                  setDate(event.target.value);
                  invalidateAvailability();
                }}
              />
            </div>
          </div>

          <Button className="mt-5 w-full sm:w-auto" type="button" onClick={loadSlots} disabled={loadingSlots || submitting}>
            {loadingSlots ? "Buscando horários…" : "Buscar horários"}
          </Button>

          <div className="mt-6" aria-live="polite" aria-busy={loadingSlots}>
            {loadingSlots ? <p className="text-sm text-muted-foreground" role="status">Consultando a agenda…</p> : null}
            {!loadingSlots && searched && slots.length === 0 && !error ? (
              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <p className="text-sm font-medium text-foreground">Não há horários disponíveis nessa data.</p>
                <p className="mt-1 text-sm text-muted-foreground">Você pode tentar outra data ou usar a lista de espera abaixo.</p>
                <a className="mt-3 inline-flex text-sm font-semibold text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35" href="#lista-de-espera">
                  Ir para a lista de espera
                </a>
              </div>
            ) : null}
            {slots.length > 0 ? (
              <fieldset disabled={submitting}>
                <legend className="mb-3 text-sm font-medium text-foreground">Horários disponíveis</legend>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {slots.map((slot) => {
                    const selected = selectedSlot?.startsAt === slot.startsAt;
                    const label = localSlotLabel(slot.startsAt, timezone);
                    return (
                      <button
                        key={`${slot.staffId}:${slot.startsAt}`}
                        type="button"
                        aria-pressed={selected}
                        aria-label={`Selecionar horário ${label}`}
                        className={`min-h-10 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-accent"}`}
                        onClick={() => setSelectedSlot(slot)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {selectedSlot ? (
                  <p className="mt-4 text-sm font-medium text-foreground" role="status">
                    Horário selecionado: {localSlotLabel(selectedSlot.startsAt, timezone)}
                  </p>
                ) : null}
              </fieldset>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <div className="p-5 sm:p-6">
          <h2 className="flex items-center gap-3 text-lg font-semibold text-foreground">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">2</span>
            <span>2. Seus dados</span>
          </h2>
          {customer ? (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-muted/35 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Continuando como</p>
                <p className="mt-1 font-semibold text-foreground">{customer.name}</p>
                <p className="text-sm text-muted-foreground">{customer.phoneE164}</p>
              </div>
              <Button type="button" variant="outline" disabled={submitting || switchingCustomer} onClick={() => void onSwitchCustomer()}>
                {switchingCustomer ? "Trocando…" : "Trocar cliente"}
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Use seu nome e telefone uma vez; este navegador lembrará seus dados nos próximos acessos.</p>
          )}

          <form className="mt-5 space-y-4" onSubmit={submitBooking} aria-busy={submitting}>
            {!customer ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="booking-name">Nome</Label>
                  <Input
                    id="booking-name"
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={120}
                    value={name}
                    disabled={submitting}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="booking-phone">Telefone</Label>
                  <Input
                    id="booking-phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    required
                    maxLength={32}
                    value={phone}
                    disabled={submitting}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </div>
              </div>
            ) : null}
            <Button className="w-full sm:w-auto" disabled={submitting || switchingCustomer || !selectedSlot} type="submit">
              {submitting ? "Confirmando…" : "Confirmar agendamento"}
            </Button>
            {!selectedSlot ? <p className="text-xs text-muted-foreground">Escolha um horário disponível para liberar a confirmação.</p> : null}
          </form>
        </div>
      </Card>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Não foi possível concluir</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
