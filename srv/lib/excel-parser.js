'use strict';

const XLSX = require('xlsx');
const { parseSpreadsheetML } = require('./spreadsheetml');

const INTRO_RE = /intro|instruction/i;
const FIELD_LIST_RE = /field\s*list|^fields$/i;
const MANDATORY_MARK_RE = /\*/;
const KEY_MARK_RE = /\bk\b|\(k\)/i;

/**
 * Parse an SAP Data Migration Cockpit template (xlsx, xlsm, SpreadsheetML 2003 XML)
 * or a generic multi-sheet workbook into a CAP-ready composition tree.
 */
function parseMigrationExcel(buffer, fileName = 'template.xlsx') {
  const workbook = readWorkbook(buffer, fileName);
  const sheetNames = workbook.sheetNames || [];
  if (!sheetNames.length) {
    throw Object.assign(new Error('The uploaded file has no worksheets.'), { status: 400 });
  }

  const rawSheets = sheetNames.map((name) => ({
    name,
    rows: workbook.sheets[name] || []
  }));

  const fieldListSheet = rawSheets.find((s) => FIELD_LIST_RE.test(s.name));
  const fieldCatalog = fieldListSheet ? indexFieldList(fieldListSheet.rows) : new Map();

  const sheets = rawSheets.map((raw, sequence) => buildSheet(raw, sequence, fieldCatalog));
  const objectName = inferObjectName(fileName, sheets);
  const fieldCount = sheets.reduce((n, s) => n + s.fields.length, 0);
  const rowCount = sheets.reduce((n, s) => n + s.rows.length, 0);

  return {
    fileName,
    objectName,
    status: 'Parsed',
    sheetCount: sheets.length,
    fieldCount,
    rowCount,
    parseMessage: `Read ${sheets.length} tab${sheets.length === 1 ? '' : 's'}, ${fieldCount} fields, ${rowCount} data rows.`,
    sheets
  };
}

function readWorkbook(buffer, fileName) {
  const looksXml =
    /\.xml$/i.test(fileName) ||
    buffer.slice(0, 200).toString('utf8').includes('urn:schemas-microsoft-com:office:spreadsheet') ||
    buffer.slice(0, 200).toString('utf8').includes('Excel.Sheet');

  if (looksXml) {
    try {
      return parseSpreadsheetML(buffer);
    } catch (xmlError) {
      try {
        return workbookFromSheetJS(buffer);
      } catch {
        throw Object.assign(
          new Error(`Could not read SpreadsheetML template: ${xmlError.message}`),
          { status: 400 }
        );
      }
    }
  }

  try {
    return workbookFromSheetJS(buffer);
  } catch (error) {
    if (buffer.slice(0, 200).toString('utf8').includes('<Workbook')) {
      return parseSpreadsheetML(buffer);
    }
    throw Object.assign(new Error(`Could not read Excel file: ${error.message}`), { status: 400 });
  }
}

function workbookFromSheetJS(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  const sheets = {};
  for (const name of wb.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      defval: '',
      raw: false,
      blankrows: true
    });
  }
  return { sheetNames: wb.SheetNames, sheets };
}

function buildSheet(raw, sequence, fieldCatalog) {
  const sheetType = detectSheetType(raw.name);
  const base = {
    name: raw.name,
    title: raw.name,
    sheetType,
    sequence,
    isMandatory: false,
    structureName: '',
    columnCount: 0,
    dataRowCount: 0,
    introText: '',
    fields: [],
    rows: []
  };

  if (sheetType === 'Introduction') {
    base.introText = rowsToIntroText(raw.rows);
    return base;
  }

  if (sheetType === 'FieldList') {
    return Object.assign(base, parseFieldListSheet(raw.rows));
  }

  return Object.assign(base, parseDataSheet(raw, fieldCatalog));
}

function detectSheetType(name) {
  if (INTRO_RE.test(name)) return 'Introduction';
  if (FIELD_LIST_RE.test(name)) return 'FieldList';
  return 'Data';
}

