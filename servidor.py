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
# les asigna disciplina (alquimista, cocinero, hechicero, herrero, o bien
# desempleado = ningún oficio, pluriempleado = todos) y puede ver y
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
#   python servidor.py aprobar NOMBRE
#                                 -> aprueba una cuenta de Discord pendiente
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
#   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
#                   aplicación de Discord (V3.6): crear cuenta sin la palabra de paso (queda pendiente
#                   de que la apruebe un DM) y vincular Discord a una cuenta. Vacías = sin Discord.
#                   Se entra siempre con nombre y contraseña. Ver docs/DISCORD.md.
#   ALQUIMIA_URL    dirección pública de la app (p. ej. https://TU-MAQUINA.TU-RED.ts.net).
#                   Discord vuelve ahí después de entrar. Desde localhost se usa http://localhost:PUERTO.
#
# Solo usa la biblioteca estándar de Python 3: no hace falta instalar nada.

import base64, binascii, http.server, ipaddress, json, os, signal, sqlite3, sys, threading, time, hmac, hashlib, secrets, re, unicodedata
import urllib.request, urllib.error
import smtplib, ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs, unquote, urlencode, quote

RAIZ = os.path.dirname(os.path.abspath(__file__))

# Versión de la app y lo que trae de nuevo, en una línea. Al arrancar con una versión distinta de la
# última anunciada, Dobby lo cuenta en el chat general. Al publicar una versión nueva, cambia las dos.
VERSION = '3.10'
NOVEDADES = ('chat general con Dobby y Dobby Jr. en cada mesa, campañas abiertas, con contraseña o solo por invitación, '
             '«En línea» con todas las cuentas, avisos personales y chats privados.')
PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else int(os.environ.get('PORT', '8080'))
HOST = os.environ.get('HOST', '0.0.0.0')
DB_PATH = os.environ.get('DB_PATH') or os.path.join(RAIZ, 'datos', 'alquimia.db')
CLAVE = os.environ.get('ALQUIMIA_CLAVE', '')
ADMIN_CLAVE = os.environ.get('ALQUIMIA_ADMIN', '')
ADMIN_NOMBRE = 'DM'               # el superusuario se llama así (su clave es 'dm')
MAX_CUERPO = 5 * 1024 * 1024      # 5 MB por petición, de sobra para un import completo
FALLOS_REGISTRO = 7               # fallos SEGUIDOS de la palabra de paso que bloquean crear cuentas
HORAS_BLOQUEO = 24                # ...durante este tiempo (o hasta que el superusuario lo levante)

# Discord (OAuth2) para crear cuenta sin palabra de paso y para vincular. Solo se pide «identify» (id y nombre).
DISCORD_ID = os.environ.get('DISCORD_CLIENT_ID', '').strip()
DISCORD_SECRETO = os.environ.get('DISCORD_CLIENT_SECRET', '').strip()
DISCORD_ACTIVO = bool(DISCORD_ID and DISCORD_SECRETO)
URL_PUBLICA = os.environ.get('ALQUIMIA_URL', '').strip().rstrip('/')
# Correo (V3.8): para recuperar la contraseña olvidada. Sin CORREO_USUARIO y CORREO_CLAVE no hay correo.
# Con Gmail: CORREO_USUARIO = la dirección de Gmail y CORREO_CLAVE = una «contraseña de aplicación» (ver docs/CORREO.md).
CORREO_SERVIDOR = os.environ.get('CORREO_SERVIDOR', '').strip() or 'smtp.gmail.com'
CORREO_PUERTO = int(os.environ.get('CORREO_PUERTO', '').strip() or '587')
CORREO_USUARIO = os.environ.get('CORREO_USUARIO', '').strip()
CORREO_CLAVE = os.environ.get('CORREO_CLAVE', '').replace(' ', '').strip()   # Google la enseña en grupos de 4
CORREO_REMITENTE = os.environ.get('CORREO_REMITENTE', '').strip() or CORREO_USUARIO
CORREO_ACTIVO = bool(CORREO_USUARIO and CORREO_CLAVE)
MAX_PENDIENTES = 20               # cuentas de Discord esperando aprobación a la vez (frena el spam)

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
    'bolsa': 'num',         # monedas del jugador: bolsa['oro'] = monedas de oro (V3.7)
    'odres': 'obj',         # odres de cada jugador para los disolventes que no son agua (V3.8)
    'descubrimientos': 'obj',  # de la mesa: material -> {jugador: fecha} en que lo recibió por primera vez (V3.8)
}
# Estas son de cada jugador; las demás, de toda la mesa.
# Un módulo nuevo (cocina, ficha...) que guarde cosas de cada jugador se añade aquí.
POR_JUGADOR = ('inventory', 'potions', 'lootPotions', 'libros', 'perfil', 'objetos', 'bolsa', 'odres')
MAX_MONEDAS = 999_999_999       # tope de la bolsa (para que nadie escriba un número absurdo)
# Odres (V3.8): los disolventes que no son agua se llevan en odres. Cada poción gasta 0,5 L.
# Cada jugador empieza con un odre vacío de 3 L (se lo da el servidor la primera vez que entra en la mesa).
DISOLVENTES_ODRE = ('Mente', 'Alma', 'Mágico')     # campos cuyo disolvente va en odre (Cuerpo = agua)
ODRE_INICIAL = {'name': 'Odre', 'capacidad': 3, 'litros': 0, 'disolvente': None}
MAX_LITROS_ODRE = 100
# Lo que un jugador puede pasar a otro de su mesa (op «dar»)
SE_PUEDE_DAR = ('inventory', 'potions', 'lootPotions', 'objetos', 'libros', 'odres', 'bolsa')
COMUN = ''   # "dueño" de lo que es de toda la mesa

# Campañas (mesas). Todo lo que hay en «entradas» y «transacciones» es de una campaña.
PRIMERA = 'primera'               # id de la primera campaña (la de los datos de antes de las campañas)
NOMBRE_PRIMERA = 'La primera campaña'
# Disciplinas que el DM asigna a cada jugador. Por defecto, todos alquimistas.
# 'desempleado' no tiene ningún oficio; 'pluriempleado' los tiene todos (elige cuál usar en la mesa).
DISCIPLINAS = ('alquimista', 'cocinero', 'hechicero', 'herrero', 'desempleado', 'pluriempleado')
DISCIPLINA_DEFECTO = 'alquimista'
# V3.7: el DM marca a qué oficios tiene acceso cada jugador (uno, varios, todos o ninguno).
# Se guarda en miembros.disciplina: 'desempleado' (ninguno), un oficio, o varios separados por comas.
OFICIOS = ('alquimista', 'cocinero', 'hechicero', 'herrero')


NOMBRE_OFICIO = {'alquimista': 'alquimista', 'cocinero': 'cocinero', 'hechicero': 'hechicero', 'herrero': 'herrero'}


def texto_oficios(disc):
    if disc == 'desempleado':
        return 'sin oficio'
    lista = [NOMBRE_OFICIO.get(o, o) for o in str(disc).split(',')]
    return ', '.join(lista[:-1]) + ' y ' + lista[-1] if len(lista) > 1 else lista[0]


def normalizar_disciplina(x):
    """Lista de oficios (o texto antiguo) -> lo que se guarda. None si no vale."""
    if isinstance(x, str):
        if x in ('desempleado', 'pluriempleado'):
            x = [] if x == 'desempleado' else list(OFICIOS)
        else:
            x = [t.strip() for t in x.split(',') if t.strip()]
    if not isinstance(x, list) or len(x) > len(OFICIOS) or any(t not in OFICIOS for t in x):
        return None
    elegidos = [o for o in OFICIOS if o in x]
    return ','.join(elegidos) if elegidos else 'desempleado'

ITERACIONES = 600_000             # PBKDF2-SHA256 para las contraseñas (lo que recomienda OWASP). Las huellas
                                  # antiguas (200.000) se rehacen solas la próxima vez que esa persona entra.
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
                clave_hash TEXT, acceso TEXT NOT NULL DEFAULT 'abierta');
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
        # Cómo se entra en cada campaña: 'abierta' (cualquier cuenta entra sola), 'clave' (con la contraseña
        # de la mesa) o 'invitacion' (solo si el DM invita). Al crear la columna: con contraseña → 'clave', sin ella → 'abierta'.
        if 'acceso' not in [f[1] for f in con.execute('PRAGMA table_info(campanas)')]:
            con.execute("ALTER TABLE campanas ADD COLUMN acceso TEXT NOT NULL DEFAULT 'abierta'")
            con.execute("UPDATE campanas SET acceso = CASE WHEN clave_hash IS NOT NULL THEN 'clave' ELSE 'abierta' END")
        if 'personaje' not in [f[1] for f in con.execute('PRAGMA table_info(miembros)')]:
            con.execute('ALTER TABLE miembros ADD COLUMN personaje TEXT')
        if 'baneado' not in [f[1] for f in con.execute('PRAGMA table_info(usuarios)')]:
            con.execute('ALTER TABLE usuarios ADD COLUMN baneado INTEGER NOT NULL DEFAULT 0')
        # V3.6: Discord. «pendiente» = cuenta creada con Discord que aún no ha aprobado un DM.
        cols_u = [f[1] for f in con.execute('PRAGMA table_info(usuarios)')]
        if 'discord_id' not in cols_u:
            con.execute('ALTER TABLE usuarios ADD COLUMN discord_id TEXT')
        if 'discord_nombre' not in cols_u:
            con.execute('ALTER TABLE usuarios ADD COLUMN discord_nombre TEXT')
        if 'pendiente' not in cols_u:
            con.execute('ALTER TABLE usuarios ADD COLUMN pendiente INTEGER NOT NULL DEFAULT 0')
        # V3.8: correo para recuperar la contraseña. «correo» = ya confirmado (el único que se usa);
        # «correo_pendiente» = escrito pero aún sin confirmar con el enlace que se le manda.
        if 'correo' not in cols_u:
            con.execute('ALTER TABLE usuarios ADD COLUMN correo TEXT')
        if 'correo_pendiente' not in cols_u:
            con.execute('ALTER TABLE usuarios ADD COLUMN correo_pendiente TEXT')
        con.execute('CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo ON usuarios (correo) WHERE correo IS NOT NULL')
        # Enlaces que se mandan por correo: solo se guarda la HUELLA del token (como con las sesiones).
        # tipo 'recuperar' (cambiar la contraseña) o 'verificar' (confirmar el correo). Un solo uso.
        con.execute('''CREATE TABLE IF NOT EXISTS enlaces_correo (
            token TEXT PRIMARY KEY, usuario TEXT NOT NULL, tipo TEXT NOT NULL, correo TEXT, creado REAL, caduca REAL NOT NULL)''')
        con.execute('DELETE FROM enlaces_correo WHERE caduca < ?', (time.time(),))
        # V3.9: cuentas a medio crear con correo (no existen hasta que se abre el enlace)
        con.execute('''CREATE TABLE IF NOT EXISTS altas_pendientes (
            token TEXT PRIMARY KEY, clave TEXT NOT NULL, nombre TEXT NOT NULL, hash TEXT NOT NULL, correo TEXT NOT NULL,
            creado REAL, caduca REAL NOT NULL)''')
        # V3.8: solicitudes de campaña. Un jugador pide una campaña; el superusuario la aprueba o la rechaza.
        # estado: pendiente | aprobada | rechazada | cancelada. Cada cuenta solo puede tener UNA pendiente.
        con.execute('''CREATE TABLE IF NOT EXISTS solicitudes_campana (
            id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL, nombre TEXT NOT NULL, motivo TEXT,
            creada TEXT, estado TEXT NOT NULL DEFAULT 'pendiente', resuelta TEXT, nota TEXT, campana TEXT)''')
        con.execute("CREATE UNIQUE INDEX IF NOT EXISTS solicitud_unica ON solicitudes_campana (usuario) WHERE estado='pendiente'")
        con.execute('CREATE UNIQUE INDEX IF NOT EXISTS usuarios_discord ON usuarios (discord_id) WHERE discord_id IS NOT NULL')
        # V3.9: chat de la mesa. autor '' = el bot de la mesa (Dobby). Solo se añaden mensajes.
        con.execute('''CREATE TABLE IF NOT EXISTS chat (
            id INTEGER PRIMARY KEY AUTOINCREMENT, campana TEXT NOT NULL, autor TEXT NOT NULL, nombre TEXT NOT NULL,
            texto TEXT NOT NULL, fecha TEXT)''')
        con.execute('CREATE INDEX IF NOT EXISTS chat_campana ON chat (campana, id)')
        if 'borrado' not in [f[1] for f in con.execute('PRAGMA table_info(chat)')]:
            # Moderación: el DM o el superusuario retiran un mensaje (no se borra de la base: queda quién y cuándo)
            con.execute('ALTER TABLE chat ADD COLUMN borrado INTEGER NOT NULL DEFAULT 0')
            con.execute('ALTER TABLE chat ADD COLUMN borrado_por TEXT')
            con.execute('ALTER TABLE chat ADD COLUMN borrado_fecha TEXT')
        # Quién ha entrado ya alguna vez en cada mesa (para que el bot dé la bienvenida solo la primera vez).
        # Al crear la tabla, todos los que ya estaban en una mesa cuentan como llegados: no hay bienvenidas en masa.
        if not con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_llegadas'").fetchone():
            con.execute('CREATE TABLE chat_llegadas (campana TEXT NOT NULL, usuario TEXT NOT NULL, fecha TEXT, PRIMARY KEY (campana, usuario))')
            con.execute('INSERT OR IGNORE INTO chat_llegadas SELECT campana, usuario, ? FROM miembros', (ahora(),))
        # Avisos personales: lo que le ha pasado a cada cuenta (le han invitado, le han dado algo, el DM ha
        # cambiado sus cosas...). Se ven en la pestaña 🔔 del chat. Solo los ve su dueño.
        con.execute('''CREATE TABLE IF NOT EXISTS avisos (
            id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL, texto TEXT NOT NULL, campana TEXT, fecha TEXT,
            leido INTEGER NOT NULL DEFAULT 0)''')
        con.execute('CREATE INDEX IF NOT EXISTS avisos_usuario ON avisos (usuario, id)')
        # Chats privados entre dos cuentas (pestaña ✉️ del chat). Solo los ven las dos personas.
        con.execute('''CREATE TABLE IF NOT EXISTS privados (
            id INTEGER PRIMARY KEY AUTOINCREMENT, de TEXT NOT NULL, para TEXT NOT NULL, texto TEXT NOT NULL, fecha TEXT,
            leido INTEGER NOT NULL DEFAULT 0)''')
        con.execute('CREATE INDEX IF NOT EXISTS privados_para ON privados (para, leido)')
        con.execute('CREATE INDEX IF NOT EXISTS privados_de ON privados (de, para, id)')
        cols_c = [f[1] for f in con.execute('PRAGMA table_info(campanas)')]
        if 'bot_nombre' not in cols_c:
            con.execute('ALTER TABLE campanas ADD COLUMN bot_nombre TEXT')
        if 'bot_bienvenida' not in cols_c:
            con.execute('ALTER TABLE campanas ADD COLUMN bot_bienvenida TEXT')
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
        # V3.8: lo que ya llevaba cada jugador cuenta como material descubierto (una sola vez)
        if not con.execute("SELECT 1 FROM ajustes WHERE clave='descubrimientos-v38'").fetchone():
            con.execute('BEGIN IMMEDIATE')
            n = migrar_descubrimientos(con)
            con.execute("INSERT OR IGNORE INTO ajustes VALUES ('descubrimientos-v38', ?)", (ahora(),))
            con.execute('COMMIT')
            if n:
                print(f'Catálogo por descubrimiento: {n} materiales que ya tenían los jugadores cuentan como descubiertos.')
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


def huella_antigua(guardado):
    try:
        return int(guardado.split('$')[1]) < ITERACIONES
    except (ValueError, IndexError, AttributeError):
        return False


# Para que comprobar una cuenta inexistente tarde lo mismo que una real
HASH_FALSO = hash_contrasena('no-existe')


def usuario_publico(fila):
    # Fuera de una campaña solo importa si es el superusuario; el papel (DM o jugador) es de cada campaña.
    return {'clave': fila[0], 'nombre': fila[1], 'rol': 'admin' if fila[2] == 'admin' else 'jugador'}


