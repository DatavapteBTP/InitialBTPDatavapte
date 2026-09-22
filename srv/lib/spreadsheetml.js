'use strict';

const { XMLParser } = require('fast-xml-parser');

/**
 * Parse Microsoft Excel XML Spreadsheet 2003 (SpreadsheetML),
 * the format downloaded from the SAP S/4HANA Migration Cockpit.
 */
function parseSpreadsheetML(buffer) {
  const xml = buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (!xml.includes('Workbook')) {
    throw new Error('File is not a SpreadsheetML workbook.');
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true,
    parseTagValue: false,
    isArray: (name) =>
      ['Worksheet', 'Row', 'Cell', 'Data', 'Table'].includes(name)
  });

  const parsed = parser.parse(xml);
  const workbook = parsed.Workbook;
  if (!workbook) {
    throw new Error('SpreadsheetML Workbook element not found.');
  }

  const worksheets = asArray(workbook.Worksheet);
  const sheetNames = [];
  const sheets = {};

  for (const worksheet of worksheets) {
    const name = worksheet['@_Name'] || worksheet['@_ss:Name'] || 'Sheet';
    sheetNames.push(name);
    const table = asArray(worksheet.Table)[0] || {};
    sheets[name] = tableToMatrix(asArray(table.Row));
  }

  return { sheetNames, sheets };
}

function tableToMatrix(rows) {
  const matrix = [];
  let nextRowIndex = 1;

  for (const row of rows) {
    const rowIndex = Number(row['@_Index'] || row['@_ss:Index'] || nextRowIndex);
    while (matrix.length < rowIndex - 1) matrix.push([]);
    matrix[rowIndex - 1] = cellsToArray(asArray(row.Cell));
    nextRowIndex = rowIndex + 1;
  }

  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  return matrix.map((row) => {
    const copy = row.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
}

function cellsToArray(cells) {
  const values = [];
  let nextCol = 1;

  for (const cell of cells) {
    const colIndex = Number(cell['@_Index'] || cell['@_ss:Index'] || nextCol);
    while (values.length < colIndex - 1) values.push('');
    values[colIndex - 1] = extractCellText(cell);
    const mergeAcross = Number(cell['@_MergeAcross'] || cell['@_ss:MergeAcross'] || 0);
    nextCol = colIndex + 1 + mergeAcross;
    for (let i = 0; i < mergeAcross; i++) values.push('');
  }

  return values;
}

function extractCellText(cell) {
  if (cell == null) return '';
  if (typeof cell === 'string' || typeof cell === 'number') return String(cell);

  const dataNodes = asArray(cell.Data);
  if (dataNodes.length) {
    return dataNodes
      .map((node) => {
        if (node == null) return '';
        if (typeof node === 'string' || typeof node === 'number') return String(node);
        if (node['#text'] != null) return String(node['#text']);
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }

  if (cell['#text'] != null) return String(cell['#text']);
  return '';
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

module.exports = { parseSpreadsheetML };
