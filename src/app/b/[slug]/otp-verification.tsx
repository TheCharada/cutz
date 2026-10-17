"use client";

import { useId, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RememberedCustomer } from "./customer-session-types";

type ApiError = { error?: { message?: string } };

export type PublicOtpChallenge = {
  id: string;
  expiresAt: string;
};

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function OtpVerification({
  slug,
  challenge,
  onChallengeChange,
  onVerified,
}: {
  slug: string;
  challenge: PublicOtpChallenge;
  onChallengeChange: (challenge: PublicOtpChallenge) => void;
  onVerified: (customer: RememberedCustomer) => Promise<void>;
}) {
  const inputId = useId();
  const helpId = useId();
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setVerifying(true);
    try {
      const response = await fetch(`/api/b/${slug}/customer-session/otp/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.id, code }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível validar o código."));
      }
      const body = (await response.json()) as { customer?: RememberedCustomer };
      if (!body.customer) {
        throw new Error("Não foi possível recuperar os dados do cliente verificado.");
      }
      await onVerified(body.customer);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível validar o código.");
    } finally {
      setVerifying(false);
    }
  }

  async function resend() {
    setError(null);
    setResending(true);
    try {
      const response = await fetch(`/api/b/${slug}/customer-session/otp/resend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: challenge.id }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível reenviar o código."));
      }
      const body = (await response.json()) as { challengeId: string; expiresAt: string };
      onChallengeChange({ id: body.challengeId, expiresAt: body.expiresAt });
      setCode("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível reenviar o código.");
    } finally {
      setResending(false);
    }
  }

  return (
    <Card aria-labelledby={`${inputId}-title`}>
      <div className="p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Verificação</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground" id={`${inputId}-title`}>Confirme seu telefone</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground" id={helpId}>
          Enviamos um código de 6 dígitos pelo WhatsApp. O código vale por 10 minutos.
        </p>
        <form className="mt-6 space-y-4" onSubmit={verify} aria-busy={verifying || resending}>
          <div className="space-y-2">
            <Label htmlFor={inputId}>Código de verificação</Label>
            <Input
              autoComplete="one-time-code"
              autoFocus
              className="max-w-xs text-base tracking-[0.25em]"
              disabled={verifying || resending}
              id={inputId}
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]{6}"
              aria-describedby={helpId}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button disabled={verifying || resending || code.length !== 6} type="submit">
              {verifying ? "Verificando…" : "Verificar código"}
            </Button>
            <Button variant="outline" disabled={verifying || resending} type="button" onClick={resend}>
              {resending ? "Reenviando…" : "Reenviar código"}
            </Button>
          </div>
        </form>
        {error ? (
          <Alert className="mt-4" variant="destructive" role="alert">
            <AlertDescription className="mt-0">{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </Card>
  );
}
