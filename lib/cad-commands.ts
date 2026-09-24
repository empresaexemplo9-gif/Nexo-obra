import { documentoSchema, camadaBloqueada, type Documento, type Elemento } from "@/lib/prancheta";
import { lerMedida, paralelaDe, espelhar } from "@/lib/prancheta-cad";
import { rotation, scaling, transform, type Matrix, type Point } from "@/packages/cad-core";
import { executeCadCommand as executeLegacy, type CadCommandContext } from "@/lib/cad-commands-legacy";

export const CAD_COMMANDS = [
  { alias: "L", name: "LINE", syntax: "L 0,0 3000,0", description: "Linha por dois pontos" },
  { alias: "PL", name: "PLINE", syntax: "PL 0,0 @3000,0 @0,2000", description: "Polilinha por pontos" },
  { alias: "C", name: "CIRCLE", syntax: "C 1000,1000 500", description: "Círculo por centro e raio" },
  { alias: "DIM", name: "DIMENSION", syntax: "DIM 0,0 3000,0 500", description: "Cota linear" },
  { alias: "M", name: "MOVE", syntax: "M @1000,500", description: "Mover a seleção" },
  { alias: "CO", name: "COPY", syntax: "CO @1000,500", description: "Copiar a seleção" },
  { alias: "RO", name: "ROTATE", syntax: "RO 90 0,0", description: "Girar a seleção em torno de um ponto" },
  { alias: "SC", name: "SCALE", syntax: "SC 2 0,0", description: "Escalar a seleção em torno de um ponto" },
  { alias: "MI", name: "MIRROR", syntax: "MI 0,0 0,1000", description: "Espelhar pelo eixo indicado" },
  { alias: "O", name: "OFFSET", syntax: "O 200", description: "Criar paralela à seleção" },
  { alias: "T", name: "TEXT", syntax: "T 0,0 200 Sala de estar", description: "Inserir texto" },
  { alias: "U", name: "UNDO", syntax: "U", description: "Desfazer" },
  { alias: "REDO", name: "REDO", syntax: "REDO", description: "Refazer" },
  { alias: "Z", name: "ZOOM", syntax: "Z", description: "Enquadrar todo o desenho" },
  { alias: "REC", name: "RECTANG", syntax: "REC 0,0 4000,3000", description: "Retângulo por cantos opostos" },
  { alias: "A", name: "ARC", syntax: "A 0,0 1000 0 90", description: "Arco: centro, raio, início e varredura" },
  { alias: "EL", name: "ELLIPSE", syntax: "EL 0,0 2000 1000", description: "Elipse por centro e semieixos (polilinha)" },
  { alias: "POL", name: "POLYGON", syntax: "POL 6 0,0 1000", description: "Polígono regular por centro e raio" },
  { alias: "AR", name: "ARRAY", syntax: "AR 3 2 1000 1000", description: "Matriz retangular da seleção" },
  { alias: "AP", name: "ARRAYPOLAR", syntax: "AP 6 0,0 360", description: "Matriz polar da seleção" },
  { alias: "E", name: "ERASE", syntax: "E", description: "Apagar a seleção" },
  { alias: "J", name: "CLOSE", syntax: "J", description: "Fechar a polilinha selecionada" },
  { alias: "TR", name: "TRIM", syntax: "TR 2500,-1000 2500,1000 3800,0", description: "Aparar seleção pelo limite e ponto indicado" },
  { alias: "EX", name: "EXTEND", syntax: "EX 6000,-1000 6000,1000 3900,0", description: "Estender seleção até o limite" },
] as const;

