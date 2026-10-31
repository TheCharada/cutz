"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { localDateTimeToInstant } from "@/shared/time";

type ServiceItem = {
  id: string;
  kind: "BOOKED" | "ADDITIONAL";
  serviceNameSnapshot: string;
  durationMinutesSnapshot: number | null;
  unitPriceCents: number | null;
  historicalSnapshotComplete: boolean;
  performedAt: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
};

type Detail = {
  appointment: { status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW" };
  items: ServiceItem[];
  totals: { knownAmountCents: number; hasUnknownPrices: boolean };
  canAdd: boolean;
};

type ServiceOption = {
  id: string;
  name: string;
  durationMinutes: number;
  priceCents: number | null;
};

type ApiError = { error?: { message?: string } };

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function amountLabel(cents: number | null) {
  return cents === null ? "Não informado" : money.format(cents / 100);
}

function parseAmount(input: string): number | null | undefined {
  const text = input.trim();
  if (!text) return null;
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(text)) return undefined;
  const cents = Math.round(Number(text.replace(",", ".")) * 100);
  return Number.isSafeInteger(cents) && cents <= 1_000_000_000 ? cents : undefined;
}

function amountInput(cents: number | null) {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

async function errorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function AppointmentServicesPanel({
  slug, appointmentId, timezone, onClose,
}: {
  slug: string;
  appointmentId: string;
  timezone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const baseUrl = `/api/admin/b/${slug}/appointments/${appointmentId}/services`;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [performedInput, setPerformedInput] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const operationId = useRef<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [detailResponse, catalogResponse] = await Promise.all([
        fetch(baseUrl, { cache: "no-store", signal }),
        fetch(`/api/b/${slug}/services`, { cache: "no-store", signal }),
      ]);
      if (detailResponse.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!detailResponse.ok || !catalogResponse.ok) {
        throw new Error("Não foi possível carregar os serviços do atendimento.");
      }
      const nextDetail = (await detailResponse.json()) as Detail;
      const catalog = (await catalogResponse.json()) as { services: ServiceOption[] };
      if (signal?.aborted) return;

      setDetail(nextDetail);
      setServices(catalog.services);
      setServiceId((current) => current && catalog.services.some((item) => item.id === current)
        ? current : catalog.services[0]?.id ?? "");
      setPriceInput((current) => current || amountInput(catalog.services[0]?.priceCents ?? null));
      setError(null);
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar o atendimento.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [baseUrl, router, slug]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const selectedService = services.find((service) => service.id === serviceId);
  const enteredPrice = parseAmount(priceInput);
  const needsReason = Boolean(selectedService && selectedService.priceCents !== null &&
    enteredPrice !== undefined && enteredPrice !== selectedService.priceCents);

  async function addService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!serviceId || enteredPrice === undefined) {
      setError("Informe um serviço e um preço válido.");
      return;
    }
    let performedAt: string | null = null;
    if (performedInput) {
      try {
        performedAt = localDateTimeToInstant(
          performedInput.slice(0, 10), performedInput.slice(11, 16), timezone,
        ).toISOString();
      } catch {
        setError("Informe uma data e hora de realização válidas.");
        return;
      }
    }
    if (!operationId.current) operationId.current = crypto.randomUUID();
    setBusy(true);
    try {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serviceId,
          unitPriceCents: enteredPrice,
          performedAt,
          priceAdjustmentReason: adjustmentReason.trim() || null,
          operationId: operationId.current,
        }),
      });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível registrar o serviço."));
      operationId.current = null;
      setAdjustmentReason("");
      setPerformedInput("");
      setPriceInput(amountInput(selectedService?.priceCents ?? null));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível registrar o serviço.");
    } finally {
      setBusy(false);
    }
  }

  async function voidService() {
    if (!voidingId || voidReason.trim().length < 3) {
      setError("Informe o motivo da anulação.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${baseUrl}/${voidingId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!response.ok) throw new Error(await errorMessage(response, "Não foi possível anular o lançamento."));
      setVoidingId(null);
      setVoidReason("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível anular o lançamento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 space-y-5 rounded-xl border border-border bg-muted/20 p-4" aria-label="Serviços do atendimento">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold text-foreground">Serviços do atendimento</h4>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Fechar</Button>
      </div>
      {loading ? <p role="status" className="text-sm text-muted-foreground">Carregando serviços…</p> : null}
      {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}

      {detail ? (
        <>
          <div className="space-y-2">
            {detail.items.map((item) => (
              <div key={item.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={item.voidedAt ? "line-through text-muted-foreground" : "font-medium"}>
                        {item.serviceNameSnapshot}
                      </span>
                      <Badge variant={item.voidedAt ? "neutral" : item.kind === "BOOKED" ? "neutral" : "success"}>
                        {item.voidedAt ? "Anulado" : item.kind === "BOOKED" ? "Agendado" : "Adicional"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.durationMinutesSnapshot === null ? "Duração não registrada" : `${item.durationMinutesSnapshot} min`}
                      {item.performedAt
                        ? ` · Realizado em ${new Intl.DateTimeFormat("pt-BR", {
                          dateStyle: "short", timeStyle: "short", timeZone: timezone,
                        }).format(new Date(item.performedAt))}`
                        : null}
                    </p>
                    {!item.historicalSnapshotComplete ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Registro anterior à preservação dos preços históricos.
                      </p>
                    ) : null}
                    {item.voidReason ? (
                      <p className="mt-1 text-xs text-muted-foreground">Motivo da anulação: {item.voidReason}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="whitespace-nowrap font-medium">{amountLabel(item.unitPriceCents)}</span>
                    {item.kind === "ADDITIONAL" && !item.voidedAt ? (
                      <Button type="button" size="sm" variant="outline" disabled={busy}
                        onClick={() => { setVoidingId(item.id); setVoidReason(""); setError(null); }}>
                        Anular
                      </Button>
                    ) : null}
                  </div>
                </div>
                {voidingId === item.id ? (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    <Label htmlFor={`void-reason-${item.id}`}>Motivo da anulação</Label>
                    <Input id={`void-reason-${item.id}`} maxLength={280} value={voidReason}
                      onChange={(event) => setVoidReason(event.target.value)} />
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="destructive" disabled={busy || voidReason.trim().length < 3}
                        onClick={voidService}>Confirmar anulação</Button>
                      <Button type="button" size="sm" variant="ghost" disabled={busy}
                        onClick={() => setVoidingId(null)}>Cancelar</Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <strong>{detail.totals.hasUnknownPrices ? "Subtotal conhecido" : "Total dos serviços"}</strong>
              <strong>{amountLabel(detail.totals.knownAmountCents)}</strong>
            </div>
            {detail.totals.hasUnknownPrices ? (
              <p className="text-xs text-muted-foreground">
                Há itens sem preço registrado. O total real pode ser diferente.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Valores dos serviços registrados, não comprovantes de pagamento.
            </p>
          </div>

          {detail.canAdd ? (
            <form onSubmit={addService} className="space-y-4 border-t border-border pt-4">
              <h5 className="font-semibold">Adicionar serviço realizado</h5>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`additional-service-${appointmentId}`}>Serviço</Label>
                  <select id={`additional-service-${appointmentId}`} value={serviceId}
                    className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground"
                    onChange={(event) => {
                      const service = services.find((item) => item.id === event.target.value);
                      setServiceId(event.target.value);
                      setPriceInput(amountInput(service?.priceCents ?? null));
                      setAdjustmentReason("");
                      operationId.current = null;
                    }}>
                    {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`service-price-${appointmentId}`}>Valor aplicado (R$)</Label>
                  <Input id={`service-price-${appointmentId}`} inputMode="decimal" placeholder="Não informado"
                    value={priceInput} onChange={(event) => {
                      setPriceInput(event.target.value);
                      operationId.current = null;
                    }} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`service-performed-${appointmentId}`}>Realizado em (opcional)</Label>
                  <Input id={`service-performed-${appointmentId}`} type="datetime-local" value={performedInput}
                    onChange={(event) => { setPerformedInput(event.target.value); operationId.current = null; }} />
                  <p className="text-xs text-muted-foreground">Horário local do estabelecimento.</p>
                </div>
                {needsReason ? (
                  <div className="space-y-2">
                    <Label htmlFor={`price-reason-${appointmentId}`}>Motivo do valor diferente</Label>
                    <Input id={`price-reason-${appointmentId}`} maxLength={280} value={adjustmentReason}
                      onChange={(event) => { setAdjustmentReason(event.target.value); operationId.current = null; }} />
                  </div>
                ) : null}
              </div>
              <Button type="submit" disabled={busy || !serviceId || enteredPrice === undefined ||
                (needsReason && adjustmentReason.trim().length < 3)}>
                {busy ? "Registrando…" : "Registrar serviço"}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              {detail.appointment.status === "SCHEDULED"
                ? "Serviços realizados podem ser registrados a partir do início do atendimento."
                : "Não é possível registrar serviços neste atendimento."}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
