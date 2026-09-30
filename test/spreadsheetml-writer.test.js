'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseMigrationExcel } = require('../srv/lib/excel-parser');
const { exportTemplateXml, xmlFileName } = require('../srv/lib/spreadsheetml-writer');

const FIXTURE_XML = path.join(__dirname, 'fixtures', 'Source_data_for_Bank.xml');

describe('SpreadsheetML export', () => {
  it('writes xml file names', () => {
    assert.equal(xmlFileName('CUSTOM_F4_009 1.xml'), 'CUSTOM_F4_009 1.xml');
    assert.equal(xmlFileName('banks.xlsx'), 'banks.xml');
  });

  it('keeps cockpit metadata rows and writes edited data into XML', () => {
    const original = fs.readFileSync(FIXTURE_XML);
    const parsed = parseMigrationExcel(original, 'Source_data_for_Bank.xml');
    const master = parsed.sheets.find((sheet) => sheet.name === 'Bank Master');
    master.rows = [
      { rowIndex: 9, values: JSON.stringify(['FR', '30004', 'Edited Bank', '', '', 'Paris', '', '']) }
    ];
    const xml = exportTemplateXml({ fileName: 'Source_data_for_Bank.xml', content: original }, parsed.sheets);
    assert.match(xml, /ss:Name="Bank Master"/);
    assert.match(xml, /S_BNKA/);
    assert.match(xml, /BANKS \(k\)/);
    assert.match(xml, /Edited Bank/);
    assert.match(xml, /<Worksheet ss:Name="Bank Master">[\s\S]*Edited Bank[\s\S]*<\/Worksheet>/);
    const roundTrip = parseMigrationExcel(Buffer.from(xml), 'Source_data_for_Bank.xml');
    const exported = roundTrip.sheets.find((sheet) => sheet.name === 'Bank Master');
    assert.equal(exported.dataRowCount, 1);
    assert.equal(JSON.parse(exported.rows[0].values)[2], 'Edited Bank');
  });
});
