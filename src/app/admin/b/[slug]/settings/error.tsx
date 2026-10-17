"use client";

import { ErrorState } from "@/components/cutz/error-state";
import { Button } from "@/components/ui/button";

export default function AdminSettingsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="Não foi possível abrir as configurações"
      description="Tente carregar as configurações novamente."
      action={<Button type="button" onClick={reset}>Tentar novamente</Button>}
    />
  );
}
