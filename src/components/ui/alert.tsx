import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const variants = {
  default: "border-border bg-card text-card-foreground",
  destructive: "border-destructive/25 bg-destructive/6 text-destructive",
  success: "border-success/25 bg-success/6 text-success",
  warning: "border-warning/25 bg-warning/8 text-warning",
} as const;

export function Alert({ className, variant = "default", ...props }: ComponentProps<"div"> & { variant?: keyof typeof variants }) {
  return (
    <div
      data-slot="alert"
      className={cn("w-full rounded-xl border p-4", variants[variant], className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-title" className={cn("font-semibold leading-snug", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="alert-description" className={cn("mt-1 text-sm leading-relaxed opacity-90", className)} {...props} />;
}