function parseDataSheet(raw, fieldCatalog) {
  const rows = raw.rows || [];
  const format = detectDataFormat(rows);

  if (format === 'migration') {
    return parseMigrationDataSheet(raw, rows, fieldCatalog);
  }
  return parseGenericDataSheet(raw, rows);
}

/**
 * SAP Migration Cockpit XML/Excel data sheets:
 *   row 4 (index 3) technical structure name
 *   row 5 (index 4) technical field names
 *   row 6 (index 5) data type / length
 *   row 8 (index 7) field descriptions (* = mandatory)
 *   row 9+          business data
 */
function parseMigrationDataSheet(raw, rows, fieldCatalog) {
  const structureRow = normalizeRow(rows[3]);
  const technicalRow = normalizeRow(rows[4]);
  const typeRow = normalizeRow(rows[5]);
  const groupRow = normalizeRow(rows[6]);
  const descriptionRow = normalizeRow(rows[7]);
  const columnCount = Math.max(
    descriptionRow.length,
    technicalRow.length,
    typeRow.length,
    groupRow.length
  );

  const structureName =
    firstNonEmpty(structureRow) ||
    firstNonEmpty(rows[0]) ||
    raw.name;

  const fields = [];
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    const description = String(descriptionRow[columnIndex] || '').trim();
    const technicalName = String(technicalRow[columnIndex] || '').trim();
    const typeInfo = parseTypeLength(typeRow[columnIndex]);
    const groupName = String(groupRow[columnIndex] || structureRow[columnIndex] || '').trim();
    if (!description && !technicalName) continue;

    const catalog = lookupCatalog(fieldCatalog, raw.name, technicalName, description);
    const mandatory =
      MANDATORY_MARK_RE.test(description) ||
      MANDATORY_MARK_RE.test(technicalName) ||
      Boolean(catalog?.mandatory);
    const isKey = KEY_MARK_RE.test(technicalName) || Boolean(catalog?.isKey);

    fields.push({
      columnIndex,
      technicalName: stripMarks(technicalName) || catalog?.technicalName || `COL_${columnIndex + 1}`,
      description: stripMarks(description) || catalog?.description || stripMarks(technicalName),
      dataType: typeInfo.dataType || catalog?.dataType || '',
      length: typeInfo.length || catalog?.length || '',
      decimals: typeInfo.decimals || catalog?.decimals || '',
      mandatory,
      isKey,
      groupName: groupName || catalog?.groupName || '',
      sapFieldName: catalog?.sapFieldName || stripMarks(technicalName)
    });
  }

  const dataRows = [];
  for (let r = 8; r < rows.length; r++) {
    const values = normalizeRow(rows[r], columnCount);
    if (values.every((v) => v === '')) continue;
    dataRows.push({
      rowIndex: r + 1,
      values: JSON.stringify(values)
    });
  }

  const isMandatory = /general|master|basic/i.test(raw.name);

  return {
    title: firstNonEmpty(rows[0]) || raw.name,
    isMandatory,
    structureName,
    columnCount: fields.length,
    dataRowCount: dataRows.length,
    fields,
    rows: dataRows
  };
}

function parseGenericDataSheet(raw, rows) {
  const headerIndex = rows.findIndex((row) => normalizeRow(row).some((c) => String(c).trim()));
  if (headerIndex < 0) {
    return { title: raw.name, fields: [], rows: [], columnCount: 0, dataRowCount: 0 };
  }

  const headers = normalizeRow(rows[headerIndex]);
  const fields = headers
    .map((header, columnIndex) => {
      const description = String(header || '').trim();
      if (!description) return null;
      return {
        columnIndex,
        technicalName: slugField(description, columnIndex),
        description: stripMarks(description),
        dataType: '',
        length: '',
        decimals: '',
        mandatory: MANDATORY_MARK_RE.test(description),
        isKey: KEY_MARK_RE.test(description),
        groupName: raw.name,
        sapFieldName: ''
      };
    })
    .filter(Boolean);

  const columnCount = headers.length;
  const dataRows = [];
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const values = normalizeRow(rows[r], columnCount);
    if (values.every((v) => v === '')) continue;
    dataRows.push({
      rowIndex: r + 1,
      values: JSON.stringify(values)
    });
  }

  return {
    title: raw.name,
    structureName: raw.name,
    columnCount: fields.length,
    dataRowCount: dataRows.length,
    fields,
    rows: dataRows
  };
}

