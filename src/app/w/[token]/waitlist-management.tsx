"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ApiError = { error?: { message?: string } };

export function WaitlistManagement({ token }: { token: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancelEntry() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/capabilities/waitlist/${encodeURIComponent(token)}/cancel`,
        { method: "POST" },
      );
      if (!response.ok) {
        let message = "Não foi possível sair da lista de espera.";
        try {
          const body = (await response.json()) as ApiError;
          message = body.error?.message ?? message;
        } catch {}
        throw new Error(message);
      }
      setDialogOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível sair da lista de espera.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Sair da lista de espera</CardTitle>
          <CardDescription>
            Você deixa de concorrer a novas vagas. Uma oferta pendente também poderá ser liberada para o próximo candidato.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={() => setDialogOpen(true)}
          >
            Sair da lista de espera
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <Alert className="mt-6" variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <AlertDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Sair da lista de espera?"
        description="Você não receberá novas ofertas desta entrada. Se houver uma vaga reservada, ela poderá seguir para o próximo candidato."
        confirmLabel="Confirmar saída"
        busy={submitting}
        onConfirm={cancelEntry}
      />
    </>
  );
}
