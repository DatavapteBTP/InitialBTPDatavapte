sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast"
], function (Controller, MessageBox, MessageToast) {
  "use strict";

  return Controller.extend("datavapte.migration.studio.controller.Home", {
    onInit: function () {
      this._selectedFile = null;
      this.getOwnerComponent().getRouter()
        .getRoute("home")
        .attachPatternMatched(this.onRouteMatched, this);
    },

    onRouteMatched: function () {
      this.loadTemplates();
    },

    loadTemplates: function () {
      const oApp = this.getOwnerComponent().getModel("app");
      fetch("/odata/v4/migration/Templates?$orderby=createdAt desc&$select=ID,fileName,objectName,status,sheetCount,fieldCount,rowCount,parseMessage,createdAt")
        .then((res) => {
          if (!res.ok) throw new Error("Could not load templates.");
          return res.json();
        })
        .then((data) => {
          oApp.setProperty("/templates", data.value || []);
        })
        .catch((err) => {
          MessageBox.error(err.message);
        });
    },

    onFileChange: function (oEvent) {
      const files = oEvent.getParameter("files");
      this._selectedFile = files && files[0] ? files[0] : null;
      this.byId("uploadButton").setEnabled(!!this._selectedFile);
      this.byId("selectedFileName").setText(
        this._selectedFile ? this._selectedFile.name : ""
      );
    },

    onUpload: function () {
      if (!this._selectedFile) {
        MessageBox.warning(this.getOwnerComponent().getModel("i18n").getProperty("selectFileFirst"));
        return;
      }
      this._uploadFile(this._selectedFile);
    },

    onLoadSample: function () {
      this._setBusy(true, "Loading sample Bank Master template…");
      fetch("/sample/Source_data_for_Bank.xml")
        .then((res) => {
          if (!res.ok) throw new Error("Sample template is not available.");
          return res.arrayBuffer();
        })
        .then((buffer) => {
          const file = new File([buffer], "Source_data_for_Bank.xml", { type: "application/xml" });
          return this._uploadFile(file);
        })
        .catch((err) => {
          this._setBusy(false);
          MessageBox.error(err.message);
        });
    },

    onOpenTemplate: function (oEvent) {
      const oCtx = oEvent.getSource().getBindingContext("app") ||
        oEvent.getSource().getParent().getBindingContext("app");
      if (!oCtx) return;
      const id = oCtx.getProperty("ID");
      this.getOwnerComponent().getRouter().navTo("viewer", { templateId: id });
    },

    _uploadFile: function (file) {
      const that = this;
      this._setBusy(true, "Reading Excel tabs…");
      return readAsBase64(file)
        .then((base64) => fetch("/odata/v4/migration/uploadTemplate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            mediaType: file.type || guessType(file.name),
            content: base64
          })
        }))
        .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
        .then(({ ok, body }) => {
          that._setBusy(false);
          if (!ok) {
            throw new Error(body.error?.message || "Upload failed.");
          }
          MessageToast.show(body.parseMessage || "Template parsed.");
          that.getOwnerComponent().getRouter().navTo("viewer", { templateId: body.ID });
        })
        .catch((err) => {
          that._setBusy(false);
          MessageBox.error(err.message);
        });
    },

    _setBusy: function (busy, reason) {
      const oApp = this.getOwnerComponent().getModel("app");
      oApp.setProperty("/busy", !!busy);
      oApp.setProperty("/busyReason", reason || "");
    }
  });

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function () {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = function () {
        reject(new Error("Could not read the selected file."));
      };
      reader.readAsDataURL(file);
    });
  }

  function guessType(name) {
    if (/\.xml$/i.test(name)) return "application/xml";
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
});
