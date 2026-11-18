/**
 * Colours that mean "which one": a bike, a ride type. Fixed order, never cycled, so a thing keeps
 * its colour from piece to piece. Checked as a set on the dark background: every pair is told
 * apart at a glance. (They are not chosen for colour-blind separation; legends carry the names.)
 *
 * The bikes took them in order of first ride: Neuron 6 blue, Checkpoint ALR4 yellow, Roscoe 8
 * green, Model C magenta. A ride type takes its bike's colour: MTB blue, Gravel/Road yellow, BMX
 * magenta.
 */
export const CATEGORICAL = ["#3987e5", "#c98500", "#199e70", "#d55181"] as const;

/** `amount` of `colour` over `base`, as a hex colour: the steps of a single-hue ramp. */
export function mix(colour: string, base: string, amount: number): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [a, b] = [channels(colour), channels(base)];
  return `#${a.map((v, i) => Math.round(v * amount + b[i] * (1 - amount)).toString(16).padStart(2, "0")).join("")}`;
}
