sap.ui.define([], function () {
  "use strict";

  const CAP_ORIGIN = "https://the-innovapte-company-dev-space-datavapte-migration-srv.cfapps.us10.hana.ondemand.com";

  function appBase() {
    const path = String(location.pathname || "/");
    if (path.endsWith("/")) return path;
    return path.replace(/\/[^/]*$/, "/");
  }

  function isLaunchpad() {
    return /launchpad\.cfapps\./i.test(location.hostname);
  }

  function isStandaloneApprouter() {
    return /datavapte-migration\.cfapps\./i.test(location.hostname);
  }

  return {
    url: function (path) {
      const rel = String(path || "").replace(/^\//, "");
      if (isLaunchpad() && /^(odata|sample)\//.test(rel)) {
        return CAP_ORIGIN + "/" + rel;
      }
      if (isStandaloneApprouter() && /^odata\//.test(rel)) {
        return "/" + rel;
      }
      if (isLaunchpad() || isStandaloneApprouter()) {
        return appBase() + rel;
      }
      return "/" + rel;
    },
    catalogUrl: function () {
      return this.url("sample/blank-templates.json");
    },
    sampleUrl: function (fileName) {
      const name = encodeURIComponent(fileName || "Source_data_for_Bank.xml");
      return this.url("sample/" + name);
    },
    downloadTemplate: function (templateId) {
      return fetch(this.url("odata/v4/migration/downloadTemplateXml"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: templateId })
      }).then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      }).then(function (result) {
        if (!result.ok) {
          throw new Error((result.body.error && result.body.error.message) || "Could not download the XML template.");
        }
        const fileName = result.body.fileName || "template.xml";
        const blob = new Blob([result.body.content || ""], {
          type: result.body.mediaType || "application/xml"
        });
        const href = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = href;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () {
          URL.revokeObjectURL(href);
        }, 1000);
        return fileName;
      });
    }
  };
});