function point(text: string | undefined, previous?: Point): Point {
  if (!text) throw new Error("Informe um ponto x,y em milímetros.");
  if (text.startsWith("@") || text.includes("<")) {
    if (!previous) throw new Error("A coordenada relativa precisa de um ponto anterior.");
    if (text.includes("<")) {
      const parts = text.replace(/^@/, "").split("<");
      if (parts.length !== 2) throw new Error("Coordenada polar inválida.");
      const distance = number(parts[0]), angle = number(parts[1]) * Math.PI / 180;
      return { x: previous.x + distance * Math.cos(angle), y: previous.y - distance * Math.sin(angle) };
    }
    const delta = point(text.slice(1));
    return { x: previous.x + delta.x, y: previous.y + delta.y };
  }
  const parts = text.split(",");
  if (parts.length !== 2 || parts.some((part) => !part.trim())) throw new Error("Use x,y, com ponto para casas decimais.");
  const x = lerMedida(parts[0]), y = lerMedida(parts[1]);
  if (x === null || y === null || Math.abs(x) > 2e9 || Math.abs(y) > 2e9) throw new Error("Coordenada inválida ou fora do limite.");
  return { x: x || 0, y: -y || 0 };
}
function number(text: string | undefined): number {
  const value = text === undefined ? null : lerMedida(text);
  if (value === null || !Number.isFinite(value)) throw new Error("Informe uma medida válida.");
  return value;
}
function transformed(element: Elemento, matrix: Matrix, factor = 1, angle = 0): Elemento {
  const p = (value: Point) => transform(value, matrix);
  const rotationOf = (value: number) => ((value + angle) % 360 + 360) % 360;
  if (element.tipo === "parede") return { ...element, a: p(element.a), b: p(element.b), espessuraMm: element.espessuraMm * factor };
  if (element.tipo === "cota") return { ...element, a: p(element.a), b: p(element.b), deslocamentoMm: element.deslocamentoMm * factor };
  if (element.tipo === "traco" || element.tipo === "comodo") return { ...element, pontos: element.pontos.map(p) };
  if (element.tipo === "arco") return { ...element, centro: p(element.centro), raioMm: element.raioMm * factor, inicioGraus: rotationOf(element.inicioGraus) };
  if (element.tipo === "hachura") return { ...element, aneis: element.aneis.map((anel) => anel.map(p)) };
  if (element.tipo === "texto") return { ...element, posicao: p(element.posicao), alturaMm: element.alturaMm * factor, rotacaoGraus: ((element.rotacaoGraus - angle) % 360 + 360) % 360 };
  const result = { ...element, posicao: p(element.posicao), rotacaoGraus: ((element.rotacaoGraus - angle) % 360 + 360) % 360 };
  if ("larguraMm" in result) result.larguraMm *= factor;
  if ("alturaMm" in result) result.alturaMm *= factor;
  return result;
}
/** Camada onde o comando desenha: a escolhida na tela, se existir e estiver livre; senão a
 *  padrão do tipo de desenho; senão a primeira livre. Desenho vindo de DWG não tem as
 *  camadas "layout" e "anotacao", e o comando falhava sem dizer por quê. */
function camadaDoComando(document: Documento, preferida: string | undefined, padrao: string) {
  const livre = (id: string | undefined) => {
    const camada = id ? document.camadas.find((c) => c.id === id) : undefined;
    return camada && camada.visivel && !camada.bloqueada ? camada.id : null;
  };
  if (preferida && document.camadas.some((c) => c.id === preferida) && !livre(preferida)) throw new Error("A camada escolhida está travada ou oculta.");
  if (!preferida && document.camadas.some((c) => c.id === padrao) && !livre(padrao)) throw new Error("A camada de destino está bloqueada ou oculta.");
  return livre(preferida) ?? livre(padrao) ?? document.camadas.find((c) => c.visivel && !c.bloqueada)?.id ?? preferida ?? padrao;
}

