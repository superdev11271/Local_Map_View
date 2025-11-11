require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');

const resolveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const PORT = resolveNumber(process.env.TILE_SERVER_PORT, 8080);
const HOST = process.env.TILE_SERVER_HOST || '0.0.0.0';
const TILE_ROOT = path.resolve(
  process.env.TILE_SERVER_ROOT || path.join(__dirname, 'tiles')
);

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

const app = express();

const ensureTileRoot = () => {
  if (!fs.existsSync(TILE_ROOT)) {
    fs.mkdirSync(TILE_ROOT, { recursive: true });
    console.warn(
      `[tileserver] Created missing tile directory at ${TILE_ROOT}. Place your tiles here.`
    );
  }
};

ensureTileRoot();

app.disable('x-powered-by');

app.get('/', (_req, res) => {
  res.type('html').send(`<html>
      <head>
        <title>Local Tile Server</title>
        <style>
          body { font-family: system-ui, sans-serif; padding: 2rem; line-height: 1.6; }
          code { background: #f1f5f9; padding: 0.1rem 0.4rem; border-radius: 0.3rem; }
          h1 { margin-top: 0; }
        </style>
      </head>
      <body>
        <h1>Local Tile Server</h1>
        <p>This server returns tiles from <code>${TILE_ROOT}</code>.</p>
        <ul>
          <li>Health check: <code>/health</code></li>
          <li>Tile endpoint: <code>/tiles/{z}/{x}/{y}.png</code></li>
        </ul>
      </body>
    </html>`);
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    tileRoot: TILE_ROOT,
    allowedExtensions: Array.from(ALLOWED_EXTENSIONS)
  });
});

const isValidCoordinate = (value) => /^\d+$/.test(value);

app.get('/tiles/:z/:x/:y.:ext', (req, res, next) => {
  const { z, x, y, ext } = req.params;

  if (!isValidCoordinate(z) || !isValidCoordinate(x) || !isValidCoordinate(y)) {
    return res.status(400).json({ error: 'Coordinates must be non-negative integers.' });
  }

  const extension = ext.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return res.status(415).json({
      error: `Unsupported tile extension '${extension}'. Allowed: ${Array.from(
        ALLOWED_EXTENSIONS
      ).join(', ')}.`
    });
  }

  const tilePath = path.join(TILE_ROOT, z, x, `${y}.${extension}`);
  const normalizedTilePath = path.normalize(tilePath);
  if (!normalizedTilePath.startsWith(TILE_ROOT)) {
    return res.status(403).json({ error: 'Tile path escapes root directory.' });
  }

  fs.access(normalizedTilePath, fs.constants.R_OK, (error) => {
    if (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Tile not found.' });
      }

      return next(error);
    }

    res.sendFile(normalizedTilePath, {
      headers: {
        'Cache-Control': 'public, max-age=86400, immutable'
      }
    });
  });
});

app.use((err, _req, res, _next) => {
  console.error('[tileserver] Unexpected error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, HOST, () => {
  console.log(`[tileserver] Serving tiles from ${TILE_ROOT}`);
  console.log(`[tileserver] Listening on http://${HOST}:${PORT}`);
  console.log('[tileserver] Example URL: /tiles/0/0/0.png');
});

