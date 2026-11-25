# servidor.py — servidor de la app de alquimia (web + base de datos compartida).
#
# Sirve la app (index.html, js/, style.css) y una API bajo /api/ que guarda los
# datos en SQLite. Varias personas pueden usar la app a la vez: cada cambio es
# una TRANSACCIÓN, como en un banco. O se aplica entera o no se aplica nada.
#
# Cada persona entra con su cuenta (usuario + contraseña). Cada jugador tiene su
# propio inventario (materiales, pociones y botín). El catálogo de materiales,
# las pociones descubiertas y los parámetros son comunes a la mesa.
# El DM (Dungeon Master) puede ver y cambiar el inventario de cualquier jugador.
# La primera cuenta que se crea es la del DM.
#
# Además existe un SUPERUSUARIO llamado «DM» (el administrador). Su contraseña es
# fija: la que ponga ALQUIMIA_ADMIN en el archivo .env (se vuelve a fijar cada vez
# que arranca el servidor). Puede todo lo que puede un DM y además desterrar
# (banear) cuentas, readmitirlas y dar o quitar poderes de DM.
#
#   python servidor.py            -> http://localhost:8080
#   python servidor.py 9000       -> otro puerto
#   python servidor.py restablecer NOMBRE NUEVA_CONTRASEÑA
#                                 -> cambia la contraseña de una cuenta (si se olvida)
#   python servidor.py hacer-dm NOMBRE
#                                 -> convierte una cuenta en DM
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

import http.server, json, os, sqlite3, sys, threading, time, hmac, hashlib, secrets, re, unicodedata
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
}
# Estas son de cada jugador; las demás, de toda la mesa.
# Un módulo nuevo (cocina, ficha...) que guarde cosas de cada jugador se añade aquí.
POR_JUGADOR = ('inventory', 'potions', 'lootPotions', 'libros', 'perfil')
COMUN = ''   # "dueño" de lo que es de toda la mesa

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
        con.executescript('''
            CREATE TABLE IF NOT EXISTS entradas (
                col TEXT NOT NULL, dueno TEXT NOT NULL DEFAULT '', id TEXT NOT NULL, valor TEXT NOT NULL,
                autor TEXT, cambiado TEXT, rev INTEGER,
                PRIMARY KEY (col, dueno, id));
            CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT);
            -- El "libro de cuentas": cada transacción confirmada queda apuntada aquí.
            -- También evita aplicar dos veces la misma si el navegador reintenta.
            CREATE TABLE IF NOT EXISTS transacciones (
                id TEXT PRIMARY KEY, rev INTEGER NOT NULL, autor TEXT, fecha TEXT,
                resumen TEXT, ops TEXT);
            -- Cuentas. "clave" es el nombre en minúsculas y sin espacios de sobra.
            CREATE TABLE IF NOT EXISTS usuarios (
                clave TEXT PRIMARY KEY, nombre TEXT NOT NULL, hash TEXT NOT NULL,
                rol TEXT NOT NULL DEFAULT 'jugador', creado TEXT);
            -- Sesiones abiertas. Se guarda el hash del token, nunca el token.
            CREATE TABLE IF NOT EXISTS sesiones (
                token TEXT PRIMARY KEY, usuario TEXT NOT NULL, creada TEXT, vista REAL);
            INSERT OR IGNORE INTO ajustes VALUES ('rev', '0');
        ''')
        if 'baneado' not in [f[1] for f in con.execute('PRAGMA table_info(usuarios)')]:
            con.execute('ALTER TABLE usuarios ADD COLUMN baneado INTEGER NOT NULL DEFAULT 0')
        asegurar_admin(con)
        # Si ya hay DM pero quedan inventarios sin dueño (base vieja), son suyos.
        dm = con.execute("SELECT clave FROM usuarios WHERE rol='dm' ORDER BY creado LIMIT 1").fetchone()
        if dm:
            con.execute('BEGIN IMMEDIATE')
            adoptar_huerfanos(con, dm[0])
            con.execute('COMMIT')
        con.execute('DELETE FROM sesiones WHERE vista < ?', (time.time() - DIAS_SESION * 86400,))
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
    """DM de la mesa o superusuario."""
    return bool(actor) and actor.get('rol') in ('dm', 'admin')


