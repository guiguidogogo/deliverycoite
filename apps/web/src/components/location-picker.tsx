"use client";

import { useEffect, useRef } from "react";

type Location = {
  latitude: number;
  longitude: number;
};

type LocationPickerProps = {
  value: Location;
  onChange: (location: Location) => void;
  height?: number;
};

export function LocationPicker({ value, onChange, height = 260 }: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let disposed = false;

    void import("leaflet").then((leafletModule) => {
      if (disposed || !containerRef.current) return;
      const L = leafletModule.default;
      const map = L.map(containerRef.current).setView(
        [value.latitude, value.longitude],
        17
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap"
      }).addTo(map);

      const icon = L.divIcon({
        className: "",
        html: '<div class="location-picker-pin"></div>',
        iconSize: [30, 42],
        iconAnchor: [15, 40]
      });
      const marker = L.marker([value.latitude, value.longitude], {
        draggable: true,
        icon
      }).addTo(map);

      marker.on("dragend", () => {
        const position = marker.getLatLng();
        onChangeRef.current({
          latitude: position.lat,
          longitude: position.lng
        });
      });
      map.on("click", (event: import("leaflet").LeafletMouseEvent) => {
        marker.setLatLng(event.latlng);
        onChangeRef.current({
          latitude: event.latlng.lat,
          longitude: event.latlng.lng
        });
      });

      mapRef.current = map;
      markerRef.current = marker;
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    markerRef.current?.setLatLng([value.latitude, value.longitude]);
    mapRef.current?.panTo([value.latitude, value.longitude]);
  }, [value.latitude, value.longitude]);

  return (
    <div>
      <div
        ref={containerRef}
        className="overflow-hidden rounded-xl border border-black/10 dark:border-white/20"
        style={{ height }}
      />
      <p className="mt-1 text-xs opacity-65">
        Arraste o marcador ou toque no mapa para corrigir o ponto.
      </p>
    </div>
  );
}
