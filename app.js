/**
 * ════════════════════════════════════════════════════════════
 * PATAGONIA 360 — app.js
 * GPS · Leaflet · AR · DeviceOrientation · Creator · QR
 *
 * Estructura:
 *   1.  Estado global (APP)
 *   2.  Datos hotel (predefinidos)
 *   3.  LocalStorage — tours
 *   4.  Navegación entre pantallas
 *   5.  Hotel — selección de servicio
 *   6.  GPS — geolocation
 *   7.  Haversine + rumbo (bearing)
 *   8.  Actualización de distancias y UI
 *   9.  Orientación del dispositivo
 *  10.  Mapa Leaflet — navegación
 *  11.  Mapa Leaflet — creator
 *  12.  AR View — cámara + overlay
 *  13.  Flecha AR direccional
 *  14.  Reserva antes de ir
 *  15.  Creator — fotos + EXIF + POIs
 *  16.  Galería
 *  17.  QR: exportar, compartir, importar
 *  18.  Toast
 *  19.  Utilidades
 *  20.  Inicialización
 * ════════════════════════════════════════════════════════════
 */

'use strict';

/* ══════════════════════════════════════════════════════════
   1. ESTADO GLOBAL
   ══════════════════════════════════════════════════════════ */
const APP = {
  svc:         null,   // POI/servicio activo en navegación
  userLat:     null,
  userLng:     null,
  userAcc:     null,
  geoWatchId:  null,
  deviceHeading: null, // heading del dispositivo (0 = Norte)

  // Leaflet — navegación
  navMap:    null,
  userMarker: null,
  poiMarkers: [],

  // Leaflet — creator
  cMap:         null,
  cUserMarker:  null,
  cPoiMarkers:  [],

  // AR
  arStream:       null,
  arCompassTimer: null,

  // Creator
  cPois:           [],
  stagingPhoto:    null,   // dataURL redimensionada
  stagingExifGPS:  null,   // { lat, lng } o null
  poiFormOpen:     false,

  // QR modal
  activeTourId: null,
};

/* ══════════════════════════════════════════════════════════
   2. DATOS HOTEL — POIs predefinidos
   ══════════════════════════════════════════════════════════ */
const HOTEL = {
  spa: {
    id: 'spa', name: 'Spa & Wellness', icon: '✦', emoji: '🧖',
    color: '#7ecfc0',
    lat: -41.1320, lng: -71.3095,
    desc: 'Relajación premium con vista panorámica a los cerros patagónicos.',
    action: 'Reservar turno',
    img: 'https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?w=300&h=120&fit=crop',
  },
  restaurant: {
    id: 'restaurant', name: 'Restaurante', icon: '◈', emoji: '🍽️',
    color: '#e8c97a',
    lat: -41.1340, lng: -71.3110,
    desc: 'Cocina patagónica de autor. Ingredientes locales. Abierto hasta las 23:00.',
    action: 'Ver menú',
    img: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=300&h=120&fit=crop',
  },
  pool: {
    id: 'pool', name: 'Piscina', icon: '◎', emoji: '🏊',
    color: '#5ca8e8',
    lat: -41.1328, lng: -71.3080,
    desc: 'Piscina climatizada con solárium y vista al lago Nahuel Huapi.',
    action: 'Reservar lugar',
    img: 'https://images.unsplash.com/photo-1575429198097-0414ec08e8cd?w=300&h=120&fit=crop',
  },
};

/* ══════════════════════════════════════════════════════════
   3. LOCALSTORAGE — tours
   ══════════════════════════════════════════════════════════ */
const LS_KEY = 'p360_tours_v5';

function getTours() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}

function setTours(tours) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(tours)); }
  catch (e) { toast('⚠️', 'Almacenamiento lleno. Eliminá recorridos viejos.'); }
}

function delTour(id) {
  setTours(getTours().filter(t => t.id !== id));
  renderGallery();
  updateHomeBadge();
  toast('🗑️', 'Recorrido eliminado');
}

/* ══════════════════════════════════════════════════════════
   4. NAVEGACIÓN ENTRE PANTALLAS
   ══════════════════════════════════════════════════════════ */
function show(screenId) {
  // Ocultar todas las pantallas (excepto AR que es overlay separado)
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(screenId);
  if (el) el.classList.add('active');

  // Efectos secundarios al entrar en pantalla
  if (screenId === 'screen-nav')     { setTimeout(initNavMap, 80); startGPS(); }
  if (screenId === 'screen-creator') { setTimeout(initCreatorMap, 80); }
  if (screenId === 'screen-gallery') { renderGallery(); }
}

function goHotel()   { show('screen-hotel'); }
function goCreator() { resetCreator(); show('screen-creator'); }
function goGallery() { show('screen-gallery'); }

/* ══════════════════════════════════════════════════════════
   5. HOTEL — selección de servicio
   ══════════════════════════════════════════════════════════ */
function selectSvc(id) {
  const s = HOTEL[id];
  if (!s) return;
  APP.svc = s;

  // Pantalla navegación
  document.getElementById('nav-title').textContent = s.name;

  // Pantalla arrival
  document.getElementById('arr-title').textContent = s.name;
  document.getElementById('arr-desc').textContent  = s.desc;
  const btn = document.getElementById('arr-action');
  btn.textContent    = s.action;
  btn.dataset.done   = '0';
  btn.className      = 'btn btn-green';
  btn.style.cssText  = '';

  // Ícono de arrival
  const img = document.getElementById('arrival-img');
  const em  = document.getElementById('arrival-emoji');
  if (s.img) {
    img.src = s.img; img.style.display = 'block'; em.style.display = 'none';
  } else {
    img.style.display = 'none'; em.style.display = ''; em.textContent = s.emoji;
  }

  // Resetear botón de reserva
  const rBtn = document.getElementById('reserve-before-btn');
  if (rBtn) { rBtn.classList.remove('done'); rBtn.textContent = '🗓️ Reservar antes de ir'; rBtn.onclick = reserveService; }

  document.getElementById('proximity-alert').classList.remove('visible');
  resetNavMap();
  show('screen-nav');
}

