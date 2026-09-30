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
    assert.match(mta, /memory: 512M/);
    const routerXsApp = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/router/xs-app.json'), 'utf8'));
    assert.equal(routerXsApp.welcomeFile, '/index.html');
    assert.equal(routerXsApp.authenticationMethod, 'none');
    assert.equal(routerXsApp.routes.some((route) => route.localDir === 'resources'), true);
    assert.equal(routerXsApp.routes.some((route) => route.service === 'html5-apps-repo-rt'), false);
    assert.match(mta, /cp -R app\/migration-studio\/webapp\/\. gen\/srv\/webapp\//);
  });

  it('packages the UI5 webapp into the standalone approuter', () => {
    const { execFileSync } = require('child_process');
    const routerDir = path.join(ROOT, 'app/router');
    execFileSync(process.execPath, [path.join(routerDir, 'build.js')], { cwd: routerDir, stdio: 'pipe' });
    assert.equal(fs.existsSync(path.join(routerDir, 'resources', 'index.html')), true);
    assert.equal(
      fs.existsSync(path.join(routerDir, 'resources', 'AppRouterDatavapte.datavaptemigrationstudio-1.0.0', 'index.html')),
      true
    );
  });

  it('calls CAP directly from Launchpad instead of a Work Zone destination', () => {
    const service = fs.readFileSync(
      path.join(ROOT, 'app/migration-studio/webapp/model/Service.js'),
      'utf8'
    );
    assert.match(service, /the-innovapte-company-dev-space-datavapte-migration-srv/);
    assert.match(service, /isLaunchpad/);
    const server = fs.readFileSync(path.join(ROOT, 'srv/server.js'), 'utf8');
    assert.match(server, /Access-Control-Allow-Origin/);
  });

  it('raises the CAP JSON body limit for Excel uploads', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.cds.server.body_parser.limit, '25mb');
  });

  it('uses app-relative OData URLs in the UI5 manifest', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'app/migration-studio/webapp/manifest.json'), 'utf8')
    );
    assert.equal(manifest['sap.app'].dataSources.mainService.uri, 'odata/v4/migration/');
    assert.equal(manifest['sap.cloud'].service, 'AppRouterDatavapte');
  });

  it('offers stored blank templates next to local file upload', () => {
    const home = fs.readFileSync(
      path.join(ROOT, 'app/migration-studio/webapp/view/Home.view.xml'),
      'utf8'
    );
    assert.match(home, /id="fileUploader"/);
    assert.match(home, /id="blankTemplateSelect"/);
    const catalog = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, 'app/migration-studio/webapp/sample/blank-templates.json'),
        'utf8'
      )
    );
    assert.equal(catalog[0].fileName, 'Product.xml');
    assert.equal(catalog[0].title, 'Product');
    assert.ok(catalog.some((item) => item.title === 'Warehouse' && item.dummy));
    assert.ok(catalog.some((item) => item.title === 'GL Account' && item.dummy));
    assert.equal(
      fs.existsSync(path.join(ROOT, 'app/migration-studio/webapp/sample', catalog[0].fileName)),
      true
    );
    const i18n = fs.readFileSync(path.join(ROOT, 'app/migration-studio/webapp/i18n/i18n.properties'), 'utf8');
    assert.match(i18n, /uploadAndOpen=Upload$/m);
    const homeCtrl = fs.readFileSync(
      path.join(ROOT, 'app/migration-studio/webapp/controller/Home.controller.js'),
      'utf8'
    );
    assert.match(homeCtrl, /blank\.dummy/);
  });

  it('uses a compact table header and lets users change row height', () => {
    const viewer = fs.readFileSync(
      path.join(ROOT, 'app/migration-studio/webapp/view/Viewer.view.xml'),
      'utf8'
    );
    const controller = fs.readFileSync(
      path.join(ROOT, 'app/migration-studio/webapp/controller/Viewer.controller.js'),
      'utf8'
    );
    const component = fs.readFileSync(
      path.join(ROOT, 'app/migration-studio/webapp/Component.js'),
      'utf8'
    );
    assert.match(viewer, /columnHeaderHeight="\{app>\/table\/headerHeight\}"/);
    assert.match(viewer, /rowHeight="\{app>\/table\/rowHeight\}"/);
    assert.match(viewer, /id="headerHeightDown"/);
    assert.match(viewer, /id="rowHeightUp"/);
    assert.match(controller, /wrapping: false/);
    assert.match(controller, /_nudgeTableSize/);
    assert.match(component, /headerHeight: 44/);
    assert.match(component, /rowHeight: 28/);
  });

  it('lets users delete uploaded templates from the home list', () => {
    const home = fs.readFileSync(
      path.join(ROOT, 'app/migration-studio/webapp/view/Home.view.xml'),
      'utf8'
    );
    const controller = fs.readFileSync(
      path.join(ROOT, 'app/migration-studio/webapp/controller/Home.controller.js'),
      'utf8'
    );
    const service = fs.readFileSync(
      path.join(ROOT, 'app/migration-studio/webapp/model/Service.js'),
      'utf8'
    );
    assert.match(home, /press="\.onDeleteTemplate"/);
    assert.match(controller, /onDeleteTemplate/);
    assert.match(controller, /MessageBox\.Action\.DELETE/);
    assert.match(service, /method: "DELETE"/);
  });

  it('shows PV tab values as dropdowns when Excel row 3 has a table-field', () => {
    const schema = fs.readFileSync(path.join(ROOT, 'db/schema.cds'), 'utf8');
    const parser = fs.readFileSync(path.join(ROOT, 'srv/lib/excel-parser.js'), 'utf8');
    const controller = fs.readFileSync(
      path.join(ROOT, 'app/migration-studio/webapp/controller/Viewer.controller.js'),
      'utf8'
    );
    const component = fs.readFileSync(
      path.join(ROOT, 'app/migration-studio/webapp/Component.js'),
      'utf8'
    );
    assert.match(schema, /valueHelps\s+:\s+LargeString/);
    assert.match(schema, /valueHelpKey\s+:\s+String\(128\)/);
    assert.match(parser, /VALUE_HELP_RE/);
    assert.match(parser, /indexPossibleValues/);
    assert.match(parser, /checkTableRow/);
    assert.match(controller, /sap\/m\/ComboBox/);
    assert.match(controller, /isA\("sap\.m\.ComboBox"\)/);
    assert.match(controller, /source\.setValue\(""\)/);
    assert.match(controller, /showSecondaryValues: true/);
    assert.match(controller, /isFreeTextProductField/);
    assert.match(controller, /\^PRODUCT\$/);
    assert.match(controller, /\^MTART\$/);
    assert.match(controller, /resolveValueHelpCatalog/);
    assert.match(controller, /lookupValueHelp/);
    assert.match(controller, /sheetType === "ValueHelp"/);
    assert.match(parser, /isFreeTextProductField/);
    assert.match(component, /setSizeLimit\(20000\)/);
  });
});
