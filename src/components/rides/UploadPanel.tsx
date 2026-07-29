"use client";

import { useRef, useState } from "react";
import type { UploadOutcome } from "@/app/(app)/rides/actions";

const mono = "var(--font-mono)";

type Row = {
  id: number;
  file: string;
  status: "uploading" | UploadOutcome["status"];
  detail: string;
};

/**
 * The log-page header + upload affordance (Rides.dc.html §logheader / §UPLOAD): a drop zone on
 * desktop, a compact ↑ button on mobile (CSS-toggled — see .ride-drop / .ride-upload-btn), and
 * per-file result rows beneath. Each dropped file resolves independently to one of three honest
 * outcomes: INGESTED (new card appears), DEDUPED (calm — the daemon era re-sends files forever),
 * FAILED (loud, with the reason). Files go through the same ingest pipeline as the API.
 */
export function UploadPanel({
  title,
  subline,
  upload,
}: {
  title: string;
  subline: string;
  upload: (fd: FormData) => Promise<UploadOutcome>;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const nextId = useRef(1);

  async function ingest(files: File[]) {
    const staged = files.map((f) => ({ id: nextId.current++, file: f.name, status: "uploading" as const, detail: "uploading + decoding…" }));
    setRows((r) => [...r, ...staged]);
    // Sequential on purpose: server actions queue per client anyway, and one-at-a-time keeps
    // each row's outcome tied to its own file.
    for (let i = 0; i < files.length; i++) {
      const fd = new FormData();
      fd.set("file", files[i]);
      let outcome: UploadOutcome;
      try {
        outcome = await upload(fd);
      } catch {
        outcome = { file: files[i].name, status: "failed", detail: "upload failed — try again" };
      }
      setRows((r) => r.map((row) => (row.id === staged[i].id ? { ...row, status: outcome.status, detail: outcome.detail } : row)));
    }
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) void ingest(files);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) void ingest(files);
  };

  const input = <input type="file" multiple accept=".fit" onChange={onPick} style={{ display: "none" }} />;

  return (
    <>
      <section style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, padding: "18px 0 14px" }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em" }}>{title}</h1>
          <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 5 }}>{subline}</div>
        </div>

        {/* Desktop: the drop zone */}
        <div
          className="ride-drop"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={{
            alignItems: "center",
            gap: 10,
            padding: "9px 13px",
            borderRadius: "var(--radius)",
            border: `1px dashed ${dragOver ? "var(--color-accent)" : "var(--color-border)"}`,
            background: dragOver ? "var(--band)" : "var(--color-surface)",
          }}
        >
          <span style={{ fontFamily: mono, fontSize: 11, color: "var(--color-text-muted)" }}>
            {dragOver ? "release to ingest" : "drop .fit files"}
          </span>
          <label style={{ fontFamily: mono, fontSize: 11, color: "var(--color-accent)", cursor: "pointer", borderBottom: "1px dashed var(--color-accent)" }}>
            choose
            {input}
          </label>
        </div>

        {/* Mobile: the compact upload button (Rides Mobile.dc.html header) */}
        <label
          className="ride-upload-btn"
          style={{
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            background: "var(--band)",
            border: "1px solid var(--color-accent)",
            borderRadius: "var(--radius)",
            color: "var(--color-accent)",
            fontFamily: mono,
            fontSize: 17,
            lineHeight: 1,
            cursor: "pointer",
          }}
        >
          ↑{input}
        </label>
      </section>

      {rows.length > 0 && (
        <section style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)", background: "var(--color-surface)", marginBottom: 18, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 14px", borderBottom: "1px solid var(--color-border)" }}>
            <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.14em", color: "var(--color-text-muted)" }}>UPLOAD</span>
            <button onClick={() => setRows([])} style={{ background: "none", border: "none", color: "var(--color-text-muted)", fontFamily: mono, fontSize: 10, cursor: "pointer" }}>
              clear
            </button>
          </div>
          {rows.map((u) => (
            <UploadRow key={u.id} row={u} dismiss={() => setRows((r) => r.filter((x) => x.id !== u.id))} />
          ))}
        </section>
      )}
    </>
  );
}

function UploadRow({ row, dismiss }: { row: Row; dismiss: () => void }) {
  const pending = row.status === "uploading";
  const color =
    row.status === "ingested" ? "var(--color-success)" : row.status === "failed" ? "var(--color-over)" : "var(--color-text-muted)";
  return (
    <div className="ride-upload-row" style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)" }}>
      <span style={{ gridArea: "file", fontFamily: mono, fontSize: 11.5, color: "var(--color-text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {row.file}
      </span>
      <span style={{ gridArea: "bar", height: 3, borderRadius: 2, background: "var(--color-surface-raised)", overflow: "hidden", alignSelf: "center" }}>
        <span
          className={pending ? "ride-upload-indeterminate" : undefined}
          style={{
            display: "block",
            height: "100%",
            width: pending ? "40%" : "100%",
            background: row.status === "failed" ? "var(--color-over)" : "var(--color-accent)",
          }}
        />
      </span>
      <span
        style={{
          gridArea: "tag",
          fontFamily: mono,
          fontSize: 9,
          letterSpacing: "0.1em",
          justifySelf: "start",
          padding: "2px 6px",
          borderRadius: 3,
          fontVariantNumeric: "tabular-nums",
          color,
          border: `1px solid ${row.status === "failed" ? "var(--color-over)" : "var(--color-border)"}`,
        }}
      >
        {pending ? "···" : row.status.toUpperCase()}
      </span>
      <span style={{ gridArea: "detail", fontFamily: mono, fontSize: 10.5, color: "var(--color-text-muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {row.detail}
      </span>
      <button onClick={dismiss} style={{ gridArea: "x", background: "none", border: "none", color: "var(--color-text-muted)", fontFamily: mono, fontSize: 12, cursor: "pointer", padding: "0 2px" }}>
        ×
      </button>
    </div>
  );
}
