const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getTileServerConfig: () => ({
    urlTemplate: process.env.TILE_SERVER_URL || 'http://localhost:8080/tiles/{z}/{x}/{y}.png',
    attribution: process.env.TILE_SERVER_ATTRIBUTION || 'Local tile server',
    minZoom: Number(process.env.TILE_SERVER_MIN_ZOOM || 0),
    maxZoom: Number(process.env.TILE_SERVER_MAX_ZOOM || 19)
  }),
  getInitialView: () => ({
    lat: Number(process.env.MAP_LAT || 37.7749),
    lng: Number(process.env.MAP_LNG || -122.4194),
    zoom: Number(process.env.MAP_ZOOM || 12)
  })
});

