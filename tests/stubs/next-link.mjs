// Substituto de next/link: vira uma âncora comum, que é como o navegador a entrega.
import React from "react";

export default function Link({ href, children, prefetch, replace, scroll, ...rest }) {
  void prefetch; void replace; void scroll;
  return React.createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children);
}
