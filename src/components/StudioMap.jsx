import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Crosshair, Maximize, Minus, Plus } from 'lucide-react';

export function StudioMap({ lines, center, onCenterChange, fitKey, markerLabel = 'Design center', track = [] }) {
  const element = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const onCenterRef = useRef(onCenterChange);
  const pickingRef = useRef(false);
  const boundsRef = useRef(null);
  const [picking, setPicking] = useState(false);
  const [tileError, setTileError] = useState(false);
  onCenterRef.current = onCenterChange;
  pickingRef.current = picking;

  useEffect(() => {
    const map = L.map(element.current, { zoomControl: false, scrollWheelZoom: true }).setView([center.lat, center.lng], 13);
    const tiles = L.tileLayer(import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    tiles.on('tileerror', () => setTileError(true));
    tiles.on('load', () => setTileError(false));
    L.control.scale({ imperial: false }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerRef.current = layer;
    map.on('click', (event) => {
      if (!pickingRef.current) return;
      onCenterRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng });
      setPicking(false);
    });
    let previousWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      map.invalidateSize();
      if (entry.contentRect.width !== previousWidth && entry.contentRect.width > 0 && boundsRef.current) {
        map.fitBounds(boundsRef.current, { padding: [48, 48], maxZoom: 16, animate: false });
      }
      previousWidth = entry.contentRect.width;
    });
    observer.observe(element.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const bounds = L.latLngBounds([]);
    lines.forEach(({ coordinates, color, dashed, weight = 4, opacity = 1 }) => {
      if (coordinates.length < 2) return;
      const points = coordinates.map((point) => [point.lat, point.lng]);
      bounds.extend(points);
      if (!dashed) L.polyline(points, { color: '#fff', weight: weight + 3, opacity: 0.85, interactive: false }).addTo(layer);
      L.polyline(points, { color, weight, opacity, dashArray: dashed ? '7 7' : undefined, lineCap: 'round', interactive: false }).addTo(layer);
    });
    const marker = L.circleMarker([center.lat, center.lng], { radius: 6, color: '#fff', weight: 3, fillColor: '#202728', fillOpacity: 1 }).addTo(layer);
    marker.bindTooltip(markerLabel);
    if (track.length) {
      const segments = [];
      track.forEach((point, index) => {
        if (index === 0 || point.segment !== track[index - 1].segment) segments.push([]);
        segments.at(-1).push([point.lat, point.lng]);
      });
      L.polyline(segments, { color: '#246bb0', weight: 4 }).addTo(layer);
      const point = track.at(-1);
      L.circleMarker([point.lat, point.lng], { radius: 7, color: '#fff', fillColor: '#246bb0', fillOpacity: 1, weight: 3 }).addTo(layer);
    }
    boundsRef.current = bounds.isValid() ? bounds : L.latLngBounds([[center.lat - 0.01, center.lng - 0.01], [center.lat + 0.01, center.lng + 0.01]]);
  }, [lines, center, markerLabel, track]);

  useEffect(() => {
    if (boundsRef.current) mapRef.current?.fitBounds(boundsRef.current, { padding: [65, 65], maxZoom: 16, animate: false });
  }, [fitKey]);

  return <div className={`studioMap ${picking ? 'isPicking' : ''}`}>
    <div className="mapCanvas" ref={element} role="region" aria-label="Interactive route map" />
    <div className="mapTools" aria-label="Map controls">
      {onCenterChange && <button type="button" className={picking ? 'isActive' : ''} aria-label="Choose location on map" title="Choose location on map" aria-pressed={picking} onClick={() => setPicking(!picking)}><Crosshair size={19} /></button>}
      <button type="button" aria-label="Fit design to view" title="Fit to view" onClick={() => mapRef.current?.fitBounds(boundsRef.current, { padding: [60, 60], maxZoom: 16 })}><Maximize size={18} /></button>
      <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}><Plus size={19} /></button>
      <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}><Minus size={19} /></button>
    </div>
    {picking && <div className="mapNotice" role="status">Choose a location on the map</div>}
    {tileError && <div className="mapNotice" role="status">Some map tiles could not load. Check your connection.</div>}
  </div>;
}
