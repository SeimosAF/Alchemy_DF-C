# servidor.py — servidor de la app de alquimia (web + base de datos compartida).
#
# Sirve la app (index.html, js/, style.css) y una API bajo /api/ que guarda los
# datos en SQLite. Varias personas pueden usar la app a la vez: cada cambio es
# una TRANSACCIÓN, como en un banco. O se aplica entera o no se aplica nada.
#
# Cada persona entra con su cuenta (usuario + contraseña). Las cuentas juegan en
# CAMPAÑAS (mesas) separadas: cada campaña tiene su catálogo de materiales, sus
# pociones descubiertas, sus parámetros y, por cada jugador, su inventario, sus
# libros y su nivel. Nada se mezcla entre campañas.
# En cada campaña hay DM (Dungeon Master) y jugadores. El DM invita a jugadores,
# les asigna disciplina (alquimista, cocinero, hechicero, herrero) y puede ver y
# cambiar el inventario de cualquier jugador DE SU CAMPAÑA.
# La primera cuenta que se crea es la del DM de la primera campaña.
#
# Además existe un SUPERUSUARIO llamado «DM» (el administrador). Su contraseña es
# fija: la que ponga ALQUIMIA_ADMIN en el archivo .env (se vuelve a fijar cada vez
# que arranca el servidor). Puede entrar en todas las campañas con poderes de DM,
# crear campañas, dar o quitar poderes de DM, y desterrar (banear) o readmitir cuentas.
#
#   python servidor.py            -> http://localhost:8080
#   python servidor.py 9000       -> otro puerto
#   python servidor.py restablecer NOMBRE NUEVA_CONTRASEÑA
#                                 -> cambia la contraseña de una cuenta (si se olvida)
#   python servidor.py hacer-dm NOMBRE [CAMPAÑA]
#                                 -> convierte una cuenta en DM de una campaña (por defecto, la primera)
#   python servidor.py readmitir NOMBRE
#                                 -> levanta el destierro (baneo) de una cuenta
#
# Variables de entorno (opcionales; pensadas también para Docker):
#   PORT            puerto (por defecto 8080; el argumento de la línea de órdenes manda)
#   HOST            interfaz de red (por defecto 0.0.0.0 = acepta conexiones de fuera)
#   DB_PATH         archivo de la base de datos (por defecto ./datos/alquimia.db)
#   ALQUIMIA_CLAVE  "palabra de paso" de la mesa: hace falta para CREAR una cuenta.
#                   Vacía = cualquiera que llegue a la app puede crearse una cuenta
#                   (vale en casa; ponla siempre si el servidor está en internet).
#                   Para entrar con una cuenta ya creada solo hace falta su contraseña.
#   ALQUIMIA_ADMIN  contraseña fija del superusuario «DM». Vacía = no hay superusuario.
#
# Solo usa la biblioteca estándar de Python 3: no hace falta instalar nada.

import base64, binascii, http.server, ipaddress, json, os, sqlite3, sys, threading, time, hmac, hashlib, secrets, re, unicodedata
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs, unquote

RAIZ = os.path.dirname(os.path.abspath(__file__))
PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else int(os.environ.get('PORT', '8080'))
HOST = os.environ.get('HOST', '0.0.0.0')
DB_PATH = os.environ.get('DB_PATH') or os.path.join(RAIZ, 'datos', 'alquimia.db')
CLAVE = os.environ.get('ALQUIMIA_CLAVE', '')
ADMIN_CLAVE = os.environ.get('ALQUIMIA_ADMIN', '')
ADMIN_NOMBRE = 'DM'               # el superusuario se llama así (su clave es 'dm')
MAX_CUERPO = 5 * 1024 * 1024      # 5 MB por petición, de sobra para un import completo
FALLOS_REGISTRO = 7               # fallos SEGUIDOS de la palabra de paso que bloquean crear cuentas
HORAS_BLOQUEO = 24                # ...durante este tiempo (o hasta que el superusuario lo levante)

# Tipo de cada colección. El servidor manda: el cliente no puede cambiarlo.
#   num -> número entero que no puede bajar de 0 (stock de materiales)
#   qty -> objeto con campo qty que no puede bajar de 0 (pilas de pociones)
#   obj -> objeto que se reemplaza entero, comprobando que nadie lo cambió antes
COLECCIONES = {
    'inventory': 'num',
    'potions': 'qty',
    'lootPotions': 'qty',
    'catalog': 'obj',
    'potionCatalog': 'obj',
    'meta': 'obj',          # settings, damageTypes, version
    'libros': 'obj',        # libros del inventario y cuánto se ha leído de cada uno
    'perfil': 'obj',        # progreso del personaje que fija el DM (p. ej. nivel de alquimia)
    'objetos': 'obj',       # inventario general: armas, armaduras, objetos mágicos, equipo... (V3.5)
}
# Estas son de cada jugador; las demás, de toda la mesa.
# Un módulo nuevo (cocina, ficha...) que guarde cosas de cada jugador se añade aquí.
POR_JUGADOR = ('inventory', 'potions', 'lootPotions', 'libros', 'perfil', 'objetos')
COMUN = ''   # "dueño" de lo que es de toda la mesa

# Campañas (mesas). Todo lo que hay en «entradas» y «transacciones» es de una campaña.
PRIMERA = 'primera'               # id de la primera campaña (la de los datos de antes de las campañas)
NOMBRE_PRIMERA = 'La primera campaña'
# Disciplinas que el DM asigna a cada jugador. Por defecto, todos alquimistas.
DISCIPLINAS = ('alquimista', 'cocinero', 'hechicero', 'herrero')
DISCIPLINA_DEFECTO = 'alquimista'

ITERACIONES = 200_000             # PBKDF2-SHA256 para las contraseñas
DIAS_SESION = 30                  # una sesión sin usar caduca a los 30 días
EN_LINEA_S = 12                   # visto hace menos de esto y con la pestaña delante = en línea
AUSENTE_S = 75                    # visto hace menos de esto = ausente (pestaña en segundo plano)

# Un único escritor a la vez dentro de este proceso. SQLite además bloquea con
# BEGIN IMMEDIATE, así que aunque hubiera dos procesos seguiría siendo seguro.
CERROJO = threading.Lock()


class Rechazo(Exception):
    """La transacción no se puede aplicar. Se deshace entera."""
    def __init__(self, motivo, mensaje, detalle=None):
        super().__init__(mensaje)
        self.motivo, self.mensaje, self.detalle = motivo, mensaje, detalle or {}


# ---------------------------------------------------------------- base de datos
def conectar():
    con = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)  # transacciones a mano
    con.execute('PRAGMA journal_mode=WAL')
    con.execute('PRAGMA synchronous=FULL')     # durabilidad: no confirma hasta escribir en disco
    con.execute('PRAGMA foreign_keys=ON')
    return con


def preparar_bd():
    os.makedirs(os.path.dirname(DB_PATH) or '.', exist_ok=True)
    con = conectar()
    try:
        antigua = con.execute("SELECT 1 FROM sqlite_master WHERE name='entradas'").fetchone()
        columnas = [f[1] for f in con.execute('PRAGMA table_info(entradas)')] if antigua else []
        if antigua and 'dueno' not in columnas:
            # Base de antes de las cuentas: se copia por si acaso y se pasa al formato nuevo.
            con.close()
            hacer_copia('antes-de-cuentas')
            con = conectar()
            con.execute('BEGIN IMMEDIATE')
            # Sentencia a sentencia dentro de una transacción: o se pasa todo o nada.
            con.execute('''CREATE TABLE entradas_nueva (
                    col TEXT NOT NULL, dueno TEXT NOT NULL DEFAULT '', id TEXT NOT NULL, valor TEXT NOT NULL,
                    autor TEXT, cambiado TEXT, rev INTEGER,
                    PRIMARY KEY (col, dueno, id))''')
            con.execute("INSERT INTO entradas_nueva SELECT col, '', id, valor, autor, cambiado, rev FROM entradas")
            con.execute('DROP TABLE entradas')
            con.execute('ALTER TABLE entradas_nueva RENAME TO entradas')
            con.execute('COMMIT')
            print('Base de datos pasada al formato con cuentas. El inventario que había será del DM.')
        nueva_bd = not con.execute("SELECT 1 FROM sqlite_master WHERE name='entradas'").fetchone()
        con.executescript('''
            CREATE TABLE IF NOT EXISTS entradas (
                campana TEXT NOT NULL, col TEXT NOT NULL, dueno TEXT NOT NULL DEFAULT '', id TEXT NOT NULL, valor TEXT NOT NULL,
                autor TEXT, cambiado TEXT, rev INTEGER,
                PRIMARY KEY (campana, col, dueno, id));
            CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT);
            -- El "libro de cuentas": cada transacción confirmada queda apuntada aquí.
            -- También evita aplicar dos veces la misma si el navegador reintenta.
            CREATE TABLE IF NOT EXISTS transacciones (
                id TEXT PRIMARY KEY, rev INTEGER NOT NULL, autor TEXT, fecha TEXT,
                resumen TEXT, ops TEXT, campana TEXT);
            -- Cuentas. "clave" es el nombre en minúsculas y sin espacios de sobra.
            CREATE TABLE IF NOT EXISTS usuarios (
                clave TEXT PRIMARY KEY, nombre TEXT NOT NULL, hash TEXT NOT NULL,
                rol TEXT NOT NULL DEFAULT 'jugador', creado TEXT);
            -- Sesiones abiertas. Se guarda el hash del token, nunca el token.
            CREATE TABLE IF NOT EXISTS sesiones (
                token TEXT PRIMARY KEY, usuario TEXT NOT NULL, creada TEXT, vista REAL);
            INSERT OR IGNORE INTO ajustes VALUES ('rev', '0');
            -- Campañas (mesas): cada una con su propio contador de revisiones.
            CREATE TABLE IF NOT EXISTS campanas (
                id TEXT PRIMARY KEY, nombre TEXT NOT NULL, creada TEXT, rev INTEGER NOT NULL DEFAULT 0,
                clave_hash TEXT);
            -- Quién juega en cada campaña, con qué papel (dm / jugador) y con qué disciplina.
            -- HISTORIAL de cada campaña: quién cambió qué y cuándo, con lo que había antes (para deshacer).
            -- Solo se añaden filas: no hay forma de borrarlo ni editarlo desde la app.
            CREATE TABLE IF NOT EXISTS historial (
                id INTEGER PRIMARY KEY AUTOINCREMENT, campana TEXT NOT NULL, fecha TEXT, autor TEXT, autor_nombre TEXT,
                tipo TEXT, resumen TEXT, afecta TEXT, cambios TEXT, deshecho_por INTEGER);
            CREATE INDEX IF NOT EXISTS historial_campana ON historial (campana, id);
            -- Quien falla la palabra de paso de la mesa al crear cuenta: tras 7 fallos seguidos, bloqueado.
            CREATE TABLE IF NOT EXISTS bloqueos_registro (
                origen TEXT PRIMARY KEY, fallos INTEGER NOT NULL DEFAULT 0, ultimo REAL, hasta REAL);
            -- Foto de perfil de cada cuenta (V3.5). Llega ya recortada y pequeña desde el navegador;
            -- aquí solo se aceptan PNG, JPEG o WebP de hasta 512x512 px y 300 KB (ver guardar_avatar).
            CREATE TABLE IF NOT EXISTS avatares (
                usuario TEXT PRIMARY KEY, tipo TEXT NOT NULL, datos BLOB NOT NULL, version INTEGER NOT NULL, cambiado TEXT);
            CREATE TABLE IF NOT EXISTS miembros (
                campana TEXT NOT NULL, usuario TEXT NOT NULL, rol TEXT NOT NULL DEFAULT 'jugador',
                disciplina TEXT NOT NULL DEFAULT 'alquimista', unido TEXT, personaje TEXT,
                PRIMARY KEY (campana, usuario));
        ''')
        # Columnas añadidas después (V3.2): contraseña de la mesa y personaje de cada jugador en cada campaña
        if 'clave_hash' not in [f[1] for f in con.execute('PRAGMA table_info(campanas)')]:
            con.execute('ALTER TABLE campanas ADD COLUMN clave_hash TEXT')
        if 'personaje' not in [f[1] for f in con.execute('PRAGMA table_info(miembros)')]:
            con.execute('ALTER TABLE miembros ADD COLUMN personaje TEXT')
        if 'baneado' not in [f[1] for f in con.execute('PRAGMA table_info(usuarios)')]:
            con.execute('ALTER TABLE usuarios ADD COLUMN baneado INTEGER NOT NULL DEFAULT 0')
        if not nueva_bd and 'campana' not in [f[1] for f in con.execute('PRAGMA table_info(entradas)')]:
            con.close()
            con = None
            migrar_a_campanas()
            con = conectar()
        asegurar_admin(con)
        # Si ya hay DM pero quedan inventarios sin dueño (base vieja), son suyos.
        dm = con.execute("SELECT usuario FROM miembros WHERE campana=? AND rol='dm' ORDER BY unido LIMIT 1", (PRIMERA,)).fetchone()
        if dm:
            con.execute('BEGIN IMMEDIATE')
            adoptar_huerfanos(con, PRIMERA, dm[0])
            con.execute('COMMIT')
        con.execute('DELETE FROM sesiones WHERE vista < ?', (time.time() - DIAS_SESION * 86400,))
    finally:
        if con:
            con.close()


