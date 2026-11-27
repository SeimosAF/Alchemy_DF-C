# Cómo está organizada la app (y cómo añadirle módulos)

La taberna de Jhon es una **mesa con módulos**. Hoy hay: Inventario, Alquimia, Lectura
y Usuarios en línea (el antiguo Compendio está ahora dentro de Alquimia). La idea es ir sumando más (cocina, ficha de personaje,
armas y sus efectos, y algún día mapas) sin tocar lo que ya funciona.

## Las piezas

| Capa | Archivos | Qué hace |
|---|---|---|
| Núcleo | `js/app.js`, `js/modulos.js`, `js/state.js`, `js/sync.js`, `js/auth.js`, `js/panel.js`, `js/cuenta.js`, `js/avatar.js` | Arranque, registro de módulos, pestañas y tarjetas de la mesa, estado, guardado (local o servidor), cuentas, usuarios en línea, menú de la cuenta y fotos de perfil |
| Servidor | `servidor.py` | Web + base de datos SQLite con transacciones todo-o-nada, cuentas, campañas, roles (jugador, DM, superusuario), disciplinas y permisos |
| Inventario | `js/inventario.js`, `js/objetos.js`, `js/bolsa.js`, `js/dm.js` | Una sola lista con todo lo que llevas (y dar cosas a otro jugador); herramientas del DM |
| Alquimia | `js/data.js`, `js/model.js`, `js/crafting.js`, `js/cauldron.js`, `js/render.js`, `js/form.js`, `js/odres.js`, `js/conocimiento.js`, `js/niveles.js`, `js/diario.js` | Caldero, catálogo de materiales, recetario, odres, alta de materiales y parámetros; niveles y diario de Jhon Arbaquel |
| Lectura | `js/lectura.js` | Alta de libros, progreso, descansos y tiradas de comprensión |
| Perfil | `js/perfil.js` | El personaje de cada jugador en cada campaña (nombre, raza, clase, nivel, mod. INT, bono, retrato, notas) |

## El registro de módulos (`js/modulos.js`)

La barra de pestañas y las tarjetas de la mesa **no están escritas a mano** en `index.html`:
salen de la lista de módulos registrados en `js/app.js`. Cada módulo dice:

```js
modulos.registrar({
  id: 'cocina',                 // su sección en index.html es <section id="tab-cocina">
  icono: '🍲', titulo: 'Cocina',
  lugar: 'cocina', lugarTxt: 'entre fogones',   // lo que se ve en «Usuarios en línea»
  tarjeta: { orden: 4, clase: 'tarjeta-cocina', texto: 'Guisos que dan fuerza' },  // o nada: sin tarjeta
  resumen: () => cocina.resumen(),              // texto de la tarjeta
  alMostrar() { cocina.render(); },             // al abrir la pestaña
  disciplina: 'cocinero',                       // opcional: solo lo ve quien tenga esta disciplina
});
```

Hoy Cocina, Hechicería y Herrería ya están registrados como **próximamente** (`proximamente: { texto }`):
su pestaña se crea sola con un cartel. Cuando se construya uno de verdad, se le quita `proximamente`,
se le da su `<section>` y su `js/…`, y listo.

## Receta: añadir un módulo nuevo (ejemplo: Cocina)

1. **Pantalla.** En `index.html`, una sección `<section id="tab-cocina" class="tab-content">…</section>`.
2. **Lógica.** Un archivo `js/cocina.js` con `render()`, `init()` y `resumen()`. Para guardar,
   cambia `state.<lo tuyo>` y llama a `saveState()`: la sincronización con el servidor es automática.
3. **Registro.** En `js/app.js`, `import * as cocina from './cocina.js'`, `modulos.registrar({...})`
   y `cocina.init()` en el arranque.
4. **Datos** (si el módulo guarda algo):
   - `js/state.js`: añade la colección vacía en `getDefaultState()` y en `normalizeState()`.
   - `js/sync.js`: añádela a `COLS` (normalmente `'obj'`).
   - `servidor.py`: añádela a `COLECCIONES` y, si es de cada jugador, a `POR_JUGADOR`.
   - Si hay campos que solo puede cambiar el DM, compruébalo en `permiso_jugador()` de `servidor.py`.
5. **Estilo.** Si tiene tarjeta, dale color en `style.css` (`.tarjeta-cocina { --acento: … }`).

## Campañas (mesas)

