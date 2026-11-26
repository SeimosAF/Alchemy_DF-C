# Usar la app entre varias personas

La app puede funcionar de dos formas. Ella sola detecta cuál toca:

| Cómo la abres | Dónde se guardan los datos | Se comparte |
|---|---|---|
| `iniciar.bat` / `python servidor.py` | En el servidor, archivo `datos/alquimia.db` | Sí, con todo el que entre a esa dirección |
| Sin servidor (por ejemplo `npx http-server`) | En el navegador, como siempre | No |

Arriba a la derecha se ve el modo: **🟢 Conectado**, **🟡 Guardando…**,
**🔴 Sin conexión** o **💾 Solo este navegador**.

## Cuentas: entrar con usuario y contraseña

Con servidor, lo primero que aparece es un pergamino para **Entrar** o **Crear cuenta**.

- **La primera cuenta que se crea es la del DM** (👑) de la primera campaña. Créala tú antes que nadie.
- **Campañas:** cada campaña (mesa) tiene su catálogo, inventarios, libros y niveles, sin mezclarse.
  El superusuario las crea (en «En línea», abajo) y nombra a su DM; el DM **invita** a los jugadores
  desde «En línea». Una cuenta nueva no está en ninguna campaña hasta que la inviten. Si alguien
  juega en varias, elige mesa al entrar (y la cambia con el botón 🗺️ de arriba).
- **Historial de cambios:** cada campaña apunta quién cambió qué y cuándo (inventarios, catálogo,
  parámetros, niveles, libros, perfiles, disciplinas, jugadores y DM). Lo ven el DM y el superusuario al
  final de «En línea». Nadie puede borrarlo desde la app. Solo el superusuario puede **deshacer** un
  cambio, y solo si nadie ha tocado después lo mismo (si no, se deshacen antes los posteriores).
  Deshacer también queda apuntado. El historial empieza a llenarse desde esta versión.
- **Fallos de la palabra de paso:** si alguien falla 7 veces seguidas la palabra de paso al crear cuenta,
  desde ese sitio (su IP) no se pueden crear cuentas durante 24 h. Entrar con una cuenta ya creada sigue
  funcionando. El superusuario lo ve y lo levanta en «En línea» → Campañas («🔒 Creación de cuentas
  bloqueada»), o desde la consola con `python servidor.py desbloquear`.
- **Contraseña de mesa (opcional):** el DM o el superusuario la ponen en «En línea». Quien sepa el
  nombre de la mesa y su contraseña se une solo desde la pantalla de elegir mesa.
- **Perfil:** cada jugador tiene un personaje por campaña (pestaña 🧙 Perfil). El DM puede editar el de
  los demás, pero nadie puede cambiar el nombre de usuario de una cuenta.
- **Disciplinas:** el DM asigna a cada jugador alquimista, cocinero, hechicero o herrero (en «En línea»).
  También puede dejarlo **desempleado** (ningún oficio: la tarjeta del oficio sale vacía) o hacerlo
  **pluriempleado** (todos los oficios: en la mesa elige con unos botones cuál usa; se recuerda en su navegador).
  Su tarjeta de oficio en la mesa cambia según la disciplina. De momento solo Alquimia está hecha;
  las demás salen como «Próximamente».
- Las contraseñas se guardan cifradas (PBKDF2-SHA256 con sal): ni el servidor las conoce.
- Si `ALQUIMIA_CLAVE` está puesta, hace falta esa **palabra de paso de la mesa** para crear
  una cuenta (también la primera). Para entrar después solo hace falta la contraseña de cada uno.
- La sesión se recuerda en el navegador 30 días. El botón 🚪 cierra la sesión.
- Tras entrar aparece **la mesa** con cuatro tarjetas: **Inventario** (materiales, pociones, botín
  y libros), **Alquimia** (el caldero, con tu nivel y el diario de Jhon Arbaquel), **Lectura**
  (tus libros y lo que llevas leído) y **Usuarios en línea** (quién está conectado y en qué parte
  de la app anda). El **Compendio** (catálogo de materiales y de pociones, identificación y
  parámetros) está en su pestaña y en un botón de Alquimia.

### El superusuario «DM»

