"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { RideDetail as RideDetailData } from "@/lib/rides/types";
import { ft, hms, mdLong, mi, mph, rideTag, rideTitle, watts } from "./format";
import { RideCharts } from "./RideCharts";
import { RideMap } from "./RideMap";
import { ZoneBar } from "./ZoneBar";

const mono = "var(--font-mono)";

/**
 * The ride detail (Rides.dc.html §RIDE DETAIL): header with click-to-name, the stat band, the
 * zone histogram, the effort charts, the route map, and the note — every section rendering only
 * when its data exists (a trainer ride simply has no map section; a watch ride no power tile).
 * The ONLY writable things on this page are `name` and `note` — everything else is the meter's.
 */
export function RideDetail({
  ride,
  localStart,
  saveName,
  saveNote,
  deleteRide,
}: {
  ride: RideDetailData;
  /** "7:46 PM" — derived server-side in the app timezone. */
  localStart: string;
  /** Bound server actions. Absent in the dev /preview harness (writes become local-only). */
  saveName?: (name: string) => Promise<void>;
  saveNote?: (note: string) => Promise<void>;
  deleteRide?: () => Promise<void>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Optimistic human layer (the lifting-detail pattern): local value leads, action follows.
  const [name, setName] = useState(ride.name);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [note, setNote] = useState(ride.note ?? "");
  const [noteSaved, setNoteSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedNote = useRef(ride.note ?? "");

  const title = rideTitle({ ...ride, name });

  const commitName = () => {
    const v = nameDraft.trim();
    setName(v || null);
    setEditingName(false);
    if (saveName) startTransition(() => void saveName(v));
  };

  const commitNote = () => {
    if (note === lastSavedNote.current) return;
    lastSavedNote.current = note;
    if (saveNote) startTransition(() => void saveNote(note));
    setNoteSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setNoteSaved(false), 1600);
  };

  const doDelete = () => {
    startTransition(async () => {
      await deleteRide?.();
      router.push(`/rides?deleted=${encodeURIComponent(title)}`);
    });
  };

  // The stat band — mirrors the design's order; absent facts get no tile (STOP #1).
  const stats: { label: string; value: string }[] = [{ label: "MOVING", value: hms(ride.movingSeconds) }];
  if (Math.abs(ride.elapsedSeconds - ride.movingSeconds) > 30) stats.push({ label: "ELAPSED", value: hms(ride.elapsedSeconds) });
  if (ride.distanceMeters != null) stats.push({ label: "DISTANCE", value: `${mi(ride.distanceMeters)} mi` });
  if (ride.totalAscentMeters != null) stats.push({ label: "ASCENT", value: `${ft(ride.totalAscentMeters)} ft` });
  if (ride.totalDescentMeters != null) stats.push({ label: "DESCENT", value: `${ft(ride.totalDescentMeters)} ft` });
  if (ride.avgHeartRate != null) stats.push({ label: "AVG HR", value: `${ride.avgHeartRate} bpm` });
  if (ride.maxHeartRate != null) stats.push({ label: "MAX HR", value: `${ride.maxHeartRate} bpm` });
  if (ride.avgSpeedMps != null) stats.push({ label: "AVG SPEED", value: `${mph(ride.avgSpeedMps)} mph` });
  if (ride.maxSpeedMps != null) stats.push({ label: "MAX SPEED", value: `${mph(ride.maxSpeedMps)} mph` });
  if (ride.avgPowerWatts != null) stats.push({ label: "AVG POWER", value: `${watts(ride.avgPowerWatts)} W` });
  if (ride.normalizedPowerWatts != null) stats.push({ label: "NP", value: `${watts(ride.normalizedPowerWatts)} W` });
  if (ride.maxPowerWatts != null) stats.push({ label: "MAX POWER", value: `${watts(ride.maxPowerWatts)} W` });
  if (ride.calories != null) stats.push({ label: "CALORIES", value: `${ride.calories.toLocaleString("en-US")} kcal` });
  if (ride.avgTemperatureC != null) stats.push({ label: "AVG TEMP", value: `${Math.round((ride.avgTemperatureC * 9) / 5 + 32)}°F` });

  const stream = ride.stream;
  const hasGps = !!stream?.data.lat;

  return (
    <div>
      <button
        onClick={() => router.push("/rides")}
        style={{ background: "none", border: "none", padding: 0, color: "var(--color-text-muted)", fontFamily: mono, fontSize: 11, cursor: "pointer", marginBottom: 16 }}
      >
        ‹ log
      </button>

      {/* header */}
      <section style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, paddingBottom: 18, borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ minWidth: 0 }}>
          {editingName ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                value={nameDraft}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                placeholder="name this ride"
                style={{ width: "min(300px, 100%)", background: "var(--color-surface-raised)", border: "1px solid var(--color-accent)", borderRadius: "var(--radius)", color: "var(--color-text)", fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, padding: "5px 10px", caretColor: "var(--color-accent)", outline: "none" }}
              />
              <button onClick={commitName} style={{ background: "none", border: "1px solid var(--color-accent)", borderRadius: "var(--radius)", color: "var(--color-accent)", fontFamily: mono, fontSize: 10, letterSpacing: "0.08em", padding: "5px 9px", cursor: "pointer" }}>
                SAVE
              </button>
              <button onClick={() => setEditingName(false)} style={{ background: "none", border: "none", color: "var(--color-text-muted)", fontFamily: mono, fontSize: 10, cursor: "pointer" }}>
                esc
              </button>
            </div>
          ) : (
            <h1
              onClick={() => {
                setNameDraft(name ?? "");
                setEditingName(true);
              }}
              className="ride-name"
              style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 23, fontWeight: 600, letterSpacing: "-0.025em", color: "var(--color-text)", cursor: "text", display: "inline-flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}
            >
              {title}
              <span style={{ fontFamily: mono, fontSize: 10, color: "var(--color-text-muted)", fontWeight: 400, whiteSpace: "nowrap" }}>
                {name ? "" : "(unnamed — click to name)"}
              </span>
            </h1>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 9 }}>
            <span style={{ fontFamily: mono, fontSize: 12, color: "var(--color-text)" }}>
              {mdLong(ride.localDate)} · {localStart}
            </span>
            <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.1em", color: "var(--color-text-muted)", border: "1px solid var(--color-border)", borderRadius: 3, padding: "2px 6px" }}>
              {rideTag(ride)}
            </span>
            {ride.deviceProduct && <span style={{ fontFamily: mono, fontSize: 10, color: "var(--color-text-muted)" }}>{ride.deviceProduct}</span>}
          </div>
        </div>

        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10 }}>
          {confirmDelete && (
            <div style={{ display: "flex", alignItems: "center", gap: 9, border: "1px solid var(--color-over)", borderRadius: "var(--radius)", padding: "5px 9px" }}>
              <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>delete ride?</span>
              <button onClick={doDelete} style={{ background: "none", border: "none", color: "var(--color-over)", fontFamily: mono, fontSize: 10.5, cursor: "pointer" }}>
                yes
              </button>
              <button onClick={() => setConfirmDelete(false)} style={{ background: "none", border: "none", color: "var(--color-text-muted)", fontFamily: mono, fontSize: 10.5, cursor: "pointer" }}>
                cancel
              </button>
            </div>
          )}
          <button
            onClick={() => setConfirmDelete((v) => !v)}
            style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", color: "var(--color-text-muted)", fontFamily: mono, fontSize: 12, lineHeight: 1, padding: "5px 8px", cursor: "pointer" }}
          >
            ⋯
          </button>
        </div>
      </section>

      {/* stat band */}
      <section style={{ display: "flex", flexWrap: "wrap", gap: 1, background: "var(--color-border)", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", marginTop: 20, overflow: "hidden" }}>
        {stats.map((s) => (
          <div key={s.label} style={{ flex: "1 1 118px", minWidth: 118, background: "var(--color-surface)", padding: "12px 14px" }}>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", color: "var(--color-text-muted)" }}>{s.label}</div>
            <div style={{ fontFamily: mono, fontSize: 17, fontWeight: 600, color: "var(--color-text)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", marginTop: 5 }}>
              {s.value}
            </div>
          </div>
        ))}
      </section>

      {ride.timeInHrZone && <ZoneBar zoneData={ride.timeInHrZone} />}

      {stream && <RideCharts stream={stream} />}

      {hasGps && stream && (
        <section style={{ marginTop: 26 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingBottom: 10 }}>
            <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>ROUTE</span>
            <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
              {ride.distanceMeters != null ? `gps · ${mi(ride.distanceMeters)} mi` : "gps"}
            </span>
          </div>
          <RideMap stream={stream} />
        </section>
      )}

      {/* note — the one editorial element on the page */}
      <section style={{ marginTop: 26, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface-raised)", padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingBottom: 9 }}>
          <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>NOTE</span>
          <span style={{ fontFamily: mono, fontSize: 10, color: "var(--color-accent)" }}>{noteSaved ? "saved" : ""}</span>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={commitNote}
          placeholder="add a note"
          rows={3}
          style={{ width: "100%", resize: "vertical", background: "none", border: "none", color: "var(--color-text)", fontFamily: "var(--font-body)", fontSize: 14, lineHeight: 1.6, padding: 0, caretColor: "var(--color-accent)", outline: "none" }}
        />
      </section>
    </div>
  );
}
