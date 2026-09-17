import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const layout = await readFile(new URL("app/layout.tsx", root), "utf8");
const polish = await readFile(new URL("app/hoikos-polish.css", root), "utf8");

test("carrega o acabamento visual H.OIKOS em toda a aplicação", () => {
  assert.match(layout, /import "\.\/hoikos-polish\.css"/);
  assert.match(layout, /ador-hairline-light\.ttf/);
  assert.match(polish, /\.nexo-sidebar \[data-sidebar="sidebar"\]/);
  assert.match(polish, /\[data-slot="table-container"\]/);
  assert.match(polish, /\[data-slot="tabs-list"\]/);
  assert.match(polish, /\[data-slot="dialog-content"\]/);
  assert.match(polish, /\[data-active="true"\]/);
  assert.match(polish, /prefers-reduced-motion/);
});

test("o acabamento só deriva da paleta central", () => {
  assert.doesNotMatch(polish, /#[0-9a-f]{3,8}/gi);
  assert.doesNotMatch(polish, /gradient\(/i);
  for (const token of [
    "--hoikos-soil",
    "--hoikos-earth",
    "--hoikos-stone",
    "--hoikos-paper",
    "--hoikos-linen",
    "--hoikos-gold",
  ]) {
    assert.match(polish, new RegExp(`var\\(${token}\\)`), `token ausente: ${token}`);
  }
});
