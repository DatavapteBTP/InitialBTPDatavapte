sap.ui.define([], function () {
  "use strict";

  function appBase() {
    const path = String(location.pathname || "/");
    if (path.endsWith("/")) return path;
    return path.replace(/\/[^/]*$/, "/");
  }

  function isDeployedHtml5() {
    const path = String(location.pathname || "");
    return /AppRouterDatavapte|datavaptemigrationstudio/i.test(path)
      || /launchpad\.cfapps\.|hana\.ondemand\.com/i.test(location.hostname);
  }

  return {
    url: function (path) {
      const rel = String(path || "").replace(/^\//, "");
      if (isDeployedHtml5()) {
        return appBase() + rel;
      }
      return "/" + rel;
    },
    sampleUrl: function () {
      return this.url("sample/Source_data_for_Bank.xml");
    }
  };
});
