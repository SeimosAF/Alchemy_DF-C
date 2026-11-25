# De la V2.2 a la V3

Resumen de todo lo que cambia respecto al commit «AlchemyV2.2» (23-11-2026).
Son unas 2.900 líneas añadidas y 500 cambiadas en 11 archivos, más 20 archivos nuevos.

## 1. Servidor multiusuario (nuevo)
- `servidor.py` pasa de servir la web a ser una API con base de datos SQLite (`datos/alquimia.db`).
- Cada cambio es una transacción todo-o-nada: el stock nunca baja de 0, no hay duplicados si se corta la conexión y queda apuntado quién hizo qué.
- Copias de seguridad automáticas cada 24 h (las 7 últimas) en `datos/copias/`.
- `js/sync.js`: sincroniza con el servidor; sin servidor la app sigue funcionando solo en el navegador, como en la V2.2.
- Docker: `Dockerfile`, `docker-compose.yml`, `docker-iniciar.bat`, `docker-parar.bat`, `.dockerignore`. Publicado con Tailscale.

## 2. Cuentas, roles y la mesa (nuevo)
- Pantalla de entrada en pergamino (`js/auth.js`): crear cuenta y entrar con contraseña (cifrada).
- La mesa (`js/panel.js`): tarjetas de Inventario, Alquimia, Lectura y Usuarios en línea, con quién está conectado y dónde.
- Inventario propio de cada jugador; catálogo, pociones descubiertas y parámetros comunes a la mesa.
- DM: cambia inventarios, libros y nivel de alquimia de cualquiera (`js/dm.js`).
- Superusuario «DM» con contraseña fija (`ALQUIMIA_ADMIN` en `.env`): da y quita DM, destierra y readmite cuentas.

## 3. Caldero visual (rehecho)
- `js/cauldron.js` casi entero nuevo: hoguera, líquido que cambia de color, ingredientes que vuelan al caldero, remover al elaborar, frasco al acertar, humo negro y calaveras al fallar, sonidos.
- El disolvente de Alma se llama «Polvo etéreo» (antes «Polvo mágico»).

## 4. Lectura (nuevo, `js/lectura.js`)
- Libros en el inventario con bono, número de lecturas y recuento.
- Una lectura por descanso; las casillas marcadas piden descanso largo y tirada de comprensión (d20 + INT contra la CD del DM).

## 5. Alquimia por niveles (nuevo, `js/niveles.js`, `js/diario.js`)
- Niveles 1 a 5 que sube el DM; bloquean disolventes, reactivos, modificadores, modos y aplicaciones.
- Diario de Jhon Arbaquel: una página por nivel que explica lo desbloqueado.
- Con servidor, todos empiezan en el nivel 1. Sin servidor, en el 5.

## 6. Organización por módulos (nuevo, `js/modulos.js`)
- Pestañas y tarjetas se generan desde un registro de módulos. Receta para añadir cocina, ficha, armas... en `docs/ARQUITECTURA.md`.
- El catálogo (antes pestaña «Lectura») pasa a la pestaña «Compendio».

## 7. Seguridad del repositorio
- `.gitignore`: fuera `.env`, la base de datos y sus copias, exportaciones, `__pycache__`.
- `.env.example`: plantilla sin contraseñas.

## Datos existentes
- Al arrancar por primera vez se copia la base (`datos/copias/antes-de-cuentas-*.db`) y el inventario que había pasa a la primera cuenta creada (el DM).
- Los datos del navegador de la V2.2 se pueden subir al servidor la primera vez, o con Exportar/Importar.

## Documentación
- `docs/MULTIUSUARIO.md`, `docs/DOCKER.md`, `docs/ARQUITECTURA.md`.