def buscar_usuario(con, clave):
    return con.execute('SELECT clave, nombre, rol, hash, baneado, pendiente FROM usuarios WHERE clave=?', (clave,)).fetchone()



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


def alta_en_bd(con, nombre, huella, correo=None):
    """Crea la cuenta dentro de una transacción abierta. La primera cuenta es el DM de la primera campaña."""
    primera = not con.execute("SELECT 1 FROM usuarios WHERE rol!='admin' LIMIT 1").fetchone()
    clave = clave_de(nombre)
    if buscar_usuario(con, clave):
        raise Rechazo('existe', f'Ya existe una cuenta llamada «{nombre}». Elige otro nombre o entra con ella.')
    con.execute('INSERT INTO usuarios (clave, nombre, hash, rol, creado, baneado, correo) VALUES (?,?,?,?,?,0,?)',
                (clave, nombre, huella, 'dm' if primera else 'jugador', ahora(), correo))
    if primera:
        # La primera cuenta es el DM de la primera campaña (se crea si aún no existe).
        con.execute('INSERT OR IGNORE INTO campanas (id, nombre, creada, rev) VALUES (?,?,?,0)',
                    (PRIMERA, NOMBRE_PRIMERA, ahora()))
        con.execute('INSERT OR REPLACE INTO miembros (campana, usuario, rol, disciplina, unido) VALUES (?,?,?,?,?)',
                    (PRIMERA, clave, 'dm', DISCIPLINA_DEFECTO, ahora()))
        adoptar_huerfanos(con, PRIMERA, clave)
    # Las demás cuentas no están en ninguna campaña hasta que un DM las invite (o pidan una campaña).
    token = abrir_sesion(con, clave)
    usuario = {'clave': clave, 'nombre': nombre, 'rol': 'jugador'}
    return {'ok': True, 'token': token, 'usuario': usuario, 'primera': primera, 'campanas': campanas_de(con, usuario)}


def registrar(cuerpo, origen='-'):
    """Crear cuenta (V3.9). Con correo o Discord configurados, la cuenta se crea de una de estas formas:
     - con CORREO: se manda un enlace y la cuenta no existe hasta que se abre (ver confirmar_alta);
     - con DISCORD: por /api/discord/empezar (modo «crear»), no por aquí;
     - con la PALABRA DE PASO de la mesa (opción oculta, por si acaso): se crea al momento.
    Sin correo ni Discord en el servidor, como siempre: palabra de paso (si la hay) y al momento."""
    nombre = re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(cuerpo.get('nombre') or '')).strip())
    contrasena = cuerpo.get('contrasena')
    if not NOMBRE_OK.match(nombre):
        raise Rechazo('invalida', 'El nombre debe tener de 2 a 24 letras o números (también valen espacios, guiones y puntos).')
    validar_contrasena(contrasena)
    con_verificacion = CORREO_ACTIVO or DISCORD_ACTIVO
    if con_verificacion and not cuerpo.get('clave'):
        if not CORREO_ACTIVO:
            raise Rechazo('invalida', 'Crea la cuenta con Discord.')
        if not cuerpo.get('correo'):
            raise Rechazo('invalida', 'Escribe tu correo' + (' o crea la cuenta con Discord.' if DISCORD_ACTIVO else '.'))
        return pedir_alta(nombre, contrasena, limpiar_correo(cuerpo.get('correo')), origen)
    if con_verificacion and not CLAVE:
        raise Rechazo('clave', 'Este servidor no tiene palabra de paso: crea la cuenta con tu correo' + (' o con Discord.' if DISCORD_ACTIVO else '.'))
    comprobar_palabra_de_paso(cuerpo, origen)
    huella = hash_contrasena(contrasena)
    return con_escritura(lambda con: alta_en_bd(con, nombre, huella))


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
        if fila[5]:
            raise Rechazo('pendiente', 'Tu cuenta todavía espera a que el DM la apruebe. Avísale y vuelve a probar cuando lo haga.')
        if fila[2] == 'admin' and not ADMIN_CLAVE:
            raise Rechazo('credenciales', 'El superusuario «DM» está desactivado (falta ALQUIMIA_ADMIN en el archivo .env).')
        # Huella hecha con menos vueltas: se rehace ahora que se tiene la contraseña a mano (fuera del cerrojo: tarda)
        rehecha = hash_contrasena(contrasena) if fila[2] != 'admin' and huella_antigua(fila[3]) else None
        with CERROJO:
            if rehecha:
                con.execute('UPDATE usuarios SET hash=? WHERE clave=?', (rehecha, clave))
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
                           'WHERE s.token=? AND u.baneado=0 AND u.pendiente=0', (th,)).fetchone()
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
        return [{'id': i, 'nombre': n, 'rol': 'admin', 'disciplina': 'pluriempleado'} for i, n in filas]
    filas = con.execute('SELECT c.id, c.nombre, m.rol, m.disciplina FROM miembros m JOIN campanas c ON c.id=m.campana '
                        'WHERE m.usuario=? ORDER BY c.creada, c.nombre', (u['clave'],)).fetchall()
    return [{'id': i, 'nombre': n, 'rol': r, 'disciplina': d} for i, n, r, d in filas]


ACCESOS = ('abierta', 'clave', 'invitacion')


def acceso_de(acceso, clave_hash):
    """El modo de entrada de una campaña. 'clave' sin contraseña guardada no puede abrirse: se trata como invitación."""
    if acceso == 'clave':
        return 'clave' if clave_hash else 'invitacion'
    return acceso if acceso in ACCESOS else 'invitacion'


def otras_campanas(con, u):
    """Las campañas en las que NO juega, para el selector: abiertas (entra sola), con candado (contraseña)
    o en gris (solo por invitación del DM)."""
    if es_admin(u):
        return []
    filas = con.execute('SELECT c.id, c.nombre, c.clave_hash, c.acceso FROM campanas c WHERE NOT EXISTS '
                        '(SELECT 1 FROM miembros m WHERE m.campana=c.id AND m.usuario=?) ORDER BY c.creada, c.nombre',
                        (u['clave'],)).fetchall()
    out = []
    for i, n, h, a in filas:
        acc = acceso_de(a, h)
        out.append({'id': i, 'nombre': n, 'acceso': acc, 'conClave': acc == 'clave'})
    return out


def puede_crear_campanas(con, u):
    """Con superusuario, solo él crea campañas. Sin él (no hay ALQUIMIA_ADMIN), cualquier DM."""
    if es_admin(u):
        return True
    return not ADMIN_CLAVE and bool(con.execute("SELECT 1 FROM miembros WHERE usuario=? AND rol='dm'", (u['clave'],)).fetchone())


def actor_en_mesa(con, u, camp):
    """La persona dentro de una campaña: con su papel en ella (rol) y su disciplina. None si no juega ahí."""
    if not u or not isinstance(camp, str) or not CAMPANA_OK.match(camp):
        return None
    c = con.execute('SELECT nombre, clave_hash, acceso FROM campanas WHERE id=?', (camp,)).fetchone()
    if not c:
        return None
    acc = acceso_de(c[2], c[1])
    if es_admin(u):
        # El superusuario tiene los poderes de un DM en todas las campañas y puede usar todos los oficios
        return {**u, 'campana': camp, 'mesa': c[0], 'disciplina': 'pluriempleado', 'personaje': None,
                'conClave': acc == 'clave', 'acceso': acc}
    m = con.execute('SELECT rol, disciplina, personaje FROM miembros WHERE campana=? AND usuario=?', (camp, u['clave'])).fetchone()
    if not m:
        return None
    return {**u, 'rol': m[0], 'campana': camp, 'mesa': c[0], 'disciplina': m[1], 'personaje': leer_personaje(m[2]),
            'conClave': acc == 'clave', 'acceso': acc}


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
            if objetivo != actor['clave']:
                avisar(con, objetivo, f'🧙 {quien_corto(actor)} ha cambiado tu personaje en «{nombre_mesa(con, camp)}».', camp)
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


# ---- Cómo se entra en la mesa: abierta, con contraseña o solo por invitación (lo deciden el DM y el superusuario)
TEXTO_ACCESO = {'abierta': 'abierta (cualquiera entra solo)', 'clave': 'con contraseña', 'invitacion': 'solo por invitación'}


def poner_acceso_mesa(actor, cuerpo):
    if not es_dm(actor):
        raise Rechazo('permiso', 'Solo el DM o el superusuario pueden cambiar cómo se entra en la mesa.')
    acceso = cuerpo.get('acceso')
    if acceso not in ACCESOS:
        raise Rechazo('invalida', 'Elige si la mesa es abierta, con contraseña o solo por invitación.')
    clave = cuerpo.get('clave')
    h = None
    if acceso == 'clave' and clave not in (None, ''):
        if not isinstance(clave, str) or not 4 <= len(clave) <= 100:
            raise Rechazo('invalida', 'La contraseña de la mesa debe tener entre 4 y 100 caracteres.')
        h = hash_contrasena(clave)

    def hacer(con):
        fila = con.execute('SELECT clave_hash, acceso FROM campanas WHERE id=?', (actor['campana'],)).fetchone()
        antes = acceso_de(fila[1], fila[0])
        nuevo_h = h if h else (fila[0] if acceso == 'clave' else None)   # la contraseña solo se guarda en modo 'clave'
        if acceso == 'clave' and not nuevo_h:
            raise Rechazo('invalida', 'Escribe la contraseña de la mesa (mínimo 4 caracteres).')
        con.execute('UPDATE campanas SET clave_hash=?, acceso=? WHERE id=?', (nuevo_h, acceso, actor['campana']))
        if antes != acceso:
            apuntar(con, actor['campana'], actor, 'mesa', f'cambió la entrada a la mesa: {TEXTO_ACCESO[acceso]}')
        elif h:
            apuntar(con, actor['campana'], actor, 'mesa', 'cambió la contraseña de la mesa')
        subir_rev(con, actor['campana'])
        return {'ok': True, 'acceso': acceso, 'conClave': acceso == 'clave'}
    return con_escritura(hacer)


def poner_clave_mesa(actor, cuerpo):
    """Ruta antigua (/api/mesa/clave): poner contraseña = modo 'clave'; quitarla = mesa abierta."""
    clave = cuerpo.get('clave')
    if clave in (None, ''):
        return poner_acceso_mesa(actor, {'acceso': 'abierta'})
    return poner_acceso_mesa(actor, {'acceso': 'clave', 'clave': clave})


def unirse(u, cuerpo, ip):
    """Unirse a una campaña sin invitación: si es abierta, con su id; si tiene contraseña, con ella."""
    if es_admin(u):
        raise Rechazo('invalida', 'El superusuario ya entra en todas las campañas.')
    fallos, desde = FALLOS.get(ip, (0, 0))
    if fallos >= 5 and time.time() - desde < 60:
        raise Rechazo('espera', 'Demasiados intentos fallidos. Espera un minuto y vuelve a probar.')
    nombre = re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(cuerpo.get('nombre') or '')).strip())
    clave = str(cuerpo.get('clave') or '')
    camp_id = cuerpo.get('id')   # V3.7: desde el selector de campañas se une por su id

    def hacer(con):
        por_id = isinstance(camp_id, str) and bool(camp_id)
        if por_id:
            c = con.execute('SELECT id, nombre, clave_hash, acceso FROM campanas WHERE id=?', (camp_id,)).fetchone()
        else:
            c = con.execute('SELECT id, nombre, clave_hash, acceso FROM campanas WHERE nombre=? COLLATE NOCASE', (nombre,)).fetchone()
        acc = acceso_de(c[3], c[2]) if c else None
        if por_id and c and es_miembro(con, c[0], u['clave']):
            raise Rechazo('existe', f'Ya estás en «{c[1]}».')
        if por_id and acc == 'invitacion':
            raise Rechazo('credenciales', 'A esta mesa solo se entra si el DM te invita.')
        abierta = por_id and acc == 'abierta'   # abierta: se entra pulsando, sin contraseña
        # Por nombre solo valen las de contraseña. Mismo mensaje si no existe, si no tiene contraseña o si es
        # incorrecta: no se delata qué mesas hay
        if not abierta and (not c or acc != 'clave' or not comprobar_contrasena(clave, c[2])):
            if not c or acc != 'clave':
                comprobar_contrasena(clave, HASH_FALSO)
            FALLOS[ip] = (fallos + 1 if time.time() - desde < 60 else 1, desde if time.time() - desde < 60 else time.time())
            if isinstance(camp_id, str) and camp_id:
                raise Rechazo('credenciales', 'Esa contraseña no abre la mesa.' if acc == 'clave'
                              else 'A esta mesa solo se entra si el DM te invita.')
            raise Rechazo('credenciales', 'No hay ninguna mesa con ese nombre y esa contraseña. '
                          'Las mesas abiertas salen en la lista: pulsa en ellas para entrar.')
        if not abierta:
            FALLOS.pop(ip, None)
        if es_miembro(con, c[0], u['clave']):
            raise Rechazo('existe', f'Ya estás en «{c[1]}».')
        con.execute('INSERT INTO miembros (campana, usuario, rol, disciplina, unido) VALUES (?,?,?,?,?)',
                    (c[0], u['clave'], 'jugador', DISCIPLINA_DEFECTO, ahora()))
        apuntar(con, c[0], u, 'miembros', 'se unió a la mesa (abierta)' if abierta else 'se unió a la mesa con la contraseña',
                None, [u['nombre']])
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
        if con.execute("SELECT 1 FROM solicitudes_campana WHERE nombre=? COLLATE NOCASE AND estado='pendiente'", (nombre,)).fetchone():
            raise Rechazo('existe', f'Alguien ha pedido ya una campaña llamada «{nombre}»: mírala en «Solicitudes de campaña».')
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


# ------------------------------------------------------------ solicitudes de campaña (V3.8)
def solicitud_de(con, clave):
    """La solicitud que enseña el selector: la pendiente, o la última resuelta hace menos de 7 días."""
    f = con.execute("SELECT id, nombre, motivo, creada, estado, resuelta, nota FROM solicitudes_campana "
                    "WHERE usuario=? AND estado!='cancelada' ORDER BY id DESC LIMIT 1", (clave,)).fetchone()
    if not f:
        return None
    if f[4] != 'pendiente':
        try:
            if (datetime.now(timezone.utc) - datetime.fromisoformat(f[5])).days >= 7:
                return None
        except (TypeError, ValueError):
            return None
    return {'id': f[0], 'nombre': f[1], 'motivo': f[2] or '', 'creada': f[3], 'estado': f[4], 'resuelta': f[5], 'nota': f[6] or ''}


def puede_solicitar(con, u):
    # Solo tiene sentido si hay superusuario que apruebe y la cuenta no puede crear campañas por sí misma
    return bool(ADMIN_CLAVE) and not es_admin(u)


def solicitar_campana(u, cuerpo):
    nombre = nombre_de_campana(cuerpo)
    motivo = re.sub(r'\s+', ' ', str(cuerpo.get('motivo') or '')).strip()[:300]

    def hacer(con):
        if not puede_solicitar(con, u):
            raise Rechazo('permiso', 'Aquí no hace falta pedir permiso: puedes crear la campaña directamente.' if es_admin(u)
                          else 'Este servidor no tiene superusuario que apruebe campañas.')
        if con.execute("SELECT 1 FROM solicitudes_campana WHERE usuario=? AND estado='pendiente'", (u['clave'],)).fetchone():
            raise Rechazo('existe', 'Ya tienes una solicitud esperando al superusuario. Cancélala si quieres pedir otra.')
        if con.execute('SELECT 1 FROM campanas WHERE nombre=? COLLATE NOCASE', (nombre,)).fetchone():
            raise Rechazo('existe', f'Ya hay una campaña llamada «{nombre}». Elige otro nombre.')
        if con.execute("SELECT 1 FROM solicitudes_campana WHERE nombre=? COLLATE NOCASE AND estado='pendiente'", (nombre,)).fetchone():
            raise Rechazo('existe', f'Alguien ha pedido ya una campaña llamada «{nombre}». Elige otro nombre.')
        con.execute("INSERT INTO solicitudes_campana (usuario, nombre, motivo, creada, estado) VALUES (?,?,?,?,'pendiente')",
                    (u['clave'], nombre, motivo, ahora()))
        return {'ok': True, 'solicitud': solicitud_de(con, u['clave'])}
    return con_escritura(hacer)


