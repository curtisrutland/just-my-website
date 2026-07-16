import { redirect } from "next/navigation";

/** /panel → /panel/health (contract §2). */
export default function PanelIndex() {
  redirect("/panel/health");
}
