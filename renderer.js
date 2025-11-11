const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const safeGetContextBridgeConfig = (getter, fallback) => {
  try {
    if (window.electronAPI && typeof window.electronAPI[getter] === 'function') {
      return window.electronAPI[getter]();
    }
  } catch (error) {
    console.warn(`[renderer] Failed to read ${getter} from preload:`, error);
  }
  return fallback;
};

const getRendererEnv = () => {
  try {
    if (typeof window !== 'undefined' && window.process && window.process.env) {
      return window.process.env;
    }
  } catch (error) {
    console.warn('[renderer] Unable to access process.env in renderer:', error);
  }
  return undefined;
};

const FALLBACK_TILE_SERVER = (() => {
  const env = getRendererEnv();
  const defaults = {
    urlTemplate: 'http://127.0.0.1:8080/tiles/{z}/{x}/{y}.png',
    attribution: 'Local tile server',
    minZoom: 12,
    maxZoom: 19
  };

  if (!env) return defaults;

  const minZoom = toFiniteNumber(env.TILE_SERVER_MIN_ZOOM);
  const maxZoom = toFiniteNumber(env.TILE_SERVER_MAX_ZOOM);

  return {
    ...defaults,
    urlTemplate: env.TILE_SERVER_URL?.trim() || defaults.urlTemplate,
    attribution: env.TILE_SERVER_ATTRIBUTION || defaults.attribution,
    minZoom: Number.isFinite(minZoom) ? minZoom : defaults.minZoom,
    maxZoom: Number.isFinite(maxZoom) ? maxZoom : defaults.maxZoom
  };
})();

const FALLBACK_INITIAL_VIEW = (() => {
  const env = getRendererEnv();
  const defaults = {
    lat: 39.045375,
    lng: 125.7680275,
    zoom: 17
  };

  if (!env) return defaults;

  const lat = toFiniteNumber(env.MAP_LAT);
  const lng = toFiniteNumber(env.MAP_LNG);
  const zoom = toFiniteNumber(env.MAP_ZOOM);

  return {
    lat: Number.isFinite(lat) ? lat : defaults.lat,
    lng: Number.isFinite(lng) ? lng : defaults.lng,
    zoom: Number.isFinite(zoom) ? zoom : defaults.zoom
  };
})();

const DEFAULT_TILE_SERVER = (() => {
  const fromPreload = safeGetContextBridgeConfig('getTileServerConfig', null);
  if (fromPreload) {
    return { ...FALLBACK_TILE_SERVER, ...fromPreload };
  }
  return FALLBACK_TILE_SERVER;
})();

const DEFAULT_INITIAL_VIEW = (() => {
  const fromPreload = safeGetContextBridgeConfig('getInitialView', null);
  if (fromPreload) {
    return { ...FALLBACK_INITIAL_VIEW, ...fromPreload };
  }
  return FALLBACK_INITIAL_VIEW;
})();

const extractBrowserConfig = () => {
  if (window.appConfig && typeof window.appConfig === 'object') {
    return {
      tileServer: {
        ...DEFAULT_TILE_SERVER,
        ...(window.appConfig.tileServer || {})
      },
      initialView: {
        ...DEFAULT_INITIAL_VIEW,
        ...(window.appConfig.initialView || {})
      }
    };
  }

  const params = new URLSearchParams(window.location.search);

  const tileServer = {
    ...DEFAULT_TILE_SERVER,
    urlTemplate: params.get('tiles') || DEFAULT_TILE_SERVER.urlTemplate,
    attribution: params.get('attr') || DEFAULT_TILE_SERVER.attribution,
    minZoom: Number(params.get('minZoom')) || DEFAULT_TILE_SERVER.minZoom,
    maxZoom: Number(params.get('maxZoom')) || DEFAULT_TILE_SERVER.maxZoom
  };

  const initialView = {
    ...DEFAULT_INITIAL_VIEW,
    lat: Number(params.get('lat')) || DEFAULT_INITIAL_VIEW.lat,
    lng: Number(params.get('lng')) || DEFAULT_INITIAL_VIEW.lng,
    zoom: Number(params.get('zoom')) || DEFAULT_INITIAL_VIEW.zoom
  };

  return { tileServer, initialView };
};

const resolveRuntimeConfig = () => {
  const preloadTileServer =
    safeGetContextBridgeConfig('getTileServerConfig', null);
  const preloadInitialView =
    safeGetContextBridgeConfig('getInitialView', null);

  if (preloadTileServer && preloadInitialView) {
    return {
      tileServer: { ...DEFAULT_TILE_SERVER, ...preloadTileServer },
      initialView: { ...DEFAULT_INITIAL_VIEW, ...preloadInitialView }
    };
  }

  return extractBrowserConfig();
};