Cada campaña es una mesa aparte: su catálogo de materiales, sus pociones conocidas, sus parámetros
y, por cada jugador, su inventario, sus libros y su nivel. **No se mezcla nada entre campañas.**

- En la base de datos, cada fila de `entradas` y de `transacciones` lleva su `campana`. Las tablas
  `campanas` (id, nombre, rev) y `miembros` (campana, usuario, rol, disciplina) dicen quién juega dónde.
- El navegador manda la campaña elegida en la cabecera `X-Campana`. El servidor comprueba en cada
  petición que la cuenta juega en ella (función `actor_en_mesa()` de `servidor.py`).
- Al entrar: si la cuenta juega en una sola campaña, entra directa; si juega en varias, elige en el
  pergamino (`js/auth.js`). Con el botón 🗺️ de la cabecera se cambia de mesa.
- Al pasar de la V3 a esta versión, todo lo que había pasa a **«La primera campaña»** (id `primera`),
  con copia previa en `datos/copias/antes-de-campanas-FECHA.db`. Los DM siguen siendo DM en ella.

## Contraseña de la mesa y personajes

- Una campaña puede tener **contraseña** (la ponen el DM o el superusuario en «En línea»). Con ella,
  cualquiera con cuenta se une solo desde el pergamino de elegir mesa (nombre de la mesa + contraseña).
  Sin contraseña, solo se entra por invitación. Se guarda cifrada en `campanas.clave_hash`.
- El **personaje** es de cada jugador en cada campaña (`miembros.personaje`, JSON). Lo edita el propio
  jugador (en Perfil) y el DM o el superusuario el de cualquiera de su campaña.
  El nombre de usuario (la cuenta) no lo cambia nadie. En «En línea» se ve con qué personaje juega cada uno.

## Historial de cambios

Tabla `historial` (solo se añaden filas). Cada transacción guarda en `cambios` el valor de antes y de después
de cada entrada que tocó (también el stock que se borra en cascada al quitar un material del catálogo);
perfiles y disciplinas guardan su valor de antes y después en `miembros`. `deshacer()` en `servidor.py`
solo vuelve atrás si el valor actual sigue siendo el «después» (si no, rechaza). Invitar, sacar, dar DM,
contraseña de mesa y renombrar se apuntan, pero no se deshacen desde aquí. GET `/api/historial`
(DM y superusuario), POST `/api/historial/deshacer` (solo superusuario).

## Disciplinas (la ranura de oficio)

El DM asigna a cada jugador de su campaña una disciplina: ⚗️ alquimista (por defecto), 🍲 cocinero,
✨ hechicero o ⚒️ herrero. La segunda tarjeta de la mesa (y su pestaña) es la de su disciplina:
los módulos con `disciplina:` en `modulos.registrar` solo los ve quien la tiene. La disciplina se
guarda en `miembros.disciplina` (una por campaña) y llega al navegador en `auth.usuario.disciplina`.

## Roles

| Rol | Quién | Puede |
|---|---|---|
| Jugador | Cualquier cuenta invitada a una campaña | Su inventario, sus libros, elaborar hasta su nivel (en esa campaña) |
| DM (👑) de una campaña | La primera cuenta (en la primera campaña), o quien nombre el superusuario | Lo anterior + invitar y sacar jugadores, asignar disciplinas, inventarios, libros (tiradas y CD), nivel y lo común (catálogo, parámetros) **de su campaña** |
| Superusuario «DM» (🛡️) | La cuenta `DM`, contraseña fija `ALQUIMIA_ADMIN` | Entra en todas las campañas como DM + crear y renombrar campañas, dar/quitar DM, desterrar y readmitir cuentas |

Ser DM es **por campaña**: se puede ser DM en una y jugador en otra.

En el navegador se pregunta con `auth.esDM()` (DM o superusuario) y `auth.esAdmin()`.
El servidor lo vuelve a comprobar siempre: la interfaz solo esconde botones.

## Niveles de alquimia

Todo el reparto está en la tabla `NIVELES` de `js/niveles.js`. Cada nivel añade disolventes,
polaridades de reactivo por campo, clases de modificador, modos de crafteo y aplicaciones; el
último (`todo: true`) lo desbloquea todo. El resto de la app solo pregunta a `disolventeOk()`,
`reactivoOk()`, `modOk()`, `modoOk()` y `aplicOk()`. Los textos del diario están en `js/diario.js`
(una página por nivel); la lista «Lo que ahora sabes hacer» se genera sola desde la tabla.