Hay una cuenta especial que se llama **DM** (🛡️ Superusuario). No se crea a mano: el servidor
la crea solo al arrancar con la contraseña que pongas en `ALQUIMIA_ADMIN` (archivo `.env`).
Esa contraseña es **fija**: para cambiarla, cambia `ALQUIMIA_ADMIN` y reinicia el servidor
(`docker-iniciar.bat`). Si `ALQUIMIA_ADMIN` está vacía, el superusuario no puede entrar.

Entra con nombre `DM` y esa contraseña. Puede todo lo que puede un DM y además, en
**Usuarios en línea**:

- **👑 Hacer DM / Quitar DM** a cualquier cuenta (solo él puede hacerlo).
- **🚫 Desterrar** una cuenta: se le cierra la sesión al momento y no puede volver a entrar.
  Sus datos no se borran. Las cuentas desterradas solo las ve el superusuario, con el botón
  **🕊️ Readmitir**. También desde la consola: `python servidor.py readmitir NOMBRE`.

El superusuario no es un personaje: no aparece en «Inventarios de la mesa».

### El DM

- En **Inventario → 👑 Inventarios de la mesa** elige un jugador y cambia su inventario:
  +1 / −1, escribir la cantidad exacta, dar o quitar pociones y dar botín sin identificar.
  Cada cambio es una transacción como las demás: se aplica entera o nada, nunca deja
  nada por debajo de 0, y si el jugador cambió esa cantidad justo a la vez, se rechaza en
  vez de pisarla.
- En ese mismo panel fija el **nivel de alquimia** de cada jugador (− / + Subir) y gestiona sus
  **libros**: darle uno nuevo, quitárselo y decir qué lecturas piden descanso largo y tirada
  de comprensión, con su CD (`casilla:CD`, por ejemplo `4:14, 8:16`). El jugador no ve la CD.
- En **Usuarios en línea** puede ponerle una contraseña nueva a quien la olvide y abrir su
  inventario, libros y nivel. Dar o quitar poderes de DM es cosa del superusuario.
- Solo el DM ve **Borrar todo** con servidor.
- Lo común a la mesa lo protege el servidor: un jugador puede **dar de alta** componentes,
  poner apodos a pociones y añadir tipos de daño, pero solo el DM (o el superusuario) puede
  **editar, identificar o borrar** componentes del catálogo, borrar fichas de pociones, quitar
  tipos de daño y cambiar los **parámetros**.

¿Se te olvidó la contraseña del DM? En la carpeta del repo:

    python servidor.py restablecer Moisés NuevaContraseña

y con Docker:

    docker compose exec app python servidor.py restablecer Moisés NuevaContraseña

### Discord (V3.6)

Se entra **siempre con nombre y contraseña**. Si el servidor tiene `DISCORD_CLIENT_ID` y
`DISCORD_CLIENT_SECRET`, Discord sirve para dos cosas:

- **Crear cuenta sin la palabra de paso.** En «Crear cuenta» se escriben nombre y contraseña (dos veces)
  y, en lugar de la palabra de paso, se pulsa **Crear con Discord**. Cada cuenta de Discord solo puede
  crear **una** cuenta (eso frena la creación masiva), y la cuenta queda **pendiente**: no puede entrar
  hasta que un DM o el superusuario la apruebe en «En línea» (arriba sale «Cuentas de Discord esperando
  aprobación»). Al aprobarla se sienta en la mesa del DM que aprueba, como jugador alquimista. Si se
  rechaza, se borra. El DM recibe un aviso en cuanto llega una.
- **Vincular Discord** a una cuenta que ya existe: desde el Perfil, «Vincular con Discord».

La palabra de paso (`ALQUIMIA_CLAVE`) sigue igual: quien la tiene crea su cuenta al momento, sin Discord
ni aprobación. El botón de Discord solo sale si hay palabra de paso. El superusuario «DM» no se vincula.
CLI: `python servidor.py aprobar NOMBRE` aprueba una cuenta pendiente sin sentarla en ninguna mesa.

## Cómo se protegen los datos (como un banco)

Cada acción (elaborar, dar de alta un material, beber una poción...) se manda al
servidor como **una transacción**: una lista de cambios que se aplica **entera o nada**.

1. **Todo o nada.** Elaborar una poción gasta materiales y crea la poción en el
   mismo paquete. Si algo falla, no se gasta nada ni se crea nada.
2. **Nunca por debajo de cero.** El stock se manda como "resta 1" o "suma 3", no como
   "ahora hay 2". El servidor comprueba en el momento que hay suficiente; si no, rechaza.
