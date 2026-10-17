"use client";

import { ErrorState } from "@/components/cutz/error-state";
import { Button } from "@/components/ui/button";

export default function AppointmentManagementError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      title="Não foi possível carregar o agendamento"
      description="Tente novamente. Se o problema continuar, use o link recebido originalmente."
      action={<Button type="button" onClick={reset}>Tentar novamente</Button>}
    />
  );
}