function parseFieldListSheet(rows) {
  const headerIndex = rows.findIndex((row) => normalizeRow(row).some((c) => String(c).trim()));
  if (headerIndex < 0) {
    return { fields: [], rows: [], columnCount: 0, dataRowCount: 0, introText: '' };
  }

  const headers = normalizeRow(rows[headerIndex]).map((h) => String(h || '').trim());
  const fields = headers
    .map((description, columnIndex) => {
      if (!description) return null;
      return {
        columnIndex,
        technicalName: slugField(description, columnIndex),
        description,
        dataType: 'Text',
        length: '',
        decimals: '',
        mandatory: false,
        isKey: false,
        groupName: 'Field List',
        sapFieldName: ''
      };
    })
    .filter(Boolean);

  const dataRows = [];
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const values = normalizeRow(rows[r], headers.length);
    if (values.every((v) => v === '')) continue;
    dataRows.push({
      rowIndex: r + 1,
      values: JSON.stringify(values)
    });
  }

  return {
    title: 'Field List',
    structureName: 'FieldList',
    columnCount: fields.length,
    dataRowCount: dataRows.length,
    fields,
    rows: dataRows
  };
}

function indexFieldList(rows) {
  const catalog = new Map();
  const headerIndex = rows.findIndex((row) => normalizeRow(row).some((c) => String(c).trim()));
  if (headerIndex < 0) return catalog;

  const headers = normalizeRow(rows[headerIndex]).map((h) => String(h || '').trim().toLowerCase());
  const col = (aliases) => headers.findIndex((h) => aliases.some((a) => h.includes(a)));

  const sheetCol = col(['sheet']);
  const groupCol = col(['group']);
  const descCol = col(['description', 'field name', 'label']);
  const techCol = col(['technical', 'sap field', 'field']);
  const typeCol = col(['type', 'data type']);
  const lengthCol = col(['length']);
  const decCol = col(['decimal']);
  const mandCol = col(['mandatory', 'required']);
  const keyCol = col(['key']);

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const values = normalizeRow(rows[r]);
    const technicalName = stripMarks(values[techCol] || '');
    const description = stripMarks(values[descCol] || '');
    if (!technicalName && !description) continue;
    const entry = {
      sheetName: String(values[sheetCol] || '').trim(),
      groupName: String(values[groupCol] || '').trim(),
      description,
      technicalName,
      dataType: String(values[typeCol] || '').trim(),
      length: String(values[lengthCol] || '').trim(),
      decimals: String(values[decCol] || '').trim(),
      mandatory: isTruthyFlag(values[mandCol]),
      isKey: isTruthyFlag(values[keyCol]),
      sapFieldName: technicalName
    };
    if (technicalName) catalog.set(`${entry.sheetName}::${technicalName}`.toLowerCase(), entry);
    if (description) catalog.set(`${entry.sheetName}::${description}`.toLowerCase(), entry);
  }
  return catalog;
}

