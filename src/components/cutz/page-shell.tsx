import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const widths = {
  sm: "max-w-md",
  md: "max-w-3xl",
  lg: "max-w-5xl",
  xl: "max-w-6xl",
} as const;

export type PageShellSize = keyof typeof widths;

export function PageShell({ className, size = "md", ...props }: ComponentProps<"main"> & { size?: PageShellSize }) {
  return (
    <main
      className={cn("mx-auto min-h-svh w-full px-4 py-8 sm:px-6 sm:py-10", widths[size], className)}
      {...props}
    />
  );
}