def migrar_a_campanas():
    """Base de antes de las campañas: todo lo que había pasa a «La primera campaña».
    Antes se hace una copia de seguridad (datos/copias/antes-de-campanas-FECHA.db).
    Todo en una sola transacción: o se pasa todo o no se toca nada."""
    hacer_copia('antes-de-campanas')
    con = conectar()
    try:
        con.execute('BEGIN IMMEDIATE')
        con.execute('''CREATE TABLE entradas_nueva (
                campana TEXT NOT NULL, col TEXT NOT NULL, dueno TEXT NOT NULL DEFAULT '', id TEXT NOT NULL, valor TEXT NOT NULL,
                autor TEXT, cambiado TEXT, rev INTEGER,
                PRIMARY KEY (campana, col, dueno, id))''')
        con.execute('INSERT INTO entradas_nueva (campana, col, dueno, id, valor, autor, cambiado, rev) '
                    'SELECT ?, col, dueno, id, valor, autor, cambiado, rev FROM entradas', (PRIMERA,))
        n = con.execute('SELECT COUNT(*) FROM entradas_nueva').fetchone()[0]
        if n != con.execute('SELECT COUNT(*) FROM entradas').fetchone()[0]:
            raise RuntimeError('La copia de las entradas no cuadra: no se cambia nada.')
        con.execute('DROP TABLE entradas')
        con.execute('ALTER TABLE entradas_nueva RENAME TO entradas')
        if 'campana' not in [f[1] for f in con.execute('PRAGMA table_info(transacciones)')]:
            con.execute('ALTER TABLE transacciones ADD COLUMN campana TEXT')
        con.execute('UPDATE transacciones SET campana=? WHERE campana IS NULL', (PRIMERA,))
        rev = int(con.execute("SELECT valor FROM ajustes WHERE clave='rev'").fetchone()[0])
        con.execute('INSERT OR IGNORE INTO campanas (id, nombre, creada, rev) VALUES (?,?,?,?)',
                    (PRIMERA, NOMBRE_PRIMERA, ahora(), rev))
        # Todas las cuentas que había juegan en la primera campaña; los DM siguen siendo DM.
        con.execute("INSERT OR IGNORE INTO miembros (campana, usuario, rol, disciplina, unido) "
                    "SELECT ?, clave, CASE rol WHEN 'dm' THEN 'dm' ELSE 'jugador' END, ?, creado FROM usuarios WHERE rol!='admin'",
                    (PRIMERA, DISCIPLINA_DEFECTO))
        con.execute('COMMIT')
        m = con.execute('SELECT COUNT(*) FROM miembros WHERE campana=?', (PRIMERA,)).fetchone()[0]
        print(f'Base de datos pasada a campañas: {n} entradas y {m} cuentas están ahora en «{NOMBRE_PRIMERA}».')
    except BaseException:
        if con.in_transaction:
            con.execute('ROLLBACK')
        raise
    finally:
        con.close()


def asegurar_admin(con):
    """Crea (o pone al día) el superusuario «DM» con la contraseña fija de ALQUIMIA_ADMIN."""
    clave = clave_de(ADMIN_NOMBRE)
    fila = con.execute('SELECT rol, hash FROM usuarios WHERE clave=?', (clave,)).fetchone()
    if not ADMIN_CLAVE:
        if fila and fila[0] == 'admin':
            print('Aviso: ALQUIMIA_ADMIN está vacía, así que el superusuario «DM» no puede entrar.')
        return
    if len(ADMIN_CLAVE) < 6:
        print('Aviso: ALQUIMIA_ADMIN debe tener al menos 6 caracteres. El superusuario «DM» queda desactivado.')
        return
    con.execute('BEGIN IMMEDIATE')
    if not fila:
        con.execute('INSERT INTO usuarios (clave, nombre, hash, rol, creado, baneado) VALUES (?,?,?,?,?,0)',
                    (clave, ADMIN_NOMBRE, hash_contrasena(ADMIN_CLAVE), 'admin', ahora()))
        print('Superusuario «DM» creado (contraseña: la de ALQUIMIA_ADMIN).')
    elif fila[0] != 'admin' or not comprobar_contrasena(ADMIN_CLAVE, fila[1]):
        if fila[0] != 'admin':
            print('Aviso: ya había una cuenta llamada «DM»; ahora es el superusuario.')
        con.execute("UPDATE usuarios SET rol='admin', hash=?, baneado=0, nombre=? WHERE clave=?",
                    (hash_contrasena(ADMIN_CLAVE), ADMIN_NOMBRE, clave))
        con.execute('DELETE FROM sesiones WHERE usuario=?', (clave,))   # la contraseña ha cambiado
    con.execute('COMMIT')


def es_dm(actor):
    """DM de la campaña en la que está o superusuario (actor de mesa: ver actor_en_mesa)."""
    return bool(actor) and actor.get('rol') in ('dm', 'admin')


def adoptar_huerfanos(con, camp, clave):
    """El inventario de antes de las cuentas (sin dueño) pasa a ser de esta cuenta."""
    marcas = ','.join('?' * len(POR_JUGADOR))
    n = con.execute(f"SELECT COUNT(*) FROM entradas WHERE campana=? AND dueno='' AND col IN ({marcas})", (camp, *POR_JUGADOR)).fetchone()[0]
    if n:
        con.execute(f"UPDATE entradas SET dueno=? WHERE campana=? AND dueno='' AND col IN ({marcas})", (clave, camp, *POR_JUGADOR))
        subir_rev(con, camp)
        print(f'{n} entradas de inventario de antes de las cuentas pasan a «{clave}».')


def rev_actual(con, camp):
    fila = con.execute('SELECT rev FROM campanas WHERE id=?', (camp,)).fetchone()
    return int(fila[0]) if fila else 0


def subir_rev(con, camp=None):
    """Algo ha cambiado en esta campaña (o en todas, sin camp): los navegadores se ponen al día."""
    if camp is None:
        con.execute('UPDATE campanas SET rev=rev+1')
    else:
        con.execute('UPDATE campanas SET rev=rev+1 WHERE id=?', (camp,))


def leer(con, camp, col, dueno, id_):
    fila = con.execute('SELECT valor, autor FROM entradas WHERE campana=? AND col=? AND dueno=? AND id=?',
                       (camp, col, dueno, id_)).fetchone()
    return (json.loads(fila[0]), fila[1]) if fila else (None, None)


def escribir(con, camp, col, dueno, id_, valor, autor, rev):
    if valor is None:
        con.execute('DELETE FROM entradas WHERE campana=? AND col=? AND dueno=? AND id=?', (camp, col, dueno, id_))
    else:
        con.execute('INSERT OR REPLACE INTO entradas (campana, col, dueno, id, valor, autor, cambiado, rev) VALUES (?,?,?,?,?,?,?,?)',
                    (camp, col, dueno, id_, json.dumps(valor, ensure_ascii=False), autor, ahora(), rev))


def estado_completo(con, camp, clave):
    """Lo común de la campaña + el inventario de esta persona en ella, con la forma de siempre."""
    datos = {c: {} for c in COLECCIONES}
    for col, id_, valor in con.execute('SELECT col, id, valor FROM entradas WHERE campana=? AND (dueno=? OR dueno=?)',
                                       (camp, COMUN, clave)):
        if col in datos:
            datos[col][id_] = json.loads(valor)
    return datos


def inventario_de(con, camp, clave):
    datos = {c: {} for c in POR_JUGADOR}
    for col, id_, valor in con.execute('SELECT col, id, valor FROM entradas WHERE campana=? AND dueno=?', (camp, clave)):
        if col in datos:
            datos[col][id_] = json.loads(valor)
    return datos


def ahora():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


# ------------------------------------------------------------------- cuentas
def clave_de(nombre):
    """Nombre -> clave única: sin mayúsculas, sin espacios de sobra, misma forma Unicode."""
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(nombre or '')).strip()).casefold()


NOMBRE_OK = re.compile(r"^[\w][\w .'\-]{1,23}$", re.UNICODE)


def hash_contrasena(contrasena, sal=None, it=ITERACIONES):
    sal = sal or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', contrasena.encode('utf-8'), bytes.fromhex(sal), it).hex()
    return f'pbkdf2_sha256${it}${sal}${h}'


def comprobar_contrasena(contrasena, guardado):
    try:
        _, it, sal, h = guardado.split('$')
        return hmac.compare_digest(hash_contrasena(contrasena, sal, int(it)).split('$')[3], h)
    except (ValueError, AttributeError):
        return False


# Para que comprobar una cuenta inexistente tarde lo mismo que una real
HASH_FALSO = hash_contrasena('no-existe')


def usuario_publico(fila):
    # Fuera de una campaña solo importa si es el superusuario; el papel (DM o jugador) es de cada campaña.
    return {'clave': fila[0], 'nombre': fila[1], 'rol': 'admin' if fila[2] == 'admin' else 'jugador'}


def buscar_usuario(con, clave):
    return con.execute('SELECT clave, nombre, rol, hash, baneado FROM usuarios WHERE clave=?', (clave,)).fetchone()


