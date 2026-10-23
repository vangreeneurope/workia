import { internalLinks, postProcess } from "../../scripts/demo/crawl.mjs";

describe("demostración estática (scripts/demo/crawl.mjs)", () => {
  it("prefija con /workia los recursos absolutos que no lo llevan e inyecta demo.js", () => {
    const html =
      '<html><head><link rel="icon" href="/icons/icon.svg"></head><body>' +
      '<img src="/brand/logo.svg"><a href="/workia/panel">Panel</a><a href="https://x.test/a">x</a>' +
      '<a href="//cdn.test/b">y</a></body></html>';
    const out = postProcess(html, "/workia");
    expect(out).toContain('href="/workia/icons/icon.svg"');
    expect(out).toContain('src="/workia/brand/logo.svg"');
    expect(out).toContain('href="/workia/panel"');
    expect(out).not.toContain("/workia/workia/");
    expect(out).toContain('href="https://x.test/a"');
    expect(out).toContain('href="//cdn.test/b"');
    expect(out).toContain(
      '<script src="/workia/demo.js" data-base="/workia" defer></script></head>',
    );
  });

  it("descubre solo pantallas internas (sin estáticos, anclas ni consultas)", () => {
    const html =
      '<a href="/workia/fichajes/">a</a><a href="/workia/ayuda?x=1">b</a><a href="/workia/_next/static/a.js">c</a>' +
      '<a href="/workia/icons/icon.png">d</a><a href="/otra">e</a><a href="/workia/gastos#top">f</a>';
    expect(internalLinks(html, "/workia").sort()).toEqual(["/ayuda", "/fichajes", "/gastos"]);
  });
});
