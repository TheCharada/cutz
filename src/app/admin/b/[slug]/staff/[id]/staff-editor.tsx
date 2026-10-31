"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { localDateTimeToInstant } from "@/shared/time";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageUploader } from "@/components/cutz/image-uploader";

type Staff = {
  id: string;
  name: string;
  active: boolean;
  acceptsAppointments: boolean;
  imageUrl: string | null;
};
type Service = { id: string; name: string; active: boolean };
type WorkingHour = { weekday: number; startsAt: string; endsAt: string };
type TimeOff = { id: string; startsAt: string; endsAt: string; reason: string | null };
type ApiError = { error?: { message?: string } };

const weekdays = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

async function responseMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ApiError;
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function dateTimeLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

export function StaffEditor({
  slug,
  staff,
  services,
  initialServiceIds,
  initialHours,
  timeOff,
  timezone,
}: {
  slug: string;
  staff: Staff;
  services: Service[];
  initialServiceIds: string[];
  initialHours: WorkingHour[];
  timeOff: TimeOff[];
  timezone: string;
}) {
  const router = useRouter();
  const [serviceIds, setServiceIds] = useState(initialServiceIds);
  const [hours, setHours] = useState(initialHours);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const isBusy = busy !== null;
  const removal = pendingRemoval ? timeOff.find((item) => item.id === pendingRemoval) ?? null : null;

  function redirectExpired(response: Response) {
    if (response.status !== 401) return false;
    router.replace("/admin/login");
    router.refresh();
    return true;
  }

  function begin(action: string) {
    setBusy(action);
    setError(null);
    setNotice(null);
  }

  async function saveStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    begin("staff");
    try {
      const response = await fetch(`/api/admin/b/${slug}/staff/${staff.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          active: data.has("active"),
          acceptsAppointments: data.has("acceptsAppointments"),
        }),
      });
      if (redirectExpired(response)) return;
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível atualizar o profissional."));
      setNotice("Profissional atualizado.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o profissional.");
    } finally {
      setBusy(null);
    }
  }

  async function saveServices() {
    begin("services");
    try {
      const response = await fetch(`/api/admin/b/${slug}/staff/${staff.id}/services`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceIds }),
      });
      if (redirectExpired(response)) return;
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível salvar os serviços do profissional."));
      const body = (await response.json()) as { serviceIds: string[] };
      setServiceIds(body.serviceIds);
      setNotice("Serviços do profissional atualizados.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar os serviços do profissional.");
    } finally {
      setBusy(null);
    }
  }

  async function saveWorkingHours() {
    begin("hours");
    try {
      const response = await fetch(`/api/admin/b/${slug}/staff/${staff.id}/working-hours`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hours }),
      });
      if (redirectExpired(response)) return;
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível salvar a jornada."));
      const body = (await response.json()) as { hours: WorkingHour[] };
      setHours(body.hours.map(({ weekday, startsAt, endsAt }) => ({ weekday, startsAt, endsAt })));
      setNotice("Jornada atualizada.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar a jornada.");
    } finally {
      setBusy(null);
    }
  }

  async function createTimeOff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    begin("time-off-create");
    try {
      const date = String(data.get("date") ?? "");
      const startsAt = localDateTimeToInstant(date, String(data.get("startsAt") ?? ""), timezone).toISOString();
      const endsAt = localDateTimeToInstant(date, String(data.get("endsAt") ?? ""), timezone).toISOString();
      const reason = String(data.get("reason") ?? "").trim();
      const response = await fetch(`/api/admin/b/${slug}/staff/${staff.id}/time-off`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startsAt, endsAt, ...(reason ? { reason } : {}) }),
      });
      if (redirectExpired(response)) return;
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível criar a indisponibilidade."));
      form.reset();
      setNotice("Indisponibilidade criada.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar a indisponibilidade.");
    } finally {
      setBusy(null);
    }
  }

  async function removeTimeOff() {
    if (!pendingRemoval) return;
    begin("time-off-remove");
    try {
      const response = await fetch(`/api/admin/b/${slug}/staff/${staff.id}/time-off/${pendingRemoval}`, {
        method: "DELETE",
      });
      if (redirectExpired(response)) return;
      if (!response.ok) throw new Error(await responseMessage(response, "Não foi possível remover a indisponibilidade."));
      setNotice("Indisponibilidade removida.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível remover a indisponibilidade.");
    } finally {
      setBusy(null);
      setPendingRemoval(null);
    }
  }

  return (
    <div className="space-y-6" aria-busy={isBusy}>
      {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {notice ? <Alert variant="success" role="status"><AlertDescription>{notice}</AlertDescription></Alert> : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Dados do profissional</h3>
              <p className="mt-1 text-sm text-muted-foreground">Controle se o profissional aparece na operação e se recebe novos agendamentos.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={staff.active ? "success" : "neutral"}>{staff.active ? "Ativo" : "Inativo"}</Badge>
              <Badge variant={staff.acceptsAppointments ? "success" : "warning"}>{staff.acceptsAppointments ? "Recebe agenda" : "Sem agenda"}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form key={`${staff.name}:${staff.active}:${staff.acceptsAppointments}`} className="space-y-4" onSubmit={saveStaff}>
            <div className="max-w-lg space-y-2">
              <Label htmlFor="staff-name">Nome</Label>
              <Input id="staff-name" name="name" required maxLength={120} defaultValue={staff.name} disabled={isBusy} />
            </div>
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input name="active" type="checkbox" defaultChecked={staff.active} disabled={isBusy} className="size-4 rounded border-input" />
                Profissional ativo
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <input name="acceptsAppointments" type="checkbox" defaultChecked={staff.acceptsAppointments} disabled={isBusy} className="size-4 rounded border-input" />
                Aceita agendamentos
              </label>
            </div>
            <Button type="submit" disabled={isBusy}>{busy === "staff" ? "Salvando…" : "Salvar profissional"}</Button>
          </form>
          <div className="mt-6 border-t border-border pt-5">
            <ImageUploader
              name={staff.name}
              imageUrl={staff.imageUrl}
              label="Fotografia do profissional"
              uploadUrl={`/api/admin/b/${slug}/staff/${staff.id}/image`}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-foreground">Serviços realizados</h3>
          <p className="text-sm text-muted-foreground">Selecione todos os serviços que podem ser atribuídos a este profissional.</p>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum serviço cadastrado.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {services.map((service) => (
                <label key={service.id} className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={serviceIds.includes(service.id)}
                    disabled={isBusy}
                    onChange={(event) => {
                      setServiceIds((current) => event.target.checked
                        ? current.includes(service.id) ? current : [...current, service.id]
                        : current.filter((id) => id !== service.id));
                    }}
                    className="size-4 rounded border-input"
                  />
                  <span className="min-w-0 flex-1 truncate">{service.name}</span>
                  {!service.active ? <Badge variant="neutral">Inativo</Badge> : null}
                </label>
              ))}
            </div>
          )}
          <Button className="mt-4" type="button" disabled={isBusy} onClick={() => void saveServices()}>
            {busy === "services" ? "Salvando…" : "Salvar serviços"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Jornada semanal</h3>
              <p className="mt-1 text-sm text-muted-foreground">Períodos não podem se sobrepor nem invalidar agendamentos futuros.</p>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={() => setHours((current) => [...current, { weekday: 1, startsAt: "09:00", endsAt: "18:00" }])}>
              Adicionar período
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {hours.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum período configurado.</p> : null}
          <div className="space-y-3">
            {hours.map((hour, index) => (
              <div key={index} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[1fr_140px_140px_auto] sm:items-end">
                <label className="space-y-2 text-sm font-medium text-foreground">
                  Dia
                  <select
                    aria-label={`Dia ${index + 1}`}
                    value={hour.weekday}
                    disabled={isBusy}
                    onChange={(event) => setHours((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, weekday: Number(event.target.value) } : item))}
                    className="mt-2 h-10 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                  >
                    {weekdays.map((name, weekday) => <option key={name} value={weekday}>{name}</option>)}
                  </select>
                </label>
                <div className="space-y-2">
                  <Label htmlFor={`hour-start-${index}`}>Início</Label>
                  <Input id={`hour-start-${index}`} aria-label={`Início ${index + 1}`} type="time" value={hour.startsAt} disabled={isBusy} onChange={(event) => setHours((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, startsAt: event.target.value } : item))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`hour-end-${index}`}>Fim</Label>
                  <Input id={`hour-end-${index}`} aria-label={`Fim ${index + 1}`} type="time" value={hour.endsAt} disabled={isBusy} onChange={(event) => setHours((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, endsAt: event.target.value } : item))} />
                </div>
                <Button type="button" variant="outline" disabled={isBusy} onClick={() => setHours((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</Button>
              </div>
            ))}
          </div>
          <Button className="mt-4" type="button" disabled={isBusy} onClick={() => void saveWorkingHours()}>
            {busy === "hours" ? "Salvando…" : "Salvar jornada"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold text-foreground">Indisponibilidades</h3>
          <p className="text-sm text-muted-foreground">Bloqueie folgas, férias ou saídas sem apagar a jornada recorrente.</p>
        </CardHeader>
        <CardContent>
          {timeOff.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma indisponibilidade cadastrada.</p>
          ) : (
            <div className="space-y-2">
              {timeOff.map((item) => (
                <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <strong className="font-semibold text-foreground">{dateTimeLabel(item.startsAt, timezone)} → {dateTimeLabel(item.endsAt, timezone)}</strong>
                    {item.reason ? <p className="mt-1 text-muted-foreground">{item.reason}</p> : null}
                  </div>
                  <Button type="button" size="sm" variant="outline" disabled={isBusy} onClick={() => setPendingRemoval(item.id)}>Remover</Button>
                </div>
              ))}
            </div>
          )}

          <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={createTimeOff}>
            <div className="space-y-2">
              <Label htmlFor="time-off-date">Data</Label>
              <Input id="time-off-date" name="date" type="date" required disabled={isBusy} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time-off-reason">Motivo</Label>
              <Input id="time-off-reason" name="reason" maxLength={240} placeholder="Opcional" disabled={isBusy} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time-off-start">Início</Label>
              <Input id="time-off-start" name="startsAt" type="time" defaultValue="09:00" required disabled={isBusy} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time-off-end">Fim</Label>
              <Input id="time-off-end" name="endsAt" type="time" defaultValue="10:00" required disabled={isBusy} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={isBusy}>{busy === "time-off-create" ? "Adicionando…" : "Adicionar indisponibilidade"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => { if (!open && !isBusy) setPendingRemoval(null); }}
        title="Remover indisponibilidade?"
        description={removal ? `O bloqueio de ${dateTimeLabel(removal.startsAt, timezone)} será removido da agenda.` : "A indisponibilidade será removida da agenda."}
        confirmLabel="Remover indisponibilidade"
        busy={busy === "time-off-remove"}
        onConfirm={removeTimeOff}
      />
    </div>
  );
}