def hash_token(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def abrir_sesion(con, clave):
    token = secrets.token_urlsafe(32)
    con.execute('INSERT INTO sesiones VALUES (?,?,?,?)', (hash_token(token), clave, ahora(), time.time()))
    return token


def validar_contrasena(c):
    if not isinstance(c, str) or len(c) < 6:
        raise Rechazo('invalida', 'La contraseña debe tener al menos 6 caracteres.')
    if len(c) > 200:
        raise Rechazo('invalida', 'La contraseña es demasiado larga.')


def comprobar_palabra_de_paso(cuerpo, origen):
    """La palabra de paso de la mesa (ALQUIMIA_CLAVE) protege la creación de cuentas.
    Tras FALLOS_REGISTRO fallos SEGUIDOS desde el mismo origen, ese origen no puede crear cuentas
    durante HORAS_BLOQUEO horas (o hasta que el superusuario lo levante). Acertar pone el contador a 0.
    El contador se guarda en la base de datos: reiniciar el servidor no lo borra."""
    if not CLAVE:
        return

    def hacer(con):
        fila = con.execute('SELECT fallos, hasta FROM bloqueos_registro WHERE origen=?', (origen,)).fetchone()
        if fila and fila[1] and fila[1] > time.time():
            return 'bloqueado'
        if hmac.compare_digest(str(cuerpo.get('clave') or ''), CLAVE):
            con.execute('DELETE FROM bloqueos_registro WHERE origen=?', (origen,))
            return 'ok'
        fallos = (fila[0] if fila and not (fila[1] and fila[1] <= time.time()) else 0) + 1   # bloqueo caducado: de cero
        hasta = time.time() + HORAS_BLOQUEO * 3600 if fallos >= FALLOS_REGISTRO else None
        con.execute('INSERT OR REPLACE INTO bloqueos_registro (origen, fallos, ultimo, hasta) VALUES (?,?,?,?)',
                    (origen, fallos, time.time(), hasta))
        if hasta:
            print(f'Creación de cuentas bloqueada {HORAS_BLOQUEO} h para {origen} ({fallos} fallos seguidos de la palabra de paso).')
            return 'bloqueado'
        return FALLOS_REGISTRO - fallos
    r = con_escritura(hacer)
    if r == 'ok':
        return
    if r == 'bloqueado':
        raise Rechazo('bloqueado', f'Se ha fallado la palabra de paso {FALLOS_REGISTRO} veces seguidas: desde aquí no se pueden crear '
                      f'cuentas durante {HORAS_BLOQUEO} horas. Si eres de la mesa, pide al superusuario que lo desbloquee.')
    raise Rechazo('clave', 'La palabra de paso de la mesa no es correcta. Pídesela al DM.'
                  + (f' Te queda{"n" if r > 1 else ""} {r} intento{"s" if r > 1 else ""}.' if r <= 3 else ''))


def registrar(cuerpo, origen='-'):
    nombre = re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(cuerpo.get('nombre') or '')).strip())
    contrasena = cuerpo.get('contrasena')
    if not NOMBRE_OK.match(nombre):
        raise Rechazo('invalida', 'El nombre debe tener de 2 a 24 letras o números (también valen espacios, guiones y puntos).')
    validar_contrasena(contrasena)
    comprobar_palabra_de_paso(cuerpo, origen)
    with CERROJO:
        con = conectar()
        try:
            con.execute('BEGIN IMMEDIATE')
            primera = not con.execute("SELECT 1 FROM usuarios WHERE rol!='admin' LIMIT 1").fetchone()
            clave = clave_de(nombre)
            if buscar_usuario(con, clave):
                raise Rechazo('existe', f'Ya existe una cuenta llamada «{nombre}». Elige otro nombre o entra con ella.')
            rol = 'dm' if primera else 'jugador'
            con.execute('INSERT INTO usuarios (clave, nombre, hash, rol, creado, baneado) VALUES (?,?,?,?,?,0)',
                        (clave, nombre, hash_contrasena(contrasena), rol, ahora()))
            if primera:
                # La primera cuenta es el DM de la primera campaña (se crea si aún no existe).
                con.execute('INSERT OR IGNORE INTO campanas (id, nombre, creada, rev) VALUES (?,?,?,0)',
                            (PRIMERA, NOMBRE_PRIMERA, ahora()))
                con.execute('INSERT OR REPLACE INTO miembros (campana, usuario, rol, disciplina, unido) VALUES (?,?,?,?,?)',
                            (PRIMERA, clave, 'dm', DISCIPLINA_DEFECTO, ahora()))
                adoptar_huerfanos(con, PRIMERA, clave)
            # Las demás cuentas no están en ninguna campaña hasta que un DM las invite.
            token = abrir_sesion(con, clave)
            con.execute('COMMIT')
            usuario = {'clave': clave, 'nombre': nombre, 'rol': 'jugador'}
            return {'ok': True, 'token': token, 'usuario': usuario, 'primera': primera,
                    'campanas': campanas_de(con, usuario)}
        except BaseException:
            if con.in_transaction:
                con.execute('ROLLBACK')
            raise
        finally:
            con.close()


FALLOS = {}   # ip -> (fallos, desde): frena a quien prueba contraseñas a lo loco


def entrar(cuerpo, ip):
    fallos, desde = FALLOS.get(ip, (0, 0))
    if fallos >= 5 and time.time() - desde < 60:
        raise Rechazo('espera', 'Demasiados intentos fallidos. Espera un minuto y vuelve a probar.')
    clave = clave_de(cuerpo.get('nombre'))
    contrasena = str(cuerpo.get('contrasena') or '')
    con = conectar()
    try:
        fila = buscar_usuario(con, clave)
        bien = comprobar_contrasena(contrasena, fila[3] if fila else HASH_FALSO) and fila is not None
        if not bien:
            FALLOS[ip] = (fallos + 1 if time.time() - desde < 60 else 1, desde if time.time() - desde < 60 else time.time())
            raise Rechazo('credenciales', 'Ese nombre y esa contraseña no casan. Revisa mayúsculas y acentos de la contraseña.')
        FALLOS.pop(ip, None)
        if fila[4]:
            raise Rechazo('baneado', 'Esta cuenta ha sido desterrada de la mesa. Habla con el DM.')
        if fila[2] == 'admin' and not ADMIN_CLAVE:
            raise Rechazo('credenciales', 'El superusuario «DM» está desactivado (falta ALQUIMIA_ADMIN en el archivo .env).')
        with CERROJO:
            token = abrir_sesion(con, clave)
        usuario = usuario_publico(fila)
        return {'ok': True, 'token': token, 'usuario': usuario, 'campanas': campanas_de(con, usuario)}
    finally:
        con.close()


SESIONES = {}   # hash del token -> (clave, última vez que se apuntó en la base)


def usuario_de_token(token):
    if not token:
        return None
    th = hash_token(token)
    con = conectar()
    try:
        fila = con.execute('SELECT s.usuario, s.vista, u.nombre, u.rol FROM sesiones s JOIN usuarios u ON u.clave=s.usuario '
                           'WHERE s.token=? AND u.baneado=0', (th,)).fetchone()
        if not fila or time.time() - fila[1] > DIAS_SESION * 86400:
            return None
        if time.time() - fila[1] > 3600:   # apunta el uso como mucho una vez por hora
            con.execute('UPDATE sesiones SET vista=? WHERE token=?', (time.time(), th))
        return {'clave': fila[0], 'nombre': fila[2], 'rol': 'admin' if fila[3] == 'admin' else 'jugador'}
    finally:
        con.close()


# ------------------------------------------------------------------ campañas
CAMPANA_OK = re.compile(r'^[a-z0-9\-]{1,40}$')
NOMBRE_CAMPANA_OK = re.compile(r"^[\w][\w .,:'!¡¿?()\-]{1,39}$", re.UNICODE)


def es_admin(u):
    return bool(u) and u.get('rol') == 'admin'


def campanas_de(con, u):
    """Las campañas en las que juega esta cuenta (el superusuario las ve todas)."""
    if es_admin(u):
        filas = con.execute('SELECT id, nombre FROM campanas ORDER BY creada, nombre').fetchall()
        return [{'id': i, 'nombre': n, 'rol': 'admin', 'disciplina': DISCIPLINA_DEFECTO} for i, n in filas]
    filas = con.execute('SELECT c.id, c.nombre, m.rol, m.disciplina FROM miembros m JOIN campanas c ON c.id=m.campana '
                        'WHERE m.usuario=? ORDER BY c.creada, c.nombre', (u['clave'],)).fetchall()
    return [{'id': i, 'nombre': n, 'rol': r, 'disciplina': d} for i, n, r, d in filas]


def puede_crear_campanas(con, u):
    """Con superusuario, solo él crea campañas. Sin él (no hay ALQUIMIA_ADMIN), cualquier DM."""
    if es_admin(u):
        return True
    return not ADMIN_CLAVE and bool(con.execute("SELECT 1 FROM miembros WHERE usuario=? AND rol='dm'", (u['clave'],)).fetchone())


def actor_en_mesa(con, u, camp):
    """La persona dentro de una campaña: con su papel en ella (rol) y su disciplina. None si no juega ahí."""
    if not u or not isinstance(camp, str) or not CAMPANA_OK.match(camp):
        return None
    c = con.execute('SELECT nombre, clave_hash FROM campanas WHERE id=?', (camp,)).fetchone()
    if not c:
        return None
    if es_admin(u):
        return {**u, 'campana': camp, 'mesa': c[0], 'disciplina': DISCIPLINA_DEFECTO, 'personaje': None, 'conClave': bool(c[1])}
    m = con.execute('SELECT rol, disciplina, personaje FROM miembros WHERE campana=? AND usuario=?', (camp, u['clave'])).fetchone()
    if not m:
        return None
    return {**u, 'rol': m[0], 'campana': camp, 'mesa': c[0], 'disciplina': m[1], 'personaje': leer_personaje(m[2]),
            'conClave': bool(c[1])}


# ---- Personaje de cada jugador en cada campaña (lo que se ve en su perfil)
CAMPOS_TEXTO = {'nombre': 40, 'raza': 40, 'clase': 40, 'retrato': 8, 'notas': 2000}
CAMPOS_NUM = {'nivel': (1, 30), 'intMod': (-5, 10), 'bono': (0, 20)}


def leer_personaje(texto):
    try:
        p = json.loads(texto) if texto else None
    except ValueError:
        p = None
    return p if isinstance(p, dict) else None


def limpiar_personaje(p):
    if not isinstance(p, dict):
        raise Rechazo('invalida', 'Perfil mal formado.')
    out = {}
    for k, largo in CAMPOS_TEXTO.items():
        v = re.sub(r'[\x00-\x08\x0b-\x1f]', '', unicodedata.normalize('NFC', str(p.get(k) or ''))).strip()
        if len(v) > largo:
            raise Rechazo('invalida', f'El campo «{k}» es demasiado largo (máximo {largo}).')
        out[k] = v
    for k, (lo, hi) in CAMPOS_NUM.items():
        v = p.get(k, lo if k != 'intMod' else 0)
        if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
            raise Rechazo('invalida', f'El campo «{k}» debe ser un número entre {lo} y {hi}.')
        out[k] = v
    return out


def guardar_personaje(actor, cuerpo):
    """Cada uno edita su personaje; el DM (o el superusuario) el de cualquiera de su campaña.
    El nombre de USUARIO (la cuenta) no se toca aquí: no lo puede cambiar nadie."""
    camp = actor['campana']
    objetivo = clave_de(cuerpo.get('usuario')) if cuerpo.get('usuario') else actor['clave']
    if objetivo != actor['clave'] and not es_dm(actor):
        raise Rechazo('permiso', 'Solo el DM puede cambiar el perfil de otro jugador.')
    p = limpiar_personaje(cuerpo.get('personaje'))

    def hacer(con):
        if not es_miembro(con, camp, objetivo):
            raise Rechazo('invalida', 'Ese perfil no es de nadie de esta campaña.' if objetivo != actor['clave']
                          else 'El superusuario no tiene personaje propio en las campañas.')
        antes = leer_miembro(con, camp, objetivo, 'personaje')
        nuevo = json.dumps(p, ensure_ascii=False)
        con.execute('UPDATE miembros SET personaje=? WHERE campana=? AND usuario=?', (nuevo, camp, objetivo))
        if antes != nuevo:
            apuntar(con, camp, actor, 'perfil', f'perfil de {nombre_de(con, objetivo)} ({p["nombre"] or "sin nombre"})',
                    [{'k': 'pj', 'u': objetivo, 'antes': antes, 'despues': nuevo}], [nombre_de(con, objetivo)])
        subir_rev(con, camp)
        return {'ok': True, 'personaje': p}
    return con_escritura(hacer)


def perfiles(con, camp):
    """Los perfiles de todos los de la campaña (todos los pueden ver; editar, ver guardar_personaje)."""
    out = []
    fotos = versiones_avatar(con)
    for c, n, r, d, pj in con.execute('SELECT u.clave, u.nombre, m.rol, m.disciplina, m.personaje FROM miembros m '
                                      'JOIN usuarios u ON u.clave=m.usuario WHERE m.campana=? AND u.baneado=0 '
                                      'ORDER BY u.nombre COLLATE NOCASE', (camp,)).fetchall():
        nivel, _ = leer(con, camp, 'perfil', c, 'alquimia')
        out.append({'clave': c, 'nombre': n, 'rol': r, 'disciplina': d, 'personaje': leer_personaje(pj),
                    'nivelAlquimia': (nivel or {}).get('nivel') if isinstance(nivel, dict) else None,
                    'avatar': fotos.get(c, 0)})
    return out


# ---- Fotos de perfil (avatares) ---------------------------------------------
# Cada cuenta puede subir una foto. El navegador la recorta y la reduce a 256x256 antes de mandarla.
# El servidor NO la abre ni la procesa: solo comprueba que es de verdad una imagen PNG, JPEG o WebP
# (por sus primeros bytes), que pesa como mucho 300 KB y que mide como mucho 512x512 px (así nadie
# puede colar un archivo enorme que cuelgue el navegador de los demás). Nada de SVG (puede llevar
# código), ni GIF, ni nada más. Al servirla, va con su tipo exacto y con cabeceras que impiden que el
# navegador la trate como otra cosa (nosniff, CSP sandbox). Solo la ven cuentas que han entrado.
AVATAR_MAX_BYTES = 300 * 1024
AVATAR_MAX_LADO = 512
AVATAR_MIN_LADO = 16
AVATAR_ESPERA_S = 3                # entre una subida y la siguiente de la misma cuenta
AVATAR_ULTIMA = {}                 # clave -> momento de la última subida


