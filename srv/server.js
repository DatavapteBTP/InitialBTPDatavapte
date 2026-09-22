'use strict';

const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');
const express = require('express');

function resolveWebapp() {
  const candidates = [
    path.join(__dirname, 'webapp'),
    path.join(__dirname, '..', 'app', 'migration-studio', 'webapp')
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')));
}

cds.on('bootstrap', (app) => {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && /hana\.ondemand\.com$/i.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  const webappDir = resolveWebapp();
  if (webappDir) {
    app.use('/migration-studio/webapp', express.static(webappDir));
    app.use('/sample', express.static(path.join(webappDir, 'sample')));
    app.use(express.static(webappDir));
  }

  app.get('/', (req, res) => {
    res.redirect('/index.html');
  });
});

module.exports = cds.server;
