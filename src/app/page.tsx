import { Landing } from "@/components/Landing";

// "today" (the macros link resolves to today's dated view) is computed per request, not baked at build.
export const dynamic = "force-dynamic";

/** Gated root landing — the module list you land on after sign-in. */
export default function Home() {
  return <Landing />;
}
