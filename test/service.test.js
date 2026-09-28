'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cds = require('@sap/cds');

const test = cds.test(path.join(__dirname, '..'));
const FIXTURE_XML = path.join(__dirname, 'fixtures', 'Source_data_for_Bank.xml');

describe('MigrationService upload', () => {
  it('uploads a cockpit XML template and expands every tab', async () => {
    const { url } = await test;
    const content = fs.readFileSync(FIXTURE_XML).toString('base64');
    const response = await fetch(url + '/odata/v4/migration/uploadTemplate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Source_data_for_Bank.xml',
        mediaType: 'application/xml',
        content
      })
    });
    const data = await response.json();
    assert.equal(response.status, 200, data.error?.message || JSON.stringify(data));
    assert.ok(data.ID);
    assert.equal(data.sheetCount, 4);
    assert.equal(data.status, 'Parsed');

    const read = await fetch(
      `${url}/odata/v4/migration/Templates(${data.ID})?$expand=sheets($expand=fields,rows)`
    );
    const template = await read.json();
    assert.equal(read.status, 200);
    assert.equal(template.sheets.length, 4);
    const master = template.sheets.find((s) => s.name === 'Bank Master');
    assert.ok(master);
    assert.ok(master.fields.length >= 8);
    assert.ok(master.rows.length >= 3);
  });

  it('saves edited sheet rows', async () => {
    const { url } = await test;
    const content = fs.readFileSync(FIXTURE_XML).toString('base64');
    const uploaded = await fetch(url + '/odata/v4/migration/uploadTemplate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Source_data_for_Bank.xml',
        mediaType: 'application/xml',
        content
      })
    }).then((res) => res.json());

    const read = await fetch(
      `${url}/odata/v4/migration/Templates(${uploaded.ID})?$expand=sheets($expand=rows)`
    ).then((res) => res.json());
    const master = read.sheets.find((s) => s.name === 'Bank Master');
    assert.ok(master);

    const save = await fetch(url + '/odata/v4/migration/saveSheetData', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetId: master.ID,
        introText: '',
        rows: JSON.stringify([
          { rowIndex: 1, values: ['FR', '30004', 'Edited Bank', '', '', 'Paris', '', ''] }
        ])
      })
    });
    const saved = await save.json();
    assert.equal(save.status, 200, saved.error?.message || JSON.stringify(saved));
    assert.equal(saved.value, 1);

    const after = await fetch(
      `${url}/odata/v4/migration/Sheets(${master.ID})?$expand=rows`
    ).then((res) => res.json());
    assert.equal(after.rows.length, 1);
    assert.match(after.rows[0].values, /Edited Bank/);
  });

  it('downloads updated data as SpreadsheetML XML', async () => {
    const { url } = await test;
    const content = fs.readFileSync(FIXTURE_XML).toString('base64');
    const uploaded = await fetch(url + '/odata/v4/migration/uploadTemplate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Source_data_for_Bank.xml',
        mediaType: 'application/xml',
        content
      })
    }).then((res) => res.json());

    const read = await fetch(
      `${url}/odata/v4/migration/Templates(${uploaded.ID})?$expand=sheets($expand=rows)`
    ).then((res) => res.json());
    const master = read.sheets.find((s) => s.name === 'Bank Master');
    await fetch(url + '/odata/v4/migration/saveSheetData', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetId: master.ID,
        introText: '',
        rows: JSON.stringify([
          { rowIndex: 9, values: ['FR', '30004', 'Edited Bank', '', '', 'Paris', '', ''] }
        ])
      })
    });

    const download = await fetch(url + '/odata/v4/migration/downloadTemplateXml', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: uploaded.ID })
    });
    const body = await download.json();
    assert.equal(download.status, 200, body.error?.message || JSON.stringify(body));
    assert.equal(body.fileName, 'Source_data_for_Bank.xml');
    assert.match(body.content, /Edited Bank/);
    assert.match(body.content, /S_BNKA/);
    assert.match(body.content, /<Worksheet ss:Name="Bank Master">[\s\S]*Edited Bank[\s\S]*<\/Worksheet>/);
  });

  it('accepts uploads larger than the default 100kb JSON body limit', async () => {
    const { url } = await test;
    const xml = fs.readFileSync(FIXTURE_XML, 'utf8');
    const padded = xml.replace('</Workbook>', `<!-- ${'x'.repeat(120000)} --></Workbook>`);
    const content = Buffer.from(padded).toString('base64');
    const body = JSON.stringify({
      fileName: 'Source_data_for_Bank.xml',
      mediaType: 'application/xml',
      content
    });
    assert.ok(body.length > 100 * 1024);
    const response = await fetch(url + '/odata/v4/migration/uploadTemplate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    const data = await response.json();
    assert.equal(response.status, 200, data.error?.message || JSON.stringify(data));
    assert.ok(data.ID);
    assert.equal(data.sheetCount, 4);
  });

  it('serves stored blank templates for the dropdown', async () => {
    const { url } = await test;
    const catalogRes = await fetch(url + '/sample/blank-templates.json');
    const catalog = await catalogRes.json();
    assert.equal(catalogRes.status, 200, JSON.stringify(catalog));
    const product = catalog.find((item) => item.id === 'custom-f4-009');
    assert.ok(product);
    assert.equal(product.fileName, 'CUSTOM_F4_009 1.xml');
    const xmlRes = await fetch(url + '/sample/' + encodeURIComponent(product.fileName));
    const xml = await xmlRes.text();
    assert.equal(xmlRes.status, 200, xml.slice(0, 200));
    assert.match(xml, /ss:Name="Basic Data"/);
    assert.match(xml, /Excel\.Sheet/);
  });

  it('uploads a large Product Migration Cockpit XML without 500', async () => {
    const custom = path.join(
      __dirname,
      '..',
      'app',
      'migration-studio',
      'webapp',
      'sample',
      'CUSTOM_F4_009 1.xml'
    );
    if (!fs.existsSync(custom)) return;
    const { url } = await test;
    const content = fs.readFileSync(custom).toString('base64');
    const response = await fetch(url + '/odata/v4/migration/uploadTemplate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'CUSTOM_F4_009 1.xml',
        mediaType: 'application/xml',
        content
      })
    });
    const data = await response.json();
    assert.equal(response.status, 200, data.error?.message || JSON.stringify(data));
    assert.equal(data.sheetCount, 29);
    assert.ok(data.fieldCount >= 600);
  });

  it('serves the UI5 app from the CAP host', async () => {
    const { url } = await test;
    const home = await fetch(url + '/index.html');
    const html = await home.text();
    assert.equal(home.status, 200, html);
    assert.match(html, /Datavapte Migration Studio/);
    assert.match(html, /ui5\.sap\.com/);
  });

  it('rejects unsupported file types', async () => {
    const { url } = await test;
    const response = await fetch(url + '/odata/v4/migration/uploadTemplate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'notes.txt',
        mediaType: 'text/plain',
        content: Buffer.from('hello').toString('base64')
      })
    });
    assert.ok(response.status >= 400);
  });

  it('deletes an uploaded template and its sheets', async () => {
    const { url } = await test;
    const content = fs.readFileSync(FIXTURE_XML).toString('base64');
    const uploaded = await fetch(url + '/odata/v4/migration/uploadTemplate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'Source_data_for_Bank.xml',
        mediaType: 'application/xml',
        content
      })
    }).then((res) => res.json());
    assert.ok(uploaded.ID);

    const del = await fetch(`${url}/odata/v4/migration/Templates(${uploaded.ID})`, {
      method: 'DELETE'
    });
    assert.ok(del.status === 204 || del.ok, await del.text());

    const gone = await fetch(`${url}/odata/v4/migration/Templates(${uploaded.ID})`);
    assert.equal(gone.status, 404);

    const remaining = await fetch(
      `${url}/odata/v4/migration/Sheets?$filter=template_ID eq ${uploaded.ID}`
    ).then((res) => res.json());
    assert.equal((remaining.value || []).length, 0);
  });
});
