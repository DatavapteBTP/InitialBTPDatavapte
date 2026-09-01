'use strict';

const cds = require('@sap/cds');
const { parseMigrationExcel, gridFromSheet } = require('./lib/excel-parser');

module.exports = class MigrationService extends cds.ApplicationService {
  async init() {
    const { Templates, Sheets, DataRows } = this.entities;

    this.on('uploadTemplate', async (req) => {
      const fileName = String(req.data.fileName || 'template.xlsx').trim();
      const mediaType = req.data.mediaType || guessMediaType(fileName);
      const content = req.data.content;
      if (!content) req.reject(400, 'Upload content is empty.');
      if (!isSupportedFile(fileName, mediaType)) {
        req.reject(400, 'Upload an SAP Data Migration Excel template (.xlsx, .xlsm, .xml).');
      }

      let buffer;
      try {
        buffer = Buffer.from(content, 'base64');
      } catch {
        req.reject(400, 'File content is not valid base64.');
      }
      if (!buffer.length) req.reject(400, 'Upload content is empty.');
      if (buffer.length > 25 * 1024 * 1024) {
        req.reject(400, 'File exceeds the 25 MB upload limit.');
      }

      let parsed;
      try {
        parsed = parseMigrationExcel(buffer, fileName);
      } catch (error) {
        req.reject(error.status || 400, error.message);
      }

      const id = cds.utils.uuid();
      await INSERT.into(Templates).entries({
        ID: id,
        fileName,
        mediaType,
        fileSize: buffer.length,
        objectName: parsed.objectName,
        status: parsed.status,
        sheetCount: parsed.sheetCount,
        fieldCount: parsed.fieldCount,
        rowCount: parsed.rowCount,
        parseMessage: parsed.parseMessage,
        content: buffer,
        sheets: parsed.sheets
      });

      return SELECT.one
        .from(Templates, (t) => {
          t.ID;
          t.fileName;
          t.mediaType;
          t.fileSize;
          t.objectName;
          t.status;
          t.sheetCount;
          t.fieldCount;
          t.rowCount;
          t.parseMessage;
          t.createdAt;
          t.sheets((s) => {
            s`.*`;
            s.fields((f) => f`.*`);
            s.rows((r) => r`.*`);
          });
        })
        .where({ ID: id });
    });

    this.on('saveSheetData', async (req) => {
      const sheetId = req.data.sheetId;
      if (!sheetId) req.reject(400, 'sheetId is required.');

      let rows;
      try {
        rows = JSON.parse(req.data.rows || '[]');
      } catch {
        req.reject(400, 'rows must be a JSON array.');
      }
      if (!Array.isArray(rows)) req.reject(400, 'rows must be a JSON array.');

      const sheet = await SELECT.one.from(Sheets).where({ ID: sheetId });
      if (!sheet) req.reject(404, 'Sheet not found.');

      await DELETE.from(DataRows).where({ sheet_ID: sheetId });

      const entries = rows.map((row, index) => ({
        ID: isUuid(row.ID) ? row.ID : cds.utils.uuid(),
        sheet_ID: sheetId,
        rowIndex: Number(row.rowIndex) || index + 1,
        values: Array.isArray(row.values) ? JSON.stringify(row.values) : String(row.values || '[]')
      }));
      if (entries.length) {
        await INSERT.into(DataRows).entries(entries);
      }

      const patch = { dataRowCount: entries.length };
      if (req.data.introText != null) patch.introText = req.data.introText;
      await UPDATE(Sheets, sheetId).with(patch);

      const siblings = await SELECT.from(Sheets)
        .columns('dataRowCount')
        .where({ template_ID: sheet.template_ID });
      const rowCount = siblings.reduce((sum, item) => sum + (item.dataRowCount || 0), 0);
      await UPDATE(Templates, sheet.template_ID).with({ rowCount });

      return entries.length;
    });

    this.on('sheetGrid', async (req) => {
      const sheetId = req.data.sheetId;
      const sheet = await SELECT.one
        .from(Sheets, (s) => {
          s`.*`;
          s.fields((f) => f`.*`);
          s.rows((r) => r`.*`);
        })
        .where({ ID: sheetId });
      if (!sheet) req.reject(404, 'Sheet not found.');
      return JSON.stringify(gridFromSheet(sheet));
    });

    this.after('READ', Templates, (each) => {
      if (!each) return;
      if (Array.isArray(each)) {
        for (const item of each) hideBinary(item);
      } else {
        hideBinary(each);
      }
    });

    await super.init();
  }
};

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

function hideBinary(item) {
  if (item && Object.prototype.hasOwnProperty.call(item, 'content')) {
    delete item.content;
  }
}

function isSupportedFile(fileName, mediaType) {
  const name = String(fileName || '').toLowerCase();
  const type = String(mediaType || '').toLowerCase();
  return (
    name.endsWith('.xlsx') ||
    name.endsWith('.xlsm') ||
    name.endsWith('.xls') ||
    name.endsWith('.xml') ||
    type.includes('spreadsheet') ||
    type.includes('excel') ||
    type === 'text/xml' ||
    type === 'application/xml'
  );
}

function guessMediaType(fileName) {
  const name = String(fileName || '').toLowerCase();
  if (name.endsWith('.xml')) return 'application/xml';
  if (name.endsWith('.xlsm')) return 'application/vnd.ms-excel.sheet.macroEnabled.12';
  if (name.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}