def cancelar_solicitud(u):
    def hacer(con):
        n = con.execute("UPDATE solicitudes_campana SET estado='cancelada', resuelta=? WHERE usuario=? AND estado='pendiente'",
                        (ahora(), u['clave'])).rowcount
        if not n:
            raise Rechazo('invalida', 'No tienes ninguna solicitud pendiente.')
        return {'ok': True}
    return con_escritura(hacer)


def lista_solicitudes(con):
    return [{'id': i, 'usuario': us, 'nombreUsuario': nu, 'nombre': n, 'motivo': m or '', 'creada': c}
            for i, us, nu, n, m, c in con.execute(
                "SELECT s.id, s.usuario, u.nombre, s.nombre, s.motivo, s.creada FROM solicitudes_campana s "
                "JOIN usuarios u ON u.clave=s.usuario WHERE s.estado='pendiente' AND u.baneado=0 ORDER BY s.id").fetchall()]


def resolver_solicitud(u, cuerpo):
    """El superusuario aprueba (se crea la campaña con quien la pidió como DM) o rechaza (con un motivo opcional)."""
    if not es_admin(u):
        raise Rechazo('permiso', 'Solo el superusuario aprueba o rechaza solicitudes de campaña.')
    aprobar = bool(cuerpo.get('aprobar'))
    nota = re.sub(r'\s+', ' ', str(cuerpo.get('nota') or '')).strip()[:300]
    try:
        sid = int(cuerpo.get('id'))
    except (TypeError, ValueError):
        raise Rechazo('invalida', 'Solicitud desconocida.')

    def hacer(con):
        f = con.execute("SELECT s.usuario, s.nombre, u.baneado FROM solicitudes_campana s JOIN usuarios u ON u.clave=s.usuario "
                        "WHERE s.id=? AND s.estado='pendiente'", (sid,)).fetchone()
        if not f:
            raise Rechazo('conflicto', 'Esa solicitud ya no está pendiente (la han cancelado o ya se resolvió).')
        camp = None
        if aprobar:
            if f[2]:
                raise Rechazo('baneado', 'Esa cuenta está desterrada: no puede ser DM de una campaña.')
            if con.execute('SELECT 1 FROM campanas WHERE nombre=? COLLATE NOCASE', (f[1],)).fetchone():
                raise Rechazo('existe', f'Ya hay una campaña llamada «{f[1]}». Recházala explicando que cambie el nombre.')
            camp = 'c-' + secrets.token_hex(4)
            con.execute('INSERT INTO campanas (id, nombre, creada, rev) VALUES (?,?,?,1)', (camp, f[1], ahora()))
            con.execute('INSERT INTO miembros (campana, usuario, rol, disciplina, unido) VALUES (?,?,?,?,?)',
                        (camp, f[0], 'dm', DISCIPLINA_DEFECTO, ahora()))
        con.execute('UPDATE solicitudes_campana SET estado=?, resuelta=?, nota=?, campana=? WHERE id=?',
                    ('aprobada' if aprobar else 'rechazada', ahora(), nota, camp, sid))
        avisar(con, f[0], (f'🎉 El superusuario ha aprobado tu campaña «{f[1]}». Ya eres su DM.' if aprobar
                           else f'El superusuario no ha aprobado tu campaña «{f[1]}».') + (f' Nota: {nota}' if nota else ''), camp)
        return f[0], f[1], camp
    usuario, nombre, camp = con_escritura(hacer)
    if aprobar:
        avisar_por_correo(usuario, f'tu campaña «{nombre}» está aprobada', f'''El superusuario ha aprobado tu campaña «{nombre}». Ya está creada y tú eres su DM.
Entra en La taberna de Jhon y elígela en el selector de campañas para invitar a tus jugadores.''' + (f'\n\nNota del superusuario: {nota}' if nota else ''))
    else:
        avisar_por_correo(usuario, f'tu solicitud de campaña «{nombre}» no se ha aprobado', f'''El superusuario no ha aprobado tu solicitud de la campaña «{nombre}».''' + (f'\n\nMotivo: {nota}' if nota else '')
                          + '\n\nPuedes hacer otra solicitud desde el selector de campañas.')
    return {'ok': True, 'campana': {'id': camp, 'nombre': nombre} if camp else None}


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
    camp, objetivo, accion = actor['campana'], clave_de(cuerpo.get('usuario')), cuerpo.get('accion')
    irse = accion == 'quitar' and objetivo == actor['clave'] and actor.get('rol') != 'admin'   # un jugador se va él solo
    if not es_dm(actor) and not irse:
        raise Rechazo('permiso', 'Solo el DM de la campaña puede invitar o sacar jugadores.')

    def hacer(con):
        fila = buscar_usuario(con, objetivo)
        if not fila:
            raise Rechazo('invalida', 'Esa cuenta no existe.')
        if fila[2] == 'admin':
            raise Rechazo('invalida', 'El superusuario ya entra en todas las campañas.')
        if accion == 'invitar':
            if fila[4]:
                raise Rechazo('baneado', f'«{fila[1]}» está desterrado: no se le puede invitar.')
            if fila[5]:
                raise Rechazo('pendiente', f'«{fila[1]}» todavía está pendiente de aprobación: apruébala arriba.')
            if es_miembro(con, camp, objetivo):
                raise Rechazo('existe', f'«{fila[1]}» ya está en esta campaña.')
            con.execute('INSERT INTO miembros (campana, usuario, rol, disciplina, unido) VALUES (?,?,?,?,?)',
                        (camp, objetivo, 'jugador', DISCIPLINA_DEFECTO, ahora()))
            apuntar(con, camp, actor, 'miembros', f'invitó a {fila[1]} a la mesa', None, [fila[1]])
            avisar(con, objetivo, f'👋 {quien_corto(actor)} te ha invitado a la mesa «{nombre_mesa(con, camp)}». '
                                  'Elígela en el selector de campañas.', camp)
        elif accion == 'quitar':
            m = con.execute('SELECT rol FROM miembros WHERE campana=? AND usuario=?', (camp, objetivo)).fetchone()
            if not m:
                raise Rechazo('invalida', f'«{fila[1]}» no está en esta campaña.')
            if objetivo == actor['clave'] and m[0] == 'dm':
                raise Rechazo('invalida', 'Un DM no puede irse de su propia campaña. Pide al superusuario que te quite el DM antes.')
            if m[0] == 'dm' and not es_admin(actor):
                raise Rechazo('permiso', 'Solo el superusuario puede sacar a un DM de la campaña.')
            con.execute('DELETE FROM miembros WHERE campana=? AND usuario=?', (camp, objetivo))
            if objetivo == actor['clave']:
                apuntar(con, camp, actor, 'miembros', 'se fue de la mesa', None, [fila[1]])
                bot_de_mesa(con, camp, f'🚪 {fila[1]} se ha ido de la mesa.')
            else:
                apuntar(con, camp, actor, 'miembros', f'sacó a {fila[1]} de la mesa', None, [fila[1]])
                bot_de_mesa(con, camp, f'🚪 {fila[1]} ya no está en la mesa: {quien_corto(actor)} le ha sacado.')
            la_mesa = nombre_mesa(con, camp)
            if objetivo != actor['clave']:
                sacado.append(la_mesa)
                avisar(con, objetivo, f'🚪 {quien_corto(actor)} te ha sacado de la mesa «{la_mesa}». No se ha borrado nada.', camp)
            else:
                avisar(con, objetivo, f'🚪 Te has ido de la mesa «{la_mesa}». No se ha borrado nada: si te vuelven a invitar, lo recuperas todo.', camp)
            if (PRESENCIA.get(objetivo) or {}).get('campana') == camp:
                PRESENCIA.pop(objetivo, None)
        else:
            raise Rechazo('invalida', 'Acción desconocida.')
        subir_rev(con, camp)
        return {'ok': True}
    sacado = []
    r = con_escritura(hacer)
    if sacado:
        avisar_por_correo(objetivo, f'te han sacado de la mesa «{sacado[0]}»', f'''{quien_lo_hizo(actor)} te ha sacado de la mesa «{sacado[0]}».

No se ha borrado nada: si vuelven a invitarte, recuperarás tu inventario, tus libros y tu nivel.
Tu cuenta sigue activa y puedes seguir jugando en tus otras mesas.''')
    return r


def quien_lo_hizo(actor):
    return 'El superusuario' if actor.get('rol') == 'admin' else f'El DM ({actor.get("nombre", "")})'


def cambiar_disciplina(actor, cuerpo):
    if not es_dm(actor):
        raise Rechazo('permiso', 'Solo el DM puede asignar disciplinas.')
    camp, objetivo = actor['campana'], clave_de(cuerpo.get('usuario'))
    disc = normalizar_disciplina(cuerpo['disciplinas'] if 'disciplinas' in cuerpo else cuerpo.get('disciplina'))
    if disc is None:
        raise Rechazo('invalida', 'Disciplina desconocida.')

    def hacer(con):
        if not es_miembro(con, camp, objetivo):
            raise Rechazo('invalida', 'Esa cuenta no está en esta campaña.')
        antes = leer_miembro(con, camp, objetivo, 'disciplina')
        con.execute('UPDATE miembros SET disciplina=? WHERE campana=? AND usuario=?', (disc, camp, objetivo))
        if antes != disc:
            apuntar(con, camp, actor, 'miembros', f'disciplina de {nombre_de(con, objetivo)}: {antes} → {disc}',
                    [{'k': 'disc', 'u': objetivo, 'antes': antes, 'despues': disc}], [nombre_de(con, objetivo)])
            if objetivo != actor['clave']:
                avisar(con, objetivo, f'🧰 {quien_corto(actor)} ha cambiado tus oficios en «{nombre_mesa(con, camp)}»: '
                                      f'{texto_oficios(disc)}.', camp)
        subir_rev(con, camp)
        return {'ok': True}
    return con_escritura(hacer)


def lista_cuentas(con, u, camp=None):
    """Cuentas para invitar (DM) o administrar (superusuario). Un DM no ve a los desterrados."""
    cuentas = []
    for clave, nombre, rol, baneado in con.execute(
            "SELECT clave, nombre, rol, baneado FROM usuarios WHERE rol!='admin' AND pendiente=0 ORDER BY nombre COLLATE NOCASE"):
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


def lista_pendientes(con):
    """Cuentas nuevas de Discord que esperan a que un DM (o el superusuario) las apruebe."""
    return [{'clave': c, 'nombre': n, 'discord': d or '', 'creado': cr} for c, n, d, cr in con.execute(
        'SELECT clave, nombre, discord_nombre, creado FROM usuarios WHERE pendiente=1 AND baneado=0 ORDER BY creado')]


