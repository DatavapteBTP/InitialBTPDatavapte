'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseMigrationExcel, parseTypeLength, detectSheetType } = require('../srv/lib/excel-parser');
const { parseSpreadsheetML } = require('../srv/lib/spreadsheetml');

const FIXTURE_XLSX = path.join(__dirname, 'fixtures', 'Source_data_for_Bank.xlsx');
const FIXTURE_XML = path.join(__dirname, 'fixtures', 'Source_data_for_Bank.xml');

describe('sheet type detection', () => {
  it('classifies introduction, field list, and data tabs', () => {
    assert.equal(detectSheetType('Introduction'), 'Introduction');
    assert.equal(detectSheetType('Field List'), 'FieldList');
    assert.equal(detectSheetType('Bank Master'), 'Data');
  });
});

describe('type / length parsing', () => {
  it('reads CHAR, NUMC and decimal definitions', () => {
    assert.deepEqual(parseTypeLength('CHAR 3'), { dataType: 'CHAR', length: '3', decimals: '' });
    assert.deepEqual(parseTypeLength('DEC 9,5'), { dataType: 'DEC', length: '9', decimals: '5' });
    assert.equal(parseTypeLength('LANG 1').dataType, 'LANG');
  });
});

describe('SpreadsheetML 2003 parser', () => {
  it('reads every worksheet from a Migration Cockpit XML file', () => {
    const workbook = parseSpreadsheetML(fs.readFileSync(FIXTURE_XML));
    assert.deepEqual(workbook.sheetNames, ['Introduction', 'Field List', 'Bank Master', 'Bank Address']);
    assert.equal(workbook.sheets['Bank Master'][7][0], 'Bank Country Key *');
    assert.equal(workbook.sheets['Bank Master'][8][0], 'DE');
  });
});

describe('migration template parser', () => {
  it('parses the XML cockpit template into UI-ready sheets', () => {
    const parsed = parseMigrationExcel(fs.readFileSync(FIXTURE_XML), 'Source_data_for_Bank.xml');
    assert.equal(parsed.sheetCount, 4);
    assert.equal(parsed.objectName, 'Bank');
    assert.equal(parsed.sheets[0].sheetType, 'Introduction');
    assert.match(parsed.sheets[0].introText, /Field List/);

    const fieldList = parsed.sheets[1];
    assert.equal(fieldList.sheetType, 'FieldList');
    assert.ok(fieldList.rows.length >= 8);

    const master = parsed.sheets[2];
    assert.equal(master.sheetType, 'Data');
    assert.equal(master.structureName, 'S_BNKA');
    assert.equal(master.fields.length, 8);
    assert.equal(master.fields[0].technicalName, 'BANKS');
    assert.equal(master.fields[0].description, 'Bank Country Key');
    assert.equal(master.fields[0].mandatory, true);
    assert.equal(master.fields[0].isKey, true);
    assert.equal(master.fields[0].dataType, 'CHAR');
    assert.equal(master.fields[0].length, '3');
    assert.equal(master.dataRowCount, 3);
    const firstRow = JSON.parse(master.rows[0].values);
    assert.equal(firstRow[2], 'City Bank');

    const address = parsed.sheets[3];
    assert.equal(address.fields.length, 4);
    assert.equal(address.dataRowCount, 2);
  });

  it('parses the xlsx cockpit template the same way', () => {
    const parsed = parseMigrationExcel(fs.readFileSync(FIXTURE_XLSX), 'Source_data_for_Bank.xlsx');
    assert.equal(parsed.sheetCount, 4);
    const master = parsed.sheets.find((s) => s.name === 'Bank Master');
    assert.equal(master.fields[1].technicalName, 'BANKL');
    assert.equal(master.fields[2].mandatory, true);
    assert.equal(JSON.parse(master.rows[1].values)[5], 'San Francisco');
  });

  it('falls back to first-row headers for generic workbooks', () => {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Customer *', 'City', 'Country'],
        ['1000', 'Walldorf', 'DE'],
        ['2000', 'Bangalore', 'IN']
      ]),
      'Customers'
    );
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const parsed = parseMigrationExcel(buffer, 'customers.xlsx');
    assert.equal(parsed.sheets[0].sheetType, 'Data');
    assert.equal(parsed.sheets[0].fields[0].mandatory, true);
    assert.equal(parsed.sheets[0].fields[0].description, 'Customer');
    assert.equal(parsed.sheets[0].dataRowCount, 2);
  });
});