const getEmptyState = () => document.getElementById('map-empty-state');

const setEmptyState = (heading, description) => {
  const emptyState = getEmptyState();
  if (!emptyState) return;

  emptyState.innerHTML = `
      <strong>${heading}</strong>
      <span>${description}</span>
    `;
};

const removeEmptyState = () => {
  const emptyState = getEmptyState();
  if (emptyState && emptyState.parentElement) {
    emptyState.remove();
  }
};

const bootstrapLeafletMap = () => {
  if (!window.L) {
    setEmptyState('Leaflet not available', 'Could not find the Leaflet library. Ensure leaflet.js is loaded.');
    return;
  }

  const mapElement = document.getElementById('map');
  if (!mapElement) {
    setEmptyState('Missing container', 'Unable to find the map container element.');
    return;
  }

  const { tileServer, initialView } = resolveRuntimeConfig();

  const map = window.L.map(mapElement, {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
    wheelPxPerZoomLevel: 100
  }).setView([initialView.lat, initialView.lng], initialView.zoom);

  const tileLayer = window.L.tileLayer(tileServer.urlTemplate, {
    minZoom: tileServer.minZoom,
    maxZoom: tileServer.maxZoom,
    attribution: tileServer.attribution,
    tileSize: 256,
    keepBuffer: 4,
    updateInterval: 100
  });

  tileLayer.on('tileerror', (event) => {
    const { coords } = event;
    console.error(`Tile failed to load z:${coords.z} x:${coords.x} y:${coords.y}`, event.error);
    setEmptyState('Tile load error', 'We could not retrieve map tiles from the local server. Verify the tile server is running and accessible.');
  });

  tileLayer.on('load', () => {
    removeEmptyState();
  });

  tileLayer.addTo(map);

  // Trajectory drawing state
  const trajectoryPoints = [];
  const markerLayer = window.L.layerGroup().addTo(map);
  const trajectoryLine = window.L.polyline([], {
    color: '#38bdf8',
    weight: 4,
    opacity: 0.85,
    lineJoin: 'round'
  }).addTo(map);

  const trajectoryControl = window.L.control({ position: 'topright' });
  let controlContainer = null;

  const formatDistance = (meters) => {
    if (!Number.isFinite(meters) || meters <= 0) {
      return '0 m';
    }

    if (meters >= 1000) {
      const km = meters / 1000;
      return `${km >= 10 ? km.toFixed(1) : km.toFixed(2)} km`;
    }

    return `${meters >= 100 ? meters.toFixed(0) : meters.toFixed(1)} m`;
  };

  const updateControl = () => {
    if (!controlContainer) return;

    const totalDistance = trajectoryPoints.reduce((sum, point, index) => {
      if (index === 0) return sum;
      return sum + trajectoryPoints[index - 1].distanceTo(point);
    }, 0);

    controlContainer.innerHTML = `
      <strong>Trajectory</strong>
      <div class="distance">${formatDistance(totalDistance)}</div>
      <div>${trajectoryPoints.length} point${trajectoryPoints.length === 1 ? '' : 's'}</div>
      <small>Right-click on the map to add a waypoint.</small>
      <button type="button" data-clear-trajectory>Clear</button>
    `;

    const button = controlContainer.querySelector('[data-clear-trajectory]');
    if (button) {
      button.disabled = trajectoryPoints.length === 0;
      button.style.opacity = trajectoryPoints.length === 0 ? '0.7' : '1';
      button.addEventListener('click', clearTrajectory, { once: true });
    }
  };

  const clearTrajectory = () => {
    trajectoryPoints.length = 0;
    trajectoryLine.setLatLngs([]);
    markerLayer.clearLayers();
    updateControl();
  };

  trajectoryControl.onAdd = () => {
    controlContainer = window.L.DomUtil.create('div', 'trajectory-control');
    window.L.DomEvent.disableClickPropagation(controlContainer);
    updateControl();
    return controlContainer;
  };

  trajectoryControl.addTo(map);

  mapElement.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  map.on('contextmenu', (event) => {
    const latLng = window.L.latLng(event.latlng.lat, event.latlng.lng);

    trajectoryPoints.push(latLng);
    trajectoryLine.addLatLng(latLng);

    window.L.circleMarker(latLng, {
      radius: 6,
      color: '#0ea5e9',
      fillColor: '#0ea5e9',
      fillOpacity: 0.9,
      weight: 2
    })
      .bindTooltip(
        `#${trajectoryPoints.length}<br>${latLng.lat.toFixed(5)}, ${latLng.lng.toFixed(5)}`,
        { permanent: false }
      )
      .addTo(markerLayer);

    removeEmptyState();
    updateControl();
  });
};

window.addEventListener('DOMContentLoaded', () => {
  bootstrapLeafletMap();
});

