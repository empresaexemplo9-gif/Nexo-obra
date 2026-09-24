# Criador de layout

Planta com móveis, eletrodomésticos e veículos na medida real e prévia 3D gerada dela, para
mostrar ao cliente como o espaço vai ficar. Segue a permissão "Prancheta e projeto": leitura
abre e exporta; edição cria, altera e exclui.

Antes de usar em produção, aplique a migração `0024` em `/superadmin` → **Atualizar banco de
dados**.

## Desenhar

| Ferramenta | Atalho | Como |
| --- | --- | --- |
| Selecionar | V | Clique para editar; arraste itens; arraste o fundo para mover a vista |
| Parede | W | Clique canto a canto; ímã nas pontas e esquadro (Shift desliga); duplo clique ou Esc termina |
| Cômodo | C | Arraste um retângulo: paredes e piso saem juntos |
| Porta, janela, portão, vão | P, J, G | Clique sobre a parede |

R gira 90° (Shift+R ao contrário), setas movem 1 cm (Shift, 10 cm), Ctrl+D duplica, Delete
apaga, Ctrl+Z/Ctrl+Shift+Z desfazem e refazem, Ctrl+S salva. Paredes de cômodos vizinhos
não duplicam na divisa. Arrastar a ponta de uma parede leva junto os cantos ligados.

## Catálogo

121 itens em treze categorias, com a medida de mercado (cama queen 158 × 198 cm, sedã
180 × 460 cm, vaga 2,5 × 5 m, balcão americano a 1,10 m): sala e jantar, quarto, cozinha,
balcões e bancadas (americano, de cozinha, de bar, ilha gourmet e de atendimento, com
banquetas), alvenaria (balcão, bancada com cuba, bancada gourmet com churrasqueira, banco,
sofá, cama, mureta, floreira, estante com nichos e lareira), banheiro, lavanderia,
escritório, som e home cinema (caixas de teto, torre e parede, soundbar, subwoofer,
receiver, projetor, tela e poltronas de cinema), ar-condicionado (split, cassete, piso-teto
e condensadora), cortinas e persianas (tecido, blackout, voil, rolô, horizontal e vertical),
garagem e veículos (hatch, sedã, SUV, picape, esportivo, elétrico, minivan, moto, scooter,
bicicleta, carregador, bancada de ferramentas, estante de aço, vaga simples e dupla) e área
externa. Largura, profundidade, altura, rotação e cor são ajustáveis por item. Com rotação
0, a frente do item fica para baixo na planta.

### Acabamentos

Mesas, bancadas, balcões, marcenaria, lavatórios, tampos de alvenaria e persianas têm
acabamento escolhido no painel do item, entre os que a peça aceita: madeira, vidro,
mármore, granito, quartzo branco, laca, metal/inox e concreto. A planta mostra o veio, o
pontilhado ou o reflexo do acabamento; a prévia 3D usa textura (mármore com veio, granito
pontilhado, madeira tingida pela cor da peça) e vidro translúcido. Madeira e laca seguem a
cor escolhida; pedra, vidro e metal têm cor própria. O servidor recusa acabamento que a
peça não aceita — sofá de vidro, por exemplo. Itens de alvenaria usam a cor como cor do
reboco ou do tijolo.

## Saídas

- **Imagem 3D**: PNG 16:9 do ângulo atual da câmera.
- **Planta**: planta humanizada em PNG, sem grade nem seleção.
- **Prancha PDF**: A3 com título, obra, empresa, data, prévia 3D, planta, quadro de áreas e o
  aviso de imagem ilustrativa.

As três vão para a Prancheta (ligadas ao projeto do layout) e podem ser enviadas pela
Comunicação. Quem só tem leitura baixa o arquivo sem guardar.

## Limites

É uma maquete de volumes para estudo e proposta, montada com formas simples; não é render
fotorrealista nem substitui o projeto executivo. Não há telhado, escada, pavimentos nem
paredes inclinadas; cômodo fora do retângulo precisa das paredes desenhadas uma a uma, e o
piso sai retangular. Até 600 paredes, 300 aberturas, 120 cômodos e 1500 itens por layout.
