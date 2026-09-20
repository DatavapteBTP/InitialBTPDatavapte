sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/IconTabFilter",
  "sap/m/Input",
  "sap/m/Label",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/ui/table/Column"
], function (Controller, IconTabFilter, Input, Label, MessageBox, MessageToast, Column) {
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

    _loadTemplate: function (templateId) {
      const oApp = this.getOwnerComponent().getModel("app");
      oApp.setProperty("/busy", true);
      const url = "/odata/v4/migration/Templates(" + templateId + ")" +
        "?$expand=sheets($expand=fields,rows;$orderby=sequence)";
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
      const fields = (sheet.fields || []).slice().sort((a, b) => a.columnIndex - b.columnIndex);
      const rows = (sheet.rows || []).slice().sort((a, b) => a.rowIndex - b.rowIndex).map((row) => {
        let values = [];
        try {
          values = JSON.parse(row.values || "[]");
        } catch (e) {
          values = [];
        }
        const entry = { ID: row.ID, rowIndex: row.rowIndex };
        fields.forEach((field) => {
          entry["col_" + field.columnIndex] = values[field.columnIndex] == null ? "" : String(values[field.columnIndex]);
        });
        return entry;
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
      oTable.destroyColumns();
      const showGroup = fields.some((f) => f.groupName);
      fields.forEach((field) => {
        const type = [field.dataType, field.length, field.decimals ? "dec " + field.decimals : ""]
          .filter(Boolean)
          .join(" ");
        const labels = [];
        if (showGroup) {
          labels.push(new Label({ text: field.groupName || " ", wrapping: true }));
        }
        labels.push(new Label({
          text: (field.description || "") + (field.mandatory ? " *" : "") + (field.isKey ? " (k)" : ""),
          wrapping: true,
          required: !!field.mandatory
        }));
        if (field.technicalName) {
          labels.push(new Label({ text: field.technicalName, wrapping: true }));
        }
        if (type) {
          labels.push(new Label({ text: type, wrapping: true }));
        }
        oTable.addColumn(new Column({
          label: labels[showGroup ? 1 : 0],
          multiLabels: labels,
          width: "12rem",
          template: new Input({
            value: "{app>col_" + field.columnIndex + "}",
            change: this.onCellChange.bind(this),
            valueState: field.mandatory ? "Information" : "None"
          })
        }));
      });
      oTable.setColumnHeaderHeight(showGroup ? 108 : 84);
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
      return fetch("/odata/v4/migration/saveSheetData", {
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
    return sheet.isMandatory ? "sap-icon://excel-attachment" : "sap-icon://table-view";
  }

  function colorFor(sheetType) {
    if (sheetType === "Introduction") return "Neutral";
    if (sheetType === "FieldList") return "Default";
    return "Positive";
  }
});
