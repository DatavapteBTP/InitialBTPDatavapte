sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/IconTabFilter",
  "sap/m/Input",
  "sap/m/ComboBox",
  "sap/m/Label",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/ui/core/ListItem",
  "sap/ui/table/Column",
  "datavapte/migration/studio/model/Service"
], function (Controller, IconTabFilter, Input, ComboBox, Label, MessageBox, MessageToast, ListItem, Column, Service) {
  "use strict";

  return Controller.extend("datavapte.migration.studio.controller.Viewer", {
    onInit: function () {
      this.getOwnerComponent().getRouter()
        .getRoute("viewer")
        .attachPatternMatched(this.onRouteMatched, this);
    },

    onNavBack: function () {
      const that = this;
      this._persistIfDirty().then(function () {
        that.getOwnerComponent().getRouter().navTo("home");
      });
    },

    onRouteMatched: function (oEvent) {
      const templateId = oEvent.getParameter("arguments").templateId;
      this._loadTemplate(templateId);
    },

    onSheetSelect: function (oEvent) {
      const sheetId = oEvent.getParameter("key");
      if (!sheetId || sheetId === this._activeSheetId) return;
      const that = this;
      this._persistIfDirty().then(function () {
        that._showSheet(sheetId);
      });
    },

    onIntroChange: function () {
      this._setDirty(true);
    },

    onCellChange: function () {
      this._setDirty(true);
    },

    onAddRow: function () {
      const oApp = this.getOwnerComponent().getModel("app");
      const rows = (oApp.getProperty("/editor/rows") || []).slice();
      const fields = oApp.getProperty("/editor/fields") || [];
      const next = {
        ID: "",
        rowIndex: rows.length + 1
      };
      fields.forEach(function (field) {
        next["col_" + field.columnIndex] = "";
      });
      rows.push(next);
      oApp.setProperty("/editor/rows", rows);
      this._setDirty(true);
    },

    onDeleteRow: function () {
      const oTable = this.byId("sheetTable");
      const index = oTable.getSelectedIndex();
      if (index < 0) {
        MessageToast.show(this._i18n("selectRowFirst"));
        return;
      }
      const oApp = this.getOwnerComponent().getModel("app");
      const rows = (oApp.getProperty("/editor/rows") || []).slice();
      rows.splice(index, 1);
      rows.forEach(function (row, i) {
        row.rowIndex = i + 1;
      });
      oApp.setProperty("/editor/rows", rows);
      oTable.clearSelection();
      this._setDirty(true);
    },

    onSaveSheet: function () {
      const that = this;
      this._saveCurrentSheet().then(function (count) {
        MessageToast.show(that._i18n("savedSheet").replace("{0}", String(count)));
      }).catch(function (err) {
        MessageBox.error(err.message);
      });
    },

    onDownloadXml: function () {
      const that = this;
      const templateId = this.getOwnerComponent().getModel("app").getProperty("/current/ID");
      this._persistIfDirty().then(function () {
        return Service.downloadTemplate(templateId);
      }).then(function (fileName) {
        MessageToast.show(that._i18n("downloadedXml").replace("{0}", fileName));
      }).catch(function (err) {
        MessageBox.error(err.message);
      });
    },

    onHeaderHeightDown: function () {
      this._nudgeTableSize("headerHeight", -4, 32, 120);
    },

    onHeaderHeightUp: function () {
      this._nudgeTableSize("headerHeight", 4, 32, 120);
    },

    onRowHeightDown: function () {
      this._nudgeTableSize("rowHeight", -4, 24, 72);
    },

    onRowHeightUp: function () {
      this._nudgeTableSize("rowHeight", 4, 24, 72);
    },

    _loadTemplate: function (templateId) {
      const oApp = this.getOwnerComponent().getModel("app");
      oApp.setProperty("/busy", true);
      const url = Service.url("odata/v4/migration/Templates(" + templateId + ")" +
        "?$expand=sheets($expand=fields,rows;$orderby=sequence)");
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error("Template could not be loaded.");
          return res.json();
        })
        .then((template) => {
          if (template.sheets && template.sheets.length) {
            template.sheets.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
          }
          oApp.setProperty("/current", template);
          oApp.setProperty("/valueHelps", parseValueHelps(template.valueHelps));
          oApp.setProperty("/busy", false);
          this._renderSheetTabs(template.sheets || []);
          const firstData = (template.sheets || []).find((s) => s.sheetType === "Data")
            || (template.sheets || [])[0];
          if (firstData) {
            this.byId("sheetTabBar").setSelectedKey(firstData.ID);
            this._showSheet(firstData.ID);
          }
        })
        .catch((err) => {
          oApp.setProperty("/busy", false);
          MessageBox.error(err.message);
        });
    },

    _renderSheetTabs: function (sheets) {
      const oBar = this.byId("sheetTabBar");
      oBar.destroyItems();
      sheets.forEach((sheet) => {
        const count = sheet.dataRowCount || (sheet.rows && sheet.rows.length) || 0;
        oBar.addItem(new IconTabFilter({
          key: sheet.ID,
          text: sheet.name + (sheet.isMandatory ? " *" : ""),
          icon: iconFor(sheet),
          count: count ? String(count) : "",
          iconColor: sheet.isMandatory ? "Critical" : colorFor(sheet.sheetType),
          tooltip: (sheet.sheetType || "Sheet") + (sheet.structureName ? " · " + sheet.structureName : "")
        }));
      });
    },

    _showSheet: function (sheetId) {
      const oApp = this.getOwnerComponent().getModel("app");
      const template = oApp.getProperty("/current");
      if (!template) return;
      const sheet = (template.sheets || []).find((s) => s.ID === sheetId);
      if (!sheet) return;
      this._activeSheetId = sheetId;
      const isIntro = sheet.sheetType === "Introduction";
      const catalog = oApp.getProperty("/valueHelps");
      const baseFields = (sheet.fields || []).slice().sort((a, b) => a.columnIndex - b.columnIndex);
      const rows = (sheet.rows || []).slice().sort((a, b) => a.rowIndex - b.rowIndex).map((row) => {
        let values = [];
        try {
          values = JSON.parse(row.values || "[]");
        } catch (e) {
          values = [];
        }
        const entry = { ID: row.ID, rowIndex: row.rowIndex };
        baseFields.forEach((field) => {
          entry["col_" + field.columnIndex] = values[field.columnIndex] == null ? "" : String(values[field.columnIndex]);
        });
        return entry;
      });
      const fields = baseFields.map(function (field) {
        const options = lookupValueHelp(catalog, field.valueHelpKey).slice();
        if (options.length) {
          const seen = {};
          options.forEach(function (item) { seen[item.key] = true; });
          rows.forEach(function (row) {
            const current = row["col_" + field.columnIndex];
            if (current && !seen[current]) {
              options.unshift({ key: current, text: current });
              seen[current] = true;
            }
          });
        }
        return Object.assign({}, field, { valueHelp: options });
      });

      oApp.setProperty("/editor", {
        sheetId: sheet.ID,
        title: sheet.title || sheet.name,
        isMandatory: !!sheet.isMandatory,
        introVisible: isIntro,
        tableVisible: !isIntro,
        introText: sheet.introText || "",
        fields: fields,
        rows: rows,
        dirty: false
      });
      this._rebuildColumns(fields);
    },

    _rebuildColumns: function (fields) {
      const oTable = this.byId("sheetTable");
      if (!oTable) return;
      oTable.destroyColumns();
      fields.forEach((field, fieldIndex) => {
        const type = [field.dataType, field.length, field.decimals ? "dec " + field.decimals : ""]
          .filter(Boolean)
          .join(" ");
        const description = (field.description || "") + (field.mandatory ? " *" : "") + (field.isKey ? " (k)" : "");
        const meta = [field.technicalName, type].filter(Boolean).join(" · ");
        const tooltip = [field.groupName, description, field.technicalName, type, field.valueHelpKey]
          .filter(Boolean)
          .join("\n");
        const labels = [
          new Label({
            text: description || field.technicalName || " ",
            wrapping: false,
            tooltip: tooltip,
            required: !!field.mandatory
          })
        ];
        if (meta) {
          labels.push(new Label({
            text: meta,
            wrapping: false,
            tooltip: tooltip
          }));
        }
        const options = field.valueHelp || [];
        const template = options.length
          ? new ComboBox({
              selectedKey: "{app>col_" + field.columnIndex + "}",
              width: "100%",
              showSecondaryValues: true,
              filterSecondaryValues: true,
              change: this.onCellChange.bind(this),
              selectionChange: this.onCellChange.bind(this),
              items: {
                path: "app>/editor/fields/" + fieldIndex + "/valueHelp",
                templateShareable: false,
                template: new ListItem({
                  key: "{app>key}",
                  text: "{app>key}",
                  additionalText: "{app>text}"
                })
              }
            })
          : new Input({
              value: "{app>col_" + field.columnIndex + "}",
              change: this.onCellChange.bind(this),
              valueState: field.mandatory ? "Information" : "None"
            });
        oTable.addColumn(new Column({
          label: labels[0],
          multiLabels: labels,
          width: options.length ? "14rem" : "10rem",
          template: template
        }));
      });
      this._applyTableSizes();
    },

    _nudgeTableSize: function (property, delta, min, max) {
      const oApp = this.getOwnerComponent().getModel("app");
      const current = Number(oApp.getProperty("/table/" + property)) || min;
      const next = Math.max(min, Math.min(max, current + delta));
      oApp.setProperty("/table/" + property, next);
      this._applyTableSizes();
    },

    _applyTableSizes: function () {
      const oTable = this.byId("sheetTable");
      if (!oTable) return;
      const oApp = this.getOwnerComponent().getModel("app");
      oTable.setColumnHeaderHeight(Number(oApp.getProperty("/table/headerHeight")) || 44);
      oTable.setRowHeight(Number(oApp.getProperty("/table/rowHeight")) || 28);
    },

    _persistIfDirty: function () {
      const oApp = this.getOwnerComponent().getModel("app");
      if (!oApp.getProperty("/editor/dirty")) {
        return Promise.resolve();
      }
      return this._saveCurrentSheet();
    },

    _saveCurrentSheet: function () {
      const that = this;
      const oApp = this.getOwnerComponent().getModel("app");
      const editor = oApp.getProperty("/editor");
      if (!editor || !editor.sheetId) {
        return Promise.resolve(0);
      }
      const payload = {
        sheetId: editor.sheetId,
        introText: editor.introText || "",
        rows: JSON.stringify((editor.rows || []).map((row) => ({
          ID: row.ID,
          rowIndex: row.rowIndex,
          values: (editor.fields || []).map((field) => row["col_" + field.columnIndex] || "")
        })))
      };
      oApp.setProperty("/busy", true);
      return fetch(Service.url("odata/v4/migration/saveSheetData"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error(body.error && body.error.message || "Save failed.");
          return body.value != null ? body.value : body;
        });
      }).then(function (count) {
        that._applySavedRowsToModel(payload);
        that._setDirty(false);
        oApp.setProperty("/busy", false);
        return count;
      }).catch(function (err) {
        oApp.setProperty("/busy", false);
        throw err;
      });
    },

    _applySavedRowsToModel: function (payload) {
      const oApp = this.getOwnerComponent().getModel("app");
      const template = oApp.getProperty("/current");
      if (!template) return;
      const sheet = (template.sheets || []).find((s) => s.ID === payload.sheetId);
      if (!sheet) return;
      const parsedRows = JSON.parse(payload.rows || "[]");
      sheet.introText = payload.introText;
      sheet.dataRowCount = parsedRows.length;
      sheet.rows = parsedRows.map(function (row) {
        return {
          ID: row.ID,
          rowIndex: row.rowIndex,
          values: JSON.stringify(row.values || [])
        };
      });
      const total = (template.sheets || []).reduce(function (sum, item) {
        return sum + (item.dataRowCount || (item.rows && item.rows.length) || 0);
      }, 0);
      template.rowCount = total;
      oApp.setProperty("/current", template);
      this._renderSheetTabs(template.sheets || []);
      this.byId("sheetTabBar").setSelectedKey(payload.sheetId);
    },

    _setDirty: function (dirty) {
      this.getOwnerComponent().getModel("app").setProperty("/editor/dirty", !!dirty);
    },

    _i18n: function (key) {
      const oBundle = this.getOwnerComponent().getModel("i18n");
      return (oBundle && oBundle.getProperty(key)) || key;
    }
  });

  function iconFor(sheet) {
    if (sheet.sheetType === "Introduction") return "sap-icon://message-information";
    if (sheet.sheetType === "FieldList") return "sap-icon://list";
    if (sheet.sheetType === "ValueHelp") return "sap-icon://value-help";
    return sheet.isMandatory ? "sap-icon://excel-attachment" : "sap-icon://table-view";
  }

  function colorFor(sheetType) {
    if (sheetType === "Introduction") return "Neutral";
    if (sheetType === "FieldList") return "Default";
    if (sheetType === "ValueHelp") return "Neutral";
    return "Positive";
  }

  function parseValueHelps(raw) {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function lookupValueHelp(catalog, tableField) {
    if (!catalog || !tableField) return [];
    const direct = catalog[tableField];
    if (direct && direct.length) return direct;
    const needle = String(tableField).toUpperCase();
    const keys = Object.keys(catalog);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].toUpperCase() === needle && catalog[keys[i]] && catalog[keys[i]].length) {
        return catalog[keys[i]];
      }
    }
    return [];
  }
});
