const MAP_TILE_THEMES = {
  light: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    options: {
      maxZoom: 18,
      subdomains: ["a", "b", "c", "d"],
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }
  }
};

// Above the current 8-station set; clustering activates only if more buoys are added.
const CLUSTER_STATION_THRESHOLD = 12;

function pointOffsetMiles(point, eastMiles = 0, northMiles = 0) {
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  const milesPerDegreeLat = 69;
  const milesPerDegreeLon = Math.max(1, 69 * Math.cos(lat * Math.PI / 180));
  return [lat + northMiles / milesPerDegreeLat, lon + eastMiles / milesPerDegreeLon];
}

function stationDataSignature(station, formatters) {
  const temp = formatters.stationWaterTemp?.(station);
  const change = formatters.stationChange24h?.(station);
  return [station.id, temp, change, station.isStale ? 1 : 0].join("|");
}

const COMPACT_MAP_WIDTH = 680;
const COMPACT_MAP_HEIGHT = 520;
const NARROW_MAP_WIDTH = 400;
const NARROW_MAP_HEIGHT = 380;

function mapSize(container) {
  const rect = container?.getBoundingClientRect?.();
  return {
    width: container?.clientWidth || Math.round(rect?.width) || window.innerWidth,
    height: container?.clientHeight || Math.round(rect?.height) || window.innerHeight
  };
}

function isCompactMap(container) {
  const { width, height } = mapSize(container);
  return width < COMPACT_MAP_WIDTH || height < COMPACT_MAP_HEIGHT;
}

function isNarrowMap(container) {
  const { width, height } = mapSize(container);
  return width < NARROW_MAP_WIDTH || height < NARROW_MAP_HEIGHT;
}

function markerMode(container) {
  if (isNarrowMap(container)) return "tiny";
  if (isCompactMap(container)) return "compact";
  return "full";
}

function getMarkerSpec(container) {
  const mode = markerMode(container);
  if (mode === "tiny") {
    return {
      iconSize: [96, 82],
      iconAnchor: [48, 41],
      center: [48, 41],
      calloutRadius: 18,
      pin: { left: 43, top: 36 },
      leaderOrigin: [48, 41],
      mode
    };
  }
  if (mode === "compact") {
    return {
      iconSize: [128, 108],
      iconAnchor: [64, 54],
      center: [64, 54],
      calloutRadius: 22,
      pin: { left: 58, top: 48 },
      leaderOrigin: [64, 54],
      mode
    };
  }
  return {
    iconSize: [180, 150],
    iconAnchor: [90, 75],
    center: [90, 75],
    calloutRadius: 42,
    pin: { left: 84, top: 69 },
    leaderOrigin: [90, 75],
    mode
  };
}

function stationCalloutLayout(station, container) {
  const spec = getMarkerSpec(container);
  const offsets = spec.mode === "tiny" ? {
    "44056": [30, 34],
    "44100": [-38, -30],
    "44099": [-44, -34],
    "44014": [38, -34],
    "44086": [-46, 32],
    "44079": [36, 10],
    "41082": [40, 42],
    "41083": [-40, 42]
  } : spec.mode === "compact" ? {
    "44056": [42, 58],
    "44100": [-56, -48],
    "44099": [-68, -56],
    "44014": [54, -54],
    "44086": [-72, 54],
    "44079": [48, 20],
    "41082": [58, 74],
    "41083": [-60, 74]
  } : {
    "44056": [62, 22],
    "44100": [-70, -42],
    "44099": [-42, -48],
    "44014": [92, -50],
    "44086": [-118, 80],
    "44079": [105, 10],
    "41082": [104, 86],
    "41083": [-68, 86]
  };
  const [x, y] = offsets[station.id] || [0, 0];
  const distance = Math.hypot(x, y);
  return {
    x,
    y,
    leaderWidth: Math.max(0, distance - spec.calloutRadius),
    leaderAngle: Math.atan2(y, x) * 180 / Math.PI,
    spec
  };
}

export class BuoyMap {
  constructor(container, { onSelect, formatters = {} } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.formatters = formatters;
    this.map = null;
    this.layers = {
      base: null,
      reference: null,
      stations: null,
      overlays: null
    };
    this.markers = new Map();
    this.stations = new Map();
    this.bounds = [];
    this.selectedStationId = null;
    this.hoveredStationId = null;
    this.reference = null;
    this.referenceKey = null;
    this.resizeTimer = null;
    this.theme = "light";
    this.stationSignatures = new Map();
    this.clusterMode = false;
    this.markerMode = null;
    this.resizeObserver = null;
  }

  get L() {
    return window.L;
  }

