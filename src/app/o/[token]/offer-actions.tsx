"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ApiError = { error?: { message?: string } };
type AcceptResponse = {
  managementUrl?: string;
  appointmentId?: string;
  alreadyAccepted?: boolean;
};

export function OfferActions({ token, expiresAt }: { token: string; expiresAt: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState<"accept" | "reject" | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      router.refresh();
      return;
    }

    const timer = window.setTimeout(() => router.refresh(), remaining + 50);
    return () => window.clearTimeout(timer);
  }, [expiresAt, router]);

  async function readError(response: Response, fallback: string) {
    try {
      const body = (await response.json()) as ApiError;
      return body.error?.message ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function acceptOffer() {
    setSubmitting("accept");
    setError(null);
    try {
      const response = await fetch(
        `/api/capabilities/waitlist-offers/${encodeURIComponent(token)}/accept`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível aceitar a vaga."));
      }
      const body = (await response.json()) as AcceptResponse;
      if (body.managementUrl) {
        window.location.assign(body.managementUrl);
        return;
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível aceitar a vaga.");
      setSubmitting(null);
    }
  }

  async function rejectOffer() {
    setSubmitting("reject");
    setError(null);
    try {
      const response = await fetch(
        `/api/capabilities/waitlist-offers/${encodeURIComponent(token)}/reject`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível rejeitar a vaga."));
      }
      setRejectDialogOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível rejeitar a vaga.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Responder à oferta</CardTitle>
          <CardDescription>
            Ao aceitar, um agendamento será criado. Ao rejeitar, a vaga poderá seguir para o próximo candidato.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            disabled={submitting !== null}
            aria-busy={submitting === "accept"}
            onClick={acceptOffer}
          >
            {submitting === "accept" ? "Aceitando…" : "Aceitar vaga"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={submitting !== null}
            onClick={() => setRejectDialogOpen(true)}
          >
            Rejeitar vaga
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <Alert className="mt-6" variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <AlertDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        title="Rejeitar esta vaga?"
        description="A reserva temporária será encerrada e a vaga poderá ser oferecida ao próximo cliente da lista de espera."
        confirmLabel="Confirmar rejeição"
        busy={submitting === "reject"}
        onConfirm={rejectOffer}
      />
    </>
  );
}