def adoptar_huerfanos(con, clave):
    """El inventario de antes de las cuentas (sin dueño) pasa a ser de esta cuenta."""
    marcas = ','.join('?' * len(POR_JUGADOR))
    n = con.execute(f"SELECT COUNT(*) FROM entradas WHERE dueno='' AND col IN ({marcas})", POR_JUGADOR).fetchone()[0]
    if n:
        con.execute(f"UPDATE entradas SET dueno=? WHERE dueno='' AND col IN ({marcas})", (clave, *POR_JUGADOR))
        con.execute("UPDATE ajustes SET valor=CAST(valor AS INTEGER)+1 WHERE clave='rev'")
        print(f'{n} entradas de inventario de antes de las cuentas pasan a «{clave}».')


def rev_actual(con):
    return int(con.execute("SELECT valor FROM ajustes WHERE clave='rev'").fetchone()[0])


def leer(con, col, dueno, id_):
    fila = con.execute('SELECT valor, autor FROM entradas WHERE col=? AND dueno=? AND id=?', (col, dueno, id_)).fetchone()
    return (json.loads(fila[0]), fila[1]) if fila else (None, None)


def escribir(con, col, dueno, id_, valor, autor, rev):
    if valor is None:
        con.execute('DELETE FROM entradas WHERE col=? AND dueno=? AND id=?', (col, dueno, id_))
    else:
        con.execute('INSERT OR REPLACE INTO entradas VALUES (?,?,?,?,?,?,?)',
                    (col, dueno, id_, json.dumps(valor, ensure_ascii=False), autor, ahora(), rev))


def estado_completo(con, clave):
    """Lo común de la mesa + el inventario de esta persona, con la forma de siempre."""
    datos = {c: {} for c in COLECCIONES}
    for col, id_, valor in con.execute('SELECT col, id, valor FROM entradas WHERE dueno=? OR dueno=?', (COMUN, clave)):
        if col in datos:
            datos[col][id_] = json.loads(valor)
    return datos


def inventario_de(con, clave):
    datos = {c: {} for c in POR_JUGADOR}
    for col, id_, valor in con.execute('SELECT col, id, valor FROM entradas WHERE dueno=?', (clave,)):
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
    return {'clave': fila[0], 'nombre': fila[1], 'rol': fila[2]}


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


def registrar(cuerpo):
    nombre = re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(cuerpo.get('nombre') or '')).strip())
    contrasena = cuerpo.get('contrasena')
    if not NOMBRE_OK.match(nombre):
        raise Rechazo('invalida', 'El nombre debe tener de 2 a 24 letras o números (también valen espacios, guiones y puntos).')
    validar_contrasena(contrasena)
    with CERROJO:
        con = conectar()
        try:
            con.execute('BEGIN IMMEDIATE')
            primera = not con.execute("SELECT 1 FROM usuarios WHERE rol!='admin' LIMIT 1").fetchone()
            # La palabra de paso de la mesa (ALQUIMIA_CLAVE) protege la creación de cuentas.
            if CLAVE and not hmac.compare_digest(str(cuerpo.get('clave') or ''), CLAVE):
                raise Rechazo('clave', 'La palabra de paso de la mesa no es correcta. Pídesela al DM.')
            clave = clave_de(nombre)
            if buscar_usuario(con, clave):
                raise Rechazo('existe', f'Ya existe una cuenta llamada «{nombre}». Elige otro nombre o entra con ella.')
            rol = 'dm' if primera else 'jugador'
            con.execute('INSERT INTO usuarios (clave, nombre, hash, rol, creado, baneado) VALUES (?,?,?,?,?,0)',
                        (clave, nombre, hash_contrasena(contrasena), rol, ahora()))
            if primera:
                adoptar_huerfanos(con, clave)
            token = abrir_sesion(con, clave)
            con.execute('COMMIT')
            return {'ok': True, 'token': token, 'usuario': {'clave': clave, 'nombre': nombre, 'rol': rol}, 'primera': primera}
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
        return {'ok': True, 'token': token, 'usuario': usuario_publico(fila)}
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
        return {'clave': fila[0], 'nombre': fila[2], 'rol': fila[3]}
    finally:
        con.close()


def cerrar_sesion(token):
    con = conectar()
    try:
        con.execute('DELETE FROM sesiones WHERE token=?', (hash_token(token),))
    finally:
        con.close()


# ------------------------------------------------------------------ presencia
PRESENCIA = {}          # clave -> {'t': última petición, 'lugar': ..., 'visible': bool}
LUGAR_OK = re.compile(r'^[a-z]{1,20}$')   # cada módulo de la app dice su "lugar" (alquimia, lectura...)


def apuntar_presencia(clave, lugar, visible):
    PRESENCIA[clave] = {'t': time.time(), 'lugar': lugar if LUGAR_OK.match(lugar or '') else 'panel', 'visible': visible}