3. **Uno detrás de otro.** El servidor aplica las transacciones de una en una
   (SQLite con `BEGIN IMMEDIATE`), así dos personas nunca gastan la misma unidad.
4. **"Como lo dejé".** Para cambios de fichas (editar un material, ajustes...) se manda
   cómo estaba antes. Si otra persona lo cambió entretanto, se rechaza en vez de pisarlo.
5. **Sin duplicados.** Cada transacción lleva un número único. Si se corta la conexión
   y el navegador la reenvía, el servidor no la aplica dos veces.
6. **Nada se pierde sin conexión.** Lo pendiente queda en cola (también si cierras la
   pestaña) y se reintenta solo.
7. **Queda apuntado.** Cada transacción confirmada se guarda en un libro de registro
   (`/api/diario`) con quién y cuándo.
8. **Copias de seguridad.** El servidor copia la base al arrancar y cada 24 h en
   `datos/copias/`, guardando las 7 últimas.

### El caso "alguien gastó mi material"

- Al pulsar **Elaborar**, la app pide al servidor lo último antes de tirar el dado. Si ya
  no queda el material, avisa y **no tira ni gasta nada**.
- Si aun así coinciden en el mismo segundo, el servidor rechaza la transacción, la app
  muestra **"⚠️ No se ha guardado"**, explica qué faltaba y quién lo cambió, y se pone al
  día con lo que hay de verdad.

Cambios distintos a la vez (tú elaboras, tu amigo da de alta un material) no chocan:
se aplican los dos y cada uno ve lo del otro en unos segundos, con un aviso abajo a la derecha.

## Qué es de cada persona

- **De cada jugador:** su inventario de materiales, sus pociones, su botín, sus libros (con lo
  que lleva leído) y su nivel de alquimia (este solo lo cambia el DM).
- **De toda la mesa:** el catálogo de materiales, las pociones descubiertas (con sus apodos)
  y los parámetros.
- El **personaje** (nombre, mod. INT, bono) se guarda en el navegador de cada cuenta.

Al pasar de la V3 a la versión con campañas, el servidor hace una copia
(`datos/copias/antes-de-campanas-....db`) y **todo lo que había pasa a «La primera campaña»**,
con las mismas cuentas, inventarios y DM. Con Docker, `docker-iniciar.bat` además saca antes una
copia a `datos\copias\ultima-antes-de-actualizar.db` en tu carpeta.

Al pasar de la versión sin cuentas a esta, el servidor hace una copia
(`datos/copias/antes-de-cuentas-....db`) y **el inventario que había pasa a ser del DM**
(la primera cuenta que se cree). Nada se pierde.

## Primera vez con el servidor

Si el servidor está vacío y tu navegador tiene datos de antes, la app pregunta si quieres
subirlos. Hazlo **tú primero**, antes de que entre nadie más. Si no te lo ofrece, abre la
app sin servidor, pulsa **Exportar**, arranca el servidor y pulsa **Importar**.

## Configuración (variables de entorno)

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `8080` | Puerto |
| `HOST` | `0.0.0.0` | Interfaz de red |
| `DB_PATH` | `./datos/alquimia.db` | Archivo de la base de datos (en Docker: `/data/alquimia.db`) |
| `ALQUIMIA_CLAVE` | vacía | Palabra de paso de la mesa para **crear cuentas**. **Ponla siempre si el servidor está en internet.** Vacía = cualquiera que llegue a la app puede crearse una cuenta |
| `ALQUIMIA_ADMIN` | vacía | Contraseña fija del superusuario **DM** (mínimo 6 caracteres). Vacía = no hay superusuario |
| `DISCORD_CLIENT_ID` | vacía | Aplicación de Discord para **Crear con Discord** y vincular (ver `docs/DISCORD.md`). Vacía = sin Discord |
| `DISCORD_CLIENT_SECRET` | vacía | Secreto de esa aplicación. Nunca sale del servidor |
| `ALQUIMIA_URL` | vacía | Dirección pública (p. ej. `https://TU-MAQUINA.TU-RED.ts.net`). Discord vuelve a `ALQUIMIA_URL/api/discord/vuelta`. Desde `localhost` se usa `http://localhost:8080` |

`GET /health` responde `{"ok": true}` para comprobar que el servidor está vivo.

Solo usa Python 3 con su biblioteca estándar: no hay que instalar nada más.
