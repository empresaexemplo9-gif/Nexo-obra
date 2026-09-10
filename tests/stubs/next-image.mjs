// Substituto de next/image para os testes de interface: o componente real depende do
// runtime do Next, e o que interessa aqui é o que a marca renderiza, não a otimização.
import React from "react";

export default function Image({ src, alt = "", width, height, priority, quality, fill, ...rest }) {
  void priority; void quality; void fill;
  return React.createElement("img", { src: typeof src === "string" ? src : "", alt, width, height, ...rest });
}
