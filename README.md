# Datavapte Migration Studio

SAP BTP CAP application that uploads an SAP S/4HANA **Data Migration Cockpit** Excel template (`.xlsx` or SpreadsheetML `.xml`) and turns every workbook tab into a matching SAP UI5 screen.

## What it does

1. Upload a Migration Cockpit template (or a generic multi-sheet Excel file).
2. The CAP service reads **all tabs** and the field metadata SAP hides in rows 4–8:
   - structure name
   - technical field name
   - data type / length
   - description, mandatory `*`, and key `(k)`
3. The UI5 app opens the file as a workbook:
   - IconTabBar for every Excel tab
   - Introduction as an editable text page
   - Field List and data sheets as editable tables (add / delete / save rows)
   - mandatory sheets marked on the tab

## Project layout

| Path | Role |
| --- | --- |
| `db/schema.cds` | Templates, sheets, fields, data rows |
| `srv/migration-service.cds` | OData V4 service + `uploadTemplate` action |
| `srv/lib/excel-parser.js` | Migration Cockpit + generic Excel parser |
| `srv/lib/spreadsheetml.js` | Excel XML Spreadsheet 2003 reader |
| `app/migration-studio/webapp` | SAP UI5 freestyle app |
| `test/` | Parser and service tests |
| `mta.yaml` | Cloud Foundry / BTP deploy descriptor |

## Local run

```bash
npm install
npm run sample
npm test
npm start
```

Open [http://localhost:4004](http://localhost:4004).

- **Upload and open as UI5** — choose a cockpit `.xlsx` or `.xml` file
- **Open sample Bank template** — loads `Source data for Bank` (Introduction, Field List, Bank Master, Bank Address)

The OData service is at `/odata/v4/migration/`.

### Upload from the command line

```bash
node -e "const fs=require('fs'); const b=fs.readFileSync('test/fixtures/Source_data_for_Bank.xml').toString('base64'); fs.writeFileSync('/tmp/body.json', JSON.stringify({fileName:'Source_data_for_Bank.xml',mediaType:'application/xml',content:b}))"
curl -s -X POST http://localhost:4004/odata/v4/migration/uploadTemplate \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/body.json
```

## SAP template layout that is recognized

Data sheets follow the Migration Cockpit XML template:

| Row | Content |
| --- | --- |
| 4 | Technical structure name (hidden in Excel) |
| 5 | Technical field name, `(k)` = key |
| 6 | Data type and length |
| 7 | Group name |
| 8 | Field description, `*` = mandatory |
| 9+ | Business data |

The **Field List** tab is used to enrich type, length, mandatory, and key flags when present. Generic workbooks (first row = headers) are also supported.

## Deploy to SAP BTP

1. Install the Cloud MTA Build Tool and Cloud Foundry CLI.
2. Add HANA and XSUAA if you have not already: `npx cds add hana,xsuaa,mta`.
3. Build and deploy:

```bash
npx cds build --production
mbt build
cf deploy mta_archives/datavapte-migration-studio_1.0.0.mtar
```

Local development uses in-memory SQLite and dummy auth. Production profile in `package.json` switches to HANA and XSUAA. To persist uploads across local restarts, change `cds.requires.db.credentials.url` to `db.sqlite` and run `npx cds deploy --to sqlite:db.sqlite`.

## Notes

- Maximum upload size is 25 MB.
- Original file bytes are stored on the `Templates.content` media property.
- UI5 is loaded from `https://ui5.sap.com` so the app runs without a local UI5 tooling install.