function handleArrival() {
  const btn = document.getElementById('arr-action');
  if (btn.dataset.done === '1') return;
  btn.dataset.done  = '1';
  btn.textContent   = '✓ Solicitud enviada';
  btn.style.background = 'rgba(34,214,138,.08)';
  btn.style.border     = '1px solid rgba(34,214,138,.35)';
  btn.style.color      = 'var(--green)';
}

/* ══════════════════════════════════════════════════════════
   6. GPS — geolocation
   ══════════════════════════════════════════════════════════ */
function startGPS() {
  if (!navigator.geolocation) {
    setGPSBadge('off', 'No disponible');
    useFallbackGPS();
    return;
  }
  setGPSBadge('wait', 'GPS…');
  navigator.geolocation.getCurrentPosition(onGPSOk, onGPSErr, {
    enableHighAccuracy: true, timeout: 8000,
  });
  APP.geoWatchId = navigator.geolocation.watchPosition(onGPSOk, onGPSErr, {
    enableHighAccuracy: true, maximumAge: 3000, timeout: 10000,
  });
}

function stopNav() {
  if (APP.geoWatchId !== null) {
    navigator.geolocation.clearWatch(APP.geoWatchId);
    APP.geoWatchId = null;
  }
}

function onGPSOk(p) {
  APP.userLat = p.coords.latitude;
  APP.userLng = p.coords.longitude;
  APP.userAcc = Math.round(p.coords.accuracy);
  setGPSBadge('ok', `±${APP.userAcc}m`);
  updateNavMap();
  updateDistances();
}

function onGPSErr(e) {
  console.warn('[P360] GPS:', e.message);
  useFallbackGPS();
}

/** Posición de demo cuando no hay GPS disponible (escritorio/emulador) */
function useFallbackGPS() {
  APP.userLat = -41.1335;
  APP.userLng = -71.3103;
  APP.userAcc = 999;
  setGPSBadge('wait', 'Demo GPS');
  updateNavMap();
  updateDistances();
}

function setGPSBadge(type, text) {
  const el = document.getElementById('gps-status');
  if (!el) return;
  el.className = `badge gps-${type === 'ok' ? 'ok' : type === 'off' ? 'off' : 'wait'}`;
  el.textContent = (type === 'ok' ? '◉ ' : '') + text;
}

/* ══════════════════════════════════════════════════════════
   7. HAVERSINE + RUMBO (bearing)
   ══════════════════════════════════════════════════════════ */

/**
 * Distancia en metros entre dos pares lat/lng.
 * Fórmula de Haversine.
 */
