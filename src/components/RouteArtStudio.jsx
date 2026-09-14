import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, Heart, ImagePlus, LocateFixed, RotateCcw, Route, Save, Shapes, Star, Trash2, Type, Upload, Zap } from 'lucide-react';
import { buildArtDesign, readImageRaster, shapeDeviationMeters, templateStrokes, textStrokes, traceRaster } from '../lib/route-art';
import { requestWalkingRoute } from '../lib/routing-api';
import { StudioMap } from './StudioMap';

function OutlinePreview({ strokes }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#397e75';
    context.lineWidth = 2.5;
    context.lineJoin = 'round';
    strokes.forEach((stroke) => {
      context.beginPath();
      stroke.forEach(([x, y], i) => context[i === 0 ? 'moveTo' : 'lineTo'](160 + x * 140, 90 + y * 140));
      context.stroke();
    });
  }, [strokes]);
  return <canvas className="outlinePreview" ref={canvasRef} width="320" height="180" role="img" aria-label="Extracted design outline" />;
}

export function LocationFields({ center, onChange, label = 'Map center' }) {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [latitude, setLatitude] = useState(String(center.lat.toFixed(5)));
  const [longitude, setLongitude] = useState(String(center.lng.toFixed(5)));
  useEffect(() => { setLatitude(center.lat.toFixed(5)); setLongitude(center.lng.toFixed(5)); }, [center.lat, center.lng]);
  const commit = () => {
    const lat = Number(latitude), lng = Number(longitude);
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 80 || Math.abs(lng) > 180) {
      setError('Enter valid latitude (-80 to 80) and longitude (-180 to 180).'); return;
    }
    setError('');
    onChange({ lat, lng });
  };
  const locate = () => {
    if (!navigator.geolocation) { setError('Location is unavailable in this browser.'); return; }
    setLocating(true); setError('');
    navigator.geolocation.getCurrentPosition((position) => {
      onChange({ lat: position.coords.latitude, lng: position.coords.longitude }); setLocating(false);
    }, () => { setError('Location unavailable. Choose a point on the map or enter coordinates.'); setLocating(false); }, { timeout: 10000 });
  };
  return <div className="controlGroup locationFields">
    <div className="labelRow"><span>{label}</span><button type="button" className="subtleAction" onClick={locate} disabled={locating} title="Use current location"><LocateFixed size={15} />{locating ? 'Locating...' : 'Locate me'}</button></div>
    <div className="coordinateFields">
      <label><span>Latitude</span><input aria-label={`${label} latitude`} inputMode="decimal" value={latitude} onChange={(e) => setLatitude(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} /></label>
      <label><span>Longitude</span><input aria-label={`${label} longitude`} inputMode="decimal" value={longitude} onChange={(e) => setLongitude(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} /></label>
    </div>
    {error && <p className="fieldError" role="alert">{error}</p>}
  </div>;
}

export function RouteArtStudio({ initialCenter, onUseRoute, onSaveRoute, onExport }) {
  const [mode, setMode] = useState('shape');
  const [shape, setShape] = useState('heart');
  const [text, setText] = useState('RUN');
  const [raster, setRaster] = useState(null);
  const [fileName, setFileName] = useState('');
  const [threshold, setThreshold] = useState(150);
  const [invert, setInvert] = useState(false);
  const [center, setCenter] = useState(initialCenter);
  const [distance, setDistance] = useState(10);
  const [rotation, setRotation] = useState(0);
  const [loadedStrokes, setLoadedStrokes] = useState(null);
  const [designName, setDesignName] = useState('');
  const [status, setStatus] = useState('');
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [savedDesigns, setSavedDesigns] = useState(() => {
    try { const stored = JSON.parse(localStorage.getItem('runroute.artDesigns') || '[]'); return Array.isArray(stored) ? stored : []; } catch { return []; }
  });
  const requestRef = useRef(null);
  const uploadRef = useRef(0);
  const fileInputRef = useRef(null);
  const versionRef = useRef(0);
  const name = designName || (mode === 'text' ? text.trim().toUpperCase() || 'Untitled' : mode === 'image' ? fileName.replace(/\.[^.]+$/, '') || 'Image outline' : `${shape[0].toUpperCase()}${shape.slice(1)} study`);
  const outline = useMemo(() => {
    try {
      return { strokes: loadedStrokes || (mode === 'shape' ? templateStrokes(shape) : mode === 'text' ? textStrokes(text) : raster ? traceRaster(raster, threshold, invert) : []), error: '' };
    } catch (error) { return { strokes: [], error: error.message }; }
  }, [mode, shape, text, raster, threshold, invert, loadedStrokes]);
  const design = useMemo(() => {
    if (!outline.strokes.length) return null;
    try { return buildArtDesign(outline.strokes, center, Number(distance), rotation); } catch (error) { return { error: error.message }; }
  }, [outline, center, distance, rotation]);
  const valid = Boolean(design?.coordinates?.length);
  const deviation = useMemo(() => route && valid ? shapeDeviationMeters(design.coordinates, route.coordinates) : null, [route, design, valid]);

  useEffect(() => {
    versionRef.current++;
    requestRef.current?.abort();
    setRoute(null); setLoading(false); setStatus('');
  }, [design]);
  useEffect(() => () => { requestRef.current?.abort(); uploadRef.current++; }, []);

  const lines = useMemo(() => [
    ...(valid ? design.strokes.map((coordinates) => ({ coordinates, color: '#b57524', dashed: !route, opacity: route ? 0.65 : 1, weight: 3 })) : []),
    ...(valid ? design.connectors.map((coordinates) => ({ coordinates, color: '#738087', dashed: true, weight: 2 })) : []),
    ...(route ? [{ coordinates: route.coordinates, color: '#14786c', weight: 5 }] : [])
  ], [design, valid, route]);

  const changeMode = (next) => { uploadRef.current++; setReading(false); setMode(next); setLoadedStrokes(null); setDesignName(''); };
  const upload = async (file) => {
    if (!file) return;
    const id = ++uploadRef.current;
    setReading(true); setStatus('');
    try {
      const data = await readImageRaster(file);
      if (id !== uploadRef.current) return;
      setRaster(data); setFileName(file.name); setLoadedStrokes(null); setDesignName('');
    } catch (error) { if (id === uploadRef.current) setStatus(error.message); }
    finally { if (id === uploadRef.current) setReading(false); }
  };
  const fit = async () => {
    if (!valid || loading) return;
    const version = versionRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true); setStatus('');
    try {
      const result = await requestWalkingRoute(design.coordinates, controller.signal);
      if (version !== versionRef.current || controller.signal.aborted) return;
      setRoute({ ...result, id: `art-${crypto.randomUUID()}`, name, targetDistanceKm: Number(distance), routeType: 'art', style: 'art', color: '#14786c', description: 'Walking route fitted to a route-art outline.', label: 'Route art', stops: [], finish: result.coordinates.at(-1), pace: '7:00 min/km', estimatedTime: `${Math.round(result.distanceKm * 7)} min` });
    } catch (error) { if (error.name !== 'AbortError' && version === versionRef.current) setStatus(error.message); }
    finally { if (version === versionRef.current) setLoading(false); }
  };
  const persistDesigns = (next) => {
    try { localStorage.setItem('runroute.artDesigns', JSON.stringify(next)); setSavedDesigns(next); return true; }
    catch { setStatus('Device storage is full or unavailable. The design could not be saved.'); return false; }
  };
  const saveDesign = () => {
    if (!valid) return;
    if (persistDesigns([{ id: crypto.randomUUID(), name, strokes: outline.strokes, center, distance: Number(distance), rotation }, ...savedDesigns].slice(0, 20))) setStatus('Design saved on this device.');
  };
  const loadDesign = (saved) => {
    if (!saved || !Array.isArray(saved.strokes) || !Number.isFinite(saved.center?.lat) || !Number.isFinite(saved.center?.lng)) { setStatus('This saved design is damaged and cannot be opened.'); return; }
    uploadRef.current++;
    setReading(false); setLoadedStrokes(saved.strokes); setDesignName(saved.name); setCenter(saved.center); setDistance(saved.distance); setRotation(saved.rotation);
  };

  return <div className="studioWorkspace">
    <aside className="studioSidebar" aria-label="Route art controls">
      <div className="workspaceTitle"><span className="sectionKicker">CREATE A ROUTE</span><h1>Route art</h1><p>A little less ordinary.</p></div>
      <div className="controlGroup">
        <span className="controlLabel">Design source</span>
        <div className="studioSegments" role="group" aria-label="Design source">
          {[['shape', Shapes, 'Shape'], ['text', Type, 'Text'], ['image', ImagePlus, 'Image']].map(([id, Icon, label]) => <button key={id} type="button" aria-pressed={mode === id} className={mode === id ? 'selected' : ''} onClick={() => changeMode(id)}><Icon size={16} />{label}</button>)}
        </div>
      </div>
      {mode === 'shape' && <div className="shapeOptions" role="group" aria-label="Shape template">
        {[['heart', Heart, 'Heart'], ['star', Star, 'Star'], ['bolt', Zap, 'Bolt']].map(([id, Icon, label]) => <button key={id} type="button" aria-label={label} title={label} aria-pressed={shape === id && !loadedStrokes} className={shape === id && !loadedStrokes ? 'selected' : ''} onClick={() => { setShape(id); setLoadedStrokes(null); setDesignName(''); }}><Icon size={24} strokeWidth={1.6} /><span>{label}</span></button>)}
      </div>}
      {mode === 'text' && <label className="controlGroup">Your text<input className="wordInput" aria-label="Route art text" value={text} maxLength={6} placeholder="RUN" onChange={(e) => { setText(e.target.value.toUpperCase()); setLoadedStrokes(null); setDesignName(''); }} /><span className="inputMeta">Letters and numbers <span>{text.length}/6</span></span></label>}
      {mode === 'image' && <div className="controlGroup">
        <input ref={fileInputRef} className="srOnly" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload route art image" onChange={(e) => { void upload(e.target.files[0]); e.target.value = ''; }} />
        <button className="uploadArea" type="button" disabled={reading} onClick={() => fileInputRef.current?.click()}><Upload size={22} /><strong>{reading ? 'Reading image...' : fileName || 'Choose an image'}</strong><span>PNG, JPG, WebP / up to 5 MB</span></button>
        {raster && <><label className="sliderLabel" htmlFor="contrast">Threshold <output>{threshold}</output></label><input id="contrast" type="range" min="30" max="230" value={threshold} onChange={(e) => { setThreshold(Number(e.target.value)); setLoadedStrokes(null); }} /><label className="checkboxLabel"><input type="checkbox" checked={invert} onChange={(e) => { setInvert(e.target.checked); setLoadedStrokes(null); }} />Light shape on dark background</label></>}
        <span className="privacyNote">Image stays on this device.</span>
      </div>}
      <div className="outlineTool"><OutlinePreview strokes={outline.strokes} /><div><span>OUTLINE</span><span>{outline.strokes.length} contour{outline.strokes.length === 1 ? '' : 's'}</span></div></div>
      {(outline.error || design?.error) && <p className="fieldError" role="alert">{outline.error || design.error}</p>}
      <div className="controlGroup"><div className="labelRow"><label htmlFor="artDistance">Design distance</label><span>km</span></div><input id="artDistance" type="number" min="1" max="60" step="0.5" value={distance} onChange={(e) => setDistance(e.target.value)} /></div>
      <div className="controlGroup"><label className="sliderLabel" htmlFor="rotation">Rotation <output>{rotation}°</output></label><div className="rotationControl"><input id="rotation" type="range" min="-180" max="180" step="5" value={rotation} onChange={(e) => setRotation(Number(e.target.value))} /><button className="iconOnly" type="button" title="Reset rotation" aria-label="Reset rotation" onClick={() => setRotation(0)}><RotateCcw size={16} /></button></div></div>
      <LocationFields center={center} onChange={setCenter} />
      <div className="sidebarActions"><button className="studioPrimary" type="button" disabled={!valid || loading || reading} onClick={fit}><Route size={17} />{loading ? 'Fitting to paths...' : 'Fit to walking paths'}<ArrowRight size={17} /></button><button className="studioSecondary" type="button" disabled={!valid || reading} onClick={saveDesign}><Save size={16} />Save design</button></div>
      {savedDesigns.length > 0 && <details className="savedDesigns"><summary>Saved designs <span>{savedDesigns.length}</span></summary>{savedDesigns.map((saved) => <div key={saved.id}><button type="button" onClick={() => loadDesign(saved)}>{saved.name}<small>{saved.distance} km</small></button><button type="button" className="iconOnly" aria-label={`Delete ${saved.name} design`} title="Delete design" onClick={() => persistDesigns(savedDesigns.filter((d) => d.id !== saved.id))}><Trash2 size={15} /></button></div>)}</details>}
    </aside>
    <section className="studioMain" aria-label="Route art preview">
      <div className="workspaceBar"><div><span className={`statusDot ${route ? 'ready' : ''}`} /><strong>{name}</strong><span className="smallTag">{route ? 'Walking route' : 'Design draft'}</span></div><span className="localBadge">No AI credits</span></div>
      <StudioMap lines={lines} center={center} onCenterChange={setCenter} fitKey={design} />
      <div className="mapKey"><span><i className="designLine" />Design outline</span>{route && <span><i className="walkingLine" />Walking route</span>}{valid && design.connectors.length > 0 && <span><i className="connectorLine" />Connecting legs</span>}<span className="mapKeyRight">{route ? 'openrouteservice / walking' : 'Outline only. Not a navigable route.'}</span></div>
      <div className="designSummary">
        <div className="summaryMetric"><span>Design distance</span><strong>{valid ? design.lengthKm.toFixed(1) : '--'} <small>km</small></strong></div>
        <div className="summaryMetric"><span>Walking distance</span><strong>{route ? route.distanceKm.toFixed(2) : '--'} <small>km</small></strong></div>
        <div className="summaryMetric"><span>Mean path deviation</span><strong>{deviation ?? '--'} <small>m</small></strong></div>
        <div className="summaryMetric"><span>Connecting legs</span><strong>{valid ? design.connectorKm.toFixed(2) : '--'} <small>km</small></strong></div>
      </div>
      <div className="studioFeedback" aria-live="polite">
        {status ? <p role="status">{status}</p> : <p>{loading ? 'Requesting one walking route. The street network may change the shape and distance.' : route ? `Walking route is ${Math.abs(route.distanceKm - Number(distance)).toFixed(2)} km ${route.distanceKm >= Number(distance) ? 'longer' : 'shorter'} than the design. Review access, crossings, and the shape before running.` : 'Street fitting pending. Terrain, access, and distance are not verified.'}</p>}
        {route && <div className="resultActions"><button className="studioSecondary" type="button" onClick={() => onExport(route)}><ArrowDownToLine size={16} />GPX</button><button className="studioSecondary" type="button" onClick={() => onSaveRoute(route)}><Save size={16} />Save route</button><button className="studioPrimary" type="button" onClick={() => onUseRoute(route)}>Use route<ArrowRight size={16} /></button></div>}
      </div>
      <div className="studioBottom"><span><Check size={14} />Local outline processing</span><span>Route Art / Beta</span></div>
    </section>
  </div>;
}
