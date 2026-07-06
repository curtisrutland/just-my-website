import { redirect } from "next/navigation";
import { todayISO } from "@/lib/date";

// "today" is computed per request, not baked at build.
export const dynamic = "force-dynamic";

/** /macros → today's day view. */
export default function MacrosIndex() {
  redirect(`/macros/${todayISO()}`);
}
