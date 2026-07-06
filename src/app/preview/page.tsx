import { notFound } from "next/navigation";
import { Landing } from "@/components/Landing";

/** Dev-only unauthenticated preview of the root landing. 404s in production. */
export default function PreviewIndex() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Landing />;
}