def medidas_imagen(b):
    """(tipo MIME, ancho, alto) si los bytes son un PNG, JPEG o WebP bien formado; si no, None."""
    if len(b) >= 24 and b[:8] == b'\x89PNG\r\n\x1a\n' and b[12:16] == b'IHDR':
        return 'image/png', int.from_bytes(b[16:20], 'big'), int.from_bytes(b[20:24], 'big')
    if len(b) >= 4 and b[:3] == b'\xff\xd8\xff':
        i = 2
        while i + 9 < len(b):
            if b[i] != 0xFF:
                return None
            marca = b[i + 1]
            if marca == 0xFF:          # relleno
                i += 1
                continue
            if marca in (0xD8, 0x01) or 0xD0 <= marca <= 0xD7:
                i += 2
                continue
            largo = int.from_bytes(b[i + 2:i + 4], 'big')
            if largo < 2:
                return None
            if marca in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                return 'image/jpeg', int.from_bytes(b[i + 7:i + 9], 'big'), int.from_bytes(b[i + 5:i + 7], 'big')
            if marca == 0xDA:          # empiezan los datos de la imagen sin haber dicho su tamaño
                return None
            i += 2 + largo
        return None
    if len(b) >= 30 and b[:4] == b'RIFF' and b[8:12] == b'WEBP':
        trozo = b[12:16]
        if trozo == b'VP8 ' and b[23:26] == b'\x9d\x01\x2a':
            return 'image/webp', int.from_bytes(b[26:28], 'little') & 0x3FFF, int.from_bytes(b[28:30], 'little') & 0x3FFF
        if trozo == b'VP8L' and b[20] == 0x2F:
            bits = int.from_bytes(b[21:25], 'little')
            return 'image/webp', (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        if trozo == b'VP8X':
            return 'image/webp', int.from_bytes(b[24:27], 'little') + 1, int.from_bytes(b[27:30], 'little') + 1
    return None


def versiones_avatar(con):
    """clave -> versión de su foto (para que el navegador sepa si la tiene y si ha cambiado)."""
    return dict(con.execute('SELECT usuario, version FROM avatares').fetchall())


def guardar_avatar(actor, cuerpo):
    """Sube o quita la foto propia. El superusuario puede además quitar la de cualquiera (moderación)."""
    if not isinstance(cuerpo, dict):
        raise Rechazo('invalida', 'Petición no válida.')
    clave = actor['clave']
    otro = cuerpo.get('usuario')
    if otro not in (None, '', clave):
        if not es_admin(actor) or not cuerpo.get('quitar'):
            raise Rechazo('permiso', 'Solo puedes cambiar tu propia foto.')
        clave = str(otro)
    if cuerpo.get('quitar'):
        con = conectar()
        try:
            con.execute('DELETE FROM avatares WHERE usuario=?', (clave,))
        finally:
            con.close()
        return {'ok': True, 'avatar': 0}
    ahora_s = time.time()
    if ahora_s - AVATAR_ULTIMA.get(clave, 0) < AVATAR_ESPERA_S:
        raise Rechazo('espera', 'Espera un momento antes de volver a cambiar la foto.')
    texto = cuerpo.get('imagen')
    if not isinstance(texto, str) or len(texto) > AVATAR_MAX_BYTES * 2:
        raise Rechazo('invalida', 'La foto es demasiado grande (máximo 300 KB).')
    m = re.match(r'^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$', texto)
    if not m:
        raise Rechazo('invalida', 'Solo se admiten fotos PNG, JPEG o WebP.')
    try:
        datos = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise Rechazo('invalida', 'La foto llegó dañada. Prueba otra vez.')
    if len(datos) > AVATAR_MAX_BYTES:
        raise Rechazo('invalida', 'La foto es demasiado grande (máximo 300 KB).')
    info = medidas_imagen(datos)
    if not info:
        raise Rechazo('invalida', 'Eso no parece una foto PNG, JPEG o WebP.')
    tipo, ancho, alto = info
    if not (AVATAR_MIN_LADO <= ancho <= AVATAR_MAX_LADO and AVATAR_MIN_LADO <= alto <= AVATAR_MAX_LADO):
        raise Rechazo('invalida', f'La foto debe medir entre {AVATAR_MIN_LADO} y {AVATAR_MAX_LADO} px de lado.')
    AVATAR_ULTIMA[clave] = ahora_s
    con = conectar()
    try:
        con.execute('BEGIN IMMEDIATE')
        v = (con.execute('SELECT version FROM avatares WHERE usuario=?', (clave,)).fetchone() or (0,))[0] + 1
        con.execute('INSERT OR REPLACE INTO avatares VALUES (?,?,?,?,?)', (clave, tipo, sqlite3.Binary(datos), v, ahora()))
        con.execute('COMMIT')
    except Exception:
        if con.in_transaction:
            con.execute('ROLLBACK')
        raise
    finally:
        con.close()
    return {'ok': True, 'avatar': v}


# ---- Contraseña de la mesa: si la hay, quien la sepa puede unirse sin invitación
def poner_clave_mesa(actor, cuerpo):
    if not es_dm(actor):
        raise Rechazo('permiso', 'Solo el DM o el superusuario pueden poner la contraseña de la mesa.')
    clave = cuerpo.get('clave')
    if clave in (None, ''):
        h = None
    else:
        if not isinstance(clave, str) or not 4 <= len(clave) <= 100:
            raise Rechazo('invalida', 'La contraseña de la mesa debe tener entre 4 y 100 caracteres.')
        h = hash_contrasena(clave)

    def hacer(con):
        con.execute('UPDATE campanas SET clave_hash=? WHERE id=?', (h, actor['campana']))
        apuntar(con, actor['campana'], actor, 'mesa', 'puso o cambió la contraseña de la mesa' if h else 'quitó la contraseña de la mesa')
        subir_rev(con, actor['campana'])
        return {'ok': True, 'conClave': bool(h)}
    return con_escritura(hacer)


def unirse(u, cuerpo, ip):
    """Unirse a una campaña con su nombre y su contraseña (sin invitación)."""
    if es_admin(u):
        raise Rechazo('invalida', 'El superusuario ya entra en todas las campañas.')
    fallos, desde = FALLOS.get(ip, (0, 0))
    if fallos >= 5 and time.time() - desde < 60:
        raise Rechazo('espera', 'Demasiados intentos fallidos. Espera un minuto y vuelve a probar.')
    nombre = re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(cuerpo.get('nombre') or '')).strip())
    clave = str(cuerpo.get('clave') or '')

    def hacer(con):
        c = con.execute('SELECT id, nombre, clave_hash FROM campanas WHERE nombre=? COLLATE NOCASE', (nombre,)).fetchone()
        # Mismo mensaje si no existe, si no tiene contraseña o si es incorrecta: no se delata qué mesas hay
        if not c or not c[2] or not comprobar_contrasena(clave, c[2]):
            if not c or not c[2]:
                comprobar_contrasena(clave, HASH_FALSO)
            FALLOS[ip] = (fallos + 1 if time.time() - desde < 60 else 1, desde if time.time() - desde < 60 else time.time())
            raise Rechazo('credenciales', 'No hay ninguna mesa con ese nombre y esa contraseña. '
                          'Si la mesa no tiene contraseña, pide al DM que te invite.')
        FALLOS.pop(ip, None)
        if es_miembro(con, c[0], u['clave']):
            raise Rechazo('existe', f'Ya estás en «{c[1]}».')
        con.execute('INSERT INTO miembros (campana, usuario, rol, disciplina, unido) VALUES (?,?,?,?,?)',
                    (c[0], u['clave'], 'jugador', DISCIPLINA_DEFECTO, ahora()))
        apuntar(con, c[0], u, 'miembros', 'se unió a la mesa con la contraseña', None, [u['nombre']])
        subir_rev(con, c[0])
        return {'ok': True, 'campana': {'id': c[0], 'nombre': c[1], 'rol': 'jugador', 'disciplina': DISCIPLINA_DEFECTO}}
    return con_escritura(hacer)


def es_miembro(con, camp, clave):
    return bool(con.execute('SELECT 1 FROM miembros WHERE campana=? AND usuario=?', (camp, clave)).fetchone())


def con_escritura(fn):
    """Ejecuta fn(con) en una transacción BEGIN IMMEDIATE con el cerrojo: todo o nada."""
    with CERROJO:
        con = conectar()
        try:
            con.execute('BEGIN IMMEDIATE')
            r = fn(con)
            con.execute('COMMIT')
            return r
        except BaseException:
            if con.in_transaction:
                con.execute('ROLLBACK')
            raise
        finally:
            con.close()


def nombre_de_campana(cuerpo):
    nombre = re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(cuerpo.get('nombre') or '')).strip())
    if not NOMBRE_CAMPANA_OK.match(nombre):
        raise Rechazo('invalida', 'El nombre de la campaña debe tener de 2 a 40 letras o números.')
    return nombre


def crear_campana(u, cuerpo):
    nombre = nombre_de_campana(cuerpo)
    dm = clave_de(cuerpo.get('dm')) if cuerpo.get('dm') else ''
    copiar = cuerpo.get('copiarDe') or ''

    def hacer(con):
        if not puede_crear_campanas(con, u):
            raise Rechazo('permiso', 'Solo el superusuario «DM» puede crear campañas.')
        if con.execute('SELECT 1 FROM campanas WHERE nombre=? COLLATE NOCASE', (nombre,)).fetchone():
            raise Rechazo('existe', f'Ya hay una campaña llamada «{nombre}».')
        camp = 'c-' + secrets.token_hex(4)
        con.execute('INSERT INTO campanas (id, nombre, creada, rev) VALUES (?,?,?,1)', (camp, nombre, ahora()))
        quien_dm = dm or ('' if es_admin(u) else u['clave'])   # sin superusuario, quien la crea es su DM
        if quien_dm:
            fila = buscar_usuario(con, quien_dm)
            if not fila or fila[2] == 'admin':
                raise Rechazo('invalida', 'Esa cuenta no existe (el DM de la campaña tiene que ser una cuenta de jugador).')
            con.execute('INSERT INTO miembros (campana, usuario, rol, disciplina, unido) VALUES (?,?,?,?,?)',
                        (camp, quien_dm, 'dm', DISCIPLINA_DEFECTO, ahora()))
        if copiar:
            # Se copia lo común (catálogo, pociones conocidas y parámetros), nunca los inventarios
            if not con.execute('SELECT 1 FROM campanas WHERE id=?', (copiar,)).fetchone():
                raise Rechazo('invalida', 'La campaña de la que copiar el catálogo no existe.')
            if not es_admin(u) and not con.execute("SELECT 1 FROM miembros WHERE campana=? AND usuario=? AND rol='dm'",
                                                    (copiar, u['clave'])).fetchone():
                raise Rechazo('permiso', 'Solo puedes copiar el catálogo de una campaña en la que eres DM.')
            con.execute('INSERT INTO entradas (campana, col, dueno, id, valor, autor, cambiado, rev) '
                        'SELECT ?, col, dueno, id, valor, autor, cambiado, 1 FROM entradas WHERE campana=? AND dueno=?',
                        (camp, copiar, COMUN))
        return {'ok': True, 'campana': {'id': camp, 'nombre': nombre}}
    return con_escritura(hacer)


def renombrar_campana(u, cuerpo):
    camp, nombre = cuerpo.get('campana'), nombre_de_campana(cuerpo)
    if not es_admin(u):
        raise Rechazo('permiso', 'Solo el superusuario «DM» puede cambiar el nombre de una campaña.')

    def hacer(con):
        if not con.execute('SELECT 1 FROM campanas WHERE id=?', (camp,)).fetchone():
            raise Rechazo('invalida', 'Esa campaña no existe.')
        if con.execute('SELECT 1 FROM campanas WHERE nombre=? COLLATE NOCASE AND id!=?', (nombre, camp)).fetchone():
            raise Rechazo('existe', f'Ya hay una campaña llamada «{nombre}».')
        viejo = con.execute('SELECT nombre FROM campanas WHERE id=?', (camp,)).fetchone()[0]
        con.execute('UPDATE campanas SET nombre=? WHERE id=?', (nombre, camp))
        apuntar(con, camp, u, 'mesa', f'renombró la campaña: «{viejo}» → «{nombre}»')
        subir_rev(con, camp)
        return {'ok': True}
    return con_escritura(hacer)


