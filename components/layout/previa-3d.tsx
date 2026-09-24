"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Eye, LoaderCircle, Maximize, MoveDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { limitesDoLayout, type LayoutConteudo } from "@/lib/layout";

export type Previa3dRef = { capturar: (largura?: number) => Promise<Blob>; pronta: () => boolean };
type Vista = "perspectiva" | "cima" | "frente";

/**
 * Prévia 3D do layout. A cena é refeita a cada mudança do documento; câmera e ângulo
 * continuam onde a pessoa deixou.
 */
export const Previa3d = forwardRef<Previa3dRef, { doc: LayoutConteudo }>(function Previa3d({ doc }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const motor = useRef<{
    three: typeof import("three"); renderer: import("three").WebGLRenderer; cena: import("three").Scene;
    camera: import("three").PerspectiveCamera; controles: import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
    conteudo: import("three").Group | null; sol: import("three").DirectionalLight; montar: typeof import("@/components/layout/cena-3d").montarCena;
  } | null>(null);
  const [erro, setErro] = useState("");
  const [pronto, setPronto] = useState(false);
  const enquadrado = useRef(false);

  function vista(tipo: Vista) {
    const atual = motor.current;
    if (!atual) return;
    const limites = limitesDoLayout(doc) ?? { minX: -3000, minY: -3000, maxX: 3000, maxY: 3000 };
    const cx = (limites.minX + limites.maxX) / 2000, cz = (limites.minY + limites.maxY) / 2000;
    const tamanho = Math.max(limites.maxX - limites.minX, limites.maxY - limites.minY, 4000) / 1000;
    const { camera, controles } = atual;
    controles.target.set(cx, 0.8, cz);
    if (tipo === "cima") camera.position.set(cx, tamanho * 1.35, cz + 0.001);
    else if (tipo === "frente") camera.position.set(cx, 1.6, cz + tamanho * 1.1);
    // Maquete vista a uns 50°: mais baixo que isso, paredes de 2,80 m escondem o piso e
    // os móveis dos cômodos, que é o que a proposta quer mostrar.
    else camera.position.set(cx + tamanho * 0.36, tamanho * 0.8, cz + tamanho * 0.55);
    camera.near = tipo === "frente" ? 0.05 : 0.2; camera.far = tamanho * 20; camera.updateProjectionMatrix();
    controles.update();
  }

  useImperativeHandle(ref, () => ({
    pronta: () => Boolean(motor.current?.conteudo),
    async capturar(largura = 2400) {
      const atual = motor.current;
      if (!atual) throw new Error("A prévia 3D ainda não abriu.");
      const { renderer, cena, camera } = atual;
      const tamanho = renderer.getSize(new atual.three.Vector2());
      const razao = renderer.getPixelRatio();
      // Captura sempre em 16:9, maior que a tela, com o mesmo ângulo da câmera: o painel
      // estreito do lado a lado cortaria as laterais numa imagem retrato.
      const altura = Math.round((largura * 9) / 16);
      renderer.setPixelRatio(1);
      renderer.setSize(largura, altura, false);
      camera.aspect = largura / altura; camera.updateProjectionMatrix();
      renderer.render(cena, camera);
      const blob = await new Promise<Blob | null>((resolve) => renderer.domElement.toBlob(resolve, "image/png"));
      renderer.setPixelRatio(razao); renderer.setSize(tamanho.x, tamanho.y, false);
      camera.aspect = tamanho.x / Math.max(tamanho.y, 1); camera.updateProjectionMatrix();
      renderer.render(cena, camera);
      if (!blob) throw new Error("Não foi possível gerar a imagem 3D.");
      return blob;
    },
  }));

  useEffect(() => {
    let vivo = true;
    let quadro = 0;
    let observador: ResizeObserver | null = null;
    (async () => {
      const [three, { OrbitControls }, { montarCena }] = await Promise.all([
        import("three"), import("three/examples/jsm/controls/OrbitControls.js"), import("@/components/layout/cena-3d"),
      ]);
      const alvo = host.current;
      if (!vivo || !alvo) return;
      let renderer: import("three").WebGLRenderer;
      try { renderer = new three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
      catch { throw new Error("Este navegador não tem WebGL ativo. A planta 2D continua funcionando."); }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = three.PCFSoftShadowMap;
      renderer.toneMapping = three.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      renderer.setSize(alvo.clientWidth, Math.max(alvo.clientHeight, 320), false);
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
      alvo.appendChild(renderer.domElement);
      const cena = new three.Scene();
      cena.background = new three.Color(0xdfe7ec);
      cena.add(new three.HemisphereLight(0xffffff, 0x9d9585, 1.6));
      const sol = new three.DirectionalLight(0xfff4e0, 2.2);
      sol.castShadow = true; sol.shadow.mapSize.set(2048, 2048); sol.shadow.bias = -0.0005;
      cena.add(sol); cena.add(sol.target);
      // O chão externo fica bem abaixo dos pisos e empurrado para trás no teste de
      // profundidade: com poucos milímetros de folga, placas de vídeo com profundidade de
      // 16 bits misturavam os dois planos e os pisos sumiam na vista inclinada.
      const chao = new three.Mesh(new three.PlaneGeometry(400, 400), new three.MeshStandardMaterial({ color: 0xcfc9bb, roughness: 1, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 }));
      chao.rotation.x = -Math.PI / 2; chao.position.y = -0.03; chao.receiveShadow = true;
      cena.add(chao);
      const camera = new three.PerspectiveCamera(45, alvo.clientWidth / Math.max(alvo.clientHeight, 320), 0.05, 2000);
      const controles = new OrbitControls(camera, renderer.domElement);
      controles.enableDamping = true; controles.maxPolarAngle = Math.PI / 2 - 0.02;
      motor.current = { three, renderer, cena, camera, controles, conteudo: null, sol, montar: montarCena };
      const desenhar = () => { quadro = requestAnimationFrame(desenhar); controles.update(); renderer.render(cena, camera); };
      desenhar();
      observador = new ResizeObserver(() => {
        const w = alvo.clientWidth, h = Math.max(alvo.clientHeight, 320);
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      });
      observador.observe(alvo);
      setPronto(true);
    })().catch((causa) => { if (vivo) setErro(causa instanceof Error ? causa.message : "Não foi possível abrir a prévia 3D."); });
    return () => {
      vivo = false; cancelAnimationFrame(quadro); observador?.disconnect();
      const atual = motor.current;
      if (atual) { atual.controles.dispose(); atual.renderer.dispose(); atual.renderer.domElement.remove(); }
      motor.current = null;
    };
  }, []);

  // Refaz a cena quando o documento muda.
  useEffect(() => {
    const atual = motor.current;
    if (!pronto || !atual) return;
    if (atual.conteudo) {
      atual.cena.remove(atual.conteudo);
      atual.conteudo.traverse((objeto) => { const malha = objeto as import("three").Mesh; if (malha.isMesh) malha.geometry.dispose(); });
    }
    atual.conteudo = atual.montar(atual.three, doc);
    atual.cena.add(atual.conteudo);
    const limites = limitesDoLayout(doc) ?? { minX: -3000, minY: -3000, maxX: 3000, maxY: 3000 };
    const cx = (limites.minX + limites.maxX) / 2000, cz = (limites.minY + limites.maxY) / 2000;
    const raio = Math.max(limites.maxX - limites.minX, limites.maxY - limites.minY, 4000) / 1000;
    atual.sol.position.set(cx + raio * 0.6, raio * 1.2, cz + raio * 0.4); atual.sol.target.position.set(cx, 0, cz);
    const sombra = atual.sol.shadow.camera;
    sombra.left = sombra.bottom = -raio; sombra.right = sombra.top = raio; sombra.far = raio * 4; sombra.updateProjectionMatrix();
    if (!enquadrado.current) { enquadrado.current = true; vista("perspectiva"); }
    // vista() lê o documento corrente; só a primeira montagem enquadra sozinha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pronto]);

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b border-hoikos-200 bg-white p-2">
      <Button size="sm" variant="outline" onClick={() => vista("perspectiva")} disabled={!pronto}><Maximize />Perspectiva</Button>
      <Button size="sm" variant="outline" onClick={() => vista("cima")} disabled={!pronto}><MoveDown />De cima</Button>
      <Button size="sm" variant="outline" onClick={() => vista("frente")} disabled={!pronto}><Eye />Altura dos olhos</Button>
      <p className="hidden text-xs text-hoikos-500 md:block">Arraste para girar · role para aproximar · botão direito para mover</p>
    </div>
    <div className="relative min-h-[320px] flex-1">
      <div ref={host} className="absolute inset-0" role="img" aria-label="Prévia 3D do layout" />
      {!pronto && !erro ? <div className="absolute inset-0 grid place-items-center text-sm" role="status"><p className="flex items-center gap-2"><LoaderCircle className="animate-spin" />Montando a prévia 3D…</p></div> : null}
      {erro ? <div className="absolute inset-0 grid place-items-center bg-white p-6 text-center text-sm" role="alert">{erro}</div> : null}
    </div>
  </div>;
});
