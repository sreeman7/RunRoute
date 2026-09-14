import React, { useMemo } from 'react';
import { ArrowDownToLine, ArrowRight, Navigation, RefreshCcw, Save } from 'lucide-react';
import { LocationFields } from './RouteArtStudio';
import { StudioMap } from './StudioMap';

export function PlannerWorkspace({ form, onChange, routes, selected, onSelect, onGenerate, routing, status, onSave, saved, onStart, onExport }) {
  const update = (key, value) => onChange((current) => ({ ...current, [key]: value }));
  const center = form.start;
  const setCenter = (point) => onChange((current) => ({ ...current, start: point, startLabel: `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}` }));
  const lines = useMemo(() => routes.map((route) => ({ coordinates: route.coordinates, color: route.id === selected.id ? '#14786c' : '#7c9299', dashed: route.source !== 'walking', weight: route.id === selected.id ? 5 : 3, opacity: route.id === selected.id ? 1 : 0.65 })), [routes, selected]);
  const ready = selected.source === 'walking';
  return <div className="studioWorkspace">
    <aside className="studioSidebar" aria-label="Run planning controls">
      <div className="workspaceTitle"><span className="sectionKicker">PLAN A RUN</span><h1>Your next route</h1><p>Start somewhere. Go somewhere.</p></div>
      <LocationFields center={center} onChange={setCenter} label="Starting point" />
      <div className="plannerNumbers"><label className="controlGroup">Target distance<div className="unitInput"><input aria-label="Target distance" type="number" min="1" max="60" step="0.5" value={form.distanceKm} onChange={(e) => update('distanceKm', e.target.value)} /><span>km</span></div></label><label className="controlGroup">Pace<div className="unitInput"><input aria-label="Pace" type="number" min="3" max="12" step="0.1" value={form.paceMinPerKm} onChange={(e) => update('paceMinPerKm', e.target.value)} /><span>min/km</span></div></label></div>
      <div className="controlGroup"><span className="controlLabel">Route type</span><div className="studioSegments" role="group" aria-label="Route type">{[['loop', 'Loop'], ['one-way', 'One-way'], ['out-and-back', 'Out & back']].map(([id, label]) => <button key={id} type="button" aria-pressed={form.routeType === id} className={form.routeType === id ? 'selected' : ''} onClick={() => update('routeType', id)}>{label}</button>)}</div></div>
      <button className="studioPrimary" type="button" onClick={onGenerate} disabled={routing}><RefreshCcw size={16} />{routing ? 'Finding walking routes...' : 'Find walking routes'}<ArrowRight size={17} /></button>
      <div className="optionHeading"><h2>Route options</h2><span>{routes.length}</span></div>
      <div className="studioRouteList">{routes.map((route, i) => <button className={`studioRouteOption ${selected.id === route.id ? 'selected' : ''}`} type="button" key={route.id} onClick={() => onSelect(route.id)}><span className="optionNumber">{String(i + 1).padStart(2, '0')}</span><div><strong>{route.name}</strong><small>{route.source === 'walking' ? 'Walking route' : 'Unrouted draft'}</small></div><span>{route.distanceKm.toFixed(1)}<small>km</small></span></button>)}</div>
      <p className="mutedNote">Saved routes stay on this device.</p>
    </aside>
    <section className="studioMain" aria-label="Route planning map">
      <div className="workspaceBar"><div><span className={`statusDot ${ready ? 'ready' : ''}`} /><strong>{selected.name}</strong><span className="smallTag">{ready ? 'Walking route' : 'Design draft'}</span></div></div>
      <StudioMap lines={lines} center={center} onCenterChange={setCenter} markerLabel="Starting point" fitKey={routes} />
      <div className="mapKey"><span><i className={ready ? 'walkingLine' : 'connectorLine'} />{ready ? 'Walking route' : 'Unrouted draft'}</span><span className="mapKeyRight">{ready ? 'openrouteservice / walking' : 'Not a navigable route'}</span></div>
      <div className="designSummary"><div className="summaryMetric"><span>{ready ? 'Walking distance' : 'Draft distance'}</span><strong>{selected.distanceKm.toFixed(2)} <small>km</small></strong></div><div className="summaryMetric"><span>Estimated time</span><strong>{Math.round(selected.distanceKm * Number(form.paceMinPerKm || 7))} <small>min</small></strong></div><div className="summaryMetric"><span>Target difference</span><strong>{Math.abs(selected.distanceKm - Number(form.distanceKm || 20)).toFixed(2)} <small>km</small></strong></div><div className="summaryMetric"><span>Elevation & safety</span><strong className="unknownMetric">Not assessed</strong></div></div>
      <div className="studioFeedback"><p role="status">{status || (ready ? 'Review crossings and local access before running. Walking routes are not a safety guarantee.' : 'This is a geometric draft. Fit it to walking paths before saving, exporting, or running.')}</p><div className="resultActions"><button className="studioSecondary" type="button" disabled={!ready} onClick={() => onSave(selected)}><Save size={16} />{saved ? 'Saved' : 'Save route'}</button><button className="studioSecondary" type="button" disabled={!ready} onClick={onExport}><ArrowDownToLine size={16} />GPX</button><button className="studioPrimary" type="button" disabled={!ready} onClick={onStart}><Navigation size={16} />Start run</button></div></div>
      <div className="studioBottom"><span>Distance target: ±2.5%</span><span>Actual distance always shown</span></div>
    </section>
  </div>;
}
