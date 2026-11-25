# Cómo está organizada la app (y cómo añadirle módulos)

La taberna de Jhon es una **mesa con módulos**. Hoy hay: Inventario, Alquimia, Lectura,
Compendio y Usuarios en línea. La idea es ir sumando más (cocina, ficha de personaje,
armas y sus efectos, y algún día mapas) sin tocar lo que ya funciona.

## Las piezas

| Capa | Archivos | Qué hace |
|---|---|---|
| Núcleo | `js/app.js`, `js/modulos.js`, `js/state.js`, `js/sync.js`, `js/auth.js`, `js/panel.js` | Arranque, registro de módulos, pestañas y tarjetas de la mesa, estado, guardado (local o servidor), cuentas y usuarios en línea |
| Servidor | `servidor.py` | Web + base de datos SQLite con transacciones todo-o-nada, cuentas, roles (jugador, DM, superusuario) y permisos |
| Inventario | `js/render.js`, `js/form.js`, `js/dm.js` | Materiales, pociones, botín; herramientas del DM |
| Alquimia | `js/data.js`, `js/model.js`, `js/crafting.js`, `js/cauldron.js`, `js/niveles.js`, `js/diario.js` | Reglas de pociones, caldero, niveles de alquimia y diario de Jhon Arbaquel |
| Lectura | `js/lectura.js` | Libros, progreso, descansos y tiradas de comprensión |

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
});
```

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

## Roles

| Rol | Quién | Puede |
|---|---|---|
| Jugador | Cualquier cuenta | Su inventario, sus libros, elaborar hasta su nivel de alquimia |
| DM (👑) | La primera cuenta, o quien nombre el superusuario | Lo anterior + inventarios, libros (tiradas y CD) y nivel de alquimia de todos |
| Superusuario «DM» (🛡️) | La cuenta `DM`, contraseña fija `ALQUIMIA_ADMIN` | Lo anterior + dar/quitar DM, desterrar y readmitir cuentas |

En el navegador se pregunta con `auth.esDM()` (DM o superusuario) y `auth.esAdmin()`.
El servidor lo vuelve a comprobar siempre: la interfaz solo esconde botones.

## Niveles de alquimia

Todo el reparto está en la tabla `NIVELES` de `js/niveles.js`. Cada nivel añade disolventes,
polaridades de reactivo por campo, clases de modificador, modos de crafteo y aplicaciones; el
último (`todo: true`) lo desbloquea todo. El resto de la app solo pregunta a `disolventeOk()`,
`reactivoOk()`, `modOk()`, `modoOk()` y `aplicOk()`. Los textos del diario están en `js/diario.js`
(una página por nivel); la lista «Lo que ahora sabes hacer» se genera sola desde la tabla.
