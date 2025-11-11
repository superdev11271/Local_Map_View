#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const express = require('express');

const ROOT_DIR = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT_DIR, 'index.html');

const numberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildClientConfig = () => {
  const minZoom = numberOr(process.env.TILE_SERVER_MIN_ZOOM, undefined);
  const maxZoom = numberOr(process.env.TILE_SERVER_MAX_ZOOM, undefined);

  return {
    tileServer: {
      urlTemplate:
        process.env.TILE_SERVER_URL ||
        'http://127.0.0.1:8080/tiles/{z}/{x}/{y}.png',
      attribution: process.env.TILE_SERVER_ATTRIBUTION || 'Local tile server',
      minZoom: Number.isFinite(minZoom) ? minZoom : 0,
      maxZoom: Number.isFinite(maxZoom) ? maxZoom : 19
    },
    initialView: {
      lat: numberOr(process.env.MAP_LAT, 37.7749),
      lng: numberOr(process.env.MAP_LNG, -122.4194),
      zoom: numberOr(process.env.MAP_ZOOM, 12)
    }
  };
};

const CONFIG_PAYLOAD = `window.appConfig = ${JSON.stringify(buildClientConfig())};`;

const injectConfigScript = (html) => {
  if (html.includes('/config.js')) {
    return html;
  }

  return html.replace(
    '<script src="./renderer.js"></script>',
    '<script src="/config.js"></script>\n    <script src="./renderer.js"></script>'
  );
};

const createServer = async () => {
  const app = express();
  const host = process.env.WEB_HOST || '0.0.0.0';
  const port = numberOr(process.env.WEB_PORT, 3000);

  let cachedIndexHtml;
  const getIndexHtml = async () => {
    if (!cachedIndexHtml) {
      const raw = await fs.readFile(INDEX_PATH, 'utf8');
      cachedIndexHtml = injectConfigScript(raw);
    }
    return cachedIndexHtml;
  };

  app.get('/config.js', (_req, res) => {
    res.type('application/javascript').send(CONFIG_PAYLOAD);
  });

  app.get(['/', '/index.html'], async (_req, res, next) => {
    try {
      const html = await getIndexHtml();
      res.type('html').send(html);
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(ROOT_DIR));

  app.use((error, _req, res, _next) => {
    console.error('[web] Unexpected error:', error);
    res.status(500).send('Internal server error');
  });

  app.listen(port, host, () => {
    console.log(`[web] Serving ${ROOT_DIR}`);
    console.log(`[web] Listening on http://${host}:${port}`);
    console.log('[web] Client config:', CONFIG_PAYLOAD);
  });
};

createServer().catch((error) => {
  console.error('[web] Failed to start web server:', error);
  process.exit(1);
});

