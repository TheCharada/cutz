"use client";

import type { PublicService, PublicStaffMember } from "@/modules/catalog";
import { formatPriceCents } from "@/shared/money";
import { CatalogPhoto } from "./catalog-photo";

type Common = {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  name: string;
};

const card = "pointer-events-none flex h-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2";
const option = "relative block cursor-pointer";

export function ServiceChoices({
  services, value, onChange, disabled, name,
}: Common & { services: PublicService[] }) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-foreground">Serviço</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => (
          <label key={service.id} className={option}>
            <input
              type="radio"
              name={name}
              value={service.id}
              aria-label={service.name}
              checked={value === service.id}
              onChange={() => onChange(service.id)}
              className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
            />
            <span className={card}>
              <CatalogPhoto src={service.imageUrl} name={service.name} className="size-16" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{service.name}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {service.durationMinutes} min · {formatPriceCents(service.priceCents)}
                </span>
                {value === service.id ? (
                  <span className="mt-1 block text-xs font-semibold text-primary">Selecionado</span>
                ) : null}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function StaffChoices({
  staff, value, onChange, disabled, name, allowAny = false,
}: Common & { staff: PublicStaffMember[]; allowAny?: boolean }) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-foreground">Profissional</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {allowAny ? (
          <label className={option}>
            <input
              type="radio"
              name={name}
              value=""
              aria-label="Qualquer profissional compatível"
              checked={value === ""}
              onChange={() => onChange("")}
              className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
            />
            <span className={card}>
              <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-muted text-xs font-semibold text-muted-foreground" aria-hidden="true">Todos</span>
              <span className="text-sm font-semibold text-foreground">
                Qualquer profissional compatível
                {value === "" ? <span className="mt-1 block text-xs text-primary">Selecionado</span> : null}
              </span>
            </span>
          </label>
        ) : null}
        {staff.map((member) => (
          <label key={member.id} className={option}>
            <input
              type="radio"
              name={name}
              value={member.id}
              aria-label={member.name}
              checked={value === member.id}
              onChange={() => onChange(member.id)}
              className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
            />
            <span className={card}>
              <CatalogPhoto src={member.imageUrl} name={member.name} className="size-16" />
              <span className="min-w-0 text-sm font-semibold text-foreground">
                {member.name}
                {value === member.id ? <span className="mt-1 block text-xs text-primary">Selecionado</span> : null}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
