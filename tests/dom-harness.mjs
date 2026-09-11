// Suporte de DOM para os testes de interface. Monta os componentes de verdade, roda os
// efeitos e despacha cliques — é o que faltava para além do render estático.
// Não é um navegador real: layout, CSS e rolagem continuam fora do alcance.

import { JSDOM } from "jsdom";

export function installDom(url = "https://platform.test/") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url, pretendToBeVisual: true });
  const { window } = dom;

  const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  define("window", window);
  define("document", window.document);
  define("navigator", window.navigator);
  // As primitivas do catálogo fazem `instanceof` com vários construtores do DOM.
  // Copiar a família inteira evita descobrir um a um a cada componente novo.
  for (const name of Object.getOwnPropertyNames(window)) {
    if (/^(HTML|SVG|DOM|CSS|Mouse|Keyboard|Pointer|Touch|Focus|Input|Composition|Wheel|Drag)/.test(name)
      && globalThis[name] === undefined) define(name, window[name]);
  }
  for (const name of [
    "Element", "Node", "NodeList", "Event", "EventTarget", "CustomEvent", "DocumentFragment",
    "getComputedStyle", "DOMParser", "NodeFilter", "Range", "Selection", "AbortController",
  ]) define(name, window[name]);

  // O que o jsdom não traz e as primitivas do catálogo esperam encontrar.
  window.matchMedia ??= (query) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  });
  define("matchMedia", window.matchMedia.bind(window));
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  for (const name of ["ResizeObserver", "IntersectionObserver", "MutationObserver"]) {
    window[name] ??= Observer;
    define(name, window[name]);
  }
  window.HTMLElement.prototype.scrollIntoView ??= () => {};
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.setPointerCapture ??= () => {};
  define("requestAnimationFrame", (callback) => window.setTimeout(() => callback(Date.now()), 0));
  define("cancelAnimationFrame", (handle) => window.clearTimeout(handle));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  return {
    window,
    cleanup() { window.close(); },
  };
}

// Respostas de API controladas: nenhum teste de interface toca a rede.
export function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    calls.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
    // O padrão mais específico vence: /api/worksheets/data não pode cair em /api/worksheets.
    const match = Object.keys(routes)
      .filter((pattern) => path === pattern || path.startsWith(`${pattern}?`) || path.startsWith(`${pattern}/`))
      .sort((left, right) => right.length - left.length)[0];
    if (!match) return new Response(JSON.stringify({ error: `sem rota de teste para ${path}` }), { status: 404, headers: { "content-type": "application/json" } });
    const handler = routes[match];
    const result = typeof handler === "function" ? await handler({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null }) : handler;
    const status = result?.__status ?? 200;
    return new Response(JSON.stringify(result), { status, headers: { "content-type": "application/json" } });
  };
  return calls;
}

export function textOf(container) {
  return (container.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function findByText(container, pattern, selector = "button, a, [role=button], label, option") {
  const test = pattern instanceof RegExp ? (value) => pattern.test(value) : (value) => value.includes(pattern);
  return [...container.querySelectorAll(selector)].find((node) => test((node.textContent ?? "").replace(/\s+/g, " ").trim())) ?? null;
}
