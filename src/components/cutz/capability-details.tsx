import type { ReactNode } from "react";

export type CapabilityDetail = {
  label: string;
  value: ReactNode;
};

export function CapabilityDetails({ items }: { items: CapabilityDetail[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-sm font-medium text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 break-words text-sm font-medium text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