def miembro(actor, cuerpo):
    """El DM invita a una cuenta a su campaña (accion='invitar') o la saca de ella (accion='quitar').
    Sacar a alguien no borra nada: si vuelve, recupera su inventario, sus libros y su nivel."""
    if not es_dm(actor):
        raise Rechazo('permiso', 'Solo el DM de la campaña puede invitar o sacar jugadores.')
    camp, objetivo, accion = actor['campana'], clave_de(cuerpo.get('usuario')), cuerpo.get('accion')

    def hacer(con):
        fila = buscar_usuario(con, objetivo)
        if not fila:
            raise Rechazo('invalida', 'Esa cuenta no existe.')
        if fila[2] == 'admin':
            raise Rechazo('invalida', 'El superusuario ya entra en todas las campañas.')
        if accion == 'invitar':
            if fila[4]:
                raise Rechazo('baneado', f'«{fila[1]}» está desterrado: no se le puede invitar.')
            if es_miembro(con, camp, objetivo):
                raise Rechazo('existe', f'«{fila[1]}» ya está en esta campaña.')
            con.execute('INSERT INTO miembros (campana, usuario, rol, disciplina, unido) VALUES (?,?,?,?,?)',
                        (camp, objetivo, 'jugador', DISCIPLINA_DEFECTO, ahora()))
            apuntar(con, camp, actor, 'miembros', f'invitó a {fila[1]} a la mesa', None, [fila[1]])
        elif accion == 'quitar':
            m = con.execute('SELECT rol FROM miembros WHERE campana=? AND usuario=?', (camp, objetivo)).fetchone()
            if not m:
                raise Rechazo('invalida', f'«{fila[1]}» no está en esta campaña.')
            if objetivo == actor['clave']:
                raise Rechazo('invalida', 'No puedes sacarte a ti mismo de la campaña.')
            if m[0] == 'dm' and not es_admin(actor):
                raise Rechazo('permiso', 'Solo el superusuario puede sacar a un DM de la campaña.')
            con.execute('DELETE FROM miembros WHERE campana=? AND usuario=?', (camp, objetivo))
            apuntar(con, camp, actor, 'miembros', f'sacó a {fila[1]} de la mesa', None, [fila[1]])
            if (PRESENCIA.get(objetivo) or {}).get('campana') == camp:
                PRESENCIA.pop(objetivo, None)
        else:
            raise Rechazo('invalida', 'Acción desconocida.')
        subir_rev(con, camp)
        return {'ok': True}
    return con_escritura(hacer)


def cambiar_disciplina(actor, cuerpo):
    if not es_dm(actor):
        raise Rechazo('permiso', 'Solo el DM puede asignar disciplinas.')
    camp, objetivo, disc = actor['campana'], clave_de(cuerpo.get('usuario')), cuerpo.get('disciplina')
    if disc not in DISCIPLINAS:
        raise Rechazo('invalida', 'Disciplina desconocida.')

    def hacer(con):
        if not es_miembro(con, camp, objetivo):
            raise Rechazo('invalida', 'Esa cuenta no está en esta campaña.')
        antes = leer_miembro(con, camp, objetivo, 'disciplina')
        con.execute('UPDATE miembros SET disciplina=? WHERE campana=? AND usuario=?', (disc, camp, objetivo))
        if antes != disc:
            apuntar(con, camp, actor, 'miembros', f'disciplina de {nombre_de(con, objetivo)}: {antes} → {disc}',
                    [{'k': 'disc', 'u': objetivo, 'antes': antes, 'despues': disc}], [nombre_de(con, objetivo)])
        subir_rev(con, camp)
        return {'ok': True}
    return con_escritura(hacer)


def lista_cuentas(con, u, camp=None):
    """Cuentas para invitar (DM) o administrar (superusuario). Un DM no ve a los desterrados."""
    cuentas = []
    for clave, nombre, rol, baneado in con.execute(
            "SELECT clave, nombre, rol, baneado FROM usuarios WHERE rol!='admin' ORDER BY nombre COLLATE NOCASE"):
        if baneado and not es_admin(u):
            continue
        c = {'clave': clave, 'nombre': nombre, 'baneado': bool(baneado)}
        if camp:
            c['enMesa'] = es_miembro(con, camp, clave)
        if es_admin(u):
            c['campanas'] = [{'id': i, 'nombre': n, 'rol': r} for i, n, r in con.execute(
                'SELECT c.id, c.nombre, m.rol FROM miembros m JOIN campanas c ON c.id=m.campana WHERE m.usuario=? '
                'ORDER BY c.creada', (clave,))]
        cuentas.append(c)
    return cuentas


def bloqueos_registro(con):
    """Para el superusuario: orígenes bloqueados para crear cuentas (o con fallos acumulados)."""
    return [{'origen': o, 'fallos': f, 'hace': round(time.time() - (ul or 0)), 'quedan': round(h - time.time()) if h else None}
            for o, f, ul, h in con.execute('SELECT origen, fallos, ultimo, hasta FROM bloqueos_registro ORDER BY ultimo DESC')
            if (h and h > time.time()) or (not h and f > 0)]


def desbloquear_registro(u, cuerpo):
    if not es_admin(u):
        raise Rechazo('permiso', 'Solo el superusuario puede levantar el bloqueo de creación de cuentas.')
    origen = cuerpo.get('origen')

    def hacer(con):
        if origen:
            con.execute('DELETE FROM bloqueos_registro WHERE origen=?', (str(origen),))
        else:
            con.execute('DELETE FROM bloqueos_registro')
        return {'ok': True}
    return con_escritura(hacer)


def resumen_campanas(con):
    """Para el superusuario: todas las campañas con sus DM y cuántos jugadores tienen."""
    out = []
    for i, n, creada in con.execute('SELECT id, nombre, creada FROM campanas ORDER BY creada, nombre').fetchall():
        miembros_ = con.execute('SELECT u.nombre, m.rol FROM miembros m JOIN usuarios u ON u.clave=m.usuario '
                                'WHERE m.campana=? ORDER BY u.nombre COLLATE NOCASE', (i,)).fetchall()
        out.append({'id': i, 'nombre': n, 'creada': creada, 'dms': [x for x, r in miembros_ if r == 'dm'],
                    'jugadores': len(miembros_)})
    return out


def cerrar_sesion(token):
    con = conectar()
    try:
        con.execute('DELETE FROM sesiones WHERE token=?', (hash_token(token),))
    finally:
        con.close()


# ------------------------------------------------------------------ presencia
PRESENCIA = {}          # clave -> {'t': última petición, 'lugar': ..., 'visible': bool}
LUGAR_OK = re.compile(r'^[a-z]{1,20}$')   # cada módulo de la app dice su "lugar" (alquimia, lectura...)


def apuntar_presencia(clave, lugar, visible, camp=None):
    PRESENCIA[clave] = {'t': time.time(), 'lugar': lugar if LUGAR_OK.match(lugar or '') else 'panel', 'visible': visible,
                        'campana': camp}


def lista_presencia(con, camp):
    """Quién juega en esta campaña y si está ahora en ella (alguien en otra campaña sale como desconectado aquí)."""
    ahora_s = time.time()
    lista = []
    filas = con.execute('SELECT u.clave, u.nombre, m.rol, u.baneado, m.disciplina, m.personaje FROM miembros m '
                        'JOIN usuarios u ON u.clave=m.usuario WHERE m.campana=? ORDER BY u.nombre COLLATE NOCASE', (camp,)).fetchall()
    adm = con.execute("SELECT clave, nombre, rol, baneado FROM usuarios WHERE rol='admin'").fetchone()
    if adm and ADMIN_CLAVE and (PRESENCIA.get(adm[0]) or {}).get('campana') == camp:
        filas.append((*adm, None, None))   # el superusuario sale solo mientras está en esta campaña
    fotos = versiones_avatar(con)
    for clave, nombre, rol, baneado, disciplina, pj in filas:
        p = PRESENCIA.get(clave)
        if p and p.get('campana') != camp:
            p = {**p, 'visible': False, 't': p['t'] - AUSENTE_S}   # está en otra campaña
        hace = ahora_s - p['t'] if p else None
        if hace is not None and hace < EN_LINEA_S and p['visible']:
            estado = 'en-linea'
        elif hace is not None and hace < AUSENTE_S:
            estado = 'ausente'
        else:
            estado = 'desconectado'
        lista.append({'clave': clave, 'nombre': nombre, 'rol': rol, 'estado': estado, 'baneado': bool(baneado),
                      'disciplina': disciplina, 'personaje': (leer_personaje(pj) or {}).get('nombre') or '',
                      'lugar': p['lugar'] if p and estado != 'desconectado' else None,
                      'hace': round(hace) if hace is not None else None, 'avatar': fotos.get(clave, 0)})
    return lista


# ----------------------------------------------------- nombres para los mensajes
def nombre_material(con, camp, id_):
    m, _ = leer(con, camp, 'catalog', COMUN, id_)
    if not m:
        return 'un material'
    return '???' if m.get('unknown') else (m.get('name') or 'un material')


def nombre_entrada(con, camp, col, id_, valor):
    if col == 'inventory':
        return '«' + nombre_material(con, camp, id_) + '»'
    if isinstance(valor, dict) and valor.get('name'):
        return '«' + str(valor['name']) + '»'
    return {'potions': 'esa poción', 'lootPotions': 'esa poción de botín', 'catalog': 'ese material',
            'potionCatalog': 'esa ficha de poción', 'meta': 'los ajustes', 'libros': 'ese libro', 'objetos': 'ese objeto',
            'perfil': 'el nivel de alquimia'}.get(col, 'ese dato')


def mayus(t):
    return t[:1].upper() + t[1:]


def quien(autor, yo):
    return f' (último cambio: {autor})' if autor and autor != yo else ''


# ------------------------------------------------------------- aplicar operaciones
def resto(v):
    """Un objeto con qty, sin el qty: lo que no es cantidad."""
    return {k: x for k, x in v.items() if k != 'qty'} if isinstance(v, dict) else v


def entero(x, campo):
    if isinstance(x, bool) or not isinstance(x, int):
        raise Rechazo('invalida', f'Operación mal formada: {campo} debe ser un número entero.')
    return x


def dueno_de(con, op, col, actor):
    """De quién es la entrada que toca esta operación (y si quien la hace puede tocarla)."""
    if col not in POR_JUGADOR:
        return COMUN
    objetivo = op.get('u') or actor['clave']
    if not isinstance(objetivo, str):
        raise Rechazo('invalida', 'Operación mal formada (jugador).')
    if objetivo != actor['clave']:
        if not es_dm(actor):
            raise Rechazo('permiso', 'Solo el DM puede tocar el inventario de otro jugador.')
        if not es_miembro(con, actor['campana'], objetivo):
            raise Rechazo('invalida', 'Ese jugador no está en esta campaña.')
    return objetivo


# ------------------------------------------------------------------ historial
def apuntar(con, camp, actor, tipo, resumen, cambios=None, afecta=()):
    """Añade una línea al historial de la campaña. «cambios» es lo necesario para deshacerla
    (lista de {k, ..., antes, despues}); None = no se puede deshacer (p. ej. invitar a alguien)."""
    cur = con.execute('INSERT INTO historial (campana, fecha, autor, autor_nombre, tipo, resumen, afecta, cambios) '
                      'VALUES (?,?,?,?,?,?,?,?)',
                      (camp, ahora(), actor['clave'], actor['nombre'], tipo, str(resumen or '')[:500],
                       json.dumps(sorted(set(a for a in afecta if a)), ensure_ascii=False),
                       json.dumps(cambios, ensure_ascii=False) if cambios else None))
    return cur.lastrowid


def nombre_de(con, clave):
    fila = con.execute('SELECT nombre FROM usuarios WHERE clave=?', (clave,)).fetchone()
    return fila[0] if fila else clave


def leer_miembro(con, camp, usuario, campo):
    fila = con.execute(f'SELECT {campo} FROM miembros WHERE campana=? AND usuario=?', (camp, usuario)).fetchone()
    return fila[0] if fila else None


