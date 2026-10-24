"use client";

import { useState, type FormEvent } from "react";
import { TelegramLinkCard } from "@/components/cutz/telegram-link-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PublicService, PublicStaffMember } from "@/modules/catalog";
import type { RememberedCustomer } from "./customer-session-types";
import { OtpVerification, type PublicOtpChallenge } from "./otp-verification";

type ApiError = { error?: { message?: string } };
type SessionStartResponse = {
  verificationRequired?: boolean;
  challengeId?: string;
  expiresAt?: string;
  customer?: RememberedCustomer;
};

const selectClassName =
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70";

export function WaitlistForm({
  telegramEnabled,
  slug,
  services,
  staff,
  customer,
  switchingCustomer,
  onCustomerSessionReady,
  onCustomerSessionInvalid,
  onSwitchCustomer,
}: {
  telegramEnabled: boolean;
  slug: string;
  services: PublicService[];
  staff: PublicStaffMember[];
  customer: RememberedCustomer | null;
  switchingCustomer: boolean;
  onCustomerSessionReady: (customer: RememberedCustomer) => void;
  onCustomerSessionInvalid: () => void;
  onSwitchCustomer: () => Promise<void>;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [staffId, setStaffId] = useState("");
  const [desiredDate, setDesiredDate] = useState("");
  const [earliestTime, setEarliestTime] = useState("08:00");
  const [latestTime, setLatestTime] = useState("18:00");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managementUrl, setManagementUrl] = useState<string | null>(null);
  const [otpChallenge, setOtpChallenge] = useState<PublicOtpChallenge | null>(null);

  async function readError(response: Response, fallback: string) {
    try {
      const body = (await response.json()) as ApiError;
      return body.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function createWaitlistEntry() {
    const response = await fetch(`/api/b/${slug}/waitlist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceId,
        ...(staffId ? { staffId } : {}),
        desiredDate,
        earliestTime,
        latestTime,
      }),
    });
    if (response.status === 401) {
      onCustomerSessionInvalid();
      throw new Error(await readError(response, "Identifique-se novamente para entrar na lista de espera."));
    }
    if (!response.ok) {
      throw new Error(await readError(response, "Não foi possível entrar na lista de espera."));
    }
    const body = (await response.json()) as { managementUrl: string };
    setManagementUrl(body.managementUrl);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setManagementUrl(null);
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

      await createWaitlistEntry();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível entrar na lista de espera.");
    } finally {
      setSubmitting(false);
    }
  }

  async function finishOtpWaitlist(verifiedCustomer: RememberedCustomer) {
    onCustomerSessionReady(verifiedCustomer);
    setOtpChallenge(null);
    setError(null);
    try {
      await createWaitlistEntry();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Não foi possível entrar na lista de espera.";
      setError(message);
      throw new Error(message);
    }
  }

  if (services.length === 0) return null;

  if (managementUrl) {
    return (
      <Card id="lista-de-espera" className="border-success/25 bg-success/5 p-6 shadow-none" aria-live="polite">
        <h2 className="text-xl font-semibold text-foreground">Lista de espera ativada</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Se surgir um horário compatível, ele poderá ser reservado temporariamente para você.</p>
        <a
          className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          href={managementUrl}
        >
          Gerenciar lista de espera
        </a>
        {telegramEnabled ? (
          <div className="mt-5">
            <TelegramLinkCard scope="waitlist" managementUrl={managementUrl} />
          </div>
        ) : null}
      </Card>
    );
  }

  if (otpChallenge) {
    return (
      <div id="lista-de-espera">
        <OtpVerification
          slug={slug}
          challenge={otpChallenge}
          onChallengeChange={setOtpChallenge}
          onVerified={finishOtpWaitlist}
        />
      </div>
    );
  }

  return (
    <Card id="lista-de-espera" className="bg-muted/35 shadow-none scroll-mt-6">
      <div className="p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Alternativa ao agendamento direto</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Lista de espera</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Não encontrou um horário? Informe uma data e a janela em que você aceita receber uma vaga liberada.</p>

        <form className="mt-6 space-y-4" onSubmit={submit} aria-busy={submitting}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="waitlist-service">Serviço</Label>
              <select id="waitlist-service" className={selectClassName} value={serviceId} disabled={submitting} onChange={(event) => setServiceId(event.target.value)}>
                {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="waitlist-staff">Profissional</Label>
              <select id="waitlist-staff" className={selectClassName} value={staffId} disabled={submitting} onChange={(event) => setStaffId(event.target.value)}>
                <option value="">Qualquer profissional compatível</option>
                {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="waitlist-date">Data desejada</Label>
              <Input id="waitlist-date" type="date" required value={desiredDate} disabled={submitting} onChange={(event) => setDesiredDate(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="waitlist-earliest">A partir de</Label>
              <Input id="waitlist-earliest" type="time" required value={earliestTime} disabled={submitting} onChange={(event) => setEarliestTime(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="waitlist-latest">Até</Label>
              <Input id="waitlist-latest" type="time" required value={latestTime} disabled={submitting} onChange={(event) => setLatestTime(event.target.value)} />
            </div>
          </div>

          {customer ? (
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Cliente</p>
                <p className="mt-1 font-semibold text-foreground">{customer.name}</p>
                <p className="text-sm text-muted-foreground">{customer.phoneE164}</p>
              </div>
              <Button type="button" variant="outline" disabled={submitting || switchingCustomer} onClick={() => void onSwitchCustomer()}>
                {switchingCustomer ? "Trocando…" : "Trocar cliente"}
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="waitlist-name">Nome</Label>
                <Input id="waitlist-name" required maxLength={120} autoComplete="name" value={name} disabled={submitting} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="waitlist-phone">Telefone</Label>
                <Input id="waitlist-phone" type="tel" required maxLength={32} autoComplete="tel" value={phone} disabled={submitting} onChange={(event) => setPhone(event.target.value)} />
              </div>
            </div>
          )}

          <Button variant="secondary" className="w-full sm:w-auto" type="submit" disabled={submitting || switchingCustomer}>
            {submitting ? "Entrando…" : "Entrar na lista de espera"}
          </Button>
        </form>

        {error ? (
          <Alert className="mt-4" variant="destructive" role="alert">
            <AlertTitle>Não foi possível entrar na lista</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </Card>
  );
}