function haversine(la1, lo1, la2, lo2) {
  const R = 6371000;
  const r = d => d * Math.PI / 180;
  const a = Math.sin(r(la2 - la1) / 2) ** 2
    + Math.cos(r(la1)) * Math.cos(r(la2)) * Math.sin(r(lo2 - lo1) / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Rumbo en grados (0 = Norte, 90 = Este, etc.)
 * desde (la1,lo1) hacia (la2,lo2).
 */
function bearing(la1, lo1, la2, lo2) {
  const r   = d => d * Math.PI / 180;
  const deg = v => v * 180 / Math.PI;
  const y = Math.sin(r(lo2 - lo1)) * Math.cos(r(la2));
  const x = Math.cos(r(la1)) * Math.sin(r(la2))
    - Math.sin(r(la1)) * Math.cos(r(la2)) * Math.cos(r(lo2 - lo1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

function bearingText(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8];
}

/* ══════════════════════════════════════════════════════════
   8. ACTUALIZACIÓN DE DISTANCIAS Y UI
   ══════════════════════════════════════════════════════════ */
function updateDistances() {
  if (!APP.svc || APP.userLat === null) return;

  const dist  = haversine(APP.userLat, APP.userLng, APP.svc.lat, APP.svc.lng);
  const bear  = bearing(APP.userLat, APP.userLng, APP.svc.lat, APP.svc.lng);
  const distR = Math.round(dist);

  // HUD distancia
  const dEl = document.getElementById('dist-val');
  if (dEl) {
    dEl.textContent = distR < 1000 ? `${distR}m` : `${(dist / 1000).toFixed(1)}km`;
    dEl.className   = 'dist-value' + (distR < 50 ? ' good' : distR < 150 ? ' warn' : '');
  }
  const bEl = document.getElementById('bearing-val');
  if (bEl) bEl.textContent = `${bearingText(bear)} ${Math.round(bear)}°`;
  const aEl = document.getElementById('acc-val');
  if (aEl) aEl.textContent = APP.userAcc < 900 ? `±${APP.userAcc}m` : 'Demo';

  // Flecha en pantalla de navegación
  const arrowEl = document.getElementById('nav-arrow');
  const labelEl = document.getElementById('arrow-label');
  if (arrowEl) {
    const visual = APP.deviceHeading !== null
      ? (bear - APP.deviceHeading + 360) % 360
      : bear;
    arrowEl.style.transform = `rotate(${visual}deg)`;
  }
  if (labelEl) labelEl.textContent = `${bearingText(bear)} · ${Math.round(bear)}°`;

  // Alerta de proximidad (< 50 m)
  const alertEl = document.getElementById('proximity-alert');
  if (alertEl) alertEl.classList.toggle('visible', distR < 50);

  // Botón inteligente: "Ir ahora" (<50m) o acción del servicio (≥50m)
  const smartBtn = document.getElementById('smart-action-btn');
  if (smartBtn) {
    if (distR < 50) {
      smartBtn.textContent = '🚶 Ir ahora';
      smartBtn.className   = 'btn btn-smart close-mode';
    } else {
      smartBtn.textContent = APP.svc.action || 'Reservar';
      smartBtn.className   = 'btn btn-smart far-mode';
    }
  }

  // Sincronizar AR si está abierto
  updateARHUD(distR, bear);
  updateARArrow(bear);
}

function handleSmartAction() {
  if (!APP.svc || APP.userLat === null) { show('screen-arrival'); return; }
  const dist = Math.round(haversine(APP.userLat, APP.userLng, APP.svc.lat, APP.svc.lng));
  if (dist < 50) show('screen-arrival');
  else openARView();
}

/* ══════════════════════════════════════════════════════════
   9. ORIENTACIÓN DEL DISPOSITIVO
   Soporta iOS (requestPermission) y Android/Chrome
   ══════════════════════════════════════════════════════════ */
function startOrientation() {
  if (typeof DeviceOrientationEvent === 'undefined') return;

  const handler = (e) => {
    if (e.alpha !== null) {
      APP.deviceHeading = e.alpha;
      updateDistances(); // refresca flecha con el nuevo heading
    }
  };

  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ requiere permiso explícito del usuario
    DeviceOrientationEvent.requestPermission()
      .then(p => { if (p === 'granted') window.addEventListener('deviceorientation', handler, true); })
      .catch(() => { /* sin permiso — flecha funciona igual con bearing GPS */ });
  } else {
    window.addEventListener('deviceorientation', handler, true);
  }
}

/* ══════════════════════════════════════════════════════════
   10. MAPA LEAFLET — Navegación
   ══════════════════════════════════════════════════════════ */
function resetNavMap() {
  if (APP.navMap) {
    APP.navMap.remove();
    APP.navMap    = null;
    APP.userMarker = null;
    APP.poiMarkers = [];
  }
}

function initNavMap() {
  if (APP.navMap) return;
  const el = document.getElementById('leaflet-map');
  if (!el) return;

  const la = APP.userLat ?? -41.1335;
  const lo = APP.userLng ?? -71.3103;

  APP.navMap = L.map('leaflet-map', {
    center: [la, lo], zoom: 17,
    zoomControl: false, attributionControl: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
  }).addTo(APP.navMap);

  // Marcador de posición del usuario
  const uIcon = L.divIcon({
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:#22d68a;border:2.5px solid #fff;
      box-shadow:0 0 10px rgba(34,214,138,.65);">
    </div>`,
    className: '', iconSize: [14, 14], iconAnchor: [7, 7],
  });
  APP.userMarker = L.marker([la, lo], { icon: uIcon })
    .bindPopup('<strong style="color:#fff;">📍 Estás aquí</strong>')
    .addTo(APP.navMap);

  if (APP.svc) addPoiToNavMap(APP.svc);
}

function addPoiToNavMap(poi) {
  if (!APP.navMap) return;

  // Ícono del POI con imagen o emoji
  const pIcon = L.divIcon({
    html: `<div style="
      width:36px;height:36px;border-radius:50%;
      background:${poi.color || '#22d68a'};
      display:flex;align-items:center;justify-content:center;
      font-size:17px;border:2px solid #fff;
      box-shadow:0 0 12px ${poi.color || '#22d68a'}88;
      overflow:hidden;">
      ${poi.img
        ? `<img src="${poi.img}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : (poi.emoji || '📍')}
    </div>`,
    className: '', iconSize: [36, 36], iconAnchor: [18, 18],
  });

  const imgTag = poi.img ? `<img src="${poi.img}" class="popup-img" onerror="this.style.display='none'">` : '';
  const m = L.marker([poi.lat, poi.lng], { icon: pIcon })
    .addTo(APP.navMap)
    .bindPopup(`
      ${imgTag}
      <div class="popup-title">${poi.name}</div>
      <div class="popup-desc">${poi.desc || ''}</div>
      <div class="popup-dist" id="pdist-${poi.id}">Calculando…</div>
    `);
  APP.poiMarkers.push(m);

  // Línea punteada usuario → POI
  const line = L.polyline(
    [[APP.userLat ?? -41.1335, APP.userLng ?? -71.3103], [poi.lat, poi.lng]],
    { color: poi.color || '#22d68a', weight: 2, opacity: .4, dashArray: '5,10' }
  ).addTo(APP.navMap);
  APP.poiMarkers.push(line);

  // Ajustar vista para ver ambos puntos
  APP.navMap.fitBounds(
    L.latLngBounds(
      [[APP.userLat ?? -41.1335, APP.userLng ?? -71.3103], [poi.lat, poi.lng]]
    ),
    { padding: [28, 28] }
  );
}

function updateNavMap() {
  if (!APP.navMap) {
    if (document.getElementById('leaflet-map')) initNavMap();
    return;
  }
  if (APP.userLat === null) return;

  APP.userMarker?.setLatLng([APP.userLat, APP.userLng]);
  APP.navMap.panTo([APP.userLat, APP.userLng], { animate: true, duration: .4 });

  if (APP.svc) {
    const d  = Math.round(haversine(APP.userLat, APP.userLng, APP.svc.lat, APP.svc.lng));
    const el = document.getElementById(`pdist-${APP.svc.id}`);
    if (el) el.textContent = `📍 A ${d}m de aquí`;
  }
}

/* ══════════════════════════════════════════════════════════
   11. MAPA LEAFLET — Creator
   ══════════════════════════════════════════════════════════ */
function initCreatorMap() {
  if (APP.cMap) return;
  const el = document.getElementById('creator-map');
  if (!el) return;

  const la = APP.userLat ?? -41.1335;
  const lo = APP.userLng ?? -71.3103;

  APP.cMap = L.map('creator-map', {
    center: [la, lo], zoom: 15,
    zoomControl: false, attributionControl: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
  }).addTo(APP.cMap);

  const ic = L.divIcon({
    html: `<div style="
      width:11px;height:11px;border-radius:50%;
      background:#e8b84b;border:2px solid #fff;
      box-shadow:0 0 7px rgba(232,184,75,.6);">
    </div>`,
    className: '', iconSize: [11, 11], iconAnchor: [5.5, 5.5],
  });
  APP.cUserMarker = L.marker([la, lo], { icon: ic })
    .bindPopup('<strong>📍 Tu posición</strong>')
    .addTo(APP.cMap);

  // Clic en mapa → rellena coordenadas en el formulario
  APP.cMap.on('click', e => {
    const latEl = document.getElementById('poi-lat-input');
    const lngEl = document.getElementById('poi-lng-input');
    if (latEl) latEl.value = e.latlng.lat.toFixed(6);
    if (lngEl) lngEl.value = e.latlng.lng.toFixed(6);
    if (APP.poiFormOpen) toast('📍', 'Coordenadas actualizadas');
  });
}

function addPoiToCreatorMap(poi) {
  if (!APP.cMap) return;
  const ic = L.divIcon({
    html: `<div style="
      width:30px;height:30px;border-radius:50%;
      background:${poi.color};display:flex;align-items:center;
      justify-content:center;font-size:15px;border:2px solid #fff;
      box-shadow:0 0 8px ${poi.color}66;overflow:hidden;">
      ${poi.img
        ? `<img src="${poi.img}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : poi.emoji}
    </div>`,
    className: '', iconSize: [30, 30], iconAnchor: [15, 15],
  });
  const m = L.marker([poi.lat, poi.lng], { icon: ic })
    .bindPopup(`<div class="popup-title">${poi.name}</div>`)
    .addTo(APP.cMap);
  APP.cPoiMarkers.push(m);
  APP.cMap.panTo([poi.lat, poi.lng], { animate: true });
}

function refreshCreatorMapPois() {
  if (!APP.cMap) return;
  APP.cPoiMarkers.forEach(m => m.remove());
  APP.cPoiMarkers = [];
  APP.cPois.forEach(p => addPoiToCreatorMap(p));
}

/* ══════════════════════════════════════════════════════════
   12. AR VIEW — cámara + overlay
   ══════════════════════════════════════════════════════════ */
async function openARView() {
  const scr = document.getElementById('screen-ar');
  // Mover fuera del flow normal para que sea verdaderamente fullscreen
  document.body.appendChild(scr);
  scr.classList.add('open');

  initARCompass();

  // Poblar overlay con datos del POI activo
  if (APP.svc) {
    const s = APP.svc;
    document.getElementById('ar-poi-icon').textContent = s.emoji || '📍';
    document.getElementById('ar-poi-name').textContent = s.name;
    document.getElementById('ar-poi-desc').textContent = s.desc || '';
    const imgEl = document.getElementById('ar-poi-img');
    if (s.img) { imgEl.src = s.img; imgEl.classList.remove('hidden'); }
    else        { imgEl.classList.add('hidden'); }
    if (APP.userLat) {
      updateARHUD(
        Math.round(haversine(APP.userLat, APP.userLng, s.lat, s.lng)),
        bearing(APP.userLat, APP.userLng, s.lat, s.lng)
      );
    }
  }

  // Cámara trasera
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    APP.arStream = stream;
    document.getElementById('ar-video').srcObject = stream;
  } catch (e) {
    console.warn('[P360] Cámara no disponible:', e.message);
    // AR funciona igual como overlay sobre fondo negro
  }
}

function openARScan() {
  // Si no hay servicio seleccionado, usar el spa como demo
  if (!APP.svc) APP.svc = HOTEL.spa;
  openARView();
}

function closeAR() {
  const scr = document.getElementById('screen-ar');
  scr.classList.remove('open');
  // Devolver al DOM del phone
  const phone = document.querySelector('body');
  phone.appendChild(scr);

  if (APP.arStream) {
    APP.arStream.getTracks().forEach(t => t.stop());
    APP.arStream = null;
    const v = document.getElementById('ar-video');
    if (v) v.srcObject = null;
  }
  if (APP.arCompassTimer) {
    clearInterval(APP.arCompassTimer);
    APP.arCompassTimer = null;
  }
}

function updateARHUD(dist, bear) {
  const d = document.getElementById('ar-dist-big');
  if (d) d.textContent = dist < 1000 ? dist : `${(dist / 1000).toFixed(1)}k`;
  const p = document.getElementById('ar-poi-dist');
  if (p) p.textContent = `${dist}m`;
  const b = document.getElementById('ar-bearing');
  if (b) b.textContent = `${bearingText(bear)} ${Math.round(bear)}°`;
}

/** Inicializa la brújula AR con animación simulada + sensor real si disponible */
function initARCompass() {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const c = document.getElementById('compass-dirs');
  if (!c) return;

  c.innerHTML = [...dirs, ...dirs, ...dirs]
    .map(d => `<div class="compass-dir ${d === 'N' ? 'n' : ''}">${d}</div>`)
    .join('');

  let h = 15, dir = 1;
  APP.arCompassTimer = setInterval(() => {
    h += dir * .3;
    if (h > 40) dir = -1;
    if (h < 5)  dir = 1;
    c.style.transform = `translateX(calc(50% + ${-(h / 360) * (dirs.length * 48)}px))`;
  }, 50);

  // Sensor real del dispositivo si está disponible
  if (typeof DeviceOrientationEvent !== 'undefined') {
    const fn = e => {
      if (e.alpha !== null) {
        clearInterval(APP.arCompassTimer);
        c.style.transform = `translateX(calc(50% + ${-(e.alpha / 360) * (dirs.length * 48)}px))`;
      }
    };
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(p => { if (p === 'granted') window.addEventListener('deviceorientation', fn, true); })
        .catch(() => {});
    } else {
      window.addEventListener('deviceorientation', fn, true);
    }
  }
}

/* ══════════════════════════════════════════════════════════
   13. FLECHA AR DIRECCIONAL
   Rota #ar-direction-arrow según bearing − deviceHeading
   ══════════════════════════════════════════════════════════ */
function updateARArrow(bearDeg) {
  if (bearDeg === undefined) {
    if (!APP.svc || APP.userLat === null) return;
    bearDeg = bearing(APP.userLat, APP.userLng, APP.svc.lat, APP.svc.lng);
  }

  // Compensar heading del dispositivo para rotación relativa
  let rotation = bearDeg;
  if (APP.deviceHeading !== null) {
    rotation = (bearDeg - APP.deviceHeading + 360) % 360;
  }

  const arrow = document.getElementById('ar-direction-arrow');
  if (arrow) {
    // IMPORTANTE: preservar translate(-50%,-50%) del CSS
    arrow.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
  }
}

/* ══════════════════════════════════════════════════════════
   14. RESERVA ANTES DE IR
   ══════════════════════════════════════════════════════════ */
function reserveService() {
  const btn = document.getElementById('reserve-before-btn');
  if (!btn || btn.classList.contains('done')) return;

  const name = APP.svc ? APP.svc.name : 'el servicio';

  // En producción: reemplazar con llamada a API de reservas
  console.log('[P360] Reserva solicitada:', {
    service: name,
    ts: new Date().toISOString(),
  });

  btn.classList.add('done');
  btn.textContent = '✓ Reserva confirmada';

  toast('🗓️', `Reserva de "${name}" confirmada`);
}

/* ══════════════════════════════════════════════════════════
   15. CREATOR — fotos + EXIF + POIs
   ══════════════════════════════════════════════════════════ */
function resetCreator() {
  APP.cPois          = [];
  APP.stagingPhoto   = null;
  APP.stagingExifGPS = null;
  APP.poiFormOpen    = false;

  ['tour-name-input', 'poi-name-input', 'poi-desc-input',
   'poi-lat-input', 'poi-lng-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const photoInput = document.getElementById('photo-input');
  if (photoInput) photoInput.value = '';

  document.getElementById('photo-preview')?.classList.remove('vis');
  document.getElementById('add-poi-form')?.classList.remove('vis');

  const saveBtn   = document.getElementById('save-tour-btn');
  const exportBtn = document.getElementById('export-qr-btn');
  const hint      = document.getElementById('save-hint');
  if (saveBtn)   saveBtn.disabled   = true;
  if (exportBtn) exportBtn.disabled = true;
  if (hint)      hint.style.display = '';

  document.getElementById('poi-count').textContent = '0';

  document.getElementById('creator-poi-list').innerHTML =
    '<p id="creator-empty" class="empty-hint">Todavía sin puntos. Agregá el primero.</p>';

  // Destruir mapa anterior para reiniciar limpio
  if (APP.cMap) {
    APP.cMap.remove();
    APP.cMap        = null;
    APP.cUserMarker = null;
    APP.cPoiMarkers = [];
  }
}

function togglePoiForm() {
  APP.poiFormOpen = !APP.poiFormOpen;
  const form = document.getElementById('add-poi-form');
  const btn  = document.getElementById('btn-add-poi');

  if (APP.poiFormOpen) {
    form.classList.add('vis');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    // Pre-rellenar con GPS actual si los campos están vacíos
    const latEl = document.getElementById('poi-lat-input');
    const lngEl = document.getElementById('poi-lng-input');
    if (APP.userLat && latEl && !latEl.value) {
      latEl.value = (APP.userLat + 0.0006).toFixed(6);
      lngEl.value = (APP.userLng + 0.0006).toFixed(6);
    }
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    form.classList.remove('vis');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
}

function cancelPoiForm() {
  APP.poiFormOpen    = false;
  APP.stagingPhoto   = null;
  APP.stagingExifGPS = null;

  document.getElementById('add-poi-form')?.classList.remove('vis');
  document.getElementById('photo-preview')?.classList.remove('vis');

  const photoInput = document.getElementById('photo-input');
  if (photoInput) photoInput.value = '';

  const btn = document.getElementById('btn-add-poi');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

/**
 * onPhotoSelected — se ejecuta al elegir una imagen.
 * 1. Muestra preview inmediata
 * 2. Lee GPS del EXIF con exifr (si está disponible)
 * 3. Rellena coordenadas automáticamente
 * 4. Redimensiona a max 500px para persistencia eficiente
 */
async function onPhotoSelected(input) {
  const file = input.files[0];
  if (!file) return;

  const preview = document.getElementById('photo-preview');
  const prevImg = document.getElementById('preview-img');
  const badge   = document.getElementById('exif-badge');

  // Preview inmediata
  prevImg.src = URL.createObjectURL(file);
  preview.classList.add('vis');
  badge.className   = 'exif-badge exif-none';
  badge.textContent = 'Leyendo EXIF…';

  // Leer GPS del EXIF con exifr
  let exifGPS = null;
  try {
    if (typeof exifr !== 'undefined') {
      const data = await exifr.gps(file);
      if (data?.latitude && data?.longitude) {
        exifGPS = { lat: data.latitude, lng: data.longitude };
      }
    }
  } catch (e) { /* archivo sin EXIF — continuar */ }

  const latEl = document.getElementById('poi-lat-input');
  const lngEl = document.getElementById('poi-lng-input');

  if (exifGPS) {
    if (latEl) latEl.value = exifGPS.lat.toFixed(6);
    if (lngEl) lngEl.value = exifGPS.lng.toFixed(6);
    APP.stagingExifGPS = exifGPS;
    badge.className   = 'exif-badge exif-gps';
    badge.textContent = `GPS EXIF: ${exifGPS.lat.toFixed(4)}, ${exifGPS.lng.toFixed(4)}`;
  } else if (APP.userLat) {
    if (latEl) latEl.value = (APP.userLat + 0.0006).toFixed(6);
    if (lngEl) lngEl.value = (APP.userLng + 0.0006).toFixed(6);
    APP.stagingExifGPS = null;
    badge.className   = 'exif-badge exif-dev';
    badge.textContent = 'GPS del dispositivo';
  } else {
    APP.stagingExifGPS = null;
    badge.className   = 'exif-badge exif-none';
    badge.textContent = 'Sin GPS — ingresá coordenadas';
  }

  // Redimensionar imagen para guardar en localStorage (max 500px, JPEG 78%)
  APP.stagingPhoto = await resizeToDataURL(file, 500, 0.78);
}

/** Redimensiona una imagen y la convierte a data URL */
function resizeToDataURL(file, maxPx, quality) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxPx) { h = Math.round(h * maxPx / w); w = maxPx; }
        if (h > maxPx) { w = Math.round(w * maxPx / h); h = maxPx; }
        const cv  = document.createElement('canvas');
        cv.width  = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function confirmAddPoi() {
  const name = document.getElementById('poi-name-input')?.value.trim();
  const lat  = parseFloat(document.getElementById('poi-lat-input')?.value);
  const lng  = parseFloat(document.getElementById('poi-lng-input')?.value);
  const desc = document.getElementById('poi-desc-input')?.value.trim() || '';

  if (!name)           { toast('⚠️', 'Ingresá un nombre para el punto'); return; }
  if (isNaN(lat) || isNaN(lng)) { toast('⚠️', 'Coordenadas inválidas'); return; }

  const poi = {
    id:          `p-${Date.now()}`,
    name, lat, lng, desc,
    img:         APP.stagingPhoto || null,
    hasExifGPS:  !!APP.stagingExifGPS,
    color:       '#22d68a',
    emoji:       '📍',
  };

  APP.cPois.push(poi);
  addPoiToCreatorMap(poi);
  renderCreatorList();
  cancelPoiForm();

  // Habilitar guardar y exportar
  document.getElementById('save-tour-btn').disabled   = false;
  document.getElementById('export-qr-btn').disabled   = false;
  document.getElementById('save-hint').style.display  = 'none';
  document.getElementById('poi-count').textContent    = APP.cPois.length;

  toast('📍', `"${name}" agregado al recorrido`);
}

function renderCreatorList() {
  const c = document.getElementById('creator-poi-list');
  if (APP.cPois.length === 0) {
    c.innerHTML = '<p id="creator-empty" class="empty-hint">Todavía sin puntos. Agregá el primero.</p>';
    return;
  }
  c.innerHTML = APP.cPois.map((p, i) => `
    <div class="cpoi-item">
      ${p.img
        ? `<img class="cpoi-thumb" src="${p.img}" alt="${esc(p.name)}">`
        : `<div class="cpoi-thumb-empty">📍</div>`}
      <div class="cpoi-info">
        <div class="cpoi-name">${esc(p.name)}</div>
        <div class="cpoi-coords">${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}</div>
        ${p.hasExifGPS ? '<div class="cpoi-exif">● GPS de foto</div>' : ''}
      </div>
      <button class="btn-danger" onclick="deleteCreatorPoi(${i})" aria-label="Eliminar punto">✕</button>
    </div>
  `).join('');
}

function deleteCreatorPoi(i) {
  APP.cPois.splice(i, 1);
  renderCreatorList();
  document.getElementById('poi-count').textContent = APP.cPois.length;
  if (APP.cPois.length === 0) {
    document.getElementById('save-tour-btn').disabled  = true;
    document.getElementById('export-qr-btn').disabled  = true;
    document.getElementById('save-hint').style.display = '';
  }
  refreshCreatorMapPois();
}

function saveTour() {
  if (APP.cPois.length === 0) return;

  const rawName = document.getElementById('tour-name-input')?.value.trim();
  const name    = rawName || `Recorrido ${new Date().toLocaleDateString('es-AR')}`;

  const tour = {
    id:      `t-${Date.now()}`,
    name,
    created: new Date().toLocaleDateString('es-AR'),
    pois:    APP.cPois.map(p => ({ ...p })),
  };

  const tours = getTours();
  tours.push(tour);
  setTours(tours);
  updateHomeBadge();
  APP.activeTourId = tour.id;

  toast('✅', `"${name}" guardado con ${tour.pois.length} puntos`);

  setTimeout(() => {
    if (confirm(`✅ "${name}" guardado.\n¿Ir a Mis Recorridos?`)) {
      goGallery();
    } else {
      resetCreator();
    }
  }, 400);
}

/** Exportar QR del tour actual en el creator (sin haber guardado aún) */
function exportQR() {
  if (APP.cPois.length === 0) { toast('⚠️', 'Agregá puntos antes de exportar'); return; }

  const rawName = document.getElementById('tour-name-input')?.value.trim();
  const name    = rawName || 'Mi Recorrido';

  // Crear tour temporal solo para generar el QR
  const tempTour = {
    id:      `temp-${Date.now()}`,
    name,
    created: new Date().toLocaleDateString('es-AR'),
    pois:    APP.cPois.map(p => ({ ...p })),
  };

  openQRModal(tempTour);
}

/* ══════════════════════════════════════════════════════════
   16. GALERÍA
   ══════════════════════════════════════════════════════════ */
function renderGallery() {
  const tours    = getTours();
  const list     = document.getElementById('gallery-list');
  const subtitle = document.getElementById('gallery-subtitle');
  const countBdg = document.getElementById('gallery-count-badge');

  if (subtitle) subtitle.textContent = tours.length === 0
    ? 'Sin recorridos guardados'
    : `${tours.length} recorrido${tours.length !== 1 ? 's' : ''}`;

  if (countBdg) countBdg.textContent = tours.length;

  if (tours.length === 0) {
    list.innerHTML = `
      <div class="gallery-empty">
        <div class="gallery-empty-icon">🗺️</div>
        <div class="gallery-empty-title">No hay recorridos todavía</div>
        <div class="gallery-empty-sub">Creá uno desde el Modo Creador.</div>
      </div>`;
    return;
  }

  list.innerHTML = tours.map(tour => {
    const cover     = tour.pois.find(p => p.img);
    const coverHTML = cover
      ? `<img class="tour-cover" src="${cover.img}" alt="${esc(tour.name)}"
           onerror="this.parentNode.innerHTML='<div class=\\'tour-cover-ph\\'>🗺️</div>'">`
      : `<div class="tour-cover-ph">🗺️</div>`;

    const thumbs = tour.pois.slice(0, 4).map(p =>
      p.img
        ? `<img class="tour-thumb" src="${p.img}" alt="">`
        : `<div class="tour-thumb-ph">📍</div>`
    ).join('');

    const more = tour.pois.length > 4
      ? `<div class="tour-thumb-more">+${tour.pois.length - 4}</div>` : '';

    return `
    <div class="tour-card" id="tcard-${tour.id}">
      ${coverHTML}
      <div class="tour-body">
        <div class="tour-name">${esc(tour.name)}</div>
        <div class="tour-meta">
          <span>📍 ${tour.pois.length} punto${tour.pois.length !== 1 ? 's' : ''}</span>
          <span>📅 ${tour.created}</span>
        </div>
        <div class="tour-thumbs">${thumbs}${more}</div>
        <div class="tour-actions">
          <button class="t-btn t-go" onclick="loadTour('${tour.id}')">🧭 Recorrer</button>
          <button class="t-btn t-go" style="background:#1e5030;color:#9abba0;"
            onclick="openQRModal(getTours().find(t=>t.id==='${tour.id}'))">⊞ QR</button>
          <button class="t-btn t-del"
            onclick="if(confirm('¿Eliminar este recorrido?')) delTour('${tour.id}')">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function loadTour(tourId) {
  const tours = getTours();
  const tour  = tours.find(t => t.id === tourId);
  if (!tour || tour.pois.length === 0) { toast('⚠️', 'Recorrido sin puntos'); return; }

  const first  = tour.pois[0];
  APP.svc      = { ...first, color: '#22d68a', action: 'Ver detalle' };

  resetNavMap();
  document.getElementById('nav-title').textContent = `${tour.name} · ${first.name}`;
  document.getElementById('arr-title').textContent = first.name;
  document.getElementById('arr-desc').textContent  = first.desc || '';

  const btn = document.getElementById('arr-action');
  btn.textContent = 'Ver detalle'; btn.dataset.done = '0'; btn.className = 'btn btn-green';

  const img = document.getElementById('arrival-img');
  const em  = document.getElementById('arrival-emoji');
  if (first.img) { img.src = first.img; img.style.display = 'block'; em.style.display = 'none'; }
  else           { img.style.display = 'none'; em.style.display = ''; em.textContent = '📍'; }

  document.getElementById('proximity-alert').classList.remove('visible');
  show('screen-nav');
  toast('🧭', `Navegando: ${tour.name}`);
}

function updateHomeBadge() {
  const tours = getTours();
  const el    = document.getElementById('gallery-home-sub');
  if (el) el.textContent = tours.length === 0
    ? 'Sin recorridos guardados'
    : `${tours.length} recorrido${tours.length !== 1 ? 's' : ''} guardado${tours.length !== 1 ? 's' : ''}`;
}

/* ══════════════════════════════════════════════════════════
   17. QR — EXPORTAR, COMPARTIR E IMPORTAR
   ══════════════════════════════════════════════════════════ */

/**
 * Abre el modal del QR para un tour.
 * Genera:
 *   - URL compartible: ?tour=<base64(JSON)>
 *   - QR visual del link
 */
function openQRModal(tour) {
  if (!tour) { toast('⚠️', 'No hay recorrido para exportar'); return; }

  APP.activeTourId = tour.id || null;

  // Payload compacto (sin imágenes para mantener la URL corta)
  const payload = JSON.stringify({
    n: tour.name,
    p: tour.pois.map(p => ({
      n:  p.name,
      la: p.lat,
      lo: p.lng,
      d:  p.desc || '',
    })),
  });

  const encoded  = btoa(unescape(encodeURIComponent(payload)));
  const shareURL = `${location.origin}${location.pathname}?tour=${encoded}`;

  // Guardar URL para el botón "Copiar"
  APP._lastShareURL = shareURL;

  // Texto del modal
  const nameEl = document.getElementById('qr-tour-name');
  if (nameEl) nameEl.textContent = tour.name;

  // Generar QR en canvas
  const canvas = document.getElementById('qr-canvas');
  if (canvas && typeof QRCode !== 'undefined') {
    QRCode.toCanvas(canvas, shareURL, {
      width:  220,
      margin: 2,
      color:  { dark: '#e8b84b', light: '#0a2415' },
    }, err => {
      if (err) console.warn('[P360] QR error:', err);
    });
  } else if (canvas) {
    // QRCode.js no cargó — mostrar URL como fallback
    const ctx = canvas.getContext('2d');
    canvas.width  = 220; canvas.height = 60;
    ctx.fillStyle = '#0a2415';
    ctx.fillRect(0, 0, 220, 60);
    ctx.fillStyle = '#e8b84b';
    ctx.font      = '11px monospace';
    ctx.fillText('QRCode.js no disponible', 10, 30);
    ctx.fillText('Copiá la URL abajo', 10, 48);
  }

  document.getElementById('qr-modal').classList.add('open');
}

function closeQRModal() {
  document.getElementById('qr-modal').classList.remove('open');
}

/** Copia la URL compartible al portapapeles */
function copyTourURL() {
  const url = APP._lastShareURL;
  if (!url) { toast('⚠️', 'Generá primero un QR'); return; }

  const btn = document.getElementById('copy-url-btn');

  if (navigator.clipboard) {
    navigator.clipboard.writeText(url)
      .then(() => {
        toast('🔗', 'URL copiada al portapapeles');
        if (btn) { btn.textContent = '✓ Copiado'; setTimeout(() => { btn.textContent = '⊂ Copiar URL'; }, 2500); }
      })
      .catch(() => toast('⚠️', 'No se pudo copiar — intentá manualmente'));
  } else {
    // Fallback: seleccionar texto
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('🔗', 'URL copiada');
  }

  console.log('[P360] Tour URL:', url);
}

/**
 * loadTourFromURL — al iniciar la app, lee el parámetro ?tour=
 * Si existe, decodifica el JSON y carga el recorrido directamente.
 * También guarda el tour en localStorage si no existe aún.
 */
function loadTourFromURL() {
  const params  = new URLSearchParams(location.search);
  const encoded = params.get('tour');
  if (!encoded) return;

  try {
    const json = decodeURIComponent(escape(atob(encoded)));
    const data = JSON.parse(json);

    // Formato compacto (n, p[]) o completo (name, pois[])
    const name = data.n || data.name || 'Recorrido compartido';
    const raw  = data.p || data.pois || [];

    if (!raw.length) return;

    const pois = raw.map((p, i) => ({
      id:    `up-${i}`,
      name:  p.n || p.name,
      lat:   p.la || p.lat,
      lng:   p.lo || p.lng,
      desc:  p.d  || p.desc || '',
      img:   null,
      color: '#22d68a',
      emoji: '📍',
    }));

    const tour = {
      id:      `url-${Date.now()}`,
      name,
      created: new Date().toLocaleDateString('es-AR'),
      pois,
    };

    // Guardar solo si no existe ya (evitar duplicados por refresh)
    const existing = getTours();
    const dup = existing.find(t =>
      t.name === tour.name && t.pois.length === tour.pois.length
    );
    if (!dup) {
      existing.push(tour);
      setTours(existing);
    }

    updateHomeBadge();
    toast('🔗', `Recorrido "${name}" cargado desde QR`);

    // Ir a navegación directamente con el primer POI
    setTimeout(() => loadTour(dup ? dup.id : tour.id), 800);

  } catch (e) {
    console.warn('[P360] URL de tour inválida:', e.message);
  }
}

/* ══════════════════════════════════════════════════════════
   18. TOAST
   ══════════════════════════════════════════════════════════ */
let _toastTimer = null;

function toast(icon, text) {
  const el   = document.getElementById('toast');
  const iEl  = document.getElementById('toast-icon');
  const tEl  = document.getElementById('toast-text');
  if (!el) return;

  if (iEl) iEl.textContent = icon;
  if (tEl) tEl.textContent = text;

  el.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ══════════════════════════════════════════════════════════
   19. UTILIDADES
   ══════════════════════════════════════════════════════════ */

/** Escapa HTML para prevenir XSS en contenido generado por el usuario */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ══════════════════════════════════════════════════════════
   20. INICIALIZACIÓN
   ══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  // Pantalla inicial
  show('screen-home');
  updateHomeBadge();

  // GPS silencioso en background (para tenerlo listo antes de entrar a NAV)
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      p => {
        APP.userLat = p.coords.latitude;
        APP.userLng = p.coords.longitude;
        APP.userAcc = Math.round(p.coords.accuracy);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }

  // Sensor de orientación para flecha AR y brújula
  startOrientation();

  // Cargar recorrido desde URL si viene con ?tour= (enlace compartido / QR)
  loadTourFromURL();

  // Cerrar modal QR con Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeQRModal();
  });
});
