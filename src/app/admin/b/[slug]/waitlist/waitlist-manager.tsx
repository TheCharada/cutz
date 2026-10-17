"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Customer = { id: string; name: string; phoneE164: string };
type Service = { id: string; name: string };
type Staff = { id: string; name: string };
type WaitlistItem = {
  id: string;
  customerId: string;
  serviceId: string;
  staffId: string | null;
  customerName: string;
  customerPhoneE164: string;
  serviceName: string;
  staffName: string | null;
  desiredDate: string;
  earliestTime: string;
  latestTime: string;
  status: "ACTIVE" | "FULFILLED" | "CANCELLED" | "EXPIRED";
  createdAt: string;
};
type ApiError = { error?: { message?: string } };

const waitlistStatuses: Record<WaitlistItem["status"], { label: string; variant: BadgeVariant }> = {
  ACTIVE: { label: "Ativa", variant: "neutral" },
  FULFILLED: { label: "Atendida", variant: "success" },
  CANCELLED: { label: "Cancelada", variant: "destructive" },
  EXPIRED: { label: "Expirada", variant: "warning" },
};

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function localDateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function WaitlistManager({
  slug,
  minDate,
  items,
  customers,
  services,
  staff,
}: {
  slug: string;
  minDate: string;
  items: WaitlistItem[];
  customers: Customer[];
  services: Service[];
  staff: Staff[];
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [staffId, setStaffId] = useState("");
  const [desiredDate, setDesiredDate] = useState("");
  const [earliestTime, setEarliestTime] = useState("09:00");
  const [latestTime, setLatestTime] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = useState<WaitlistItem | null>(null);

  const effectiveCustomerId = customers.some((customer) => customer.id === customerId)
    ? customerId
    : customers[0]?.id ?? "";
  const effectiveServiceId = services.some((service) => service.id === serviceId)
    ? serviceId
    : services[0]?.id ?? "";
  const effectiveStaffId = !staffId || staff.some((member) => member.id === staffId) ? staffId : "";
  const canCreate = Boolean(effectiveCustomerId && effectiveServiceId && desiredDate && latestTime > earliestTime);

  function redirectExpired(response: Response) {
    if (response.status !== 401) return false;
    router.replace("/admin/login");
    router.refresh();
    return true;
  }

  async function createEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/b/${slug}/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: effectiveCustomerId,
          serviceId: effectiveServiceId,
          ...(effectiveStaffId ? { staffId: effectiveStaffId } : {}),
          desiredDate,
          earliestTime,
          latestTime,
        }),
      });
      if (redirectExpired(response)) return;
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível criar a entrada na fila."));
      setNotice("Entrada adicionada à lista de espera.");
      setDesiredDate("");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar a entrada na fila.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelEntry() {
    if (!pendingCancel) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/b/${slug}/waitlist/${pendingCancel.id}/cancel`, { method: "POST" });
      if (redirectExpired(response)) return;
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível cancelar a entrada."));
      setNotice("Entrada cancelada.");
      setPendingCancel(null);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível cancelar a entrada.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div aria-busy={busy}>
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert className={error ? "mt-3" : undefined} variant="success" role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Adicionar à fila</CardTitle>
        </CardHeader>
        <CardContent>
          {customers.length === 0 || services.length === 0 ? (
            <Alert>
              <AlertDescription>
                É necessário ter pelo menos um cliente e um serviço ativo antes de adicionar uma entrada.
              </AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={createEntry} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="waitlist-customer">Cliente</Label>
                <select
                  id="waitlist-customer"
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                  value={effectiveCustomerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                >
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name} · {customer.phoneE164}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="waitlist-service">Serviço</Label>
                <select
                  id="waitlist-service"
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                  value={effectiveServiceId}
                  onChange={(event) => setServiceId(event.target.value)}
                >
                  {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="waitlist-staff">Profissional</Label>
                <select
                  id="waitlist-staff"
                  className="h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                  value={effectiveStaffId}
                  onChange={(event) => setStaffId(event.target.value)}
                >
                  <option value="">Qualquer profissional</option>
                  {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="waitlist-date">Data desejada</Label>
                <Input id="waitlist-date" type="date" min={minDate} required value={desiredDate} onChange={(event) => setDesiredDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="waitlist-earliest">Horário inicial</Label>
                <Input id="waitlist-earliest" type="time" required value={earliestTime} onChange={(event) => setEarliestTime(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="waitlist-latest">Horário final</Label>
                <Input id="waitlist-latest" type="time" required value={latestTime} onChange={(event) => setLatestTime(event.target.value)} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Button type="submit" disabled={busy || !canCreate}>Adicionar à lista de espera</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <section className="mt-6" aria-labelledby="waitlist-entries-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="waitlist-entries-title" className="text-lg font-semibold text-foreground">Entradas</h3>
            <p className="mt-1 text-sm text-muted-foreground">{items.length} entrada(s) registrada(s).</p>
          </div>
        </div>
        <div className="mt-4 space-y-3" aria-live="polite">
          {items.map((item) => {
            const status = waitlistStatuses[item.status];
            return (
              <article key={item.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-foreground">{item.customerName}</h4>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{item.customerPhoneE164}</p>
                    <p className="mt-3 text-sm text-foreground">
                      {item.serviceName} · {item.staffName ?? "Qualquer profissional"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {localDateLabel(item.desiredDate)} · {item.earliestTime}–{item.latestTime}
                    </p>
                  </div>
                  {item.status === "ACTIVE" ? (
                    <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => setPendingCancel(item)}>
                      Cancelar entrada
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <h4 className="font-semibold text-foreground">Lista de espera vazia</h4>
              <p className="mt-1 text-sm text-muted-foreground">Nenhuma entrada foi registrada para esta barbearia.</p>
            </div>
          ) : null}
        </div>
      </section>

      <AlertDialog
        open={Boolean(pendingCancel)}
        onOpenChange={(open) => { if (!open) setPendingCancel(null); }}
        title="Cancelar entrada da lista de espera?"
        description={pendingCancel ? `A entrada de ${pendingCancel.customerName} será encerrada e deixará de participar das ofertas de vaga.` : ""}
        confirmLabel="Cancelar entrada"
        busy={busy}
        onConfirm={cancelEntry}
      />
    </div>
  );
}