def deshacer(actor, cuerpo):
    """Deshace una línea del historial: vuelve a poner lo que había antes. Solo el superusuario.
    Solo si nada de lo que tocó ha cambiado después (si no, hay que deshacer antes lo posterior).
    Deshacer también queda apuntado en el historial (y se puede deshacer a su vez)."""
    if not es_admin(actor):
        raise Rechazo('permiso', 'Solo el superusuario puede deshacer cambios del historial.')
    hid, camp = cuerpo.get('id'), actor['campana']
    if isinstance(hid, bool) or not isinstance(hid, int):
        raise Rechazo('invalida', 'Línea del historial mal indicada.')

    def hacer(con):
        fila = con.execute('SELECT cambios, deshecho_por, resumen, autor_nombre FROM historial WHERE id=? AND campana=?',
                           (hid, camp)).fetchone()
        if not fila:
            raise Rechazo('invalida', 'Esa línea del historial no existe en esta campaña.')
        if fila[1]:
            raise Rechazo('conflicto', 'Ese cambio ya se deshizo.')
        if not fila[0]:
            raise Rechazo('invalida', 'Ese tipo de cambio no se puede deshacer desde aquí.')
        cambios = json.loads(fila[0])
        rev = rev_actual(con, camp) + 1
        inversos, afecta = [], set()
        for c in cambios:
            if c['k'] == 'e':
                ahora_v, quien_ = leer(con, camp, c['c'], c['d'], c['id'])
                if ahora_v != c['despues']:
                    raise Rechazo('conflicto', f'No se puede deshacer: {nombre_entrada(con, camp, c["c"], c["id"], ahora_v or c["antes"])} '
                                  f'ha cambiado después{quien(quien_, "")}. Deshaz antes los cambios posteriores.')
                escribir(con, camp, c['c'], c['d'], c['id'], c['antes'], actor['nombre'], rev)
            else:   # personaje o disciplina de un miembro
                campo = {'pj': 'personaje', 'disc': 'disciplina'}[c['k']]
                if not es_miembro(con, camp, c['u']):
                    raise Rechazo('conflicto', f'No se puede deshacer: {nombre_de(con, c["u"])} ya no está en la campaña.')
                if leer_miembro(con, camp, c['u'], campo) != c['despues']:
                    raise Rechazo('conflicto', f'No se puede deshacer: el {campo} de {nombre_de(con, c["u"])} ha cambiado después.')
                con.execute(f'UPDATE miembros SET {campo}=? WHERE campana=? AND usuario=?', (c['antes'], camp, c['u']))
            inversos.append({**c, 'antes': c['despues'], 'despues': c['antes']})
            afecta.add(c.get('d') or c.get('u'))
        con.execute('UPDATE campanas SET rev=? WHERE id=?', (rev, camp))
        nuevo = apuntar(con, camp, actor, 'deshacer', f'deshizo: «{fila[2]}» (de {fila[3]})', inversos,
                        [nombre_de(con, a) for a in afecta if a])
        con.execute('UPDATE historial SET deshecho_por=? WHERE id=?', (nuevo, hid))
        return {'ok': True}
    return con_escritura(hacer)


def lista_historial(con, camp, antes_de=None, n=50):
    q = ('SELECT id, fecha, autor_nombre, tipo, resumen, afecta, cambios IS NOT NULL, deshecho_por FROM historial '
         'WHERE campana=?' + (' AND id<?' if antes_de else '') + ' ORDER BY id DESC LIMIT ?')
    args = (camp, antes_de, n) if antes_de else (camp, n)
    return [{'id': i, 'fecha': f, 'autor': a, 'tipo': t, 'resumen': r, 'afecta': json.loads(af or '[]'),
             'deshacible': bool(d), 'deshechoPor': dp} for i, f, a, t, r, af, d, dp in con.execute(q, args)]


def aplicar_op(con, op, actor, rev, registro=None):
    if not isinstance(op, dict):
        raise Rechazo('invalida', 'Operación mal formada.')
    autor = actor['nombre']
    camp = actor['campana']
    col, id_, t = op.get('c'), op.get('id'), op.get('t')
    if t == 'vacio':
        # Solo para la primera subida de datos: exige que la campaña esté vacía.
        if con.execute("SELECT 1 FROM entradas WHERE campana=? AND col != 'meta' LIMIT 1", (camp,)).fetchone():
            raise Rechazo('conflicto', 'Esta campaña ya tiene datos: no se han subido los de este navegador.')
        return
    if col not in COLECCIONES or not isinstance(id_, str) or not id_ or len(id_) > 200:
        raise Rechazo('invalida', 'Operación mal formada (colección o id).')
    tipo = COLECCIONES[col]
    dueno = dueno_de(con, op, col, actor)
    actual, autor_prev = leer(con, camp, col, dueno, id_)
    if registro is not None:   # para el historial: lo que había ANTES de esta transacción
        registro.setdefault((col, dueno, id_), actual)

    if t == 'num' and tipo == 'num':
        # Sumar o restar stock. Nunca puede quedar por debajo de 0.
        if op.get('borrar'):     # el material se ha borrado del catálogo: fuera su stock
            escribir(con, camp, col, dueno, id_, None, autor, rev)
            return
        n = entero(op.get('n', 0), 'n')
        tenia = actual if isinstance(actual, int) else 0
        if 'e' in op and tenia != op['e']:   # "pon exactamente X" del DM: solo si nadie lo cambió
            raise Rechazo('conflicto',
                f'{mayus(nombre_entrada(con, camp, col, id_, actual))} ha cambiado mientras tanto (ahora hay {tenia}){quien(autor_prev, autor)}.',
                {'col': col, 'id': id_, 'hay': tenia})
        queda = tenia + n
        if queda < 0:
            raise Rechazo('stock',
                f'No queda suficiente {nombre_entrada(con, camp, col, id_, actual)}: hay {tenia} y hacían falta {-n}{quien(autor_prev, autor)}.',
                {'col': col, 'id': id_, 'hay': tenia, 'falta': -n})
        escribir(con, camp, col, dueno, id_, queda, autor, rev)

    elif t == 'qty' and tipo == 'qty':
        n = entero(op.get('n', 0), 'n')
        if actual is None:
            if n > 0 and isinstance(op.get('tpl'), dict):
                escribir(con, camp, col, dueno, id_, {**op['tpl'], 'qty': n}, autor, rev)
                return
            if n == 0 and op.get('v') is None:
                return
            raise Rechazo('stock',
                f'{mayus(nombre_entrada(con, camp, col, id_, op.get("tpl") or op.get("e")))} ya no existe: alguien la ha usado o borrado.',
                {'col': col, 'id': id_, 'hay': 0, 'falta': -n})
        nuevo = dict(actual)
        if 'v' in op:   # también cambian otros campos (nombre, descripción...)
            if resto(actual) != op.get('e'):
                raise Rechazo('conflicto',
                    f'Otra persona ha modificado {nombre_entrada(con, camp, col, id_, actual)} mientras tanto{quien(autor_prev, autor)}.',
                    {'col': col, 'id': id_})
            nuevo = {**(op['v'] or {}), 'qty': actual.get('qty', 0)}
        tenia = entero(actual.get('qty', 0), 'qty')
        queda = tenia + n
        if queda < 0:
            raise Rechazo('stock',
                f'No queda suficiente {nombre_entrada(con, camp, col, id_, actual)}: hay {tenia} y hacían falta {-n}{quien(autor_prev, autor)}.',
                {'col': col, 'id': id_, 'hay': tenia, 'falta': -n})
        nuevo['qty'] = queda
        escribir(con, camp, col, dueno, id_, nuevo if queda > 0 else None, autor, rev)

    elif t == 'obj' and tipo == 'obj':
        # Reemplazar entero, solo si sigue como lo vio quien hace el cambio
        # (control de concurrencia optimista: "compara y cambia").
        esperado, nuevo = op.get('e'), op.get('v')
        if col == 'objetos' and nuevo is not None:
            validar_objeto(nuevo)
        if not es_dm(actor):
            permiso_jugador(col, actual, nuevo, id_)
        if actual != esperado and actual != nuevo:
            raise Rechazo('conflicto',
                f'Otra persona ha modificado {nombre_entrada(con, camp, col, id_, actual or esperado or nuevo)} mientras tanto{quien(autor_prev, autor)}.',
                {'col': col, 'id': id_})
        escribir(con, camp, col, dueno, id_, nuevo, autor, rev)
        if col == 'catalog' and nuevo is None:
            # Material borrado del catálogo: desaparece de los inventarios de todos
            if registro is not None:   # también se apunta el stock que pierden todos
                for d, v in con.execute("SELECT dueno, valor FROM entradas WHERE campana=? AND col='inventory' AND id=?", (camp, id_)):
                    registro.setdefault(('inventory', d, id_), json.loads(v))
            con.execute("DELETE FROM entradas WHERE campana=? AND col='inventory' AND id=?", (camp, id_))
    else:
        raise Rechazo('invalida', 'Operación desconocida.')


# ---- Inventario general (objetos): forma y límites de cada objeto
OBJ_TEXTO = {'name': 120, 'categoria': 30, 'rareza': 30, 'valor': 60, 'peso': 30, 'descripcion': 4000, 'notas': 2000, 'creado': 40}
OBJ_SUB = {'arma': {'dano': 40, 'tipoDano': 40, 'propiedades': 300},
           'armadura': {'ca': 60, 'tipo': 30},
           'cargas': {'recarga': 120}}


def validar_objeto(o):
    """Un objeto del inventario general: textos acotados y números con sentido. Lo que sobre, fuera."""
    if not isinstance(o, dict) or not isinstance(o.get('name'), str) or not o['name'].strip():
        raise Rechazo('invalida', 'Un objeto necesita nombre.')
    for k, v in o.items():
        if k in OBJ_TEXTO:
            if not isinstance(v, str) or len(v) > OBJ_TEXTO[k]:
                raise Rechazo('invalida', f'El campo «{k}» del objeto no es válido o es demasiado largo.')
        elif k in ('sintonizacion', 'sintonizado', 'equipado'):
            if not isinstance(v, bool):
                raise Rechazo('invalida', f'El campo «{k}» del objeto no es válido.')
        elif k == 'cantidad':
            if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v <= 99999:
                raise Rechazo('invalida', 'La cantidad de un objeto va de 0 a 99999.')
        elif k in OBJ_SUB:
            if v is None:
                continue
            if not isinstance(v, dict):
                raise Rechazo('invalida', f'El bloque «{k}» del objeto no es válido.')
            for k2, v2 in v.items():
                if k2 in OBJ_SUB[k]:
                    if not isinstance(v2, str) or len(v2) > OBJ_SUB[k][k2]:
                        raise Rechazo('invalida', f'El campo «{k}.{k2}» del objeto no es válido.')
                elif k2 in ('bonif', 'actual', 'max'):
                    if not isinstance(v2, int) or isinstance(v2, bool) or not -10 <= v2 <= 9999:
                        raise Rechazo('invalida', f'El campo «{k}.{k2}» del objeto no es válido.')
                else:
                    raise Rechazo('invalida', f'Campo desconocido en el objeto: {k}.{k2}.')
        else:
            raise Rechazo('invalida', f'Campo desconocido en el objeto: {k}.')


def permiso_jugador(col, actual, nuevo, id_=''):
    """Lo que un jugador NO puede cambiar por su cuenta (solo el DM o el superusuario).
    Regla general de lo común a la mesa: un jugador puede AÑADIR, pero no editar ni borrar."""
    if col == 'catalog' and actual is not None:
        # Dar de alta un componente nuevo sí; cambiarlo o borrarlo afecta a toda la mesa
        raise Rechazo('permiso', 'Solo el DM puede editar o borrar componentes del catálogo (afectan a toda la mesa).')
    if col == 'potionCatalog' and actual is not None and nuevo is None:
        raise Rechazo('permiso', 'Solo el DM puede borrar pociones del catálogo.')
    if col == 'meta':
        if id_ == 'settings' and actual is not None:
            raise Rechazo('permiso', 'Solo el DM puede cambiar los parámetros (disolventes y dificultades).')
        if id_ == 'damageTypes' and actual is not None and not (
                isinstance(nuevo, list) and all(t in nuevo for t in (actual if isinstance(actual, list) else []))):
            raise Rechazo('permiso', 'Puedes añadir tipos de daño, pero solo el DM puede quitarlos.')
    if col == 'perfil':
        raise Rechazo('permiso', 'Solo el DM puede cambiar tu nivel (de alquimia o de tu disciplina).')
    if col == 'libros' and isinstance(nuevo, dict):
        pruebas = nuevo.get('pruebas') or {}
        if not isinstance(pruebas, dict):
            raise Rechazo('invalida', 'Libro mal formado (casillas con tirada).')
        if actual is None:
            # Al dar de alta un libro se pueden marcar las casillas con tirada, pero la CD la pone el DM
            if any(isinstance(p, dict) and p.get('cd') is not None for p in pruebas.values()):
                raise Rechazo('permiso', 'La dificultad de las tiradas de comprensión la fija el DM.')
        elif pruebas != ((actual.get('pruebas') or {}) if isinstance(actual, dict) else {}):
            raise Rechazo('permiso', 'Solo el DM puede cambiar qué casillas piden tirada de comprensión y su dificultad.')


