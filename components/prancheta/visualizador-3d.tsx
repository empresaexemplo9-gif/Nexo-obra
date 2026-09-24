"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Maximize } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PropsVisualizador } from "@/components/prancheta/tipos";

type Three = typeof import("three");
type Objeto = import("three").Object3D;

/**
 * IFC pelo web-ifc (WebAssembly): cada peça sai com a cor e a posição do modelo BIM.
 * Peças da mesma cor viram uma malha só; um edifício com dezenas de milhares de peças
 * continua girando liso.
 */
async function carregarIfc(three: Three, bytes: Uint8Array, aoProgresso: (texto: string) => void) {
  const { IfcAPI } = await import("web-ifc");
  const api = new IfcAPI();
  await api.Init(() => "/vendor/web-ifc/web-ifc.wasm", true);
  const modelo = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
  if (modelo < 0) throw new Error("O arquivo IFC não pôde ser lido.");
  const esquema = api.GetModelSchema(modelo);
  const porCor = new Map<string, { cor: [number, number, number, number]; posicoes: number[]; normais: number[]; indices: number[] }>();
  const matriz = new three.Matrix4(), normalMatriz = new three.Matrix3(), v = new three.Vector3(), n = new three.Vector3();
  let pecas = 0;
  api.StreamAllMeshes(modelo, (malha, indice, total) => {
    pecas += 1;
    if (indice % 500 === 0) aoProgresso(`Montando o modelo · ${Math.round((indice / Math.max(total, 1)) * 100)}%`);
    const geometrias = malha.geometries;
    for (let g = 0; g < geometrias.size(); g += 1) {
      const colocada = geometrias.get(g);
      const geometria = api.GetGeometry(modelo, colocada.geometryExpressID);
      const vertices = api.GetVertexArray(geometria.GetVertexData(), geometria.GetVertexDataSize());
      const indices = api.GetIndexArray(geometria.GetIndexData(), geometria.GetIndexDataSize());
      matriz.fromArray(colocada.flatTransformation);
      normalMatriz.getNormalMatrix(matriz);
      const c = colocada.color;
      const chave = `${c.x.toFixed(3)}|${c.y.toFixed(3)}|${c.z.toFixed(3)}|${c.w.toFixed(2)}`;
      let lote = porCor.get(chave);
      if (!lote) { lote = { cor: [c.x, c.y, c.z, c.w], posicoes: [], normais: [], indices: [] }; porCor.set(chave, lote); }
      const base = lote.posicoes.length / 3;
      for (let i = 0; i + 5 < vertices.length; i += 6) {
        v.set(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(matriz);
        n.set(vertices[i + 3], vertices[i + 4], vertices[i + 5]).applyMatrix3(normalMatriz).normalize();
        lote.posicoes.push(v.x, v.y, v.z); lote.normais.push(n.x, n.y, n.z);
      }
      for (let i = 0; i < indices.length; i += 1) lote.indices.push(base + indices[i]);
      geometria.delete();
    }
  });
  api.CloseModel(modelo);
  const grupo = new three.Group();
  for (const lote of porCor.values()) {
    const geometria = new three.BufferGeometry();
    geometria.setAttribute("position", new three.Float32BufferAttribute(lote.posicoes, 3));
    geometria.setAttribute("normal", new three.Float32BufferAttribute(lote.normais, 3));
    geometria.setIndex(lote.indices);
    const [r, g, b, a] = lote.cor;
    grupo.add(new three.Mesh(geometria, new three.MeshStandardMaterial({
      color: new three.Color(r, g, b), transparent: a < 1, opacity: a, side: three.DoubleSide, roughness: 0.8, metalness: 0.05,
    })));
  }
  return { objeto: grupo as Objeto, detalhe: `${esquema} · ${pecas.toLocaleString("pt-BR")} elementos` };
}

async function carregarModelo(three: Three, extensao: string, blob: Blob, aoProgresso: (texto: string) => void): Promise<{ objeto: Objeto; detalhe: string }> {
  const buffer = await blob.arrayBuffer();
  const material = new three.MeshStandardMaterial({ color: 0xc9c2b0, roughness: 0.7, metalness: 0.05, side: three.DoubleSide });
  if (extensao === "ifc") return carregarIfc(three, new Uint8Array(buffer), aoProgresso);
  if (extensao === "stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    const geometria = new STLLoader().parse(buffer);
    geometria.computeVertexNormals();
    return { objeto: new three.Mesh(geometria, material), detalhe: `${(geometria.getAttribute("position").count / 3).toLocaleString("pt-BR")} triângulos` };
  }
  if (extensao === "ply") {
    const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
    const geometria = new PLYLoader().parse(buffer);
    geometria.computeVertexNormals();
    const temCor = Boolean(geometria.getAttribute("color"));
    const objeto = geometria.index || geometria.getAttribute("position").count % 3 === 0
      ? new three.Mesh(geometria, temCor ? new three.MeshStandardMaterial({ vertexColors: true, side: three.DoubleSide }) : material)
      : new three.Points(geometria, new three.PointsMaterial({ size: 0.01, vertexColors: temCor }));
    return { objeto, detalhe: "PLY" };
  }
  if (extensao === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    const objeto = new OBJLoader().parse(new TextDecoder().decode(buffer));
    // Sem o .mtl ao lado, o OBJ vem sem material: aplica o neutro para enxergar a forma.
    objeto.traverse((filho) => { const malha = filho as import("three").Mesh; if (malha.isMesh) malha.material = material; });
    return { objeto, detalhe: "OBJ · materiais do .mtl não incluídos" };
  }
  if (extensao === "3mf") {
    const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
    return { objeto: new ThreeMFLoader().parse(buffer), detalhe: "3MF" };
  }
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  return { objeto: gltf.scene, detalhe: extensao === "glb" ? "glTF binário" : "glTF" };
}

export default function Visualizador3d({ blob, nome, extensao }: PropsVisualizador) {
  const host = useRef<HTMLDivElement>(null);
  const enquadrarRef = useRef<() => void>(() => undefined);
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">("carregando");
  const [progresso, setProgresso] = useState("Abrindo o modelo…");
  const [detalhe, setDetalhe] = useState("");
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancelado = false;
    let limpar: () => void = () => {};
    (async () => {
      const three = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const alvo = host.current;
      if (cancelado || !alvo) return;
      let renderer: import("three").WebGLRenderer;
      try { renderer = new three.WebGLRenderer({ antialias: true }); }
      catch { throw new Error("Este navegador não tem WebGL ativo, que o visualizador 3D usa. Ative a aceleração gráfica ou baixe o arquivo."); }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(alvo.clientWidth, Math.max(alvo.clientHeight, 360));
      alvo.appendChild(renderer.domElement);
      const cena = new three.Scene();
      cena.background = new three.Color(0xeeece6);
      cena.add(new three.HemisphereLight(0xffffff, 0x8a8577, 2.2));
      const sol = new three.DirectionalLight(0xffffff, 1.6); sol.position.set(1, 2, 1.5); cena.add(sol);
      const camera = new three.PerspectiveCamera(45, alvo.clientWidth / Math.max(alvo.clientHeight, 360), 0.01, 1e7);
      const controles = new OrbitControls(camera, renderer.domElement);
      controles.enableDamping = true;
      let quadro = 0;
      const desenhar = () => { quadro = requestAnimationFrame(desenhar); controles.update(); renderer.render(cena, camera); };
      const redimensionar = new ResizeObserver(() => {
        const w = alvo.clientWidth, h = Math.max(alvo.clientHeight, 360);
        renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      });
      redimensionar.observe(alvo);
      limpar = () => { cancelAnimationFrame(quadro); redimensionar.disconnect(); controles.dispose(); renderer.dispose(); renderer.domElement.remove(); };

      const { objeto, detalhe: texto } = await carregarModelo(three, extensao, blob, setProgresso);
      if (cancelado) return;
      // STL, PLY e 3MF vêm do CAD com Z para cima; glTF, OBJ e o IFC do web-ifc já com Y.
      if (["stl", "ply", "3mf"].includes(extensao)) objeto.rotation.x = -Math.PI / 2;
      cena.add(objeto);
      const caixa = new three.Box3().setFromObject(objeto);
      if (caixa.isEmpty()) throw new Error("O modelo não tem geometria visível.");
      const centro = caixa.getCenter(new three.Vector3()), tamanho = caixa.getSize(new three.Vector3()).length() || 1;
      const grade = new three.GridHelper(tamanho * 2, 20, 0xb5ad98, 0xd8d3c4);
      grade.position.y = caixa.min.y; cena.add(grade);
      enquadrarRef.current = () => {
        camera.near = tamanho / 1000; camera.far = tamanho * 100; camera.updateProjectionMatrix();
        camera.position.copy(centro).add(new three.Vector3(tamanho * 0.7, tamanho * 0.55, tamanho * 0.7));
        controles.target.copy(centro); controles.update();
      };
      enquadrarRef.current();
      desenhar();
      setDetalhe(texto); setEstado("pronto");
    })().catch((causa) => {
      if (cancelado) return;
      setErro(causa instanceof Error && causa.message ? causa.message : "Não foi possível abrir o modelo.");
      setEstado("erro");
    });
    return () => { cancelado = true; limpar(); };
  }, [blob, extensao]);

  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b border-hoikos-200 bg-white p-2">
      <Button size="sm" variant="outline" onClick={() => enquadrarRef.current()} disabled={estado !== "pronto"}><Maximize />Enquadrar</Button>
      <p className="text-sm text-hoikos-600">{detalhe || "Arraste para girar, role para aproximar, botão direito para mover."}</p>
    </div>
    <div className="relative min-h-[360px] flex-1">
      <div ref={host} className="absolute inset-0" role="img" aria-label={`Modelo 3D ${nome}`} />
      {estado === "carregando" ? <div className="absolute inset-0 grid place-items-center bg-hoikos-950/50 text-sm text-white" role="status"><p className="flex items-center gap-2"><LoaderCircle className="animate-spin" />{progresso}</p></div> : null}
      {estado === "erro" ? <div className="absolute inset-0 grid place-items-center bg-white p-6 text-center" role="alert"><div><p className="font-medium">Não foi possível exibir o modelo</p><p className="mt-2 max-w-md text-sm text-hoikos-500">{erro}</p></div></div> : null}
    </div>
  </div>;
}