def lista_presencia(con):
    ahora_s = time.time()
    lista = []
    for clave, nombre, rol, baneado in con.execute('SELECT clave, nombre, rol, baneado FROM usuarios ORDER BY nombre COLLATE NOCASE'):
        if rol == 'admin' and not ADMIN_CLAVE:
            continue
        p = PRESENCIA.get(clave)
        hace = ahora_s - p['t'] if p else None
        if hace is not None and hace < EN_LINEA_S and p['visible']:
            estado = 'en-linea'
        elif hace is not None and hace < AUSENTE_S:
            estado = 'ausente'
        else:
            estado = 'desconectado'
        lista.append({'clave': clave, 'nombre': nombre, 'rol': rol, 'estado': estado, 'baneado': bool(baneado),
                      'lugar': p['lugar'] if p and estado != 'desconectado' else None,
                      'hace': round(hace) if hace is not None else None})
    return lista


# ----------------------------------------------------- nombres para los mensajes
def nombre_material(con, id_):
    m, _ = leer(con, 'catalog', COMUN, id_)
    if not m:
        return 'un material'
    return '???' if m.get('unknown') else (m.get('name') or 'un material')


def nombre_entrada(con, col, id_, valor):
    if col == 'inventory':
        return '«' + nombre_material(con, id_) + '»'
    if isinstance(valor, dict) and valor.get('name'):
        return '«' + str(valor['name']) + '»'
    return {'potions': 'esa poción', 'lootPotions': 'esa poción de botín', 'catalog': 'ese material',
            'potionCatalog': 'esa ficha de poción', 'meta': 'los ajustes', 'libros': 'ese libro',
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
        if not buscar_usuario(con, objetivo):
            raise Rechazo('invalida', 'Ese jugador no existe.')
    return objetivo


def aplicar_op(con, op, actor, rev):
    if not isinstance(op, dict):
        raise Rechazo('invalida', 'Operación mal formada.')
    autor = actor['nombre']
    col, id_, t = op.get('c'), op.get('id'), op.get('t')
    if t == 'vacio':
        # Solo para la primera subida de datos: exige que el servidor esté vacío.
        if con.execute("SELECT 1 FROM entradas WHERE col != 'meta' LIMIT 1").fetchone():
            raise Rechazo('conflicto', 'El servidor ya tiene datos: no se han subido los de este navegador.')
        return
    if col not in COLECCIONES or not isinstance(id_, str) or not id_ or len(id_) > 200:
        raise Rechazo('invalida', 'Operación mal formada (colección o id).')
    tipo = COLECCIONES[col]
    dueno = dueno_de(con, op, col, actor)
    actual, autor_prev = leer(con, col, dueno, id_)

    if t == 'num' and tipo == 'num':
        # Sumar o restar stock. Nunca puede quedar por debajo de 0.
        if op.get('borrar'):     # el material se ha borrado del catálogo: fuera su stock
            escribir(con, col, dueno, id_, None, autor, rev)
            return
        n = entero(op.get('n', 0), 'n')
        tenia = actual if isinstance(actual, int) else 0
        if 'e' in op and tenia != op['e']:   # "pon exactamente X" del DM: solo si nadie lo cambió
            raise Rechazo('conflicto',
                f'{mayus(nombre_entrada(con, col, id_, actual))} ha cambiado mientras tanto (ahora hay {tenia}){quien(autor_prev, autor)}.',
                {'col': col, 'id': id_, 'hay': tenia})
        queda = tenia + n
        if queda < 0:
            raise Rechazo('stock',
                f'No queda suficiente {nombre_entrada(con, col, id_, actual)}: hay {tenia} y hacían falta {-n}{quien(autor_prev, autor)}.',
                {'col': col, 'id': id_, 'hay': tenia, 'falta': -n})
        escribir(con, col, dueno, id_, queda, autor, rev)

    elif t == 'qty' and tipo == 'qty':
        n = entero(op.get('n', 0), 'n')
        if actual is None:
            if n > 0 and isinstance(op.get('tpl'), dict):
                escribir(con, col, dueno, id_, {**op['tpl'], 'qty': n}, autor, rev)
                return
            if n == 0 and op.get('v') is None:
                return
            raise Rechazo('stock',
                f'{mayus(nombre_entrada(con, col, id_, op.get("tpl") or op.get("e")))} ya no existe: alguien la ha usado o borrado.',
                {'col': col, 'id': id_, 'hay': 0, 'falta': -n})
        nuevo = dict(actual)
        if 'v' in op:   # también cambian otros campos (nombre, descripción...)
            if resto(actual) != op.get('e'):
                raise Rechazo('conflicto',
                    f'Otra persona ha modificado {nombre_entrada(con, col, id_, actual)} mientras tanto{quien(autor_prev, autor)}.',
                    {'col': col, 'id': id_})
            nuevo = {**(op['v'] or {}), 'qty': actual.get('qty', 0)}
        tenia = entero(actual.get('qty', 0), 'qty')
        queda = tenia + n
        if queda < 0:
            raise Rechazo('stock',
                f'No queda suficiente {nombre_entrada(con, col, id_, actual)}: hay {tenia} y hacían falta {-n}{quien(autor_prev, autor)}.',
                {'col': col, 'id': id_, 'hay': tenia, 'falta': -n})
        nuevo['qty'] = queda
        escribir(con, col, dueno, id_, nuevo if queda > 0 else None, autor, rev)

    elif t == 'obj' and tipo == 'obj':
        # Reemplazar entero, solo si sigue como lo vio quien hace el cambio
        # (control de concurrencia optimista: "compara y cambia").
        esperado, nuevo = op.get('e'), op.get('v')
        if not es_dm(actor):
            permiso_jugador(col, actual, nuevo)
        if actual != esperado and actual != nuevo:
            raise Rechazo('conflicto',
                f'Otra persona ha modificado {nombre_entrada(con, col, id_, actual or esperado or nuevo)} mientras tanto{quien(autor_prev, autor)}.',
                {'col': col, 'id': id_})
        escribir(con, col, dueno, id_, nuevo, autor, rev)
        if col == 'catalog' and nuevo is None:
            # Material borrado del catálogo: desaparece de los inventarios de todos
            con.execute("DELETE FROM entradas WHERE col='inventory' AND id=?", (id_,))
    else:
        raise Rechazo('invalida', 'Operación desconocida.')


def permiso_jugador(col, actual, nuevo):
    """Lo que un jugador NO puede cambiar por su cuenta (solo el DM)."""
    if col == 'perfil':
        raise Rechazo('permiso', 'Solo el DM puede cambiar tu nivel de alquimia.')
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
            hecha = con.execute('SELECT rev FROM transacciones WHERE id=?', (tx_id,)).fetchone()
            if hecha:   # reintento de algo ya confirmado: no se aplica otra vez
                con.execute('ROLLBACK')
                return {'ok': True, 'rev': rev_actual(con), 'repetida': True}
            rev = rev_actual(con) + 1
            for op in ops:
                aplicar_op(con, op, actor, rev)
            con.execute("UPDATE ajustes SET valor=? WHERE clave='rev'", (str(rev),))
            con.execute('INSERT INTO transacciones VALUES (?,?,?,?,?,?)',
                        (tx_id, rev, actor['nombre'], ahora(), resumen, json.dumps(ops, ensure_ascii=False)))
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
    # Con superusuario, solo él reparte los poderes de DM. Sin él (no hay ALQUIMIA_ADMIN), los DM.
    if actor['rol'] != 'admin' and (ADMIN_CLAVE or actor['rol'] != 'dm'):
        raise Rechazo('permiso', 'Solo el superusuario «DM» puede dar o quitar poderes de DM.')
    objetivo, rol = clave_de(cuerpo.get('usuario')), cuerpo.get('rol')
    if rol not in ('dm', 'jugador'):
        raise Rechazo('invalida', 'Rol desconocido.')
    with CERROJO:
        con = conectar()
        try:
            con.execute('BEGIN IMMEDIATE')
            fila = buscar_usuario(con, objetivo)
            if not fila:
                raise Rechazo('invalida', 'Esa cuenta no existe.')
            if fila[2] == 'admin':
                raise Rechazo('permiso', 'El superusuario «DM» no se puede cambiar.')
            if not ADMIN_CLAVE and rol == 'jugador' and con.execute(
                    "SELECT COUNT(*) FROM usuarios WHERE rol='dm' AND clave!=?", (objetivo,)).fetchone()[0] == 0:
                raise Rechazo('invalida', 'Tiene que quedar al menos un DM en la mesa.')
            con.execute('UPDATE usuarios SET rol=? WHERE clave=?', (rol, objetivo))
            con.execute("UPDATE ajustes SET valor=CAST(valor AS INTEGER)+1 WHERE clave='rev'")
            con.execute('COMMIT')
            return {'ok': True}
        except BaseException:
            if con.in_transaction:
                con.execute('ROLLBACK')
            raise
        finally:
            con.close()


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
            con.execute("UPDATE ajustes SET valor=CAST(valor AS INTEGER)+1 WHERE clave='rev'")
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

    def token(self):
        a = self.headers.get('Authorization', '')
        return a[7:].strip() if a.startswith('Bearer ') else ''

    def actor(self):
        """La persona que hace la petición (o None si no ha entrado). Apunta su presencia."""
        u = usuario_de_token(self.token())
        if u:
            apuntar_presencia(u['clave'], unquote(self.headers.get('X-Lugar', '')), self.headers.get('X-Visible', '1') != '0')
        return u

    def sin_sesion(self):
        return self.json(401, {'ok': False, 'motivo': 'sesion', 'mensaje': 'Tienes que entrar con tu cuenta.'})

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
            actor = self.actor()
            if not actor:
                return self.sin_sesion()
            q = parse_qs(url.query)
            con = conectar()
            try:
                if ruta == '/api/yo':
                    return self.json(200, {'ok': True, 'usuario': actor})
                if ruta == '/api/estado':
                    rev = rev_actual(con)
                    try:
                        desde = int(q.get('rev', ['-1'])[0] or -1)
                    except ValueError:
                        desde = -1
                    base = {'ok': True, 'rev': rev, 'usuario': actor, 'presencia': lista_presencia(con)}
                    if desde == rev:
                        return self.json(200, {**base, 'igual': True})
                    otros = []
                    if desde >= 0:
                        otros = [{'rev': r, 'autor': a, 'resumen': s} for r, a, s in con.execute(
                            'SELECT rev, autor, resumen FROM transacciones WHERE rev>? ORDER BY rev LIMIT 20', (desde,))]
                    return self.json(200, {**base, 'datos': estado_completo(con, actor['clave']), 'cambios': otros})
                if ruta == '/api/presencia':
                    return self.json(200, {'ok': True, 'presencia': lista_presencia(con)})
                if ruta == '/api/jugadores':
                    if not es_dm(actor):
                        return self.json(403, {'ok': False, 'motivo': 'permiso', 'mensaje': 'Solo para el DM.'})
                    # El superusuario no es un personaje: no sale en la lista de inventarios
                    jugadores = [{'clave': c, 'nombre': n, 'rol': r, 'baneado': bool(b), **inventario_de(con, c)} for c, n, r, b in
                                 con.execute("SELECT clave, nombre, rol, baneado FROM usuarios WHERE rol!='admin' "
                                             'ORDER BY nombre COLLATE NOCASE').fetchall()]
                    return self.json(200, {'ok': True, 'rev': rev_actual(con), 'jugadores': jugadores})
                if ruta == '/api/diario':
                    try:
                        n = min(int(q.get('n', ['50'])[0]), 500)
                    except ValueError:
                        n = 50
                    filas = con.execute('SELECT rev, autor, fecha, resumen FROM transacciones ORDER BY rev DESC LIMIT ?', (n,))
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
                    '/api/usuarios/rol', '/api/usuarios/contrasena', '/api/usuarios/destierro')
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
                return self.json(200, registrar(cuerpo))
            if ruta == '/api/entrar':
                return self.json(200, entrar(cuerpo, self.client_address[0]))
            if ruta == '/api/salir':
                if self.token():
                    u = usuario_de_token(self.token())
                    cerrar_sesion(self.token())
                    if u:
                        PRESENCIA.pop(u['clave'], None)
                return self.json(200, {'ok': True})
            actor = self.actor()
            if not actor:
                return self.sin_sesion()
            if ruta == '/api/transaccion':
                if largo <= 0:
                    return self.json(400, {'ok': False, 'motivo': 'invalida', 'mensaje': 'Petición vacía.'})
                return self.json(200, transaccion(cuerpo, actor))
            if ruta == '/api/usuarios/rol':
                return self.json(200, cambiar_rol(actor, cuerpo))
            if ruta == '/api/usuarios/contrasena':
                return self.json(200, cambiar_contrasena(actor, cuerpo))
            if ruta == '/api/usuarios/destierro':
                return self.json(200, desterrar(actor, cuerpo))
        except Rechazo as r:
            codigo = {'stock': 409, 'conflicto': 409, 'existe': 409, 'permiso': 403,
                      'credenciales': 401, 'clave': 401, 'espera': 429, 'baneado': 403}.get(r.motivo, 400)
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
    """python servidor.py restablecer NOMBRE CONTRASEÑA  |  hacer-dm NOMBRE  |  readmitir NOMBRE"""
    preparar_bd()
    con = conectar()
    try:
        orden, nombre = args[0], args[1] if len(args) > 1 else ''
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
            con.execute("UPDATE usuarios SET rol='dm' WHERE clave=?", (fila[0],))
            print(f'«{fila[1]}» ahora es DM.')
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
