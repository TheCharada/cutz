import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const variants = {
  neutral: "border-border bg-secondary text-secondary-foreground",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  destructive: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

export type BadgeVariant = keyof typeof variants;

export function Badge({
  className,
  variant = "neutral",
  ...props
}: ComponentProps<"span"> & { variant?: BadgeVariant }) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