def aprobar_cuenta(actor, cuerpo):
    """Un DM (o el superusuario) aprueba una cuenta creada con Discord y la sienta en su mesa como
    jugador alquimista, o la rechaza (se borra: aún no tiene nada guardado)."""
    if not es_dm(actor):
        raise Rechazo('permiso', 'Solo un DM o el superusuario pueden aprobar cuentas nuevas.')
    camp, objetivo, aprobar = actor['campana'], clave_de(cuerpo.get('usuario')), bool(cuerpo.get('aprobar'))

    def hacer(con):
        fila = buscar_usuario(con, objetivo)
        if not fila or not fila[5]:
            raise Rechazo('invalida', 'Esa cuenta ya no está pendiente (quizá otro DM se ha adelantado).')
        if aprobar:
            con.execute('UPDATE usuarios SET pendiente=0 WHERE clave=?', (objetivo,))
            con.execute('INSERT OR IGNORE INTO miembros (campana, usuario, rol, disciplina, unido) VALUES (?,?,?,?,?)',
                        (camp, objetivo, 'jugador', DISCIPLINA_DEFECTO, ahora()))
            apuntar(con, camp, actor, 'miembros', f'aprobó la cuenta de {fila[1]} (creada con Discord) y la sentó en la mesa', None, [fila[1]])
            avisar(con, objetivo, f'✅ {quien_corto(actor)} ha aprobado tu cuenta y te ha sentado en la mesa «{nombre_mesa(con, camp)}».', camp)
        else:
            con.execute('DELETE FROM sesiones WHERE usuario=?', (objetivo,))
            con.execute('DELETE FROM avatares WHERE usuario=?', (objetivo,))
            con.execute('DELETE FROM usuarios WHERE clave=? AND pendiente=1', (objetivo,))
        subir_rev(con, camp)
        return {'ok': True}
    return con_escritura(hacer)


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
    for i, n, creada, h, acc in con.execute('SELECT id, nombre, creada, clave_hash, acceso FROM campanas ORDER BY creada, nombre').fetchall():
        miembros_ = con.execute('SELECT u.nombre, m.rol FROM miembros m JOIN usuarios u ON u.clave=m.usuario '
                                'WHERE m.campana=? ORDER BY u.nombre COLLATE NOCASE', (i,)).fetchall()
        out.append({'id': i, 'nombre': n, 'creada': creada, 'dms': [x for x, r in miembros_ if r == 'dm'],
                    'jugadores': len(miembros_), 'acceso': acceso_de(acc, h)})
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
        otra = bool(p and p.get('campana') != camp)   # conectado, pero jugando en otra campaña
        hace = ahora_s - p['t'] if p else None
        if hace is not None and hace < EN_LINEA_S and p['visible']:
            estado = 'en-linea'
        elif hace is not None and hace < AUSENTE_S:
            estado = 'ausente'
        else:
            estado = 'desconectado'
        lista.append({'clave': clave, 'nombre': nombre, 'rol': rol, 'estado': estado, 'baneado': bool(baneado),
                      'disciplina': disciplina, 'personaje': (leer_personaje(pj) or {}).get('nombre') or '',
                      'otraMesa': otra and estado != 'desconectado',   # sale «en otra mesa» y no cuenta como de esta
                      'lugar': p['lugar'] if p and estado != 'desconectado' and not otra else None,
                      'hace': round(hace) if hace is not None else None, 'avatar': fotos.get(clave, 0)})
    # Después, todas las demás cuentas (las que no juegan en esta mesa): «fuera». De ellas solo se dice si
    # están conectadas a la taberna (no dónde). Los desterrados solo los usa el superusuario (el navegador los filtra).
    dentro = {f[0] for f in filas}
    for clave, nombre, baneado in con.execute("SELECT clave, nombre, baneado FROM usuarios WHERE rol!='admin' AND pendiente=0 "
                                              "ORDER BY nombre COLLATE NOCASE").fetchall():
        if clave in dentro:
            continue
        p = PRESENCIA.get(clave)
        hace = ahora_s - p['t'] if p else None
        estado = ('en-linea' if hace is not None and hace < EN_LINEA_S and p['visible']
                  else 'ausente' if hace is not None and hace < AUSENTE_S else 'desconectado')
        lista.append({'clave': clave, 'nombre': nombre, 'rol': 'fuera', 'fuera': True, 'estado': estado, 'baneado': bool(baneado),
                      'disciplina': None, 'personaje': '', 'lugar': None,
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
    if col == 'bolsa':
        return 'las monedas de oro'
    if isinstance(valor, dict) and valor.get('name'):
        return '«' + str(valor['name']) + '»'
    return {'potions': 'esa poción', 'lootPotions': 'esa poción de botín', 'catalog': 'ese material',
            'potionCatalog': 'esa ficha de poción', 'meta': 'los ajustes', 'libros': 'ese libro', 'objetos': 'ese objeto',
            'perfil': 'el nivel de alquimia', 'odres': 'ese odre', 'descubrimientos': 'ese descubrimiento'}.get(col, 'ese dato')


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
    if t == 'dar':
        return dar(con, op, actor, rev, registro)
    tipo = COLECCIONES[col]
    if col == 'bolsa' and id_ != 'oro':
        raise Rechazo('invalida', 'En la bolsa solo se guardan monedas de oro.')
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
                f'{mayus(nombre_entrada(con, camp, col, id_, actual))} {"han" if col == "bolsa" else "ha"} cambiado mientras tanto (ahora hay {tenia}){quien(autor_prev, autor)}.',
                {'col': col, 'id': id_, 'hay': tenia})
        queda = tenia + n
        if col == 'bolsa':
            if queda < 0:
                raise Rechazo('stock', f'No hay suficientes monedas de oro: hay {tenia} y hacían falta {-n}{quien(autor_prev, autor)}.',
                              {'col': col, 'id': id_, 'hay': tenia, 'falta': -n})
            if queda > MAX_MONEDAS:
                raise Rechazo('invalida', f'Demasiadas monedas: el máximo es {MAX_MONEDAS:,}.'.replace(',', '.'))
        if queda < 0:
            raise Rechazo('stock',
                f'No queda suficiente {nombre_entrada(con, camp, col, id_, actual)}: hay {tenia} y hacían falta {-n}{quien(autor_prev, autor)}.',
                {'col': col, 'id': id_, 'hay': tenia, 'falta': -n})
        escribir(con, camp, col, dueno, id_, queda, autor, rev)
        if col == 'inventory' and n > 0:
            descubrir(con, camp, id_, dueno, autor, rev)   # la primera vez que le llega, sale en su catálogo

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
        if col == 'odres' and nuevo is not None:
            validar_odre(nuevo)
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
            con.execute("DELETE FROM entradas WHERE campana=? AND col='descubrimientos' AND id=?", (camp, id_))
    else:
        raise Rechazo('invalida', 'Operación desconocida.')


# ---- Catálogo por descubrimiento (V3.8)
# Un material que da de alta el DM no sale en el catálogo de un jugador hasta que lo recibe por primera vez
# (normalmente porque se lo da el DM; también si se lo pasa otro jugador). Se apunta aquí y no se olvida.
def es_dm_de(con, camp, clave):
    if con.execute("SELECT 1 FROM usuarios WHERE clave=? AND rol='admin'", (clave,)).fetchone():
        return True   # el superusuario es DM en todas las campañas
    fila = con.execute('SELECT rol FROM miembros WHERE campana=? AND usuario=?', (camp, clave)).fetchone()
    return bool(fila) and fila[0] == 'dm'


def descubrir(con, camp, mid, clave, autor, rev):
    if not clave or es_dm_de(con, camp, clave):
        return   # el DM ya lo conoce todo
    if not leer(con, camp, 'catalog', COMUN, mid)[0]:
        return
    actual, _ = leer(con, camp, 'descubrimientos', COMUN, mid)
    actual = actual if isinstance(actual, dict) else {}
    if clave in actual:
        return
    escribir(con, camp, 'descubrimientos', COMUN, mid, {**actual, clave: ahora()}, autor, rev)


def migrar_descubrimientos(con):
    """Al pasar a la V3.8: lo que ya llevaba cada jugador cuenta como descubierto (si no, desaparecería de su catálogo)."""
    n = 0
    filas = con.execute("SELECT campana, dueno, id, valor FROM entradas WHERE col='inventory' AND dueno!=''").fetchall()
    for camp, dueno, mid, valor in filas:
        try:
            v = json.loads(valor)
        except ValueError:
            continue
        if not isinstance(v, int) or v <= 0 or es_dm_de(con, camp, dueno) or not leer(con, camp, 'catalog', COMUN, mid)[0]:
            continue
        actual, _ = leer(con, camp, 'descubrimientos', COMUN, mid)
        actual = actual if isinstance(actual, dict) else {}
        if dueno not in actual:
            escribir(con, camp, 'descubrimientos', COMUN, mid, {**actual, dueno: ahora()}, 'La taberna', rev_actual(con, camp))
            n += 1
    return n


# ---- Odres (V3.8)
def litros_ok(x, maximo):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and 0 <= x <= maximo and float(x * 2).is_integer()


def validar_odre(o):
    if not isinstance(o, dict):
        raise Rechazo('invalida', 'Odre mal formado.')
    for k in o:
        if k not in ('name', 'disolvente', 'capacidad', 'litros', 'creado'):
            raise Rechazo('invalida', f'Campo desconocido en el odre: {k}.')
    if not isinstance(o.get('name'), str) or not o['name'].strip() or len(o['name']) > 60:
        raise Rechazo('invalida', 'El odre necesita un nombre (hasta 60 letras).')
    if 'creado' in o and (not isinstance(o['creado'], str) or len(o['creado']) > 40):
        raise Rechazo('invalida', 'Odre mal formado.')
    cap = o.get('capacidad')
    if not litros_ok(cap, MAX_LITROS_ODRE) or cap < 0.5:
        raise Rechazo('invalida', f'La capacidad de un odre va de 0,5 a {MAX_LITROS_ODRE} litros, de medio en medio.')
    if not litros_ok(o.get('litros', 0), cap):
        raise Rechazo('invalida', f'Los litros de un odre van de medio en medio, entre 0 y {cap} L.')
    d = o.get('disolvente')
    if d is not None and d not in DISOLVENTES_ODRE:
        raise Rechazo('invalida', 'En un odre solo van disolventes que no son agua.')
    if o.get('litros', 0) > 0 and d is None:
        raise Rechazo('invalida', 'Un odre con líquido tiene que decir qué disolvente lleva.')


def dar_odre_inicial(camp, clave):
    """Cada jugador empieza con un odre vacío de 3 L (una sola vez por campaña)."""
    if (camp, clave) in ODRES_DADOS:
        return
    marca = f'odre-inicial:{camp}:{clave}'

    def hacer(con):
        if con.execute('SELECT 1 FROM ajustes WHERE clave=?', (marca,)).fetchone():
            return
        if not leer(con, camp, 'odres', clave, 'inicial')[0]:
            rev = rev_actual(con, camp) + 1
            escribir(con, camp, 'odres', clave, 'inicial', {**ODRE_INICIAL, 'creado': ahora()}, 'La taberna', rev)
            con.execute('UPDATE campanas SET rev=? WHERE id=?', (rev, camp))
        con.execute('INSERT OR IGNORE INTO ajustes VALUES (?, ?)', (marca, ahora()))
    con_escritura(hacer)
    ODRES_DADOS.add((camp, clave))


ODRES_DADOS = set()


# ---- Dar algo a otro jugador de la mesa (V3.8)
# Todo en la misma transacción: se quita al que lo da y se pone al que lo recibe, o no pasa nada.
def dar(con, op, actor, rev, registro=None):
    camp, autor, origen = actor['campana'], actor['nombre'], actor['clave']
    col, id_, destino = op.get('c'), op.get('id'), op.get('u')
    if col not in SE_PUEDE_DAR:
        raise Rechazo('invalida', 'Eso no se puede dar a otro jugador.')
    if not isinstance(destino, str) or not destino or destino == origen:
        raise Rechazo('invalida', 'Elige a quién se lo das.')
    if not es_miembro(con, camp, destino):
        raise Rechazo('invalida', 'Ese jugador no está en esta campaña.')
    if col == 'bolsa' and id_ != 'oro':
        raise Rechazo('invalida', 'En la bolsa solo se guardan monedas de oro.')
    actual, autor_prev = leer(con, camp, col, origen, id_)
    if registro is not None:
        registro.setdefault((col, origen, id_), actual)
    tipo = COLECCIONES[col]
    para = nombre_de(con, destino)

    def poner(id_dest, valor):
        if registro is not None:
            registro.setdefault((col, destino, id_dest), leer(con, camp, col, destino, id_dest)[0])
        escribir(con, camp, col, destino, id_dest, valor, autor, rev)

    def id_libre(base):
        if not leer(con, camp, col, destino, base)[0]:
            return base
        return (base[:180] + '-' + secrets.token_hex(3))

    if tipo == 'num':
        n = entero(op.get('n'), 'n')
        if n < 1:
            raise Rechazo('invalida', 'Hay que dar al menos uno.')
        tenia = actual if isinstance(actual, int) else 0
        if tenia < n:
            raise Rechazo('stock', f'No te queda suficiente {nombre_entrada(con, camp, col, id_, actual)}: tienes {tenia} y querías dar {n}{quien(autor_prev, autor)}.',
                          {'col': col, 'id': id_, 'hay': tenia, 'falta': n})
        escribir(con, camp, col, origen, id_, tenia - n, autor, rev)
        suyo = leer(con, camp, col, destino, id_)[0]
        suyo = suyo if isinstance(suyo, int) else 0
        if col == 'bolsa' and suyo + n > MAX_MONEDAS:
            raise Rechazo('invalida', f'{para} no puede llevar tantas monedas.')
        poner(id_, suyo + n)
        if col == 'inventory':
            descubrir(con, camp, id_, destino, autor, rev)
        return
    if actual is None:
        raise Rechazo('stock', f'Ya no tienes {nombre_entrada(con, camp, col, id_, op.get("e"))}: lo habrás usado o dado.', {'col': col, 'id': id_})
    if 'e' in op and op['e'] is not None and (resto(actual) if tipo == 'qty' else actual) != op['e']:
        raise Rechazo('conflicto', f'{mayus(nombre_entrada(con, camp, col, id_, actual))} ha cambiado mientras tanto: mira cómo está y vuelve a intentarlo.', {'col': col, 'id': id_})
    if tipo == 'qty':
        n = entero(op.get('n'), 'n')
        tiene = entero(actual.get('qty', 0), 'qty')
        if n < 1 or n > tiene:
            raise Rechazo('stock', f'No tienes tantas: hay {tiene} de {nombre_entrada(con, camp, col, id_, actual)}.', {'col': col, 'id': id_, 'hay': tiene, 'falta': n})
        escribir(con, camp, col, origen, id_, {**actual, 'qty': tiene - n} if tiene > n else None, autor, rev)
        suyo = leer(con, camp, col, destino, id_)[0]
        # Pociones: la misma receta va a la misma pila (su id dice qué es); el botín, aparte si no es igual
        if isinstance(suyo, dict) and (col == 'potions' or resto(suyo) == resto(actual)):
            poner(id_, {**suyo, 'qty': entero(suyo.get('qty', 0), 'qty') + n})
        else:
            poner(id_libre(id_), {**resto(actual), 'qty': n})
        return
    # Objetos, libros y odres: van enteros (de un objeto con cantidad se puede dar una parte)
    if col == 'objetos':
        cant = actual.get('cantidad', 1)
        n = op.get('n', cant)
        n = entero(n if n is not None else cant, 'n')
        if n < 1 or n > max(cant, 1):
            raise Rechazo('stock', f'Solo tienes {cant} de «{actual.get("name", "ese objeto")}».', {'col': col, 'id': id_})
        nuevo = {**actual, 'cantidad': n, 'equipado': False, 'sintonizado': False}
        validar_objeto(nuevo)
        escribir(con, camp, col, origen, id_, {**actual, 'cantidad': cant - n} if n < cant else None, autor, rev)
        poner(id_libre(id_), nuevo)
        return
    if col == 'libros':
        nuevo = {**actual, 'progreso': 0, 'historial': []}   # quien lo recibe empieza a leerlo desde el principio
    else:
        nuevo = actual
    escribir(con, camp, col, origen, id_, None, autor, rev)
    poner(id_libre(id_), nuevo)


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
    if col == 'catalog':
        # V3.8: el alta de materiales es cosa del DM (y del superusuario), igual que editarlos o borrarlos
        raise Rechazo('permiso', 'Solo el DM da de alta, edita o borra materiales del catálogo (afectan a toda la mesa).')
    if col == 'descubrimientos':
        raise Rechazo('permiso', 'Un material se descubre cuando lo recibes, no a mano.')
    if col == 'odres':
        if actual is None:
            raise Rechazo('permiso', 'Los odres los da el DM.')
        if nuevo is None:
            return   # tirar un odre propio sí se puede
        if not isinstance(actual, dict) or not isinstance(nuevo, dict) or \
                nuevo.get('capacidad') != actual.get('capacidad') or nuevo.get('name') != actual.get('name'):
            raise Rechazo('permiso', 'Solo el DM puede cambiar un odre.')
        if (nuevo.get('litros') or 0) > (actual.get('litros') or 0):
            raise Rechazo('permiso', 'Solo el DM puede llenar los odres.')
        if nuevo.get('disolvente') != actual.get('disolvente') and (nuevo.get('litros') or 0) > 0:
            raise Rechazo('permiso', 'Solo el DM puede cambiar lo que lleva un odre.')
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
                # Aviso personal a cada jugador al que le han tocado sus cosas (se lo ha dado otro o lo ha cambiado el DM)
                da = any(isinstance(o, dict) and o.get('t') == 'dar' for o in ops)
                for dueno in sorted({c['d'] for c in cambios if c['d'] and c['d'] != actor['clave']}):
                    icono = '🎁' if da else '🧙'
                    avisar(con, dueno, f'{icono} {quien_corto(actor)} en «{actor["mesa"]}»: {resumen or "ha cambiado tus cosas"}.', camp)
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
        avisar(con, objetivo, (f'👑 {quien_corto(actor)} te ha hecho DM de la mesa «{nombre_mesa(con, camp)}».' if rol == 'dm'
                               else f'{quien_corto(actor)} te ha quitado los poderes de DM en «{nombre_mesa(con, camp)}».'), camp)
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
            avisar(con, objetivo, '🚫 El superusuario ha suspendido tu cuenta.' if ban
                   else '🕊️ El superusuario ha levantado la suspensión de tu cuenta. Bienvenido de nuevo.')
            if ban:   # fuera de la mesa ya: se cierran todas sus sesiones
                con.execute('DELETE FROM sesiones WHERE usuario=?', (objetivo,))
            subir_rev(con)
            con.execute('COMMIT')
            if ban:
                PRESENCIA.pop(objetivo, None)
        except BaseException:
            if con.in_transaction:
                con.execute('ROLLBACK')
            raise
        finally:
            con.close()
    # Ya está guardado (si algo falla antes, salta la excepción y no se avisa)
    if ban:
        avisar_por_correo(objetivo, 'tu cuenta ha sido suspendida', '''El superusuario ha suspendido (desterrado) tu cuenta de La taberna de Jhon.
Mientras siga así no podrás entrar, y se han cerrado tus sesiones abiertas.

No se ha borrado nada. Si crees que es un error, habla con el DM o con el superusuario.''')
    else:
        avisar_por_correo(objetivo, 'tu cuenta vuelve a estar activa', '''El superusuario ha levantado la suspensión de tu cuenta de La taberna de Jhon.
Ya puedes volver a entrar con tu nombre y tu contraseña.''')
    return {'ok': True}


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
        elif actor['rol'] != 'admin':   # pedido por Moisés (2026-11-27): ni siquiera el DM
            raise Rechazo('permiso', 'Solo el superusuario puede poner una contraseña nueva a otra persona.')
        with CERROJO:
            con.execute('BEGIN IMMEDIATE')
            con.execute('UPDATE usuarios SET hash=? WHERE clave=?', (hash_contrasena(nueva), objetivo))
            con.execute("DELETE FROM enlaces_correo WHERE usuario=? AND tipo='recuperar'", (objetivo,))
            if objetivo != actor['clave']:   # se cierran sus sesiones abiertas
                con.execute('DELETE FROM sesiones WHERE usuario=?', (objetivo,))
                avisar(con, objetivo, '🔑 El superusuario te ha puesto una contraseña nueva. Cámbiala por una tuya en el menú de la cuenta.')
            con.execute('COMMIT')
        if objetivo != actor['clave']:
            avisar_por_correo(objetivo, 'el superusuario te ha puesto una contraseña nueva', '''El superusuario ha puesto una contraseña nueva a tu cuenta de La taberna de Jhon y se han cerrado tus
sesiones abiertas. Te la tiene que decir él; por seguridad, este correo no la incluye.

Cuando entres, cámbiala por una tuya desde el menú de la cuenta (🔑 Cambiar contraseña).
Si no sabías nada de esto, habla con el superusuario.''')
        return {'ok': True}
    finally:
        con.close()


# ------------------------------------------------------------ correo (V3.8)
# Recuperar la contraseña olvidada con un enlace por correo. Medidas de seguridad:
#  - El enlace lleva un token aleatorio de 256 bits. En la base solo se guarda su HUELLA (SHA-256):
#    quien copie la base no puede usar los enlaces pendientes.
#  - Sirve UNA vez y caduca a los 30 minutos. Pedir otro anula el anterior.
#  - Al cambiar la contraseña se cierran TODAS las sesiones de esa cuenta y se anulan sus enlaces.
#  - «Te hemos mandado un enlace» se contesta siempre igual, exista la cuenta o no, y el correo se
#    manda en segundo plano: así nadie puede averiguar qué nombres o correos tienen cuenta.
#  - Límite de peticiones por conexión y por cuenta (nadie puede llenarle el buzón a otro).
#  - Solo se usa un correo CONFIRMADO: al ponerlo se manda un enlace para comprobar que es suyo.
#    Si no, alguien podría poner el correo de otra persona... o un correo suyo en la cuenta de otro.
#  - El enlace lleva el token detrás de «#», que el navegador no manda al servidor ni a otras webs.
#  - La dirección del enlace sale de ALQUIMIA_URL (o localhost), nunca de cabeceras que pueda
#    inventarse quien hace la petición.
#  - El correo solo lo ve su dueño (no sale en las listas de la mesa).
#  - La conexión con el servidor de correo va cifrada (STARTTLS o SSL) y con el certificado comprobado.
MIN_ENLACE = 30                    # minutos que dura el enlace para cambiar la contraseña
HORAS_VERIFICAR = 24               # horas que dura el enlace para confirmar el correo
CORREO_OK = re.compile(r'^[^@\s<>"\'(),;:\\\[\]]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)+$')
PETICIONES_CORREO = {}             # 'ip:...' / 'u:...' -> [tiempos]; en memoria (basta para frenar abusos)
CERROJO_PETICIONES = threading.Lock()


def limpiar_correo(c):
    c = unicodedata.normalize('NFC', str(c or '')).strip()
    if len(c) > 254 or not CORREO_OK.match(c):
        raise Rechazo('invalida', 'Ese correo no parece válido. Escríbelo entero, por ejemplo nombre@gmail.com.')
    usuario, _, dominio = c.rpartition('@')
    return usuario + '@' + dominio.lower()


def clave_correo(c):
    return str(c or '').strip().casefold()


def ocultar_correo(c):
    """mo*****@gmail.com: para decir a dónde se ha mandado algo sin enseñar la dirección entera."""
    u, _, d = str(c or '').partition('@')
    return (u[:2] + '•' * max(1, len(u) - 2)) + '@' + d if d else ''


def demasiadas(clave, maximo, segundos):
    """True si «clave» ya ha pedido «maximo» veces en los últimos «segundos». Si no, apunta esta vez."""
    t = time.time()
    with CERROJO_PETICIONES:
        lista = [x for x in PETICIONES_CORREO.get(clave, []) if t - x < segundos]
        if len(lista) >= maximo:
            PETICIONES_CORREO[clave] = lista
            return True
        lista.append(t)
        PETICIONES_CORREO[clave] = lista
        if len(PETICIONES_CORREO) > 5000:   # que no crezca sin fin
            for k in [k for k, v in PETICIONES_CORREO.items() if not v or t - v[-1] > 86400]:
                PETICIONES_CORREO.pop(k, None)
        return False


def url_enlaces():
    """A qué dirección apuntan los enlaces de los correos. Sale SOLO de la configuración."""
    return URL_PUBLICA or f'http://localhost:{PUERTO}'


def enviar_correo(para, asunto, texto):
    """Manda un correo de texto. Lanza excepción si falla (quien llama decide qué hacer)."""
    m = EmailMessage()
    m['From'] = f'La taberna de Jhon <{CORREO_REMITENTE}>'
    m['To'] = para
    m['Subject'] = asunto
    m['Date'] = formatdate(localtime=False)
    m['Message-ID'] = make_msgid(domain=CORREO_REMITENTE.partition('@')[2] or None)
    m.set_content(texto)
    ctx = ssl.create_default_context()   # comprueba el certificado del servidor de correo
    if CORREO_PUERTO == 465:
        with smtplib.SMTP_SSL(CORREO_SERVIDOR, CORREO_PUERTO, context=ctx, timeout=20) as s:
            s.login(CORREO_USUARIO, CORREO_CLAVE)
            s.send_message(m)
    else:
        with smtplib.SMTP(CORREO_SERVIDOR, CORREO_PUERTO, timeout=20) as s:
            s.starttls(context=ctx)      # si el servidor no admite cifrado, falla: nunca se manda en claro
            s.login(CORREO_USUARIO, CORREO_CLAVE)
            s.send_message(m)


def enviar_en_segundo_plano(para, asunto, texto):
    def tarea():
        try:
            enviar_correo(para, asunto, texto)
        except Exception as e:   # no se dice nada a quien lo pidió (sabría que la cuenta existe)
            print(f'No se pudo mandar el correo a {ocultar_correo(para)}: {type(e).__name__}: {e}', file=sys.stderr)
    threading.Thread(target=tarea, daemon=True).start()


def nuevo_enlace(con, clave, tipo, correo, minutos):
    """Crea un enlace de un solo uso (anula los anteriores del mismo tipo) y devuelve el token en claro."""
    token = secrets.token_urlsafe(32)
    con.execute('DELETE FROM enlaces_correo WHERE usuario=? AND tipo=?', (clave, tipo))
    con.execute('INSERT INTO enlaces_correo (token, usuario, tipo, correo, creado, caduca) VALUES (?,?,?,?,?,?)',
                (hash_token(token), clave, tipo, correo, time.time(), time.time() + minutos * 60))
    return token


def pedir_verificacion(clave, nombre, correo):
    """Apunta el correo como pendiente y manda el enlace para confirmarlo."""
    def hacer(con):
        con.execute('UPDATE usuarios SET correo_pendiente=? WHERE clave=?', (correo, clave))
        return nuevo_enlace(con, clave, 'verificar', correo, HORAS_VERIFICAR * 60)
    token = con_escritura(hacer)
    enviar_en_segundo_plano(correo, 'La taberna de Jhon: confirma tu correo', f'''Hola, {nombre}:

Has puesto este correo en tu cuenta de La taberna de Jhon. Para confirmar que es tuyo, abre este enlace:

{url_enlaces()}/#verificar={token}

El enlace sirve una sola vez y caduca en {HORAS_VERIFICAR} horas. Cuando lo confirmes, podrás usar este
correo para cambiar tu contraseña si alguna vez la olvidas.

Si no has sido tú, no hagas nada: este correo no quedará unido a ninguna cuenta.
''')


def poner_correo(u, cuerpo):
    """El dueño pone, cambia o quita su correo. Pide su contraseña actual (por si dejó la sesión abierta)."""
    if not CORREO_ACTIVO:
        raise Rechazo('invalida', 'El servidor no tiene el correo configurado (CORREO_USUARIO y CORREO_CLAVE en el archivo .env).')
    if u['rol'] == 'admin':
        raise Rechazo('permiso', 'El superusuario «DM» no usa correo: su contraseña es la de ALQUIMIA_ADMIN.')
    con = conectar()
    try:
        fila = buscar_usuario(con, u['clave'])
    finally:
        con.close()
    if not fila or not comprobar_contrasena(str(cuerpo.get('contrasena') or ''), fila[3]):
        raise Rechazo('credenciales', 'La contraseña no es correcta. No se ha cambiado nada.')
    if not cuerpo.get('correo'):   # quitarlo
        def hacer(con):
            con.execute('UPDATE usuarios SET correo=NULL, correo_pendiente=NULL WHERE clave=?', (u['clave'],))
            con.execute('DELETE FROM enlaces_correo WHERE usuario=?', (u['clave'],))
        con_escritura(hacer)
        return {'ok': True, 'quitado': True}
    correo = limpiar_correo(cuerpo.get('correo'))
    if demasiadas('u:' + u['clave'], 5, 3600):
        raise Rechazo('espera', 'Has pedido demasiados correos seguidos. Espera una hora y vuelve a probar.')
    pedir_verificacion(u['clave'], u['nombre'], correo)
    return {'ok': True, 'pendiente': correo}


def verificar_correo(cuerpo):
    token = str(cuerpo.get('token') or '')

    def hacer(con):
        f = con.execute("SELECT usuario, correo, caduca FROM enlaces_correo WHERE token=? AND tipo='verificar'",
                        (hash_token(token),)).fetchone()
        if not f or f[2] < time.time():
            raise Rechazo('enlace', 'Ese enlace ya se ha usado o ha caducado. Vuelve a poner tu correo en el Perfil.')
        otro = con.execute('SELECT clave FROM usuarios WHERE correo=? COLLATE NOCASE AND clave!=?', (f[1], f[0])).fetchone()
        con.execute("DELETE FROM enlaces_correo WHERE usuario=? AND tipo='verificar'", (f[0],))
        if otro:
            raise Rechazo('existe', 'Ese correo ya está en otra cuenta. Cada correo solo puede estar en una.')
        con.execute('UPDATE usuarios SET correo=?, correo_pendiente=NULL WHERE clave=?', (f[1], f[0]))
        return f[1]
    correo = con_escritura(hacer)
    return {'ok': True, 'correo': correo}


def pedir_recuperacion(cuerpo, ip):
    """Manda el enlace para cambiar la contraseña. La respuesta es SIEMPRE la misma."""
    respuesta = {'ok': True, 'mensaje': 'Si ese nombre o correo es de una cuenta con correo confirmado, te acabamos '
                 f'de mandar un enlace. Mira tu bandeja de entrada (y la de spam). Caduca en {MIN_ENLACE} minutos.'}
    if not CORREO_ACTIVO:
        raise Rechazo('invalida', 'Este servidor no tiene el correo configurado. Pide al DM que te ponga una contraseña nueva.')
    quien = str(cuerpo.get('quien') or '').strip()
    if not quien or len(quien) > 254:
        raise Rechazo('invalida', 'Escribe tu nombre de usuario o tu correo.')
    if demasiadas('ip:' + ip, 5, 900):
        raise Rechazo('espera', 'Demasiadas peticiones seguidas. Espera un cuarto de hora y vuelve a probar.')
    con = conectar()
    try:
        fila = con.execute('SELECT clave, nombre, rol, correo, baneado, pendiente FROM usuarios WHERE '
                           + ('correo=? COLLATE NOCASE' if '@' in quien else 'clave=?'),
                           (quien if '@' in quien else clave_de(quien),)).fetchone()
    finally:
        con.close()
    if not fila or not fila[3] or fila[2] == 'admin' or fila[4] or fila[5]:
        return respuesta
    if demasiadas('u:' + fila[0], 3, 3600):   # como mucho 3 enlaces por hora para la misma cuenta
        return respuesta
    token = con_escritura(lambda con: nuevo_enlace(con, fila[0], 'recuperar', fila[3], MIN_ENLACE))
    enviar_en_segundo_plano(fila[3], 'La taberna de Jhon: cambiar tu contraseña', f'''Hola, {fila[1]}:

Alguien (seguramente tú) ha pedido cambiar la contraseña de tu cuenta de La taberna de Jhon.
Para elegir una nueva, abre este enlace:

{url_enlaces()}/#recuperar={token}

El enlace sirve una sola vez y caduca en {MIN_ENLACE} minutos.

Si no lo has pedido tú, no hagas nada: tu contraseña sigue siendo la misma.
''')
    return respuesta


def recuperar_contrasena(cuerpo):
    token = str(cuerpo.get('token') or '')
    nueva = cuerpo.get('nueva')
    validar_contrasena(nueva)
    huella = hash_contrasena(nueva)   # fuera del cerrojo: tarda un poco

    def hacer(con):
        f = con.execute("SELECT e.usuario, e.caduca, u.nombre, u.correo, u.rol, u.baneado FROM enlaces_correo e "
                        "JOIN usuarios u ON u.clave=e.usuario WHERE e.token=? AND e.tipo='recuperar'",
                        (hash_token(token),)).fetchone()
        if not f or f[1] < time.time() or f[4] == 'admin' or f[5]:
            raise Rechazo('enlace', 'Ese enlace ya se ha usado o ha caducado. Pide otro desde «¿Olvidaste la contraseña?».')
        con.execute('UPDATE usuarios SET hash=? WHERE clave=?', (huella, f[0]))
        con.execute("DELETE FROM enlaces_correo WHERE usuario=? AND tipo='recuperar'", (f[0],))
        con.execute('DELETE FROM sesiones WHERE usuario=?', (f[0],))   # fuera quien estuviera dentro
        return f
    f = con_escritura(hacer)
    if f[3]:
        enviar_en_segundo_plano(f[3], 'La taberna de Jhon: tu contraseña ha cambiado', f'''Hola, {f[2]}:

La contraseña de tu cuenta de La taberna de Jhon se acaba de cambiar con el enlace del correo, y se han
cerrado todas las sesiones abiertas.

Si has sido tú, no tienes que hacer nada. Si no, avisa al DM cuanto antes.
''')
    return {'ok': True, 'nombre': f[2]}


def avisar_por_correo(clave, asunto, texto):
    """Avisa a una cuenta por correo (solo si tiene correo confirmado y el servidor tiene correo).
    Se llama DESPUÉS de guardar el cambio y fuera del cerrojo; el envío va en segundo plano."""
    if not CORREO_ACTIVO:
        return
    con = conectar()
    try:
        f = con.execute('SELECT nombre, correo FROM usuarios WHERE clave=?', (clave,)).fetchone()
    finally:
        con.close()
    if f and f[1]:
        enviar_en_segundo_plano(f[1], 'La taberna de Jhon: ' + asunto, f'Hola, {f[0]}:\n\n{texto}\n')


HORAS_ALTA = 24   # horas que dura el enlace para terminar de crear la cuenta


def pedir_alta(nombre, contrasena, correo, ip):
    """Crear cuenta con correo: la cuenta NO existe hasta que se abre el enlace. Se guarda la huella de la
    contraseña (nunca la contraseña) y la huella del token. La respuesta es la misma pase lo que pase
    con el correo: si ya está en otra cuenta, se avisa a ese correo en vez de decirlo aquí."""
    respuesta = {'ok': True, 'alta': True, 'mensaje': f'Te hemos mandado un correo a {correo}. Abre el enlace para terminar de '
                 f'crear la cuenta (caduca en {HORAS_ALTA} horas). Mira también en spam.'}
    if demasiadas('alta-ip:' + ip, 5, 3600) or demasiadas('alta-c:' + clave_correo(correo), 3, 3600):
        raise Rechazo('espera', 'Demasiadas cuentas pedidas seguidas. Espera una hora y vuelve a probar.')
    clave = clave_de(nombre)
    huella = hash_contrasena(contrasena)   # fuera del cerrojo: tarda

    def hacer(con):
        con.execute('DELETE FROM altas_pendientes WHERE caduca < ?', (time.time(),))
        if buscar_usuario(con, clave):
            raise Rechazo('existe', f'Ya existe una cuenta llamada «{nombre}». Elige otro nombre o entra con ella.')
        otro = con.execute('SELECT correo FROM altas_pendientes WHERE clave=?', (clave,)).fetchone()
        if otro and clave_correo(otro[0]) != clave_correo(correo):
            raise Rechazo('existe', f'Alguien está creando ahora una cuenta llamada «{nombre}». Elige otro nombre.')
        ya = con.execute('SELECT nombre FROM usuarios WHERE correo=? COLLATE NOCASE', (correo,)).fetchone()
        if ya:
            return ('ya', ya[0])
        con.execute('DELETE FROM altas_pendientes WHERE clave=?', (clave,))
        token = secrets.token_urlsafe(32)
        con.execute('INSERT INTO altas_pendientes (token, clave, nombre, hash, correo, creado, caduca) VALUES (?,?,?,?,?,?,?)',
                    (hash_token(token), clave, nombre, huella, correo, time.time(), time.time() + HORAS_ALTA * 3600))
        return ('ok', token)
    r, dato = con_escritura(hacer)
    if r == 'ya':
        enviar_en_segundo_plano(correo, 'La taberna de Jhon: ya tienes una cuenta', f'''Hola:

Alguien (seguramente tú) ha intentado crear una cuenta nueva en La taberna de Jhon con este correo, pero
este correo ya es de la cuenta «{dato}». Entra con ese nombre; si no recuerdas la contraseña, pulsa
«¿Olvidaste la contraseña?» en la pantalla de entrada.

Si no has sido tú, no hagas nada.
''')
    else:
        enviar_en_segundo_plano(correo, 'La taberna de Jhon: termina de crear tu cuenta', f'''Hola, {nombre}:

Para terminar de crear tu cuenta en La taberna de Jhon, abre este enlace:

{url_enlaces()}/#alta={dato}

El enlace sirve una sola vez y caduca en {HORAS_ALTA} horas. Después entrarás con tu nombre y tu contraseña.

Si no has sido tú, no hagas nada: no se creará ninguna cuenta.
''')
    return respuesta


def confirmar_alta(cuerpo):
    token = str(cuerpo.get('token') or '')

    def hacer(con):
        f = con.execute('SELECT nombre, hash, correo, caduca FROM altas_pendientes WHERE token=?', (hash_token(token),)).fetchone()
        if not f or f[3] < time.time():
            raise Rechazo('enlace', 'Ese enlace ya se ha usado o ha caducado. Vuelve a crear la cuenta.')
        con.execute('DELETE FROM altas_pendientes WHERE token=?', (hash_token(token),))
        if con.execute('SELECT 1 FROM usuarios WHERE correo=? COLLATE NOCASE', (f[2],)).fetchone():
            raise Rechazo('existe', 'Ese correo ya es de otra cuenta. Entra con ella.')
        return alta_en_bd(con, f[0], f[1], f[2])
    # Si algo falla, se deshace todo (también el borrado del enlace)
    return con_escritura(hacer)


def datos_correo(con, clave):
    f = con.execute('SELECT correo, correo_pendiente FROM usuarios WHERE clave=?', (clave,)).fetchone()
    return {'correo': f[0] if f else None, 'pendiente': f[1] if f else None}


# ------------------------------------------------------------ Discord
# Discord NO sirve para entrar: se entra siempre con nombre y contraseña. Sirve para dos cosas (V3.6):
#  - CREAR una cuenta sin la palabra de paso de la mesa: la persona escribe nombre y contraseña y
#    demuestra con Discord quién es. Cada cuenta de Discord solo puede crear UNA cuenta (eso frena la
#    creación masiva) y la cuenta queda PENDIENTE hasta que un DM o el superusuario la apruebe en «En línea».
#  - VINCULAR Discord a una cuenta que ya existe (desde el Perfil).
# Flujo OAuth2 «authorization code»:
#  1. POST /api/discord/empezar (modo «crear» con nombre y contraseña, o «vincular» con sesión).
#     El servidor apunta un «state» de un solo uso (10 min), lo ata a este navegador con una cookie
#     y devuelve la dirección de Discord. La contraseña solo se guarda ya cifrada, y en memoria.
#  2. Discord pregunta a la persona y vuelve a GET /api/discord/vuelta?code=...&state=...
#  3. El servidor canjea el code (con el secreto, que nunca sale del servidor), lee el id de Discord
#     y crea la cuenta pendiente o la vincula. Vuelve a la app con #discord=pendiente|vinculado|error.
DISCORD_AUTORIZAR = 'https://discord.com/oauth2/authorize'
DISCORD_TOKEN = 'https://discord.com/api/v10/oauth2/token'
DISCORD_YO = 'https://discord.com/api/v10/users/@me'
COOKIE_DISCORD = 'alq_discord'
ESTADOS_DISCORD = {}   # state -> {'modo', 'usuario', 'nombre', 'hash', 'nonce', 'origen', 't'}
ORIGEN_LOCAL = re.compile(r'^http://(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$')


def limpiar_discord():
    t = time.time()
    for k in [k for k, v in ESTADOS_DISCORD.items() if t - v['t'] > 600]:
        ESTADOS_DISCORD.pop(k, None)


def origen_para_discord(pedido):
    """A qué dirección vuelve Discord: la del propio navegador si es localhost; si no, ALQUIMIA_URL.
    Tiene que estar apuntada tal cual en «Redirects» del portal de Discord (ver docs/DISCORD.md)."""
    pedido = str(pedido or '').rstrip('/')
    if ORIGEN_LOCAL.match(pedido):
        return pedido
    if URL_PUBLICA:
        return URL_PUBLICA
    if re.match(r'^https?://[A-Za-z0-9.\-]+(:\d{1,5})?$', pedido):
        return pedido   # sin ALQUIMIA_URL: la que use el navegador (también tiene que estar en el portal)
    raise Rechazo('invalida', 'No se sabe a qué dirección debe volver Discord. Pon ALQUIMIA_URL en el archivo .env.')


def discord_empezar(u, cuerpo):
    if not DISCORD_ACTIVO:
        raise Rechazo('invalida', 'Discord no está configurado en este servidor (faltan DISCORD_CLIENT_ID y DISCORD_CLIENT_SECRET).')
    modo = cuerpo.get('modo')
    nombre = hash_ = None
    if modo == 'crear':
        nombre = re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(cuerpo.get('nombre') or '')).strip())
        if not NOMBRE_OK.match(nombre):
            raise Rechazo('invalida', 'El nombre debe tener de 2 a 24 letras o números (también valen espacios, guiones y puntos).')
        validar_contrasena(cuerpo.get('contrasena'))
        con = conectar()
        try:
            if buscar_usuario(con, clave_de(nombre)):
                raise Rechazo('existe', f'Ya existe una cuenta llamada «{nombre}». Elige otro nombre o entra con ella.')
            if not con.execute("SELECT 1 FROM usuarios WHERE rol!='admin' LIMIT 1").fetchone():
                raise Rechazo('invalida', 'La primera cuenta (la del DM) se crea con el correo o con la palabra de paso, no con Discord.')
        finally:
            con.close()
        hash_ = hash_contrasena(cuerpo.get('contrasena'))
    elif modo == 'vincular':
        if not u:
            raise Rechazo('sesion', 'Tienes que entrar con tu cuenta para vincular Discord.')
        if es_admin(u):
            raise Rechazo('permiso', 'El superusuario «DM» no se vincula a Discord.')
    else:
        raise Rechazo('invalida', 'Modo desconocido.')
    origen = origen_para_discord(cuerpo.get('origen'))
    limpiar_discord()
    if len(ESTADOS_DISCORD) > 500:
        raise Rechazo('espera', 'Demasiadas peticiones a Discord a medias. Espera unos minutos.')
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    ESTADOS_DISCORD[state] = {'modo': modo, 'usuario': u['clave'] if u and modo == 'vincular' else None,
                              'nombre': nombre, 'hash': hash_, 'nonce': nonce, 'origen': origen, 't': time.time()}
    url = DISCORD_AUTORIZAR + '?' + urlencode({
        'response_type': 'code', 'client_id': DISCORD_ID, 'scope': 'identify', 'state': state,
        'redirect_uri': origen + '/api/discord/vuelta'})
    return {'ok': True, 'url': url}, nonce, origen.startswith('https://')


