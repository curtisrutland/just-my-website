"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Fixed bottom tab bar (design brief §4). Icon + label, active = accent + top border. Built as a
 *  flex row so a 4th/5th tab (lifting, riding) drops in without a rethink. */
const TABS = [
  {
    href: "/panel/health",
    label: "Health",
    icon: (
      <path d="M20.8 6.6a5 5 0 0 0-7.1 0L12 8.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21l8.8-7.3a5 5 0 0 0 0-7.1z" />
    ),
  },
  {
    href: "/panel/shopping",
    label: "Shopping",
    icon: (
      <>
        <circle cx="9" cy="20" r="1.4" />
        <circle cx="18" cy="20" r="1.4" />
        <path d="M2 3h3l2.4 12.4a1 1 0 0 0 1 .8h8.7a1 1 0 0 0 1-.8L20.5 7H6" />
      </>
    ),
  },
  {
    href: "/panel/recipe",
    label: "Recipe",
    icon: (
      <>
        <path d="M4 10h16v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5z" />
        <path d="M2 10h20" />
        <path d="M20 12h2.2v3H20M4 12H1.8v3H4" />
      </>
    ),
  },
];

export function PanelTabBar() {
  const pathname = usePathname();
  return (
    <nav className="p-tabbar">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className="p-tab" data-active={pathname.startsWith(t.href) ? "1" : "0"}>
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {t.icon}
          </svg>
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