type Result = { document: Documento; message: string; selectedId: string | null };
export function executeCadCommand(input: string, context: CadCommandContext): Result;
export function executeCadCommand(document: Documento, input: string, selectedId: string | null, id?: () => string, camada?: string): Result;
export function executeCadCommand(documentOrInput: Documento | string, inputOrContext: string | CadCommandContext, selectedId: string | null = null, id: () => string = () => crypto.randomUUID(), camadaEscolhida?: string): Result {
  if (typeof documentOrInput === "string") return executeLegacy(documentOrInput, inputOrContext as CadCommandContext);
  const document = documentOrInput;
  const input = inputOrContext as string;
  const desenho = () => camadaDoComando(document, camadaEscolhida, "layout");
  const anotacao = () => camadaDoComando(document, camadaEscolhida, "anotacao");
  const [raw, ...args] = input.trim().split(/\s+/);
  if (["TR", "TRIM", "EX", "EXTEND"].includes(raw.toUpperCase())) {
    if (args.length < 2 || args.length > 3) throw new Error("Use TR/EX x1,y1 x2,y2 [ponto].");
    return executeLegacy(input, { document, selectedId, layerId: camadaEscolhida ?? "layout", createId: id });
  }
  if (["RO", "ROTATE", "SC", "SCALE"].includes(raw.toUpperCase()) && args[0]?.includes(",")) args.reverse();
  const command = CAD_COMMANDS.find((c) => c.alias === raw.toUpperCase() || c.name === raw.toUpperCase());
  if (!command) throw new Error("Comando desconhecido. Consulte as sugestões abaixo do campo.");
  let added: Elemento | undefined;
  let changed: Elemento | undefined;
  let extras: Elemento[] = [];
  let deleted = false;
  const selected = document.elementos.find((e) => e.id === selectedId);
  const requireSelection = () => {
    if (!selected) throw new Error("Selecione um elemento antes de executar este comando.");
    if (camadaBloqueada(document, selected.camada)) throw new Error("A camada da seleção está bloqueada.");
    return selected;
  };
  const requireArgs = (count: number) => { if (args.length !== count) throw new Error(`Use: ${command.syntax}`); };
  const newId = id();
  switch (command.alias) {
    case "REC": { requireArgs(2); const a = point(args[0]), b = point(args[1], a); if (a.x === b.x || a.y === b.y) throw new Error("O retângulo precisa de largura e altura."); added = { id: newId, camada: desenho(), tipo: "traco", pontos: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a], espessuraMm: 1 }; break; }
    case "A": { requireArgs(4); const start = ((number(args[2]) % 360) + 360) % 360; added = { id: newId, camada: desenho(), tipo: "arco", centro: point(args[0]), raioMm: number(args[1]), inicioGraus: start, varreduraGraus: number(args[3]), espessuraMm: 1 }; break; }
    case "EL": case "POL": {
      requireArgs(3);
      const polygon = command.alias === "POL";
      const center = point(args[polygon ? 1 : 0]);
      const rx = number(args[polygon ? 2 : 1]), ry = polygon ? rx : number(args[2]);
      const count = polygon ? number(args[0]) : 128;
      if (rx <= 0 || ry <= 0 || !Number.isInteger(count) || count < 3 || count > 1000) throw new Error("Raios positivos e 3 a 1000 lados são necessários.");
      const points = Array.from({ length: count }, (_, i) => ({ x: center.x + rx * Math.cos(2 * Math.PI * i / count), y: center.y - ry * Math.sin(2 * Math.PI * i / count) }));
      added = { id: newId, camada: desenho(), tipo: "traco", pontos: [...points, points[0]], espessuraMm: 1 }; break;
    }
    case "AR": {
      requireArgs(4); const e = requireSelection(); const columns = number(args[0]), rows = number(args[1]), dx = number(args[2]), dy = number(args[3]);
      if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1 || columns * rows < 2 || columns * rows > 400 || (columns > 1 && dx === 0) || (rows > 1 && dy === 0)) throw new Error("Use 2 a 400 posições, contagens inteiras e passos não nulos.");
      for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) if (row || col) extras.push({ ...transformed(e, [1, 0, 0, 1, col * dx, -row * dy]), id: id() });
      break;
    }
    case "AP": {
      requireArgs(3); const e = requireSelection(); const count = number(args[0]), center = point(args[1]), sweep = number(args[2]);
      if (!Number.isInteger(count) || count < 2 || count > 400 || sweep === 0 || Math.abs(sweep) > 360) throw new Error("Use 2 a 400 posições e varredura até 360 graus.");
      const step = sweep / (Math.abs(sweep) === 360 ? count : count - 1);
      extras = Array.from({ length: count - 1 }, (_, i) => ({ ...transformed(e, rotation(step * (i + 1), center), 1, step * (i + 1)), id: id() })); break;
    }
    case "E": requireArgs(0); requireSelection(); deleted = true; break;
    case "J": { requireArgs(0); const e = requireSelection(); if (e.tipo !== "traco" || e.pontos.length < 3) throw new Error("Selecione uma polilinha com pelo menos três pontos."); const first = e.pontos[0], last = e.pontos.at(-1)!; if (first.x === last.x && first.y === last.y) throw new Error("A polilinha já está fechada."); changed = { ...e, pontos: [...e.pontos, first] }; break; }
    case "L": case "PL": {
      if (args.length < 2 || (command.alias === "L" && args.length !== 2)) throw new Error(`Use: ${command.syntax}`);
      const points: Point[] = [];
      for (const arg of args) points.push(point(arg, points.at(-1)));
      added = { id: newId, camada: desenho(), tipo: "traco", pontos: points, espessuraMm: 1 };
      break;
    }
    case "C": requireArgs(2); added = { id: newId, camada: desenho(), tipo: "arco", centro: point(args[0]), raioMm: number(args[1]), inicioGraus: 0, varreduraGraus: 360, espessuraMm: 1 }; break;
    case "DIM": { requireArgs(3); const a = point(args[0]); added = { id: newId, camada: anotacao(), tipo: "cota", a, b: point(args[1], a), deslocamentoMm: number(args[2]) }; break; }
    case "T": if (args.length < 3) throw new Error(`Use: ${command.syntax}`); added = { id: newId, camada: anotacao(), tipo: "texto", posicao: point(args[0]), alturaMm: number(args[1]), texto: args.slice(2).join(" "), rotacaoGraus: 0 }; break;
    case "M": case "CO": { requireArgs(1); const e = requireSelection(); const delta = point(args[0], { x: 0, y: 0 }); const moved = transformed(e, [1, 0, 0, 1, delta.x, delta.y]); if (command.alias === "M") changed = moved; else added = { ...moved, id: newId }; break; }
    case "RO": { requireArgs(2); const e = requireSelection(); const angle = number(args[0]); changed = transformed(e, rotation(angle, point(args[1])), 1, angle); break; }
    case "SC": { requireArgs(2); const e = requireSelection(); const factor = number(args[0]); changed = transformed(e, scaling(factor, point(args[1])), factor); break; }
    case "MI": { requireArgs(2); const e = requireSelection(); const a = point(args[0]), b = point(args[1], a); if (a.x === b.x && a.y === b.y) throw new Error("O eixo precisa de dois pontos diferentes."); const mirrored = espelhar(e, a, b); if (!mirrored) throw new Error("Não é possível espelhar esse elemento."); changed = mirrored; break; }
    case "O": { requireArgs(1); const e = requireSelection(); const result = paralelaDe(e, number(args[0])); if (!result) throw new Error("Não é possível criar uma paralela desse elemento."); added = { ...result, id: newId }; break; }
    default: throw new Error("Use os controles de histórico do editor.");
  }
  if (added && camadaBloqueada(document, added.camada)) throw new Error("A camada de destino está bloqueada.");
  const elements = deleted ? document.elementos.filter((e) => e.id !== selectedId) : added ? [...document.elementos, added] : document.elementos.map((e) => e.id === changed?.id ? changed : e);
  const candidate = { ...document, elementos: [...elements, ...extras] };
  const valid = documentoSchema.safeParse(candidate);
  if (!valid.success) throw new Error("O comando excede os limites de medida ou de elementos da prancha.");
  return { document: valid.data, selectedId: deleted ? null : added?.id ?? changed?.id ?? selectedId, message: `${command.name} concluído.${command.alias === "EL" ? " Elipse aproximada por 128 segmentos." : ""}` };
}
