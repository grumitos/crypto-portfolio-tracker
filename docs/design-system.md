# Sistema visual — Papel & Tinta

Referencia de intencion del rediseno de la interfaz. Los valores vivos estan en
`src/styles/variables.css`; este documento explica **por que** son esos y que
reglas deben respetar los cambios futuros.

## Las cuatro reglas

1. **Sin cajas anidadas.** La jerarquia se construye con espacio y filetes de 1px,
   no con bordes y sombras. Una tarjeta dentro de una tarjeta es un error de
   diseno, no una variante.
2. **Una sola superficie elevada por pantalla, como maximo.** Hoy son el panel de
   "Senal actual" de la calculadora y el modal de configuracion. Nada mas lleva
   sombra.
3. **Una cifra dominante por vista.** Cada vista tiene un unico heroe numerico en
   `--serif`; todo lo demas se subordina a el.
4. **Mismo esqueleto en las cinco vistas.** Barra superior, barra de contexto,
   heroe, riel de metricas, contenido. La homogeneidad sale de repetir esa
   estructura, no de repetir componentes.

## El color solo significa

El cromo es neutro por completo. Ningun color es decorativo: si algo tiene color,
es porque ese color comunica algo concreto.

| Rol | Significado | Claro | Oscuro |
| --- | --- | --- | --- |
| `--gain` | Ganancia, resultado positivo | `#2e7d5b` | `#5fbf8c` |
| `--loss` | Perdida, resultado negativo | `#b4453a` | `#e28470` |
| `--warn` | Breakeven, aviso, progreso aun no rentable | `#8f6416` | `#d6a44a` |
| `--focus` | Foco de teclado | `#3b72d9` | `#6c9be8` |
| `--cat-a` | Categoria A: buy low, deposito | `#35708f` | `#6fb0d4` |
| `--cat-b` | Categoria B: sell high, retiro | `#8c631f` | `#d9a94e` |

`--warn-fill` y `--gain-fill` son variantes mas claras para **rellenos graficos**
(la barra de progreso), donde el minimo de contraste es 3:1 y no 4.5:1. No las
uses para texto.

Los neutros son calidos y estan calculados para cumplir AA sobre su fondo:

| Token | Claro | Oscuro | Uso |
| --- | --- | --- | --- |
| `--bg` | `#faf9f7` | `#131312` | Fondo de pagina |
| `--surface` | `#ffffff` | `#1b1b19` | Superficie elevada |
| `--surface-2` | `#f2f1ec` | `#232320` | Panel, campo bloqueado, pista |
| `--line` | `#e5e3dc` | `#2c2c28` | Filete separador |
| `--line-2` | `#cfccc3` | `#3d3c37` | Filete de enfasis, borde de control |
| `--ink` | `#1a1a18` | `#f4f3ef` | Texto principal |
| `--ink-2` | `#5c5a53` | `#a5a29a` | Texto secundario |
| `--ink-3` | `#757269` | `#8a877e` | Etiquetas y texto atenuado |

`--ink-3` esta al limite de AA (4.6:1 en claro). Si se aclara, deja de cumplir.

## Tipografia

Tres familias, cada una con un trabajo:

- **`--sans` (Instrument Sans)** — interfaz: titulos, etiquetas, prosa, botones.
- **`--serif` (Newsreader 500)** — solo la cifra heroe de cada vista y la marca.
  Es el unico gesto editorial del sistema; usarlo en mas sitios lo arruina.
- **`--mono` (IBM Plex Mono)** — toda cifra tabular, con `tabular-nums`. Los
  numeros tienen que alinear sus decimales en columna.

| Uso | Familia | Tamano | Peso |
| --- | --- | --- | --- |
| Cifra heroe | serif | 50px | 500 |
| Valor de riel | mono | 19px | 500 |
| Titulo de vista | sans | 15px | 600 |
| Titulo de bloque | sans | 13.5px | 600 |
| Celda y cuerpo | sans | 13px | 400 |
| Dato tabular | mono | 13px | 400 |
| Etiqueta | sans | 12px | 500 (`--ink-3`) |

**La prosa nunca va en mono.** Si una frase mezcla texto y cifras, la frase va en
sans y solo la cifra se envuelve en `.num`.

## Medidas

- **Espaciado**: 8 · 16 · 24 · 32 · 48. Sin valores intermedios.
- **Radios**: 6 chip · 8 control · 12 panel · 16 modal · 999 pista.
- **Alturas de control**: 34 boton · 36 campo · 30 boton pequeno.
- **Ancho de contenido**: 1200px maximo, 32px de margen lateral.
- **Fila de tabla**: 13px de padding vertical.
- **Sombra**: solo en el modal (`--elevation`). En ningun otro sitio.

## Estados de carga

Los skeletons miden su altura en `em`, no en `rem`: tienen que escalar con la
cifra que sustituyen. Una altura fija deja una barra suelta dentro de la cifra
heroe y hace saltar el layout cuando llegan los datos.