## Cabecera y menú de la cuenta (V3.5)

Arriba solo quedan el título (vuelve a la mesa), la mesa en la que estás (pulsar = cambiar de mesa)
y el **icono de la cuenta** (`js/cuenta.js`). El icono lleva la foto o la inicial, un punto de color
con el estado de la conexión (verde conectado, amarillo guardando, rojo sin conexión; el cartel de
texto solo aparece si algo va mal) y el número de personas en línea. Su menú reúne: perfil, foto,
quién está en línea, cambiar de mesa, sonido, exportar/importar, borrar todo (DM), contraseña y
cerrar sesión. Las opciones usan los mismos `data-action` que el resto de la app (los atiende `app.js`).
Perfil y En línea siguen siendo módulos (`tab-perfil`, `tab-usuarios`) pero con `pestana: false`.
La barra Personaje / Mod. INT / Bono desapareció: esos datos se editan en Perfil.

## Fotos de perfil (V3.5)

La foto es de la **cuenta** (sale en todas sus mesas), no del personaje. `js/avatar.js` la recorta en
cuadrado y la reduce a 256×256 en el navegador (WebP o JPEG) antes de mandarla. El servidor
(`guardar_avatar` en `servidor.py`, tabla `avatares`) no abre la imagen: comprueba por sus primeros bytes
que es PNG, JPEG o WebP, que pesa ≤ 300 KB y que mide entre 16 y 512 px; nada de SVG ni GIF. La sirve en
GET `/api/avatar/<cuenta>` solo a quien ha entrado, con `nosniff` y `Content-Security-Policy: sandbox`.
POST `/api/yo/avatar` con `{imagen: dataURL}` o `{quitar: true}`; el superusuario puede quitar la de
cualquiera (`{usuario, quitar: true}`). `presencia`, `perfiles` y `/api/yo` llevan `avatar` (versión, 0 = sin foto).
Para pintar una foto en cualquier sitio: `avatar.html(clave, version, inicial, clases)`; se rellena sola.

## Buscadores y filtros (V3.5)

`js/filtros.js`. Encima de una lista se pone `<div class="filtros" data-filtros="NOMBRE" ...>` con las
opciones que quieras (`data-campos`, `data-sin-id`, `data-tipos`, `data-tengo`, `data-estados`,
`data-texto="texto de ayuda"`) y en `app.js` se dice qué función la repinta (`filtros.init({...})`).
La función que pinta usa `filtros.coincide(lista, ...textos)` (sin mayúsculas ni tildes, todas las palabras),
`filtros.campoOk()`, `filtros.estado(lista)` y al final `filtros.cuenta(lista, vistos, total)`.
Hoy hay filtros en Inventario (materiales, pociones, botín), Compendio (materiales y pociones) y En línea.
Un material sin identificar nunca sale al filtrar por campo: solo con «❔ Sin identificar».

## Inventario general: objetos (V3.5)

`js/objetos.js`, subpestaña «🎒 Objetos» del Inventario (la primera). Colección `objetos` por jugador
y campaña (`POR_JUGADOR` en `servidor.py`, `COLS` en `sync.js`), así que queda en el historial y se puede
deshacer como lo demás. El servidor comprueba la forma de cada objeto en `validar_objeto()` (campos
conocidos, textos acotados, cantidad 0–99999). Cada jugador gestiona los suyos; el DM los da, edita y
quita desde «Inventarios de la mesa (DM)».

Un objeto: `name, categoria, cantidad, rareza, valor, peso, descripcion, notas, sintonizacion, sintonizado,
equipado`, y tres bloques opcionales pensados para futuros módulos (fichas de armas, efectos):
`arma {dano, tipoDano, propiedades, bonif}`, `armadura {ca, tipo}`, `cargas {actual, max, recarga}`.
Para añadir un campo nuevo: tocar el formulario de `editor()` en objetos.js y `OBJ_TEXTO`/`OBJ_SUB` en servidor.py.

## V3.8: cada cosa en su zona, odres, inventario único y catálogo por descubrimiento

