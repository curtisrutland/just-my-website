"use client";

import { useEffect, useState } from "react";

/** Dark ⇄ light toggle, applied via data-theme on the root (drives the token block). Default dark. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      document.documentElement.dataset.theme = saved;
    }
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--color-text-muted)",
        background: "transparent",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        padding: "6px 10px",
        cursor: "pointer",
        width: "100%",
        textAlign: "left",
      }}
    >
      {theme === "dark" ? "◐  dark" : "◑  light"}
    </button>
  );
}
