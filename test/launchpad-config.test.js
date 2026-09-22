'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('Launchpad / destination wiring', () => {
  it('does not put unresolved srv-api placeholders into destination init_data', () => {
    const mta = fs.readFileSync(path.join(ROOT, 'mta.yaml'), 'utf8');
    const initData = mta.split('init_data:')[1] || '';
    const beforeResourcesEnd = initData.split('service: destination')[0];
    assert.equal(beforeResourcesEnd.includes('~{srv-api/srv-url}'), false);
  });

  it('creates the CAP destination without OAuth2 user token exchange', () => {
    const mta = fs.readFileSync(path.join(ROOT, 'mta.yaml'), 'utf8');
    assert.match(mta, /Name: datavapte-migration-srv-api/);
    assert.match(mta, /Authentication: NoAuthentication/);
    assert.doesNotMatch(mta, /TokenServiceInstanceName: datavapte-migration-uaa$/m);
  });

  it('includes a standalone approuter module', () => {
    const mta = fs.readFileSync(path.join(ROOT, 'mta.yaml'), 'utf8');
    assert.match(mta, /type: approuter\.nodejs/);
    assert.match(mta, /path: app\/router/);
    const routerXsApp = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/router/xs-app.json'), 'utf8'));
    assert.match(routerXsApp.welcomeFile, /AppRouterDatavapte\.datavaptemigrationstudio/);
  });

  it('uses app-relative OData URLs in the UI5 manifest', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'app/migration-studio/webapp/manifest.json'), 'utf8')
    );
    assert.equal(manifest['sap.app'].dataSources.mainService.uri, 'odata/v4/migration/');
    assert.equal(manifest['sap.cloud'].service, 'AppRouterDatavapte');
  });
});
