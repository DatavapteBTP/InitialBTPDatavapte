'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

describe('Launchpad / destination wiring', () => {
  it('keeps GACD destination-content entries service-based', () => {
    const mta = fs.readFileSync(path.join(ROOT, 'mta.yaml'), 'utf8');
    const content = mta.split('datavapte-migration-destination-content')[1] || '';
    const destBlock = content.split('datavapte-migration-app-content')[0];
    assert.equal(destBlock.includes('Name: datavapte-migration-srv-api'), false);
    assert.match(destBlock, /ServiceInstanceName: datavapte-migration-html5-app-host-service/);
    assert.match(destBlock, /ServiceInstanceName: datavapte-migration-xsuaa-service/);
  });

  it('creates the CAP destination in destination-service init_data', () => {
    const mta = fs.readFileSync(path.join(ROOT, 'mta.yaml'), 'utf8');
    const initData = mta.split('init_data:')[1] || '';
    const destService = initData.split('service: destination')[0];
    assert.match(destService, /Name: datavapte-migration-srv-api/);
    assert.match(destService, /Authentication: NoAuthentication/);
    assert.match(destService, /URL: ~\{srv-api\/srv-url\}/);
    assert.match(
      mta,
      /- name: datavapte-migration-destination-service\n  type: org\.cloudfoundry\.managed-service\n  requires:\n  - name: srv-api/
    );
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
