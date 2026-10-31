"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Kind = "IN" | "OUT" | "ADJUSTMENT";
type Movement = {
  id: string; kind: Kind; quantityDelta: number;
  quantityBefore: number; quantityAfter: number; reason: string;
  createdAt: string;
};
type ApiError = { error?: { message?: string } };
const labels: Record<Kind, string> = {
  IN: "Entrada", OUT: "Saída", ADJUSTMENT: "Ajuste",
};

async function errorMessage(response: Response) {
  try { return ((await response.json()) as ApiError).error?.message ?? "Operação não concluída."; }
  catch { return "Operação não concluída."; }
}

export function ProductStockPanel({ slug, productId, quantity }: {
  slug: string; productId: string; quantity: number;
}) {
  const router = useRouter();
  const endpoint = `/api/admin/b/${slug}/products/${productId}/movements`;
  const [expanded, setExpanded] = useState(false);
  const [kind, setKind] = useState<Kind>("IN");
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operationId = useRef<string | null>(null);

  const reload = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`${endpoint}?limit=25`, { cache: "no-store", signal });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!response.ok) throw new Error(await errorMessage(response));
      const data = (await response.json()) as { movements: Movement[] };
      if (!signal?.aborted) setMovements(data.movements);
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Não foi possível carregar o histórico.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [endpoint, router]);

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [expanded, reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = Number(data.get("quantity"));
    if (!Number.isSafeInteger(parsed) || parsed < (kind === "ADJUSTMENT" ? 0 : 1) || parsed > 1_000_000) {
      setError("Informe uma quantidade válida.");
      return;
    }
    const reason = String(data.get("reason") ?? "").trim();
    if (reason.length < 3 || reason.length > 280) {
      setError("Informe um motivo de 3 a 280 caracteres.");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    operationId.current ??= crypto.randomUUID();
    try {
      const body = kind === "ADJUSTMENT"
        ? { operationId: operationId.current, kind, newQuantity: parsed, reason }
        : { operationId: operationId.current, kind, quantity: parsed, reason };
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!response.ok) {
        if (response.status === 409) operationId.current = null;
        throw new Error(await errorMessage(response));
      }
      operationId.current = null;
      form.reset();
      setNotice("Movimentação registrada.");
      router.refresh();
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível registrar a movimentação.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <Button type="button" size="sm" variant="outline"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}>
        {expanded ? "Ocultar estoque" : "Movimentar estoque e consultar histórico"}
      </Button>
      {expanded ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Saldo atual: <strong className="text-foreground">{quantity}</strong> unidade(s).
            Ajuste informa o saldo final; entrada e saída informam a quantidade movimentada.
          </p>
          <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => void submit(event)}>
            <div className="space-y-1">
              <Label htmlFor={`kind-${productId}`}>Operação</Label>
              <select id={`kind-${productId}`} value={kind}
                disabled={busy} onChange={(event) => {
                  setKind(event.target.value as Kind);
                  operationId.current = null;
                  setError(null);
                }}
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm">
                <option value="IN">Entrada</option>
                <option value="OUT">Saída</option>
                <option value="ADJUSTMENT">Ajuste</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`qty-${productId}`}>
                {kind === "ADJUSTMENT" ? "Novo saldo" : "Quantidade"}
              </Label>
              <Input id={`qty-${productId}`} name="quantity"
                type="number" step="1" min={kind === "ADJUSTMENT" ? 0 : 1}
                max={1000000} required disabled={busy} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`reason-${productId}`}>Motivo</Label>
              <Input id={`reason-${productId}`} name="reason"
                minLength={3} maxLength={280} required disabled={busy}
                placeholder="Ex.: Reposição" />
            </div>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={busy}>{busy ? "Registrando…" : "Registrar movimentação"}</Button>
            </div>
          </form>
          {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
          {notice ? <Alert variant="success" role="status"><AlertDescription>{notice}</AlertDescription></Alert> : null}
          <div>
            <h4 className="mb-2 text-sm font-semibold">Últimas movimentações</h4>
            {loading ? <p className="text-sm text-muted-foreground">Carregando…</p>
              : movements.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma movimentação.</p>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead><tr className="border-b border-border">
                        <th className="p-2">Data</th><th className="p-2">Tipo</th>
                        <th className="p-2">Alteração</th><th className="p-2">Saldo</th>
                        <th className="p-2">Motivo</th>
                      </tr></thead>
                      <tbody>
                        {movements.map((row) => (
                          <tr key={row.id} className="border-b border-border/60">
                            <td className="p-2">{new Date(row.createdAt).toLocaleString("pt-BR")}</td>
                            <td className="p-2">{labels[row.kind]}</td>
                            <td className="p-2">{row.quantityDelta > 0 ? "+" : ""}{row.quantityDelta}</td>
                            <td className="p-2">{row.quantityAfter}</td>
                            <td className="p-2">{row.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
