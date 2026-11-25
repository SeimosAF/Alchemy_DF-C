# Cómo está organizada la app (y cómo añadirle módulos)

La taberna de Jhon es una **mesa con módulos**. Hoy hay: Inventario, Alquimia, Lectura,
Compendio y Usuarios en línea. La idea es ir sumando más (cocina, ficha de personaje,
armas y sus efectos, y algún día mapas) sin tocar lo que ya funciona.

## Las piezas

| Capa | Archivos | Qué hace |
|---|---|---|
| Núcleo | `js/app.js`, `js/modulos.js`, `js/state.js`, `js/sync.js`, `js/auth.js`, `js/panel.js` | Arranque, registro de módulos, pestañas y tarjetas de la mesa, estado, guardado (local o servidor), cuentas y usuarios en línea |
| Servidor | `servidor.py` | Web + base de datos SQLite con transacciones todo-o-nada, cuentas, campañas, roles (jugador, DM, superusuario), disciplinas y permisos |
| Inventario | `js/render.js`, `js/form.js`, `js/dm.js` | Materiales, pociones, botín; herramientas del DM |
| Alquimia | `js/data.js`, `js/model.js`, `js/crafting.js`, `js/cauldron.js`, `js/niveles.js`, `js/diario.js` | Reglas de pociones, caldero, niveles de alquimia y diario de Jhon Arbaquel |
| Lectura | `js/lectura.js` | Libros, progreso, descansos y tiradas de comprensión |
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
  jugador (en Perfil o en la barra de arriba) y el DM o el superusuario el de cualquiera de su campaña.
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