  init(reference) {
    if (!this.container) return false;

    if (!this.L) {
      this.container.innerHTML = `
        <div class="map-fallback">
          <div>
            <strong>Map tiles unavailable</strong>
            <span>The buoy list still shows live station temperatures.</span>
          </div>
        </div>
      `;
      console.warn("[BuoyMap] init failed: leaflet_missing");
      return false;
    }

    if (this.map) return true;

    if (this.container.querySelector(".map-fallback")) {
      this.container.innerHTML = "";
    }

    this.reference = reference;
    this.map = this.L.map(this.container, {
      scrollWheelZoom: false,
      zoomControl: true,
      zoomSnap: 0.25,
      zoomDelta: 0.25
    }).setView([reference?.lat ?? 36.55, reference?.lon ?? -75.87], 8);

    this.layers.reference = this.L.layerGroup().addTo(this.map);
    this.layers.overlays = this.L.layerGroup().addTo(this.map);
    this.layers.stations = this.createStationsLayer(false).addTo(this.map);
    this.markerMode = markerMode(this.container);
    this.observeContainerSize();
    this.setTheme(this.theme);
    window.requestAnimationFrame(() => {
      this.syncContainerSize();
      this.map?.invalidateSize();
      this.fitBounds();
    });
    return true;
  }

