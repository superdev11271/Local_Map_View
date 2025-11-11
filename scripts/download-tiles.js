#!/usr/bin/env node
/**
 * Download map tiles around a given center coordinate and radius.
 *
 * Examples:
 *   node scripts/download-tiles.js --lat 37.7749 --lon -122.4194 --radius 5000 --zoom 12 --zoom 13
 *
 * Environment variable fallbacks (see .env.example):
 *   DOWNLOAD_LAT, DOWNLOAD_LON, DOWNLOAD_RADIUS_METERS,
 *   DOWNLOAD_ZOOM_LEVELS, DOWNLOAD_SOURCE_URL_TEMPLATE,
 *   DOWNLOAD_OUTPUT_DIR, DOWNLOAD_TILE_EXT, DOWNLOAD_SUBDOMAINS
 */

const fs = require('fs');
const path = require('path');
const { setTimeout: delay } = require('timers/promises');

require('dotenv').config();

const EARTH_RADIUS_METERS = 6_371_008.8;
const DEFAULT_RADIUS_METERS = 5_000;
const DEFAULT_ZOOMS = [12];
const DEFAULT_OUTPUT_DIR = path.join(__dirname, '..', 'tiles');
const DEFAULT_SOURCE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_EXT = 'png';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const result = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const keyValue = arg.slice(2).split('=');
    const key = keyValue[0];

    if (keyValue.length > 1) {
      result[key] = keyValue.slice(1).join('=');
      continue;
    }

    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }

    result[key] = next;
    i += 1;
  }

  return result;
};

const args = parseArgs();

const getArg = (name, envName) => {
  if (args[name] !== undefined) {
    return args[name];
  }

  if (envName && process.env[envName] !== undefined) {
    return process.env[envName];
  }

  return undefined;
};

const parseNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const parseZooms = (value) => {
  if (!value || value.length === 0) {
    return DEFAULT_ZOOMS;
  }

  if (Array.isArray(value)) {
    return value
      .flatMap(parseZooms)
      .filter((zoom, index, arr) => arr.indexOf(zoom) === index)
      .sort((a, b) => a - b);
  }

  const stringValue = String(value).trim();

  if (stringValue.includes('-')) {
    const [start, end] = stringValue.split('-').map((part) => parseInt(part, 10));
    if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
      const range = [];
      for (let z = start; z <= end; z += 1) {
        range.push(z);
      }
      return range;
    }
  }

  return stringValue
    .split(',')
    .map((part) => parseInt(part.trim(), 10))
    .filter(Number.isFinite);
};

const clampLat = (lat) => {
  return Math.max(Math.min(lat, 85.05112878), -85.05112878);
};

const latLonToTile = (lat, lon, zoom) => {
  const latRad = (clampLat(lat) * Math.PI) / 180;
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
  );

  const maxIndex = n - 1;

  return {
    x: Math.min(Math.max(x, 0), maxIndex),
    y: Math.min(Math.max(y, 0), maxIndex)
  };
};

const computeBoundingBox = (lat, lon, radiusMeters) => {
  const angularRadius = radiusMeters / EARTH_RADIUS_METERS;
  const latDelta = (angularRadius * 180) / Math.PI;
  const lonDelta =
    (angularRadius * 180) / (Math.PI * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLon: lon - lonDelta,
    maxLon: lon + lonDelta
  };
};

const ensureDirectory = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const downloadTile = async ({ url, outputPath }) => {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    await ensureDirectory(path.dirname(outputPath));
    await fs.promises.writeFile(outputPath, buffer);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message || String(error)
    };
  }
};

const renderUrl = (template, { z, x, y, s, ext }) => {
  return template
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y))
    .replaceAll('{s}', s ?? '')
    .replaceAll('{ext}', ext);
};

const unique = (value, index, array) => array.indexOf(value) === index;

const main = async () => {
  const lat = parseNumber(getArg('lat', 'DOWNLOAD_LAT'), undefined);
  const lon = parseNumber(getArg('lon', 'DOWNLOAD_LON'), undefined);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    console.error(
      'Provide center coordinates via --lat and --lon (or DOWNLOAD_LAT / DOWNLOAD_LON).'
    );
    process.exitCode = 1;
    return;
  }

  const radiusMeters = parseNumber(
    getArg('radius', 'DOWNLOAD_RADIUS_METERS'),
    DEFAULT_RADIUS_METERS
  );

  const zoomArg = args.zoom ?? process.env.DOWNLOAD_ZOOM_LEVELS;
  const zoomLevels = parseZooms(zoomArg);

  if (!zoomLevels.length) {
    console.error('No zoom levels provided. Use --zoom 10 --zoom 11 or --zoom 10-12.');
    process.exitCode = 1;
    return;
  }

  const sourceTemplate =
    getArg('source', 'DOWNLOAD_SOURCE_URL_TEMPLATE') || DEFAULT_SOURCE;
  const outputDir = path.resolve(
    getArg('output', 'DOWNLOAD_OUTPUT_DIR') || DEFAULT_OUTPUT_DIR
  );
  const tileExt = (getArg('ext', 'DOWNLOAD_TILE_EXT') || DEFAULT_EXT).replace('.', '');
  const subdomains = (getArg('subdomains', 'DOWNLOAD_SUBDOMAINS') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter(unique);

  const bbox = computeBoundingBox(lat, lon, radiusMeters);

  console.log('[download-tiles] Starting download with:');
  console.log(`  center:        lat=${lat}, lon=${lon}`);
  console.log(`  radius:        ${radiusMeters}m`);
  console.log(`  zoom levels:   ${zoomLevels.join(', ')}`);
  console.log(`  source:        ${sourceTemplate}`);
  console.log(`  output dir:    ${outputDir}`);
  console.log(`  tile ext:      .${tileExt}`);
  if (subdomains.length) {
    console.log(`  subdomains:     ${subdomains.join(', ')}`);
  }

  let successCount = 0;
  let failureCount = 0;

  for (const zoom of zoomLevels) {
    const southWest = latLonToTile(bbox.minLat, bbox.minLon, zoom);
    const northEast = latLonToTile(bbox.maxLat, bbox.maxLon, zoom);

    const minX = Math.min(southWest.x, northEast.x);
    const maxX = Math.max(southWest.x, northEast.x);
    const minY = Math.min(southWest.y, northEast.y);
    const maxY = Math.max(southWest.y, northEast.y);

    const tileTotal = (maxX - minX + 1) * (maxY - minY + 1);
    console.log(`[download-tiles] Zoom ${zoom}: downloading ${tileTotal} tiles`);

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const subdomain =
          subdomains.length > 0 ? subdomains[(x + y) % subdomains.length] : undefined;
        const url = renderUrl(sourceTemplate, { z: zoom, x, y, s: subdomain, ext: tileExt });
        const outputPath = path.join(outputDir, String(zoom), String(x), `${y}.${tileExt}`);

        const result = await downloadTile({ url, outputPath });
        if (result.success) {
          successCount += 1;
        } else {
          failureCount += 1;
          console.warn(`[download-tiles] Failed ${zoom}/${x}/${y}: ${result.error}`);
          await delay(100);
        }

        await delay(25);
      }
    }
  }

  console.log('[download-tiles] Completed.');
  console.log(`  success: ${successCount}`);
  console.log(`  failed:  ${failureCount}`);

  if (failureCount > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error('[download-tiles] Unexpected error:', error);
  process.exitCode = 1;
});

