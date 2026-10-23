// Demostración estática de Workia (ADR-070). No hay servidor: los formularios y
// las acciones no se envían; se muestra un aviso. El acceso lleva al panel.
(function () {
  "use strict";
  var script = document.currentScript;
  var base = (script && script.getAttribute("data-base")) || "";
  var MESSAGE =
    "Demostración: los cambios no se guardan. Puedes seguir navegando por la aplicación.";

  function toast(text) {
    var box = document.getElementById("demo-aviso");
    if (!box) {
      box = document.createElement("div");
      box.id = "demo-aviso";
      box.setAttribute("role", "status");
      box.style.cssText =
        "position:fixed;left:50%;bottom:calc(5rem + env(safe-area-inset-bottom));transform:translateX(-50%);" +
        "z-index:9999;max-width:min(28rem,calc(100vw - 2rem));padding:.75rem 1rem;border-radius:.75rem;" +
        "background:#1f2937;color:#fff;font:500 14px/1.4 system-ui,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,.25)";
      document.body.appendChild(box);
    }
    box.textContent = text;
    clearTimeout(box._timer);
    box._timer = setTimeout(function () {
      box.remove();
    }, 5000);
  }

  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (
        form.querySelector('input[type="password"]') &&
        form.querySelector('input[type="email"]')
      ) {
        window.location.href = base + "/panel/";
        return;
      }
      toast(MESSAGE);
    },
    true,
  );

  // Acciones de servidor lanzadas desde botones (sin formulario).
  var originalFetch = window.fetch;
  window.fetch = function (input, init) {
    var headers = (init && init.headers) || {};
    var isAction =
      init &&
      String(init.method || "").toUpperCase() === "POST" &&
      (typeof headers.get === "function"
        ? headers.get("Next-Action")
        : headers["Next-Action"] || headers["next-action"]);
    if (isAction) {
      toast(MESSAGE);
      return Promise.reject(new TypeError("Demostración sin servidor"));
    }
    return originalFetch.apply(this, arguments);
  };
})();