  createStationsLayer(useCluster = false) {
    const L = this.L;
    if (useCluster && L.markerClusterGroup) {
      return L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 52,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 9,
        iconCreateFunction: (cluster) => {
          const count = cluster.getChildCount();
          return L.divIcon({
            className: "leaflet-div-icon buoy-cluster-icon",
            html: `<div class="buoy-cluster"><span>${count}</span><small>buoys</small></div>`,
            iconSize: [54, 54],
            iconAnchor: [27, 27]
          });
        }
      });
    }
    return L.layerGroup();
  }

  shouldCluster(stationCount = this.stations.size) {
    return stationCount > CLUSTER_STATION_THRESHOLD;
  }

  refreshClusterMode(stationCount = this.stations.size) {
    if (!this.map || !this.L?.markerClusterGroup) return false;
    const nextMode = this.shouldCluster(stationCount);
    if (nextMode === this.clusterMode) return false;

    const stations = Array.from(this.stations.values());
    const selectedId = this.selectedStationId;
    const hoveredId = this.hoveredStationId;
    this.clusterMode = nextMode;
    this.layers.stations.remove();
    this.layers.stations = this.createStationsLayer(nextMode).addTo(this.map);
    this.markers.clear();
    this.stationSignatures.clear();

    for (const station of stations) {
      if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) continue;
      this.upsertStationMarker(station);
    }

    this.selectedStationId = selectedId;
    this.hoveredStationId = hoveredId;
    this.updateMarkerPresentation();
    return true;
  }

  setTheme(theme = "light") {
    this.theme = theme;
    if (!this.map || !this.L) return;

    const config = MAP_TILE_THEMES[theme] ?? MAP_TILE_THEMES.light;
    if (this.layers.base) {
      if (this.layers.base._obxTheme === theme) return;
      this.layers.base.remove();
    }

    const nextLayer = this.L.tileLayer(config.url, config.options);
    nextLayer._obxTheme = theme;
    this.layers.base = nextLayer.addTo(this.map);
  }

  setReference(reference) {
    const key = reference
      ? `${reference.lat}|${reference.lon}|${reference.name || ""}`
      : null;
    if (key === this.referenceKey) return;

    this.reference = reference;
    this.referenceKey = key;
    this.renderReference();
  }

  renderReference() {
    const L = this.L;
    if (!this.layers.reference || !L) return;

    this.layers.reference.clearLayers();
    const reference = this.reference;
    if (!reference?.lat || !reference?.lon) return;

    const { escapeHtml } = this.formatters;
    const referenceIcon = L.divIcon({
      className: "leaflet-div-icon",
      html: `<div class="line-marker">${escapeHtml?.(reference.name || "VA/NC line") ?? "VA/NC line"}</div>`,
      iconSize: [120, 32],
      iconAnchor: [60, 16]
    });
    L.marker([reference.lat, reference.lon], { icon: referenceIcon, interactive: false })
      .addTo(this.layers.reference);

    [
      { label: "1 mi", radius: 1609.344, color: "#d9672b", eastMiles: 1 },
      { label: "10 mi", radius: 16093.44, color: "#b73f25", eastMiles: 10 }
    ].forEach((ring) => {
      L.circle([reference.lat, reference.lon], {
        radius: ring.radius,
        color: ring.color,
        weight: ring.label === "1 mi" ? 2 : 2.5,
        opacity: ring.label === "1 mi" ? 0.8 : 0.72,
        fillColor: ring.color,
        fillOpacity: ring.label === "1 mi" ? 0.08 : 0.035
      }).addTo(this.layers.reference);

      const labelPoint = pointOffsetMiles(reference, ring.eastMiles, ring.label === "1 mi" ? 0.18 : 0.45);
      if (!labelPoint) return;
      const ringIcon = L.divIcon({
        className: "leaflet-div-icon",
        html: `<div class="ring-label">${escapeHtml?.(ring.label) ?? ring.label}</div>`,
        iconSize: [54, 26],
        iconAnchor: [27, 13]
      });
      L.marker(labelPoint, { icon: ringIcon, interactive: false }).addTo(this.layers.reference);
    });
  }

  setStations(stations, { selectedId = null, preserveView = false } = {}) {
    if (!this.map || !this.layers.stations) return;

    this.refreshClusterMode(stations.length);

    const nextStations = new Map(stations.map((station) => [station.id, station]));
    const nextIds = new Set(nextStations.keys());
    this.stations = nextStations;
    if (selectedId != null) {
      this.selectedStationId = selectedId;
    }

    for (const [stationId, marker] of this.markers) {
      if (!nextIds.has(stationId)) {
        this.layers.stations.removeLayer(marker);
        this.markers.delete(stationId);
        this.stationSignatures.delete(stationId);
      }
    }

    const bounds = [];
    for (const station of stations) {
      if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) continue;
      bounds.push([station.lat, station.lon]);
      this.upsertStationMarker(station);
    }

    if (this.reference?.lat && this.reference?.lon) {
      bounds.push([this.reference.lat, this.reference.lon]);
    }

    this.bounds = bounds;
    this.updateMarkerPresentation();

    if (!preserveView) {
      this.fitBounds();
      window.setTimeout(() => this.fitBounds(), 0);
    }
  }

  upsertStationMarker(station) {
    const signature = stationDataSignature(station, this.formatters);

    const existing = this.markers.get(station.id);
    if (existing && this.stationSignatures.get(station.id) === signature) {
      return existing;
    }

    if (existing) {
      this.layers.stations.removeLayer(existing);
    }

    const marker = this.createStationMarker(station);
    marker.addTo(this.layers.stations);
    this.markers.set(station.id, marker);
    this.stationSignatures.set(station.id, signature);
    return marker;
  }

  stationMarkerHtml(station) {
    const {
      escapeHtml,
      tempColor,
      trendClass,
      trendBadgeLabel,
      oneDecimal,
      stationWaterTemp,
      stationChange24h
    } = this.formatters;

    const temp = stationWaterTemp?.(station);
    const change = stationChange24h?.(station);
    const tempLabel = Number.isFinite(temp) ? `${oneDecimal?.(temp) ?? temp.toFixed(1)}°` : "--";
    const changeLabel = trendBadgeLabel?.(change) ?? "--";
    const stationShortName = station.name?.replace(/,?\s*(VA|NC)$/i, "") || station.id;
    const trend = trendClass?.(change) ?? "unknown";
    const color = tempColor?.(temp) ?? "#66756f";
    const isSelected = station.id === this.selectedStationId;
    const isHovered = station.id === this.hoveredStationId;
    const layout = stationCalloutLayout(station, this.container);
    const [centerX, centerY] = layout.spec.center;

    return `
      <div
        data-station-id="${escapeHtml?.(station.id) ?? station.id}"
        aria-label="${escapeHtml?.(`${station.id} ${station.name}: ${tempLabel} water, ${changeLabel} in 24 hours`) ?? `${station.id} ${tempLabel}`}"
        class="buoy-marker ${layout.spec.mode} ${station.isStale ? "stale" : ""} ${isSelected ? "selected" : ""} ${isHovered ? "hovered" : ""} ${trend}"
        style="--buoy-temp-color:${color}; --callout-x:${layout.x + centerX}px; --callout-y:${layout.y + centerY}px; --leader-width:${layout.leaderWidth.toFixed(1)}px; --leader-angle:${layout.leaderAngle.toFixed(1)}deg; --pin-left:${layout.spec.pin.left}px; --pin-top:${layout.spec.pin.top}px; --leader-origin-x:${layout.spec.leaderOrigin[0]}px; --leader-origin-y:${layout.spec.leaderOrigin[1]}px"
      >
        <span class="buoy-marker-leader" aria-hidden="true"></span>
        <span class="buoy-marker-pin" aria-hidden="true"></span>
        <span class="buoy-marker-callout">
          <strong class="buoy-marker-temp">${escapeHtml?.(tempLabel) ?? tempLabel}</strong>
          <span class="buoy-marker-badge">${escapeHtml?.(changeLabel) ?? changeLabel}</span>
          <span class="buoy-marker-label">
            <b>${escapeHtml?.(station.id) ?? station.id}</b>
            <small>${escapeHtml?.(stationShortName) ?? stationShortName}</small>
          </span>
        </span>
      </div>
    `;
  }

  createStationIcon(station) {
    const L = this.L;
    const spec = getMarkerSpec(this.container);
    return L.divIcon({
      className: "leaflet-div-icon buoy-leaflet-icon",
      html: this.stationMarkerHtml(station),
      iconSize: spec.iconSize,
      iconAnchor: spec.iconAnchor
    });
  }

  createStationMarker(station) {
    const L = this.L;
    const marker = L.marker([station.lat, station.lon], {
      icon: this.createStationIcon(station),
      keyboard: true,
      title: `${station.id} · ${station.name}`
    });

    marker.on("click", () => this.selectStation(station.id));
    marker.on("mouseover", () => this.setHoveredStation(station.id));
    marker.on("mouseout", () => {
      if (this.hoveredStationId === station.id) {
        this.setHoveredStation(null);
      }
    });

    marker._obxStationId = station.id;
    return marker;
  }

  updateMarkerPresentation() {
    for (const [stationId, marker] of this.markers) {
      const station = this.stations.get(stationId);
      if (!station) continue;

      marker.setIcon?.(this.createStationIcon(station));
      marker.setZIndexOffset?.(
        stationId === this.selectedStationId || stationId === this.hoveredStationId
          ? 1000
          : station.isStale ? -100 : 0
      );
    }
  }

  setHoveredStation(stationId) {
    if (this.hoveredStationId === stationId) return;
    this.hoveredStationId = stationId;
    this.updateMarkerPresentation();
  }

  selectStation(stationId, { pan = true, notify = true } = {}) {
    const marker = this.markers.get(stationId);
    const station = this.stations.get(stationId);
    if (!station || !this.map) return;

    this.selectedStationId = stationId;
    this.updateMarkerPresentation();
    if (notify) {
      this.onSelect?.(stationId, station);
    }

    if (pan && marker) {
      const latLng = marker.getLatLng();
      const minZoom = isCompactMap(this.container) ? 6.45 : 7.65;
      this.map.flyTo(latLng, Math.max(this.map.getZoom(), minZoom), { duration: 0.45 });
    }
  }

  hasMarker(stationId) {
    return this.markers.has(stationId);
  }

  hasStations() {
    return this.markers.size > 0;
  }

  getSelectedStationId() {
    return this.selectedStationId;
  }

  getStation(stationId) {
    return this.stations.get(stationId);
  }

  syncContainerSize() {
    if (!this.container) return;
    this.container.style.removeProperty("height");
    this.container.style.removeProperty("width");
  }

  observeContainerSize() {
    if (!this.container || this.resizeObserver || !("ResizeObserver" in window)) return;

    let previousSize = "";
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const box = Array.isArray(entry?.contentBoxSize)
        ? entry.contentBoxSize[0]
        : entry?.contentBoxSize;
      const width = Math.round(box?.inlineSize ?? entry?.contentRect?.width ?? this.container.clientWidth);
      const height = Math.round(box?.blockSize ?? entry?.contentRect?.height ?? this.container.clientHeight);
      const nextSize = `${width}x${height}`;
      if (nextSize === previousSize) return;

      previousSize = nextSize;
      this.scheduleResize();
    });
    this.resizeObserver.observe(this.container);
  }

  fitBounds() {
    if (!this.map || !this.bounds.length || !this.L) return;
    const mode = markerMode(this.container);
    const bounds = this.L.latLngBounds(this.bounds).pad(mode === "tiny" ? 0.22 : mode === "compact" ? 0.26 : 0.1);
    this.syncContainerSize();
    this.map.invalidateSize();
    this.map.fitBounds(bounds, {
      animate: false,
      padding: mode === "tiny" ? [46, 32] : mode === "compact" ? [72, 56] : [84, 84],
      maxZoom: mode === "tiny" ? 5.9 : mode === "compact" ? 6.35 : 7.65
    });
  }

  scheduleResize() {
    if (!this.map) return;
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      const nextMode = markerMode(this.container);
      if (this.markerMode !== nextMode) {
        this.markerMode = nextMode;
        this.stationSignatures.clear();
        this.updateMarkerPresentation();
      }
      this.fitBounds();
    }, 120);
  }

  clear() {
    this.layers.stations?.clearLayers?.();
    this.markers.clear();
    this.stationSignatures.clear();
    this.stations.clear();
    this.bounds = [];
    this.selectedStationId = null;
    this.hoveredStationId = null;
  }

  destroy() {
    this.clear();
    this.layers.reference?.clearLayers?.();
    this.layers.overlays?.clearLayers?.();
    this.layers.base?.remove?.();
    this.resizeObserver?.disconnect?.();
    this.map?.remove?.();
    this.map = null;
    this.resizeObserver = null;
    this.layers = { base: null, reference: null, stations: null, overlays: null };
  }
}