**Dónde está cada cosa.** Alquimia tiene subpestañas: 🔥 Caldero · 🗃️ Materiales (catálogo) · 📚 Recetario ·
🫙 Odres · ➕ Alta de materiales y ⚙️ Parámetros (estas dos, solo DM o sin servidor). Lectura tiene el alta de libros
(abajo) y cada libro su ✏️ y 🗑️. El Inventario es **una sola lista** con secciones (objetos, materiales, pociones,
botín, libros, odres), un buscador y filtros por clase, por oficio y «✨ Mágico». El DM sigue teniendo
«👑 Inventarios de la mesa». El DM ve siempre la pestaña de Alquimia aunque su disciplina sea otra (`modulos.setDM`).

**Odres** (`js/odres.js`, colección `odres` por jugador). El agua no se lleva; azogue, polvo etéreo y esencia mágica
van en odres `{ name, capacidad, litros, disolvente }` (litros de medio en medio). Cada elaboración gasta 0,5 L
(también si sale mal) del odre de ese disolvente que menos tenga. Sin litros, ese disolvente sale bloqueado en el caldero.
Cada jugador empieza con un odre vacío de 3 L: lo crea el servidor la primera vez que entra en la mesa
(`dar_odre_inicial`, una sola vez por campaña: marca en la tabla `ajustes`). Un jugador solo puede gastar o tirar sus
odres; llenarlos, darlos y cambiarlos es cosa del DM (`permiso_jugador`). Sin servidor, se llenan desde Alquimia → Odres.

**Dar cosas a otro jugador** (op `{t:'dar', c, id, u, n}` de `/api/transaccion`, función `dar()` de `servidor.py`).
Vale para materiales, pociones, botín, objetos (también una parte de la cantidad), libros (quien lo recibe empieza a
leerlo desde el principio), odres y monedas. Se quita al que lo da y se pone al que lo recibe en la misma transacción:
o pasa todo o nada. Queda en el historial y se puede deshacer como lo demás.

**Catálogo por descubrimiento** (`js/conocimiento.js`, colección común `descubrimientos`: material → {jugador: fecha}).
Solo el DM da de alta materiales (el servidor rechaza el alta de un jugador). Un material no sale en el catálogo de
un jugador hasta que le llega por primera vez: lo apunta el servidor cada vez que suma stock a un jugador que no es DM
(`descubrir()`), ya se lo dé el DM o se lo pase otro jugador. Nadie puede escribir esa colección a mano. Al pasar a
la V3.8, lo que ya llevaba cada jugador cuenta como descubierto (`migrar_descubrimientos`, una vez).
La marca **🙈 Desconocido** (`unknown` del material) ya no esconde la ficha al DM: la rellena entera y los jugadores
ven solo nombre y lugar, no pueden usarlo en el caldero ni compararlo al identificar botín, hasta que la quite.
El DM ve en Alquimia → Materiales «🆕 Sin dar a nadie» / «👥 Lo conocen N» y puede filtrar por ellos, y en los
inventarios de la mesa, «🆕 nuevo para …» en los materiales que ese jugador aún no conoce.

**Quien no es alquimista** (ni pluriempleado ni DM) ve los materiales alquímicos de su inventario como
«Material alquímico», sin nombre ni efectos; puede tirarlos o dárselos a otro.

## V3.8: recuperar la contraseña por correo

Todo está en `servidor.py`, bloque «correo»: columnas `usuarios.correo` (confirmado) y
`usuarios.correo_pendiente`, tabla `enlaces_correo` (huella del token, tipo `recuperar` o `verificar`,
caducidad). Rutas sin sesión: `POST /api/recuperar`, `/api/recuperar/nueva`, `/api/correo/verificar`;
con sesión: `POST /api/yo/correo`. En el navegador, `js/auth.js` (modos `olvido` y `nueva` del pergamino,
enlaces `#recuperar=` y `#verificar=`) y `js/perfil.js` (caja del correo). Configuración y medidas de
seguridad en `docs/CORREO.md`.

## V3.8: solicitudes de campaña

Un jugador pide una campaña desde el selector de campañas (`js/auth.js`, «📜 Pedir una campaña nueva»); solo puede
tener una pendiente a la vez (índice único en `solicitudes_campana`). El superusuario la ve en «Quién está en línea»
(`js/panel.js`, «📨 Solicitudes de campaña») y la aprueba (se crea con el catálogo vacío y quien la pidió es su DM)
o la rechaza con un motivo. Se avisa por correo si la cuenta lo tiene confirmado. Rutas: `POST /api/campanas/solicitar`,
`/api/campanas/solicitud/cancelar` y `/api/campanas/solicitud/resolver` (solo superusuario).
