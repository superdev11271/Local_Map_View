# Local Tile Demo

This Electron demo renders maps using tiles from a local HTTP server. It ships with a lightweight Express tile server you can point at any XYZ tile directory.

## Prerequisites

- Node.js 18+
- A folder of raster tiles organized as `/{z}/{x}/{y}.png` (or `.jpg`, `.jpeg`, `.webp`)

## Install

```bash
npm install
```

## Configure environment

Copy the template and adjust values as needed:

```bash
copy env.example .env
```

The app automatically loads variables from `.env` when you run the server, downloader, or Electron app.

## Start the tile server

```bash
set TILE_SERVER_ROOT=E:\path\to\tiles
npm run tileserver
```

Environment variables (all optional):

- `TILE_SERVER_ROOT` – root directory containing your tiles (defaults to `./tiles`)
- `TILE_SERVER_PORT` – port to listen on (default `8080`)
- `TILE_SERVER_HOST` – host/interface (default `0.0.0.0`)
- `TILE_SERVER_ATTRIBUTION` – attribution text shown on the map

The server serves tiles at `http://HOST:PORT/tiles/{z}/{x}/{y}.png`. Check `http://HOST:PORT/health` for status.

## Download tiles around a coordinate

You can pre-fetch tiles from a remote XYZ service:

```bash
npm run download-tiles -- --lat 37.7749 --lon -122.4194 --radius 5000 --zoom 12 --zoom 13
```

Key options / environment variables:

- `--lat`, `--lon` (`DOWNLOAD_LAT`, `DOWNLOAD_LON`) – center coordinate
- `--radius` (`DOWNLOAD_RADIUS_METERS`) – radius in meters around the center (default 5000)
- `--zoom` (`DOWNLOAD_ZOOM_LEVELS`) – pass multiple flags (`--zoom 12 --zoom 13`) or ranges (`--zoom 12-14`)
- `--source` (`DOWNLOAD_SOURCE_URL_TEMPLATE`) – XYZ template, e.g. `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- `--output` (`DOWNLOAD_OUTPUT_DIR`) – destination folder, defaults to `./tiles`
- `--ext` (`DOWNLOAD_TILE_EXT`) – file extension (`png`, `jpg`, ...)

### Satellite imagery sources

Most satellite providers require an API key or account. Examples:

- **ArcGIS World Imagery** (no key, but subject to Esri terms):  
  `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
- **Mapbox Satellite** (requires access token):  
  `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}?access_token=YOUR_TOKEN`
- **Google Maps** tiles are not licensed for bulk download; prefer Google Static Maps or a commercial agreement instead of scraping.

Update your `.env` (or CLI `--source`) with the provider URL, set any required `--ext` (e.g. `--ext jpg`), and include attribution via `TILE_SERVER_ATTRIBUTION`.

Downloaded tiles follow the same directory layout expected by the local server, so you can point `TILE_SERVER_ROOT` at the output path and start serving right away.

## Develop with live reload

Run the tiler server and Electron app together with auto-reload:

```bash
npm run dev
```

`npm run dev` uses `electronmon` under the hood—when you edit renderer, preload, or main-process files it restarts Electron automatically. `concurrently` keeps the tile server running alongside it (killing both on exit).

## Launch the Electron app

```bash
set TILE_SERVER_URL=http://127.0.0.1:8080/tiles/{z}/{x}/{y}.png
set MAP_LAT=37.7749
set MAP_LNG=-122.4194
set MAP_ZOOM=12
npm start
```

Any of the map-related environment variables can be omitted; defaults are provided in `preload.js`.

## Tile layout example

```
tiles/
└── 12/
    └── 654/
        └── 1582.png
```

If a requested tile is missing, the renderer shows an error message and the tile server returns `404`.

