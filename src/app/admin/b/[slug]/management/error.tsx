"use client";

import { ErrorState } from "@/components/cutz/error-state";
import { Button } from "@/components/ui/button";

export default function AdminManagementError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      size="xl"
      title="Não foi possível abrir a gestão"
      description="Tente carregar a página novamente."
      action={<Button type="button" onClick={reset}>Tentar novamente</Button>}
    />
  );
}
