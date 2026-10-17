import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/cutz/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Cutz",
    template: "%s · Cutz",
  },
  description: "Agenda, lista de espera e indicadores para barbearias.",
};

const themeBootScript = `(() => {
  try {
    const stored = window.localStorage.getItem("cutz-theme");
    const theme = stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
