'use strict';

const cds = require('@sap/cds');
const path = require('path');
const express = require('express');

cds.on('bootstrap', (app) => {
  const webappDir = path.join(__dirname, '..', 'app', 'migration-studio', 'webapp');
  app.use('/migration-studio/webapp', express.static(webappDir));
  app.use('/sample', express.static(path.join(webappDir, 'sample')));

  app.get('/', (req, res) => {
    res.redirect('/migration-studio/webapp/index.html');
  });
});

module.exports = cds.server;
