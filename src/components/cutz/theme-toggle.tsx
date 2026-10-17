"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const themeChangeEvent = "cutz-theme-change";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(callback: () => void) {
  window.addEventListener(themeChangeEvent, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(themeChangeEvent, callback);
    window.removeEventListener("storage", callback);
  };
}

function serverTheme(): Theme {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, currentTheme, serverTheme);

  function toggleTheme() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("cutz-theme", next);
    window.dispatchEvent(new Event(themeChangeEvent));
  }

  const target = theme === "dark" ? "claro" : "escuro";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Ativar tema ${target}`}
      title={`Ativar tema ${target}`}
      className="fixed bottom-4 right-4 z-50 inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-3 text-sm font-semibold text-card-foreground shadow-md transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {theme === "dark" ? "Tema claro" : "Tema escuro"}
    </button>
  );
}