function lookupCatalog(catalog, sheetName, technicalName, description) {
  if (!catalog || !catalog.size) return null;
  const keys = [
    `${sheetName}::${stripMarks(technicalName)}`,
    `${sheetName}::${stripMarks(description)}`
  ];
  for (const key of keys) {
    const hit = catalog.get(key.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function detectDataFormat(rows) {
  if (!rows || rows.length < 8) return 'generic';
  const technicalRow = normalizeRow(rows[4]);
  const typeRow = normalizeRow(rows[5]);
  const descriptionRow = normalizeRow(rows[7]);
  const techHits = technicalRow.filter((c) => /^[A-Z][A-Z0-9_/]{1,30}$/.test(String(c).trim())).length;
  const typeHits = typeRow.filter((c) => /char|numc|dec|date|clnt|cuky|curr|tims|lang|text|number|integer/i.test(String(c))).length;
  const descHits = descriptionRow.filter((c) => String(c).trim()).length;
  if ((techHits >= 2 && descHits >= 2) || (typeHits >= 2 && descHits >= 2)) return 'migration';
  return 'generic';
}

function parseTypeLength(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return { dataType: '', length: '', decimals: '' };
  const match = text.match(/^([A-Za-z]+)\s*(\d+)?(?:\s*[.,/]\s*(\d+))?/);
  if (match) {
    return {
      dataType: match[1].toUpperCase(),
      length: match[2] || '',
      decimals: match[3] || ''
    };
  }
  const lengthOnly = text.match(/length[:\s]+(\d+)/i);
  const typeOnly = text.match(/type[:\s]+([A-Za-z]+)/i);
  const decOnly = text.match(/dec(?:imal)?s?[:\s]+(\d+)/i);
  return {
    dataType: typeOnly ? typeOnly[1].toUpperCase() : text,
    length: lengthOnly ? lengthOnly[1] : '',
    decimals: decOnly ? decOnly[1] : ''
  };
}

function rowsToIntroText(rows) {
  return (rows || [])
    .map((row) => normalizeRow(row).filter(Boolean).join('  '))
    .filter((line) => line.trim())
    .join('\n');
}

function normalizeRow(row, minLength = 0) {
  const values = Array.isArray(row) ? row.map((cell) => stringifyCell(cell)) : [];
  while (values.length < minLength) values.push('');
  return values;
}

function stringifyCell(cell) {
  if (cell == null) return '';
  if (cell instanceof Date) {
    const yyyy = cell.getFullYear();
    const mm = String(cell.getMonth() + 1).padStart(2, '0');
    const dd = String(cell.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(cell).trim();
}

function firstNonEmpty(row) {
  if (!row) return '';
  if (typeof row === 'string') return row.trim();
  const values = Array.isArray(row) ? row : [];
  return values.map((c) => String(c || '').trim()).find(Boolean) || '';
}

function stripMarks(value) {
  return String(value || '')
    .replace(/\s*\*\s*/g, ' ')
    .replace(/\s*\(k\)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugField(description, columnIndex) {
  const slug = String(description || '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  return slug || `COL_${columnIndex + 1}`;
}

function isTruthyFlag(value) {
  const text = String(value || '').trim();
  return /^(y|yes|true|1|x|\*|k|mandatory|key)$/i.test(text);
}

function inferObjectName(fileName, sheets) {
  const fromFile = String(fileName || '')
    .replace(/\.(xlsx|xlsm|xls|xml)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/^source data for\s+/i, '')
    .trim();
  if (fromFile && !/^template$/i.test(fromFile)) return fromFile;
  const dataSheet = sheets.find((s) => s.sheetType === 'Data');
  return dataSheet?.title || dataSheet?.name || 'Migration Template';
}

function gridFromSheet(sheet) {
  const fields = (sheet.fields || []).slice().sort((a, b) => a.columnIndex - b.columnIndex);
  const rows = (sheet.rows || [])
    .slice()
    .sort((a, b) => a.rowIndex - b.rowIndex)
    .map((row) => {
      let values = [];
      try {
        values = JSON.parse(row.values || '[]');
      } catch {
        values = [];
      }
      return {
        rowIndex: row.rowIndex,
        cells: fields.map((field) => ({
          columnIndex: field.columnIndex,
          value: values[field.columnIndex] ?? ''
        }))
      };
    });

  return {
    ID: sheet.ID,
    name: sheet.name,
    title: sheet.title,
    sheetType: sheet.sheetType,
    isMandatory: sheet.isMandatory,
    structureName: sheet.structureName,
    introText: sheet.introText || '',
    fields,
    rows
  };
}

module.exports = {
  parseMigrationExcel,
  detectSheetType,
  detectDataFormat,
  parseTypeLength,
  gridFromSheet,
  readWorkbook
};