def discord_pedir(url, datos=None, token=None):
    cab = {'User-Agent': 'LaTabernaDeJhon (https://github.com/SeimosAF/Alchemy_DF-C, 3.6)', 'Accept': 'application/json'}
    if datos is not None:
        cab['Content-Type'] = 'application/x-www-form-urlencoded'
    if token:
        cab['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, data=urlencode(datos).encode() if datos is not None else None, headers=cab)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            detalle = e.read().decode('utf-8', 'replace')[:300]
        except Exception:
            detalle = ''
        print(f'Discord respondió {e.code} en {url}: {detalle}', file=sys.stderr)
        if e.code in (400, 401):
            raise Rechazo('discord', 'Discord no aceptó la petición. Revisa DISCORD_CLIENT_SECRET y que la dirección de vuelta '
                          'esté apuntada en el portal de Discord (docs/DISCORD.md).')
        raise Rechazo('discord', f'Discord respondió con un error ({e.code}). Vuelve a probar en un rato.')
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
        print('No se pudo hablar con Discord:', e, file=sys.stderr)
        raise Rechazo('discord', 'No se pudo hablar con Discord. ¿Tiene internet el servidor?')


def discord_vuelta(q, cookie_nonce):
    """Devuelve (origen, fragmento) para volver a la app: #discord=pendiente | vinculado | error."""
    limpiar_discord()
    st = ESTADOS_DISCORD.pop(q.get('state', [''])[0], None)
    if not st:
        return URL_PUBLICA or '', 'discord=error&m=' + quote('La petición a Discord caducó o no es válida. Vuelve a probar.')
    origen = st['origen']
    if not cookie_nonce or not hmac.compare_digest(cookie_nonce, st['nonce']):
        return origen, 'discord=error&m=' + quote('Empieza y termina con Discord en el mismo navegador.')
    if q.get('error'):
        return origen, 'discord=error&m=' + quote('Has cancelado en Discord. No se ha cambiado nada.')
    try:
        tok = discord_pedir(DISCORD_TOKEN, {
            'grant_type': 'authorization_code', 'code': q.get('code', [''])[0],
            'redirect_uri': origen + '/api/discord/vuelta',
            'client_id': DISCORD_ID, 'client_secret': DISCORD_SECRETO})
        perfil = discord_pedir(DISCORD_YO, token=tok.get('access_token'))
        did = str(perfil.get('id') or '')
        if not did.isdigit():
            raise Rechazo('discord', 'Discord no ha dicho quién eres.')
        alias = str(perfil.get('username') or '')[:40]

        def hacer(con):
            otra = con.execute('SELECT clave, nombre FROM usuarios WHERE discord_id=?', (did,)).fetchone()
            if st['modo'] == 'vincular':
                if otra and otra[0] != st['usuario']:
                    raise Rechazo('existe', f'Esa cuenta de Discord ya está vinculada a «{otra[1]}».')
                con.execute('UPDATE usuarios SET discord_id=?, discord_nombre=? WHERE clave=?', (did, alias, st['usuario']))
                return 'discord=vinculado'
            # crear: una sola cuenta por cada cuenta de Discord
            if otra:
                raise Rechazo('existe', f'Con esa cuenta de Discord ya se creó la cuenta «{otra[1]}». Entra con su nombre y contraseña.')
            if buscar_usuario(con, clave_de(st['nombre'])):
                raise Rechazo('existe', f'Alguien acaba de crear una cuenta llamada «{st["nombre"]}». Elige otro nombre.')
            # V3.9 (pedido por Moisés): con Discord la cuenta queda creada al momento, sin esperar al DM
            con.execute('INSERT INTO usuarios (clave, nombre, hash, rol, creado, baneado, discord_id, discord_nombre, pendiente) '
                        "VALUES (?,?,?,'jugador',?,0,?,?,0)", (clave_de(st['nombre']), st['nombre'], st['hash'], ahora(), did, alias))
            print(f'Cuenta nueva creada con Discord: {st["nombre"]} (@{alias}).')
            return 'discord=creada&n=' + quote(st['nombre'])
        return origen, con_escritura(hacer)
    except Rechazo as r:
        return origen, 'discord=error&m=' + quote(r.mensaje) + ('&modo=' + st['modo'])


def discord_desvincular(u):
    def hacer(con):
        fila = buscar_usuario(con, u['clave'])
        if not fila:
            raise Rechazo('invalida', 'Esa cuenta no existe.')
        con.execute('UPDATE usuarios SET discord_id=NULL, discord_nombre=NULL WHERE clave=?', (u['clave'],))
        return {'ok': True}
    return con_escritura(hacer)


def datos_discord(con, clave):
    fila = con.execute('SELECT discord_id, discord_nombre FROM usuarios WHERE clave=?', (clave,)).fetchone()
    return {'vinculado': bool(fila and fila[0]), 'nombre': (fila[1] if fila else '') or ''}


# ------------------------------------------------------- chat de la mesa (V3.9)
# Cada campaña tiene su chat. Lo leen y escriben los de la mesa (y el superusuario). El bot de la mesa
# (por defecto «Dobby») avisa cuando alguien entra por PRIMERA vez; su nombre y su mensaje de
# bienvenida los cambia el DM de la mesa (o el superusuario). En la bienvenida, {nombre} = quien llega
# y {mesa} = el nombre de la mesa.
BOT_NOMBRE = 'Dobby Jr.'          # el bot de cada mesa (su DM le puede cambiar el nombre)
BOT_BIENVENIDA = '¡{nombre} ha llegado a «{mesa}» por primera vez! Dobby Jr. os desea buena partida.'
BOT_GENERAL = 'Dobby'             # el bot del chat general: versiones nuevas y apagado / encendido del servidor
GENERAL = '*'                     # «campaña» de los mensajes del chat general (lo ven y escriben todas las cuentas)
MAX_MENSAJE = 1000
MAX_BOT_NOMBRE = 30
MAX_BIENVENIDA = 300
LLEGADOS = set()   # (campana, usuario) ya comprobados desde que arrancó el servidor


def texto_limpio(t, maximo, lineas=True):
    """Texto normalizado, sin caracteres de control (salvo saltos de línea si «lineas») y recortado."""
    t = unicodedata.normalize('NFC', str(t or '')).replace('\r\n', '\n').replace('\r', '\n')
    t = ''.join(c for c in t if (c == '\n' and lineas) or unicodedata.category(c)[0] != 'C' or c == '\u200d')
    t = re.sub(r'\n{3,}', '\n\n', t).strip()
    return t[:maximo]


def bot_de(con, camp):
    f = con.execute('SELECT bot_nombre, bot_bienvenida FROM campanas WHERE id=?', (camp,)).fetchone() or (None, None)
    return {'nombre': f[0] or BOT_NOMBRE, 'bienvenida': f[1] or BOT_BIENVENIDA}


def ultimo_chat(con, camp):
    return con.execute('SELECT COALESCE(MAX(id), 0) FROM chat WHERE campana=?', (camp,)).fetchone()[0]


def borrados_chat(con, camp):
    return con.execute('SELECT COUNT(*) FROM chat WHERE campana=? AND borrado=1', (camp,)).fetchone()[0]


def mensajes_chat(con, camp, desde=None, antes=None, n=60):
    if desde is not None:
        filas = con.execute('SELECT id, autor, nombre, texto, fecha FROM chat WHERE campana=? AND id>? AND borrado=0 ORDER BY id LIMIT 200',
                            (camp, desde)).fetchall()
    else:
        filas = con.execute('SELECT id, autor, nombre, texto, fecha FROM chat WHERE campana=? AND id<? AND borrado=0 ORDER BY id DESC LIMIT ?',
                            (camp, antes or 2 ** 62, n)).fetchall()[::-1]
    fotos = versiones_avatar(con)
    return [{'id': i, 'autor': a, 'nombre': nm, 'texto': t, 'fecha': f, 'bot': a == '', 'avatar': fotos.get(a, 0) if a else 0}
            for i, a, nm, t, f in filas]


def bienvenida_si_es_nuevo(camp, actor):
    """La primera vez que alguien entra en una mesa, el bot lo anuncia en el chat (una sola vez, nunca más)."""
    if actor.get('rol') == 'admin' or (camp, actor['clave']) in LLEGADOS:
        return

    def hacer(con):
        cur = con.execute('INSERT OR IGNORE INTO chat_llegadas VALUES (?,?,?)', (camp, actor['clave'], ahora()))
        if cur.rowcount != 1:
            return
        bot = bot_de(con, camp)
        texto = bot['bienvenida'].replace('{nombre}', actor['nombre']).replace('{mesa}', actor.get('mesa') or '')
        con.execute('INSERT INTO chat (campana, autor, nombre, texto, fecha) VALUES (?,?,?,?,?)',
                    (camp, '', bot['nombre'], texto_limpio(texto, MAX_BIENVENIDA + 200), ahora()))
    con_escritura(hacer)
    LLEGADOS.add((camp, actor['clave']))


def enviar_chat(actor, cuerpo):
    texto = texto_limpio(cuerpo.get('texto'), MAX_MENSAJE + 1)
    if not texto:
        raise Rechazo('invalida', 'El mensaje está vacío.')
    if len(texto) > MAX_MENSAJE:
        raise Rechazo('invalida', f'El mensaje es demasiado largo (máximo {MAX_MENSAJE} caracteres).')
    if demasiadas('chat:' + actor['clave'], 8, 10):
        raise Rechazo('espera', 'Vas muy deprisa: espera unos segundos antes de mandar otro mensaje.')
    camp = actor['campana']

    def hacer(con):
        cur = con.execute('INSERT INTO chat (campana, autor, nombre, texto, fecha) VALUES (?,?,?,?,?)',
                          (camp, actor['clave'], actor['nombre'], texto, ahora()))
        return {'ok': True, 'id': cur.lastrowid}
    return con_escritura(hacer)


def enviar_general(u, cuerpo):
    """Chat general de la taberna: lo leen y escriben todas las cuentas, estén en la mesa que estén."""
    texto = texto_limpio(cuerpo.get('texto'), MAX_MENSAJE + 1)
    if not texto:
        raise Rechazo('invalida', 'El mensaje está vacío.')
    if len(texto) > MAX_MENSAJE:
        raise Rechazo('invalida', f'El mensaje es demasiado largo (máximo {MAX_MENSAJE} caracteres).')
    if demasiadas('chat:' + u['clave'], 8, 10):
        raise Rechazo('espera', 'Vas muy deprisa: espera unos segundos antes de mandar otro mensaje.')

    def hacer(con):
        cur = con.execute('INSERT INTO chat (campana, autor, nombre, texto, fecha) VALUES (?,?,?,?,?)',
                          (GENERAL, u['clave'], u['nombre'], texto, ahora()))
        return {'ok': True, 'id': cur.lastrowid}
    return con_escritura(hacer)


def borrar_general(u, cuerpo):
    """Moderación del chat general: solo el superusuario (los DM lo son de su mesa, no de toda la taberna)."""
    if not es_admin(u):
        raise Rechazo('permiso', 'Solo el superusuario puede borrar mensajes del chat general.')
    try:
        mid = int(cuerpo.get('id'))
    except (TypeError, ValueError):
        raise Rechazo('invalida', 'Mensaje no válido.')
    con_escritura(lambda con: con.execute('UPDATE chat SET borrado=1, borrado_por=?, borrado_fecha=? WHERE id=? AND campana=?',
                                          (u['clave'], ahora(), mid, GENERAL)))
    return {'ok': True}


def borrar_mensaje(actor, cuerpo):
    """Moderación: el DM de la mesa o el superusuario retiran un mensaje del chat (de quien sea, también del bot).
    Desaparece para todos; en la base queda marcado con quién lo retiró, y en el historial de la mesa."""
    if not es_dm(actor):
        raise Rechazo('permiso', 'Solo el DM de la mesa o el superusuario pueden borrar mensajes.')
    try:
        mid = int(cuerpo.get('id'))
    except (TypeError, ValueError):
        raise Rechazo('invalida', 'Mensaje no válido.')
    camp = actor['campana']

    def hacer(con):
        f = con.execute('SELECT nombre, texto, borrado FROM chat WHERE id=? AND campana=?', (mid, camp)).fetchone()
        if not f:
            raise Rechazo('invalida', 'Ese mensaje no existe.')
        if f[2]:
            return {'ok': True}
        con.execute('UPDATE chat SET borrado=1, borrado_por=?, borrado_fecha=? WHERE id=?', (actor['clave'], ahora(), mid))
        corto = f[1] if len(f[1]) <= 80 else f[1][:80] + '…'
        apuntar(con, camp, actor, 'chat', f'borró un mensaje de {f[0]} en el chat: «{corto}»')
        return {'ok': True}
    return con_escritura(hacer)


# ---- El bot avisa en todas las mesas: servidor apagado / encendido y versión nueva (V3.9)
# {{hora:FECHA-ISO}} lo pinta el navegador con la hora de quien lo lee («hoy a las 16:13»).
def hora_bot(t):
    return '{{hora:' + datetime.fromtimestamp(t, timezone.utc).isoformat(timespec='seconds') + '}}'


def duracion(seg):
    seg = int(max(0, seg))
    if seg < 90:
        return 'unos segundos'
    m = round(seg / 60)
    if m < 60:
        return f'{m} minuto{"s" if m != 1 else ""}'
    h, m = divmod(m, 60)
    if h < 48:
        return f'{h} hora{"s" if h != 1 else ""}' + (f' y {m} minuto{"s" if m != 1 else ""}' if m else '')
    d = round(h / 24)
    return f'{d} días'


def bot_a_todas(con, texto):
    """Dobby lo dice en el chat GENERAL (lo ven todas las cuentas). Los chats de las mesas no se tocan:
    allí Dobby Jr. solo anuncia quién llega por primera vez y quién se va."""
    con.execute('INSERT INTO chat (campana, autor, nombre, texto, fecha) VALUES (?,?,?,?,?)',
                (GENERAL, '', BOT_GENERAL, texto, ahora()))


def bot_de_mesa(con, camp, texto):
    """Dobby Jr. (o como lo haya llamado el DM) dice algo en el chat de una mesa."""
    con.execute('INSERT INTO chat (campana, autor, nombre, texto, fecha) VALUES (?,?,?,?,?)',
                (camp, '', bot_de(con, camp)['nombre'], texto_limpio(texto, 600), ahora()))


def leer_ajuste(con, clave):
    f = con.execute('SELECT valor FROM ajustes WHERE clave=?', (clave,)).fetchone()
    return f[0] if f else None


def poner_ajuste(con, clave, valor):
    if valor is None:
        con.execute('DELETE FROM ajustes WHERE clave=?', (clave,))
    else:
        con.execute('INSERT OR REPLACE INTO ajustes VALUES (?, ?)', (clave, str(valor)))


def anunciar_encendido():
    """Al arrancar. Si la última vez se apagó bien, ya se avisó entonces; si no (corte de luz, ventana cerrada...),
    se avisa ahora con la hora del último latido. Después: encendido y, si cambió la versión, las novedades."""
    def hacer(con):
        t = time.time()
        apagado, latido = leer_ajuste(con, 'servidor-apagado'), leer_ajuste(con, 'servidor-latido')
        desde = None
        if apagado:
            desde = float(apagado)
        elif latido:
            desde = float(latido)
            bot_a_todas(con, f'🔴 El servidor se apagó sin avisar {hora_bot(desde)}, más o menos '
                             '(corte de luz, ventana cerrada o el PC apagado).')
        bot_a_todas(con, f'🟢 El servidor se ha encendido {hora_bot(t)}.'
                         + (f' Ha estado apagado {duracion(t - desde)}.' if desde else ''))
        if leer_ajuste(con, 'version-anunciada') != VERSION:
            bot_a_todas(con, f'✨ La taberna se ha actualizado a la V{VERSION}: {NOVEDADES}')
            poner_ajuste(con, 'version-anunciada', VERSION)
        poner_ajuste(con, 'servidor-apagado', None)
        poner_ajuste(con, 'servidor-latido', t)
    con_escritura(hacer)


def anunciar_apagado():
    def hacer(con):
        t = time.time()
        bot_a_todas(con, f'🔴 El servidor se ha apagado {hora_bot(t)}.')
        poner_ajuste(con, 'servidor-apagado', t)
    con_escritura(hacer)


def latidos():
    """Cada minuto apunta que sigue vivo: si se apaga de golpe, al volver se sabe cuándo fue."""
    while True:
        time.sleep(60)
        try:
            con_escritura(lambda con: poner_ajuste(con, 'servidor-latido', time.time()))
        except Exception as e:   # que un fallo puntual no pare los latidos
            print('Latido no guardado:', e, file=sys.stderr)


# ---- Avisos personales y chats privados
MAX_AVISOS = 300   # por cuenta: los más viejos se van borrando


def avisar(con, clave, texto, camp=None):
    """Apunta un aviso para «clave» (dentro de la transacción de lo que lo provoca: o las dos cosas o ninguna)."""
    if not clave:
        return
    con.execute('INSERT INTO avisos (usuario, texto, campana, fecha) VALUES (?,?,?,?)',
                (clave, texto_limpio(texto, 600), camp, ahora()))
    con.execute('DELETE FROM avisos WHERE usuario=? AND id <= (SELECT id FROM avisos WHERE usuario=? ORDER BY id DESC LIMIT 1 OFFSET ?)',
                (clave, clave, MAX_AVISOS))


def nombre_mesa(con, camp):
    return (con.execute('SELECT nombre FROM campanas WHERE id=?', (camp,)).fetchone() or [camp])[0]


def quien_corto(actor):
    """«El superusuario», «Jhon (DM)» o «Ana», para los avisos."""
    if actor.get('rol') == 'admin':
        return 'El superusuario'
    return f'{actor["nombre"]} (DM)' if actor.get('rol') == 'dm' else actor['nombre']


def lista_avisos(con, clave, antes=None):
    filas = con.execute('SELECT a.id, a.texto, a.fecha, a.leido, a.campana, c.nombre FROM avisos a LEFT JOIN campanas c ON c.id=a.campana '
                        'WHERE a.usuario=? AND a.id<? ORDER BY a.id DESC LIMIT 60', (clave, antes or 2 ** 62)).fetchall()
    return [{'id': i, 'texto': t, 'fecha': f, 'leido': bool(l), 'campana': c, 'mesa': m} for i, t, f, l, c, m in filas]


def avisos_leidos(u, cuerpo):
    try:
        hasta = int(cuerpo.get('hasta'))
    except (TypeError, ValueError):
        raise Rechazo('invalida', 'Falta hasta dónde se ha leído.')
    con_escritura(lambda con: con.execute('UPDATE avisos SET leido=1 WHERE usuario=? AND id<=? AND leido=0', (u['clave'], hasta)))
    return {'ok': True}


def resumen_buzon(con, clave):
    """Lo que el sondeo necesita para los numeritos: avisos y privados sin leer, y el último id de cada cosa."""
    a = con.execute('SELECT COALESCE(MAX(id),0), COALESCE(SUM(leido=0),0) FROM avisos WHERE usuario=?', (clave,)).fetchone()
    p = con.execute('SELECT COALESCE(MAX(id),0) FROM privados WHERE de=? OR para=?', (clave, clave)).fetchone()
    n = con.execute('SELECT COUNT(*) FROM privados WHERE para=? AND leido=0', (clave,)).fetchone()
    return {'avisos': a[1], 'avisosUltimo': a[0], 'privados': n[0], 'privadosUltimo': p[0]}


def puede_escribir_a(con, para):
    f = con.execute('SELECT nombre, baneado, pendiente FROM usuarios WHERE clave=?', (para,)).fetchone()
    if not f or f[1] or f[2]:
        raise Rechazo('invalida', 'No se le puede escribir a esa cuenta.')
    return f[0]


def conversaciones(con, clave):
    """Las conversaciones privadas de una cuenta: con quién, el último mensaje y cuántos sin leer."""
    filas = con.execute('''SELECT otro, MAX(id) FROM (
            SELECT para AS otro, id FROM privados WHERE de=? UNION ALL SELECT de AS otro, id FROM privados WHERE para=?)
        GROUP BY otro ORDER BY MAX(id) DESC''', (clave, clave)).fetchall()
    fotos = versiones_avatar(con)
    out = []
    for otro, ultimo in filas:
        u = con.execute('SELECT nombre, baneado FROM usuarios WHERE clave=?', (otro,)).fetchone()
        if not u:
            continue
        de, texto, fecha = con.execute('SELECT de, texto, fecha FROM privados WHERE id=?', (ultimo,)).fetchone()
        n = con.execute('SELECT COUNT(*) FROM privados WHERE de=? AND para=? AND leido=0', (otro, clave)).fetchone()[0]
        out.append({'clave': otro, 'nombre': u[0], 'baneado': bool(u[1]), 'avatar': fotos.get(otro, 0), 'ultimo': ultimo,
                    'texto': texto[:120], 'mio': de == clave, 'fecha': fecha, 'sinLeer': n})
    return out


def mensajes_privados(con, clave, otro, desde=None, antes=None):
    if desde is not None:
        filas = con.execute('SELECT id, de, texto, fecha, leido FROM privados WHERE ((de=? AND para=?) OR (de=? AND para=?)) AND id>? '
                            'ORDER BY id LIMIT 200', (clave, otro, otro, clave, desde)).fetchall()
    else:
        filas = con.execute('SELECT id, de, texto, fecha, leido FROM privados WHERE ((de=? AND para=?) OR (de=? AND para=?)) AND id<? '
                            'ORDER BY id DESC LIMIT 60', (clave, otro, otro, clave, antes or 2 ** 62)).fetchall()[::-1]
    return [{'id': i, 'autor': d, 'texto': t, 'fecha': f, 'leido': bool(l)} for i, d, t, f, l in filas]


def enviar_privado(u, cuerpo):
    para = clave_de(cuerpo.get('para'))
    if para == u['clave']:
        raise Rechazo('invalida', 'No puedes escribirte a ti mismo.')
    texto = texto_limpio(cuerpo.get('texto'), MAX_MENSAJE + 1)
    if not texto:
        raise Rechazo('invalida', 'El mensaje está vacío.')
    if len(texto) > MAX_MENSAJE:
        raise Rechazo('invalida', f'El mensaje es demasiado largo (máximo {MAX_MENSAJE} caracteres).')
    if demasiadas('chat:' + u['clave'], 8, 10):
        raise Rechazo('espera', 'Vas muy deprisa: espera unos segundos antes de mandar otro mensaje.')

    def hacer(con):
        puede_escribir_a(con, para)
        cur = con.execute('INSERT INTO privados (de, para, texto, fecha) VALUES (?,?,?,?)', (u['clave'], para, texto, ahora()))
        return {'ok': True, 'id': cur.lastrowid}
    return con_escritura(hacer)


def privados_leidos(u, cuerpo):
    otro = clave_de(cuerpo.get('con'))
    con_escritura(lambda con: con.execute('UPDATE privados SET leido=1 WHERE de=? AND para=? AND leido=0', (otro, u['clave'])))
    return {'ok': True}


def directorio(con, yo):
    """Cuentas a las que se puede escribir en privado (todas las activas menos uno mismo)."""
    fotos = versiones_avatar(con)
    return [{'clave': c, 'nombre': n, 'admin': r == 'admin', 'avatar': fotos.get(c, 0)} for c, n, r in con.execute(
        "SELECT clave, nombre, rol FROM usuarios WHERE baneado=0 AND pendiente=0 AND clave!=? "
        "AND (rol!='admin' OR ?) ORDER BY nombre COLLATE NOCASE", (yo, 1 if ADMIN_CLAVE else 0))]


def ajustar_bot(actor, cuerpo):
    """El DM de la mesa (o el superusuario) cambia el nombre del bot y su mensaje de bienvenida."""
    if not es_dm(actor):
        raise Rechazo('permiso', 'Solo el DM de la mesa o el superusuario pueden cambiar el bot.')
    nombre = re.sub(r'\s+', ' ', texto_limpio(cuerpo.get('nombre'), MAX_BOT_NOMBRE + 1, False))
    bienvenida = texto_limpio(cuerpo.get('bienvenida'), MAX_BIENVENIDA + 1)
    if not nombre or len(nombre) > MAX_BOT_NOMBRE:
        raise Rechazo('invalida', f'El nombre del bot debe tener entre 1 y {MAX_BOT_NOMBRE} caracteres.')
    if not bienvenida or len(bienvenida) > MAX_BIENVENIDA:
        raise Rechazo('invalida', f'La bienvenida debe tener entre 1 y {MAX_BIENVENIDA} caracteres.')
    camp = actor['campana']

    def hacer(con):
        antes = bot_de(con, camp)
        con.execute('UPDATE campanas SET bot_nombre=?, bot_bienvenida=? WHERE id=?',
                    (None if nombre == BOT_NOMBRE else nombre, None if bienvenida == BOT_BIENVENIDA else bienvenida, camp))
        if antes['nombre'] != nombre:
            apuntar(con, camp, actor, 'mesa', f'cambió el nombre del bot del chat: {antes["nombre"]} → {nombre}')
        if antes['bienvenida'] != bienvenida:
            apuntar(con, camp, actor, 'mesa', 'cambió el mensaje de bienvenida del bot del chat')
        return {'ok': True, 'bot': {'nombre': nombre, 'bienvenida': bienvenida}}
    return con_escritura(hacer)


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
                return self.json(200, {'ok': True, 'cuentas': True, 'hayUsuarios': hay, 'pideClave': bool(CLAVE),
                                       'discord': DISCORD_ACTIVO, 'correo': CORREO_ACTIVO})
            if ruta == '/api/discord/vuelta':   # Discord devuelve aquí al navegador (sin sesión todavía)
                cookie = ''
                for trozo in (self.headers.get('Cookie') or '').split(';'):
                    k, _, v = trozo.strip().partition('=')
                    if k == COOKIE_DISCORD:
                        cookie = v
                origen, frag = discord_vuelta(parse_qs(url.query), cookie)
                self.send_response(303)
                self.send_header('Location', (origen or '') + '/#' + frag)
                self.send_header('Set-Cookie', f'{COOKIE_DISCORD}=; Path=/api/discord; Max-Age=0; HttpOnly; SameSite=Lax')
                self.send_header('Referrer-Policy', 'no-referrer')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            u = self.actor()
            if not u:
                return self.sin_sesion()
            q = parse_qs(url.query)
            con = conectar()
            try:
                # --- sin campaña: quién soy y en qué campañas juego
                if ruta == '/api/yo':
                    u = {**u, 'avatar': versiones_avatar(con).get(u['clave'], 0), 'discord': datos_discord(con, u['clave']),
                         'discordActivo': DISCORD_ACTIVO, 'correo': datos_correo(con, u['clave']), 'correoActivo': CORREO_ACTIVO}
                    return self.json(200, {'ok': True, 'usuario': u, 'campanas': campanas_de(con, u),
                                           'otras': otras_campanas(con, u), 'puedeCrear': puede_crear_campanas(con, u),
                                           'puedeSolicitar': puede_solicitar(con, u), 'solicitud': solicitud_de(con, u['clave'])})
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
                # --- avisos personales y chats privados (de la cuenta, no de una campaña)
                if ruta == '/api/avisos':
                    try:
                        antes = int(q['antes'][0]) if 'antes' in q else None
                    except ValueError:
                        antes = None
                    return self.json(200, {'ok': True, 'avisos': lista_avisos(con, u['clave'], antes), 'buzon': resumen_buzon(con, u['clave'])})
                if ruta == '/api/general':   # chat general (?desde=ID los nuevos, ?antes=ID los anteriores)
                    try:
                        desde = int(q['desde'][0]) if 'desde' in q else None
                        antes = int(q['antes'][0]) if 'antes' in q else None
                    except ValueError:
                        desde = antes = None
                    return self.json(200, {'ok': True, 'mensajes': mensajes_chat(con, GENERAL, desde, antes),
                                           'ultimo': ultimo_chat(con, GENERAL), 'borrados': borrados_chat(con, GENERAL),
                                           'puedeModerar': es_admin(u)})
                if ruta == '/api/privados':
                    return self.json(200, {'ok': True, 'conversaciones': conversaciones(con, u['clave']),
                                           'directorio': directorio(con, u['clave']), 'buzon': resumen_buzon(con, u['clave'])})
                if ruta == '/api/privados/con':
                    otro = clave_de((q.get('u') or [''])[0])
                    f = con.execute('SELECT nombre FROM usuarios WHERE clave=?', (otro,)).fetchone()
                    if not f or otro == u['clave']:
                        return self.json(404, {'ok': False, 'mensaje': 'Esa cuenta no existe.'})
                    try:
                        desde = int(q['desde'][0]) if 'desde' in q else None
                        antes = int(q['antes'][0]) if 'antes' in q else None
                    except ValueError:
                        desde = antes = None
                    return self.json(200, {'ok': True, 'con': {'clave': otro, 'nombre': f[0], 'avatar': versiones_avatar(con).get(otro, 0)},
                                           'mensajes': mensajes_privados(con, u['clave'], otro, desde, antes)})
                if ruta == '/api/campanas':
                    if not es_admin(u) and not puede_crear_campanas(con, u):
                        return self.json(200, {'ok': True, 'campanas': campanas_de(con, u)})
                    return self.json(200, {'ok': True, 'campanas': resumen_campanas(con) if es_admin(u) else campanas_de(con, u),
                                           'cuentas': lista_cuentas(con, u) if es_admin(u) else [],
                                           'bloqueos': bloqueos_registro(con) if es_admin(u) else [],
                                           'solicitudes': lista_solicitudes(con) if es_admin(u) else []})
                # --- dentro de una campaña
                actor = self.actor_mesa(con, u)
                if not actor:
                    return self.sin_mesa()
                camp = actor['campana']
                if ruta == '/api/estado':
                    if actor['rol'] != 'admin':
                        dar_odre_inicial(camp, actor['clave'])   # V3.8: el odre de 3 L con el que empieza cada jugador
                    bienvenida_si_es_nuevo(camp, actor)   # V3.9: el bot del chat anuncia a quien llega por primera vez
                    rev = rev_actual(con, camp)
                    try:
                        desde = int(q.get('rev', ['-1'])[0] or -1)
                    except ValueError:
                        desde = -1
                    base = {'ok': True, 'rev': rev, 'usuario': actor, 'presencia': lista_presencia(con, camp),
                            'chat': ultimo_chat(con, camp), 'chatBorrados': borrados_chat(con, camp),
                            'buzon': resumen_buzon(con, actor['clave']),   # avisos personales y privados sin leer
                            'general': ultimo_chat(con, GENERAL), 'generalBorrados': borrados_chat(con, GENERAL)}   # chat general   # V3.9: chat (nuevos / moderados)
                    if es_dm(actor):   # cuentas de Discord esperando aprobación (aviso en «En línea»)
                        base['pendientes'] = con.execute('SELECT COUNT(*) FROM usuarios WHERE pendiente=1 AND baneado=0').fetchone()[0]
                    if actor['rol'] == 'admin':   # solicitudes de campaña esperando (aviso al superusuario)
                        base['solicitudes'] = con.execute("SELECT COUNT(*) FROM solicitudes_campana s JOIN usuarios u ON u.clave=s.usuario "
                                                          "WHERE s.estado='pendiente' AND u.baneado=0").fetchone()[0]
                    if desde == rev:
                        return self.json(200, {**base, 'igual': True})
                    otros = []
                    if desde >= 0:
                        otros = [{'rev': r, 'autor': a, 'resumen': s} for r, a, s in con.execute(
                            'SELECT rev, autor, resumen FROM transacciones WHERE campana=? AND rev>? ORDER BY rev LIMIT 20',
                            (camp, desde))]
                    return self.json(200, {**base, 'datos': estado_completo(con, camp, actor['clave']), 'cambios': otros})
                if ruta == '/api/chat':   # V3.9: ?desde=ID (los nuevos) o ?antes=ID (los anteriores)
                    try:
                        desde = int(q['desde'][0]) if 'desde' in q else None
                        antes = int(q['antes'][0]) if 'antes' in q else None
                    except ValueError:
                        desde = antes = None
                    return self.json(200, {'ok': True, 'mensajes': mensajes_chat(con, camp, desde, antes),
                                           'ultimo': ultimo_chat(con, camp), 'bot': bot_de(con, camp),
                                           'puedeEditarBot': es_dm(actor), 'borrados': borrados_chat(con, camp)})
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
                    return self.json(200, {'ok': True, 'cuentas': lista_cuentas(con, actor, camp), 'pendientes': lista_pendientes(con)})
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
                    '/api/mesa/miembro', '/api/mesa/disciplina', '/api/mesa/personaje', '/api/mesa/clave', '/api/mesa/acceso', '/api/historial/deshacer', '/api/yo/avatar',
                    '/api/discord/empezar', '/api/discord/desvincular', '/api/usuarios/aprobar',
                    '/api/recuperar', '/api/recuperar/nueva', '/api/correo/verificar', '/api/yo/correo', '/api/registro/confirmar',
                    '/api/campanas/solicitar', '/api/campanas/solicitud/cancelar', '/api/campanas/solicitud/resolver',
                    '/api/chat/enviar', '/api/chat/bot', '/api/chat/borrar',
                    '/api/avisos/leidos', '/api/privados/enviar', '/api/privados/leidos', '/api/general/enviar', '/api/general/borrar')
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
            # --- recuperar la contraseña y confirmar el correo: sin sesión (se llega desde el enlace del correo)
            if ruta == '/api/recuperar':
                return self.json(200, pedir_recuperacion(cuerpo, self.origen()))
            if ruta == '/api/recuperar/nueva':
                return self.json(200, recuperar_contrasena(cuerpo))
            if ruta == '/api/correo/verificar':
                return self.json(200, verificar_correo(cuerpo))
            if ruta == '/api/registro/confirmar':
                return self.json(200, confirmar_alta(cuerpo))
            if ruta == '/api/salir':
                if self.token():
                    u = usuario_de_token(self.token())
                    cerrar_sesion(self.token())
                    if u:
                        PRESENCIA.pop(u['clave'], None)
                return self.json(200, {'ok': True})
            if ruta == '/api/discord/empezar':   # crear cuenta (sin sesión) o vincular (con sesión)
                datos, nonce, segura = discord_empezar(self.actor(), cuerpo)
                cuerpo_r = json.dumps(datos, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(cuerpo_r)))
                self.send_header('Set-Cookie', f'{COOKIE_DISCORD}={nonce}; Path=/api/discord; Max-Age=600; HttpOnly; SameSite=Lax'
                                 + ('; Secure' if segura else ''))
                self.end_headers()
                self.wfile.write(cuerpo_r)
                return
            u = self.actor()
            if not u:
                return self.sin_sesion()
            # --- sin campaña
            if ruta == '/api/discord/desvincular':
                return self.json(200, discord_desvincular(u))
            if ruta == '/api/usuarios/destierro':
                return self.json(200, desterrar(u, cuerpo))
            if ruta == '/api/campanas/crear':
                return self.json(200, crear_campana(u, cuerpo))
            if ruta == '/api/registro/desbloquear':
                return self.json(200, desbloquear_registro(u, cuerpo))
            if ruta == '/api/campanas/renombrar':
                return self.json(200, renombrar_campana(u, cuerpo))
            if ruta == '/api/campanas/solicitar':
                return self.json(200, solicitar_campana(u, cuerpo))
            if ruta == '/api/campanas/solicitud/cancelar':
                return self.json(200, cancelar_solicitud(u))
            if ruta == '/api/campanas/solicitud/resolver':
                return self.json(200, resolver_solicitud(u, cuerpo))
            if ruta == '/api/campanas/unirse':
                return self.json(200, unirse(u, cuerpo, self.origen()))
            if ruta == '/api/yo/avatar':   # la foto es de la cuenta, no de una campaña
                return self.json(200, guardar_avatar(u, cuerpo))
            if ruta == '/api/yo/correo':
                return self.json(200, poner_correo(u, cuerpo))
            if ruta == '/api/avisos/leidos':
                return self.json(200, avisos_leidos(u, cuerpo))
            if ruta == '/api/privados/enviar':
                return self.json(200, enviar_privado(u, cuerpo))
            if ruta == '/api/privados/leidos':
                return self.json(200, privados_leidos(u, cuerpo))
            if ruta == '/api/general/enviar':
                return self.json(200, enviar_general(u, cuerpo))
            if ruta == '/api/general/borrar':
                return self.json(200, borrar_general(u, cuerpo))
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
            if ruta == '/api/usuarios/aprobar':
                return self.json(200, aprobar_cuenta(actor, cuerpo))
            if ruta == '/api/mesa/disciplina':
                return self.json(200, cambiar_disciplina(actor, cuerpo))
            if ruta == '/api/mesa/personaje':
                return self.json(200, guardar_personaje(actor, cuerpo))
            if ruta == '/api/mesa/clave':
                return self.json(200, poner_clave_mesa(actor, cuerpo))
            if ruta == '/api/mesa/acceso':
                return self.json(200, poner_acceso_mesa(actor, cuerpo))
            if ruta == '/api/historial/deshacer':
                return self.json(200, deshacer(actor, cuerpo))
            if ruta == '/api/chat/enviar':
                return self.json(200, enviar_chat(actor, cuerpo))
            if ruta == '/api/chat/bot':
                return self.json(200, ajustar_bot(actor, cuerpo))
            if ruta == '/api/chat/borrar':
                return self.json(200, borrar_mensaje(actor, cuerpo))
        except Rechazo as r:
            codigo = {'stock': 409, 'conflicto': 409, 'existe': 409, 'permiso': 403,
                      'credenciales': 401, 'clave': 401, 'espera': 429, 'baneado': 403, 'bloqueado': 429,
                      'pendiente': 403, 'sesion': 401, 'discord': 502, 'enlace': 410}.get(r.motivo, 400)
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
    """python servidor.py restablecer NOMBRE CONTRASEÑA  |  hacer-dm NOMBRE  |  readmitir NOMBRE  |  aprobar NOMBRE  |  desbloquear
                      |  probar-correo DIRECCIÓN  (manda un correo de prueba con la configuración del .env)"""
    if args[0] == 'probar-correo':
        if not CORREO_ACTIVO:
            print('Falta CORREO_USUARIO o CORREO_CLAVE en el archivo .env.')
            return 1
        try:
            para = limpiar_correo(args[1] if len(args) > 1 else CORREO_USUARIO)
            enviar_correo(para, 'La taberna de Jhon: correo de prueba',
                          'Si lees esto, el servidor ya puede mandar los enlaces para cambiar la contraseña.\n')
        except Rechazo as r:
            print(r.mensaje)
            return 1
        except Exception as e:
            print(f'No se pudo mandar: {type(e).__name__}: {e}')
            if isinstance(e, smtplib.SMTPAuthenticationError):
                print('Gmail no acepta la clave. Tiene que ser una «contraseña de aplicación» (16 letras), no tu contraseña normal.')
            return 1
        print(f'Correo de prueba mandado a {para} desde {CORREO_REMITENTE} ({CORREO_SERVIDOR}:{CORREO_PUERTO}).')
        return 0
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
            con.execute('DELETE FROM enlaces_correo WHERE usuario=?', (fila[0],))
            print(f'Contraseña de «{fila[1]}» cambiada.')
            correo = con.execute('SELECT correo FROM usuarios WHERE clave=?', (fila[0],)).fetchone()[0]
            if CORREO_ACTIVO and correo:
                try:
                    enviar_correo(correo, 'La taberna de Jhon: el superusuario te ha puesto una contraseña nueva',
                                  f'Hola, {fila[1]}:\n\nEl superusuario ha puesto una contraseña nueva a tu cuenta y se han cerrado '
                                  'tus sesiones abiertas. Te la tiene que decir él; por seguridad, este correo no la incluye.\n')
                    print(f'Avisado por correo ({ocultar_correo(correo)}).')
                except Exception as e:
                    print(f'No se pudo avisar por correo: {e}')
            return 0
        if orden == 'aprobar':   # aprueba una cuenta de Discord pendiente (sin sentarla en ninguna mesa)
            con.execute('UPDATE usuarios SET pendiente=0 WHERE clave=?', (fila[0],))
            print(f'Cuenta «{fila[1]}» aprobada. Invítala a una mesa desde «En línea».')
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
    anunciar_encendido()   # V3.9: el bot lo dice en el chat de cada mesa
    threading.Thread(target=latidos, daemon=True).start()

    # Docker para el contenedor con SIGTERM (y en Windows, cerrar la ventana manda SIGBREAK):
    # se convierte en un cierre normal para que el bot avise del apagado.
    def parar(*_):
        raise KeyboardInterrupt
    for nombre_senal in ('SIGTERM', 'SIGBREAK'):
        if hasattr(signal, nombre_senal):
            signal.signal(getattr(signal, nombre_senal), parar)
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer.daemon_threads = True
    with http.server.ThreadingHTTPServer((HOST, PUERTO), Manejador) as srv:
        print(f'Alquimia en http://localhost:{PUERTO}  (Ctrl+C para cerrar)')
        print(f'Base de datos: {DB_PATH}')
        print('Crear cuentas: ' + ('pide la palabra de paso de la mesa (ALQUIMIA_CLAVE)' if CLAVE
              else 'libre (pon ALQUIMIA_CLAVE si lo abres a internet)'))
        print('Superusuario «DM»: ' + ('activo (contraseña de ALQUIMIA_ADMIN)' if len(ADMIN_CLAVE) >= 6
              else 'desactivado (pon ALQUIMIA_ADMIN en el archivo .env)'))
        print('Discord: ' + (f'activo (vuelve a {URL_PUBLICA or "la dirección del navegador"}/api/discord/vuelta)'
              if DISCORD_ACTIVO else 'desactivado (pon DISCORD_CLIENT_ID y DISCORD_CLIENT_SECRET en el archivo .env)'))
        print('Correo para recuperar contraseñas: ' + (f'activo (desde {CORREO_REMITENTE}; enlaces a {url_enlaces()})'
              if CORREO_ACTIVO else 'desactivado (pon CORREO_USUARIO y CORREO_CLAVE en el archivo .env)'))
        if CORREO_ACTIVO and not URL_PUBLICA:
            print('  Ojo: sin ALQUIMIA_URL los enlaces de los correos apuntan a localhost y solo funcionan en este PC.')
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass
    try:
        anunciar_apagado()
        print('Servidor apagado (avisado en el chat de las mesas).')
    except Exception as e:
        print('No se pudo avisar del apagado:', e, file=sys.stderr)


if __name__ == '__main__':
    main()