def transaccion(cuerpo, actor):
    tx_id = cuerpo.get('id')
    ops = cuerpo.get('ops')
    resumen = str(cuerpo.get('resumen') or '')[:500]
    if not isinstance(tx_id, str) or not tx_id or len(tx_id) > 100 or not isinstance(ops, list):
        raise Rechazo('invalida', 'Transacción mal formada.')
    # 'vacio' es un control previo: va el primero aunque el cliente lo mande en otro orden
    ops = sorted(ops, key=lambda o: 0 if isinstance(o, dict) and o.get('t') == 'vacio' else 1)
    with CERROJO:
        con = conectar()
        try:
            con.execute('BEGIN IMMEDIATE')
            camp = actor['campana']
            hecha = con.execute('SELECT rev FROM transacciones WHERE id=?', (tx_id,)).fetchone()
            if hecha:   # reintento de algo ya confirmado: no se aplica otra vez
                con.execute('ROLLBACK')
                return {'ok': True, 'rev': rev_actual(con, camp), 'repetida': True}
            rev = rev_actual(con, camp) + 1
            registro = {}
            for op in ops:
                aplicar_op(con, op, actor, rev, registro)
            con.execute('UPDATE campanas SET rev=? WHERE id=?', (rev, camp))
            cambios = []
            for (col, dueno, id_), antes in registro.items():
                despues, _ = leer(con, camp, col, dueno, id_)
                if antes != despues:
                    cambios.append({'k': 'e', 'c': col, 'd': dueno, 'id': id_, 'antes': antes, 'despues': despues})
            if cambios:
                apuntar(con, camp, actor, 'datos', resumen or 'cambios', cambios,
                        [nombre_de(con, c['d']) for c in cambios if c['d']])
            con.execute('INSERT INTO transacciones (id, rev, autor, fecha, resumen, ops, campana) VALUES (?,?,?,?,?,?,?)',
                        (tx_id, rev, actor['nombre'], ahora(), resumen, json.dumps(ops, ensure_ascii=False), camp))
            con.execute('COMMIT')
            return {'ok': True, 'rev': rev}
        except BaseException:
            if con.in_transaction:
                con.execute('ROLLBACK')   # nada de estados a medias
            raise
        finally:
            con.close()


# ------------------------------------------------------ gestión de cuentas (DM)
def cambiar_rol(actor, cuerpo):
    """Dar o quitar poderes de DM en la campaña en la que está quien lo pide."""
    # Con superusuario, solo él reparte los poderes de DM. Sin él (no hay ALQUIMIA_ADMIN), los DM de la campaña.
    if actor['rol'] != 'admin' and (ADMIN_CLAVE or actor['rol'] != 'dm'):
        raise Rechazo('permiso', 'Solo el superusuario «DM» puede dar o quitar poderes de DM.')
    camp, objetivo, rol = actor['campana'], clave_de(cuerpo.get('usuario')), cuerpo.get('rol')
    if rol not in ('dm', 'jugador'):
        raise Rechazo('invalida', 'Rol desconocido.')

    def hacer(con):
        fila = buscar_usuario(con, objetivo)
        if not fila:
            raise Rechazo('invalida', 'Esa cuenta no existe.')
        if fila[2] == 'admin':
            raise Rechazo('permiso', 'El superusuario «DM» no se puede cambiar.')
        if not es_miembro(con, camp, objetivo):
            raise Rechazo('invalida', f'«{fila[1]}» no está en esta campaña. Invítalo primero.')
        if not ADMIN_CLAVE and rol == 'jugador' and con.execute(
                "SELECT COUNT(*) FROM miembros WHERE campana=? AND rol='dm' AND usuario!=?", (camp, objetivo)).fetchone()[0] == 0:
            raise Rechazo('invalida', 'Tiene que quedar al menos un DM en la campaña.')
        con.execute('UPDATE miembros SET rol=? WHERE campana=? AND usuario=?', (rol, camp, objetivo))
        apuntar(con, camp, actor, 'miembros', f'{"dio" if rol == "dm" else "quitó"} poderes de DM a {fila[1]}', None, [fila[1]])
        subir_rev(con, camp)
        return {'ok': True}
    return con_escritura(hacer)


def desterrar(actor, cuerpo):
    """Banear (ban=True) o readmitir (ban=False) una cuenta. Solo el superusuario."""
    if actor['rol'] != 'admin':
        raise Rechazo('permiso', 'Solo el superusuario «DM» puede desterrar cuentas.')
    objetivo, ban = clave_de(cuerpo.get('usuario')), bool(cuerpo.get('ban'))
    with CERROJO:
        con = conectar()
        try:
            con.execute('BEGIN IMMEDIATE')
            fila = buscar_usuario(con, objetivo)
            if not fila:
                raise Rechazo('invalida', 'Esa cuenta no existe.')
            if fila[2] == 'admin':
                raise Rechazo('permiso', 'El superusuario no se puede desterrar.')
            con.execute('UPDATE usuarios SET baneado=? WHERE clave=?', (1 if ban else 0, objetivo))
            if ban:   # fuera de la mesa ya: se cierran todas sus sesiones
                con.execute('DELETE FROM sesiones WHERE usuario=?', (objetivo,))
            subir_rev(con)
            con.execute('COMMIT')
            if ban:
                PRESENCIA.pop(objetivo, None)
            return {'ok': True}
        except BaseException:
            if con.in_transaction:
                con.execute('ROLLBACK')
            raise
        finally:
            con.close()


def cambiar_contrasena(actor, cuerpo):
    objetivo = clave_de(cuerpo.get('usuario') or actor['clave'])
    nueva = cuerpo.get('nueva')
    validar_contrasena(nueva)
    con = conectar()
    try:
        fila = buscar_usuario(con, objetivo)
        if not fila:
            raise Rechazo('invalida', 'Esa cuenta no existe.')
        if fila[2] == 'admin':
            raise Rechazo('permiso', 'La contraseña del superusuario «DM» es fija: se cambia en ALQUIMIA_ADMIN (archivo .env) y reiniciando el servidor.')
        if objetivo == actor['clave']:
            if not comprobar_contrasena(str(cuerpo.get('actual') or ''), fila[3]):
                raise Rechazo('credenciales', 'La contraseña actual no es correcta.')
        elif not es_dm(actor):
            raise Rechazo('permiso', 'Solo el DM puede cambiar la contraseña de otra persona.')
        elif actor['rol'] != 'admin' and not es_miembro(con, actor['campana'], objetivo):
            raise Rechazo('permiso', 'Solo puedes cambiar la contraseña de quien juega en tu campaña.')
        with CERROJO:
            con.execute('BEGIN IMMEDIATE')
            con.execute('UPDATE usuarios SET hash=? WHERE clave=?', (hash_contrasena(nueva), objetivo))
            if objetivo != actor['clave']:   # se cierran sus sesiones abiertas
                con.execute('DELETE FROM sesiones WHERE usuario=?', (objetivo,))
            con.execute('COMMIT')
        return {'ok': True}
    finally:
        con.close()


# ----------------------------------------------------------------------- HTTP
PROHIBIDO = ('/datos', '/.git', '/.env', '/servidor.py', '/Dockerfile', '/docker-compose')


