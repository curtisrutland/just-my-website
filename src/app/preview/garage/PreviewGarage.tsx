"use client";

import { BikeList } from "@/components/garage/BikeList";
import { BikePicker, type PickerBike } from "@/components/garage/BikePicker";
import type { BikeView } from "@/lib/garage/types";

const noop = async () => ({});

/** The garage's client components with local no-op writes (the preview harness has no actions). */
export function PreviewBikeList({ bikes }: { bikes: BikeView[] }) {
  return <BikeList bikes={bikes} save={noop} setRetired={noop} />;
}

export function PreviewPicker({ bikes, value }: { bikes: PickerBike[]; value: string | null }) {
  return <BikePicker bikes={bikes} value={value} tag={noop} />;
}
