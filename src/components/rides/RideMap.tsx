"use client";

import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RideStreamView } from "@/lib/rides/types";

/**
 * The route map (Rides.dc.html §ROUTE): the GPS polyline in the accent color over muted CARTO
 * raster tiles (dark/light follows the site theme live). Leaflet is loaded dynamically at mount
 * — it touches `window` at import time, so it can never run during SSR. Rides without GPS never
 * render this component at all (the page omits the section).
 */
export function RideMap({ stream }: { stream: RideStreamView }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const tilesRef = useRef<Leaflet.TileLayer | null>(null);

  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;

    const tileUrl = () => {
      const theme = document.documentElement.dataset.theme === "light" ? "light_all" : "dark_all";
      return `https://{s}.basemaps.cartocdn.com/${theme}/{z}/{x}/{y}{r}.png`;
    };

    (async () => {
      const L = (await import("leaflet")).default;
      const el = elRef.current;
      if (cancelled || !el || mapRef.current) return;

      const lat = stream.data.lat;
      const lon = stream.data.lon;
      if (!lat || !lon) return;
      const pts: [number, number][] = [];
      for (let i = 0; i < lat.length; i++) {
        if (lat[i] != null && lon[i] != null) pts.push([lat[i]!, lon[i]!]);
      }
      if (pts.length === 0) return;

      const map = L.map(el, { scrollWheelZoom: false, zoomControl: true });
      mapRef.current = map;
      tilesRef.current = L.tileLayer(tileUrl(), {
        subdomains: "abcd",
        maxZoom: 19,
        attribution: "© OpenStreetMap · © CARTO",
      }).addTo(map);

      const cs = getComputedStyle(el);
      const accent = (cs.getPropertyValue("--color-accent") || "#3ad0d6").trim();
      const bg = (cs.getPropertyValue("--color-bg") || "#0a0d0f").trim();
      const txt = (cs.getPropertyValue("--color-text") || "#e7eef1").trim();
      L.polyline(pts, { color: accent, weight: 3, opacity: 0.95, lineJoin: "round" }).addTo(map);
      L.circleMarker(pts[0], { radius: 5, color: accent, weight: 2, fillColor: bg, fillOpacity: 1 }).addTo(map);
      L.circleMarker(pts[pts.length - 1], { radius: 4, color: txt, weight: 1, fillColor: txt, fillOpacity: 1 }).addTo(map);
      map.fitBounds(L.latLngBounds(pts).pad(0.12));
      setTimeout(() => {
        if (mapRef.current === map) map.invalidateSize();
      }, 200);

      // Follow the site theme toggle live (ThemeToggle stamps data-theme on <html>).
      observer = new MutationObserver(() => tilesRef.current?.setUrl(tileUrl()));
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      tilesRef.current = null;
    };
    // The stream is immutable for a given ride page; mount-once is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={elRef} className="ride-map" style={{ height: 330, border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden" }} />;
}