class Manejador(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=RAIZ, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        self.send_header('X-Content-Type-Options', 'nosniff')   # el navegador no adivina tipos
        super().end_headers()

    def log_message(self, fmt, *args):
        if '/api/estado' not in (self.path or ''):   # no llenar la consola con los sondeos
            super().log_message(fmt, *args)

    def json(self, codigo, datos):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode('utf-8')
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def origen(self):
        """De dónde viene la petición. Detrás de Docker y de Tailscale Funnel todas llegan desde una IP
        interna (el proxy): entonces la IP real va en X-Forwarded-For. Esa cabecera solo se cree si la
        petición llega desde una IP interna; si llega directa de internet, cuenta su propia IP."""
        ip = self.client_address[0]
        try:
            interna = ipaddress.ip_address(ip).is_private or ipaddress.ip_address(ip).is_loopback
        except ValueError:
            interna = False
        reenviada = (self.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
        if interna and reenviada:
            try:
                return str(ipaddress.ip_address(reenviada))
            except ValueError:
                pass
        return ip

    def token(self):
        a = self.headers.get('Authorization', '')
        return a[7:].strip() if a.startswith('Bearer ') else ''

    def actor(self):
        """La persona que hace la petición (o None si no ha entrado), sin campaña."""
        return usuario_de_token(self.token())

    def actor_mesa(self, con, u):
        """La persona dentro de la campaña que dice la cabecera X-Campana (o None). Apunta su presencia."""
        a = actor_en_mesa(con, u, self.headers.get('X-Campana', ''))
        if a:
            apuntar_presencia(a['clave'], unquote(self.headers.get('X-Lugar', '')), self.headers.get('X-Visible', '1') != '0',
                              a['campana'])
        return a

    def sin_sesion(self):
        return self.json(401, {'ok': False, 'motivo': 'sesion', 'mensaje': 'Tienes que entrar con tu cuenta.'})

    def sin_mesa(self):
        return self.json(403, {'ok': False, 'motivo': 'mesa',
                               'mensaje': 'No estás en esa campaña (o ya no existe). Elige otra mesa.'})

    def do_GET(self):
        url = urlparse(self.path)
        ruta = url.path
        if ruta == '/health':
            return self.json(200, {'ok': True})
        if ruta.startswith('/api/'):
            if ruta == '/api/info':   # pública: la pantalla de entrada la necesita
                con = conectar()
                try:
                    hay = bool(con.execute('SELECT 1 FROM usuarios LIMIT 1').fetchone())
                finally:
                    con.close()
                return self.json(200, {'ok': True, 'cuentas': True, 'hayUsuarios': hay, 'pideClave': bool(CLAVE)})
            u = self.actor()
            if not u:
                return self.sin_sesion()
            q = parse_qs(url.query)
            con = conectar()
            try:
                # --- sin campaña: quién soy y en qué campañas juego
                if ruta == '/api/yo':
                    u = {**u, 'avatar': versiones_avatar(con).get(u['clave'], 0)}
                    return self.json(200, {'ok': True, 'usuario': u, 'campanas': campanas_de(con, u),
                                           'puedeCrear': puede_crear_campanas(con, u)})
                if ruta.startswith('/api/avatar/'):
                    # La foto de una cuenta (solo para quien ha entrado). Va con su tipo exacto y sin
                    # posibilidad de que el navegador la interprete como página o script.
                    fila = con.execute('SELECT tipo, datos FROM avatares WHERE usuario=?',
                                       (unquote(ruta[len('/api/avatar/'):]),)).fetchone()
                    if not fila or fila[0] not in ('image/png', 'image/jpeg', 'image/webp'):
                        return self.json(404, {'ok': False, 'mensaje': 'Sin foto.'})
                    datos = bytes(fila[1])
                    self.send_response(200)
                    self.send_header('Content-Type', fila[0])
                    self.send_header('Content-Length', str(len(datos)))
                    self.send_header('Content-Security-Policy', "default-src 'none'; sandbox")
                    self.send_header('Content-Disposition', 'inline; filename="avatar"')
                    self.end_headers()
                    self.wfile.write(datos)
                    return
                if ruta == '/api/campanas':
                    if not es_admin(u) and not puede_crear_campanas(con, u):
                        return self.json(200, {'ok': True, 'campanas': campanas_de(con, u)})
                    return self.json(200, {'ok': True, 'campanas': resumen_campanas(con) if es_admin(u) else campanas_de(con, u),
                                           'cuentas': lista_cuentas(con, u) if es_admin(u) else [],
                                           'bloqueos': bloqueos_registro(con) if es_admin(u) else []})
                # --- dentro de una campaña
                actor = self.actor_mesa(con, u)
                if not actor:
                    return self.sin_mesa()
                camp = actor['campana']
                if ruta == '/api/estado':
                    rev = rev_actual(con, camp)
                    try:
                        desde = int(q.get('rev', ['-1'])[0] or -1)
                    except ValueError:
                        desde = -1
                    base = {'ok': True, 'rev': rev, 'usuario': actor, 'presencia': lista_presencia(con, camp)}
                    if desde == rev:
                        return self.json(200, {**base, 'igual': True})
                    otros = []
                    if desde >= 0:
                        otros = [{'rev': r, 'autor': a, 'resumen': s} for r, a, s in con.execute(
                            'SELECT rev, autor, resumen FROM transacciones WHERE campana=? AND rev>? ORDER BY rev LIMIT 20',
                            (camp, desde))]
                    return self.json(200, {**base, 'datos': estado_completo(con, camp, actor['clave']), 'cambios': otros})
                if ruta == '/api/presencia':
                    return self.json(200, {'ok': True, 'presencia': lista_presencia(con, camp)})
                if ruta == '/api/historial':
                    # El historial lo ven el DM de la campaña y el superusuario; nadie puede borrarlo
                    if not es_dm(actor):
                        return self.json(403, {'ok': False, 'motivo': 'permiso', 'mensaje': 'Solo para el DM.'})
                    try:
                        antes_de = int(q.get('antes', ['0'])[0]) or None
                    except ValueError:
                        antes_de = None
                    return self.json(200, {'ok': True, 'historial': lista_historial(con, camp, antes_de),
                                           'puedeDeshacer': es_admin(actor)})
                if ruta == '/api/mesa/perfiles':
                    return self.json(200, {'ok': True, 'perfiles': perfiles(con, camp)})
                if ruta == '/api/cuentas':
                    # Para invitar a la campaña: el DM ve las cuentas (sin los desterrados)
                    if not es_dm(actor):
                        return self.json(403, {'ok': False, 'motivo': 'permiso', 'mensaje': 'Solo para el DM.'})
                    return self.json(200, {'ok': True, 'cuentas': lista_cuentas(con, actor, camp)})
                if ruta == '/api/jugadores':
                    if not es_dm(actor):
                        return self.json(403, {'ok': False, 'motivo': 'permiso', 'mensaje': 'Solo para el DM.'})
                    # Solo los de esta campaña. El superusuario no es un personaje: no sale en la lista de inventarios
                    jugadores = [{'clave': c, 'nombre': n, 'rol': r, 'disciplina': d, 'baneado': bool(b),
                                  'personaje': (leer_personaje(pj) or {}).get('nombre') or '', **inventario_de(con, camp, c)}
                                 for c, n, r, d, b, pj in con.execute(
                                     'SELECT u.clave, u.nombre, m.rol, m.disciplina, u.baneado, m.personaje FROM miembros m '
                                     'JOIN usuarios u ON u.clave=m.usuario WHERE m.campana=? '
                                     'ORDER BY u.nombre COLLATE NOCASE', (camp,)).fetchall()]
                    return self.json(200, {'ok': True, 'rev': rev_actual(con, camp), 'jugadores': jugadores})
                if ruta == '/api/diario':
                    try:
                        n = min(int(q.get('n', ['50'])[0]), 500)
                    except ValueError:
                        n = 50
                    filas = con.execute('SELECT rev, autor, fecha, resumen FROM transacciones WHERE campana=? '
                                        'ORDER BY rev DESC LIMIT ?', (camp, n))
                    return self.json(200, {'ok': True, 'diario': [
                        {'rev': r, 'autor': a, 'fecha': f, 'resumen': s} for r, a, f, s in filas]})
            finally:
                con.close()
            return self.json(404, {'ok': False, 'mensaje': 'No existe.'})
        if ruta.startswith(PROHIBIDO) or '/.' in ruta:
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        ruta = urlparse(self.path).path
        if ruta.startswith(PROHIBIDO) or '/.' in ruta:
            return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        ruta = urlparse(self.path).path
        acciones = ('/api/transaccion', '/api/registro', '/api/entrar', '/api/salir',
                    '/api/usuarios/rol', '/api/usuarios/contrasena', '/api/usuarios/destierro',
                    '/api/campanas/crear', '/api/registro/desbloquear', '/api/campanas/renombrar', '/api/campanas/unirse',
                    '/api/mesa/miembro', '/api/mesa/disciplina', '/api/mesa/personaje', '/api/mesa/clave', '/api/historial/deshacer', '/api/yo/avatar')
        if ruta not in acciones:
            return self.json(404, {'ok': False, 'mensaje': 'No existe.'})
        largo = int(self.headers.get('Content-Length') or 0)
        if largo > MAX_CUERPO:
            return self.json(413, {'ok': False, 'motivo': 'invalida', 'mensaje': 'Petición demasiado grande.'})
        try:
            cuerpo = json.loads(self.rfile.read(largo).decode('utf-8') or '{}') if largo else {}
            if not isinstance(cuerpo, dict):
                raise ValueError
        except ValueError:
            return self.json(400, {'ok': False, 'motivo': 'invalida', 'mensaje': 'JSON no válido.'})
        try:
            if ruta == '/api/registro':
                return self.json(200, registrar(cuerpo, self.origen()))
            if ruta == '/api/entrar':
                return self.json(200, entrar(cuerpo, self.origen()))
            if ruta == '/api/salir':
                if self.token():
                    u = usuario_de_token(self.token())
                    cerrar_sesion(self.token())
                    if u:
                        PRESENCIA.pop(u['clave'], None)
                return self.json(200, {'ok': True})
            u = self.actor()
            if not u:
                return self.sin_sesion()
            # --- sin campaña
            if ruta == '/api/usuarios/destierro':
                return self.json(200, desterrar(u, cuerpo))
            if ruta == '/api/campanas/crear':
                return self.json(200, crear_campana(u, cuerpo))
            if ruta == '/api/registro/desbloquear':
                return self.json(200, desbloquear_registro(u, cuerpo))
            if ruta == '/api/campanas/renombrar':
                return self.json(200, renombrar_campana(u, cuerpo))
            if ruta == '/api/campanas/unirse':
                return self.json(200, unirse(u, cuerpo, self.origen()))
            if ruta == '/api/yo/avatar':   # la foto es de la cuenta, no de una campaña
                return self.json(200, guardar_avatar(u, cuerpo))
            con = conectar()
            try:
                actor = self.actor_mesa(con, u)
            finally:
                con.close()
            if ruta == '/api/usuarios/contrasena':   # la propia se puede cambiar estando o no en una campaña
                return self.json(200, cambiar_contrasena(actor or u, cuerpo))
            # --- dentro de una campaña
            if not actor:
                return self.sin_mesa()
            if ruta == '/api/transaccion':
                if largo <= 0:
                    return self.json(400, {'ok': False, 'motivo': 'invalida', 'mensaje': 'Petición vacía.'})
                return self.json(200, transaccion(cuerpo, actor))
            if ruta == '/api/usuarios/rol':
                return self.json(200, cambiar_rol(actor, cuerpo))
            if ruta == '/api/mesa/miembro':
                return self.json(200, miembro(actor, cuerpo))
            if ruta == '/api/mesa/disciplina':
                return self.json(200, cambiar_disciplina(actor, cuerpo))
            if ruta == '/api/mesa/personaje':
                return self.json(200, guardar_personaje(actor, cuerpo))
            if ruta == '/api/mesa/clave':
                return self.json(200, poner_clave_mesa(actor, cuerpo))
            if ruta == '/api/historial/deshacer':
                return self.json(200, deshacer(actor, cuerpo))
        except Rechazo as r:
            codigo = {'stock': 409, 'conflicto': 409, 'existe': 409, 'permiso': 403,
                      'credenciales': 401, 'clave': 401, 'espera': 429, 'baneado': 403, 'bloqueado': 429}.get(r.motivo, 400)
            return self.json(codigo, {'ok': False, 'motivo': r.motivo, 'mensaje': r.mensaje, 'detalle': r.detalle})
        except sqlite3.Error as e:
            print('Error de base de datos:', e, file=sys.stderr)
            return self.json(503, {'ok': False, 'motivo': 'bd', 'mensaje': 'La base de datos no respondió. No se ha guardado nada; se reintentará.'})


# ------------------------------------------------------------ copias de seguridad
COPIAS_DIR = os.path.join(os.path.dirname(DB_PATH) or '.', 'copias')
COPIAS_A_GUARDAR = 7


def hacer_copia(etiqueta=''):
    """Copia en caliente (consistente aunque haya gente usando la app) y borra las viejas."""
    try:
        if not os.path.exists(DB_PATH):
            return
        os.makedirs(COPIAS_DIR, exist_ok=True)
        if etiqueta:   # copias especiales (antes de cambiar el formato): no se borran solas
            destino = os.path.join(COPIAS_DIR, f'{etiqueta}-' + datetime.now().strftime('%Y-%m-%d_%H%M%S') + '.db')
        else:
            destino = os.path.join(COPIAS_DIR, 'alquimia-' + datetime.now().strftime('%Y-%m-%d_%H%M') + '.db')
        origen = conectar()
        copia = sqlite3.connect(destino)
        with copia:
            origen.backup(copia)
        copia.close(); origen.close()
        copias = sorted(f for f in os.listdir(COPIAS_DIR) if f.startswith('alquimia-') and f.endswith('.db'))
        for viejo in copias[:-COPIAS_A_GUARDAR]:
            os.remove(os.path.join(COPIAS_DIR, viejo))
        print('Copia de seguridad:', destino)
    except Exception as e:
        print('No se pudo hacer la copia de seguridad:', e, file=sys.stderr)


def copias_periodicas():
    while True:
        hacer_copia()
        time.sleep(24 * 3600)


def orden_consola(args):
    """python servidor.py restablecer NOMBRE CONTRASEÑA  |  hacer-dm NOMBRE  |  readmitir NOMBRE  |  desbloquear"""
    preparar_bd()
    con = conectar()
    try:
        orden, nombre = args[0], args[1] if len(args) > 1 else ''
        if orden == 'desbloquear':   # levanta todos los bloqueos de creación de cuentas
            n = con.execute('DELETE FROM bloqueos_registro').rowcount
            print(f'Bloqueos de creación de cuentas levantados: {n}.')
            return 0
        fila = buscar_usuario(con, clave_de(nombre))
        if not fila:
            print(f'No existe ninguna cuenta llamada «{nombre}».')
            return 1
        if orden == 'restablecer' and len(args) == 3:
            validar_contrasena(args[2])
            con.execute('UPDATE usuarios SET hash=? WHERE clave=?', (hash_contrasena(args[2]), fila[0]))
            con.execute('DELETE FROM sesiones WHERE usuario=?', (fila[0],))
            print(f'Contraseña de «{fila[1]}» cambiada.')
            return 0
        if orden == 'readmitir':
            con.execute('UPDATE usuarios SET baneado=0 WHERE clave=?', (fila[0],))
            print(f'«{fila[1]}» vuelve a ser bienvenido en la mesa.')
            return 0
        if orden == 'hacer-dm':
            nombre_c = ' '.join(args[2:])
            c = (con.execute('SELECT id, nombre FROM campanas WHERE nombre=? COLLATE NOCASE', (nombre_c,)).fetchone() if nombre_c
                 else con.execute('SELECT id, nombre FROM campanas ORDER BY creada LIMIT 1').fetchone())
            if not c:
                print(f'No existe ninguna campaña llamada «{nombre_c}».' if nombre_c else 'Todavía no hay ninguna campaña.')
                return 1
            con.execute("INSERT INTO miembros (campana, usuario, rol, disciplina, unido) VALUES (?,?,'dm',?,?) "
                        "ON CONFLICT(campana, usuario) DO UPDATE SET rol='dm'", (c[0], fila[0], DISCIPLINA_DEFECTO, ahora()))
            con.execute('UPDATE campanas SET rev=rev+1 WHERE id=?', (c[0],))
            print(f'«{fila[1]}» ahora es DM de «{c[1]}».')
            return 0
        print(orden_consola.__doc__)
        return 1
    except Rechazo as r:
        print(r.mensaje)
        return 1
    finally:
        con.close()


def main():
    if len(sys.argv) > 1 and not sys.argv[1].isdigit():
        sys.exit(orden_consola(sys.argv[1:]))
    preparar_bd()
    threading.Thread(target=copias_periodicas, daemon=True).start()
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer.daemon_threads = True
    with http.server.ThreadingHTTPServer((HOST, PUERTO), Manejador) as srv:
        print(f'Alquimia en http://localhost:{PUERTO}  (Ctrl+C para cerrar)')
        print(f'Base de datos: {DB_PATH}')
        print('Crear cuentas: ' + ('pide la palabra de paso de la mesa (ALQUIMIA_CLAVE)' if CLAVE
              else 'libre (pon ALQUIMIA_CLAVE si lo abres a internet)'))
        print('Superusuario «DM»: ' + ('activo (contraseña de ALQUIMIA_ADMIN)' if len(ADMIN_CLAVE) >= 6
              else 'desactivado (pon ALQUIMIA_ADMIN en el archivo .env)'))
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
