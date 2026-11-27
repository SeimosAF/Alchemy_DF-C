# Recuperar la contraseña por correo (V3.8)

Quien olvide su contraseña pulsa **«¿Olvidaste la contraseña?»** en la pantalla de entrada, escribe su
nombre o su correo y le llega un enlace para elegir una nueva. Solo funciona con un correo **confirmado**:
cada jugador lo pone en **Perfil → 📧 Poner correo** (o al crear la cuenta) y abre el enlace que le llega.

Si alguien no tiene correo, **solo el superusuario** (no el DM) le pone una contraseña nueva en
**Usuarios en línea → 🔑 Nueva contraseña**, o desde la consola: `python servidor.py restablecer NOMBRE CONTRASEÑA`.

## Avisos por correo

Si la cuenta tiene correo confirmado, se le avisa cuando:

- el superusuario le pone una contraseña nueva (el correo **no** incluye la contraseña);
- cambia su contraseña con el enlace de recuperación;
- el superusuario suspende (destierra) su cuenta, o la vuelve a activar;
- el DM o el superusuario la sacan de una mesa.

Sin correo confirmado no se puede avisar: por eso conviene que todos lo pongan en su Perfil.

## Configurarlo con Gmail (gratis, unos 5 minutos)

1. Usa una cuenta de Gmail para la taberna (mejor una nueva solo para esto que la tuya personal).
2. Activa la **verificación en dos pasos** de esa cuenta: <https://myaccount.google.com/signinoptions/twosv>.
   Google no deja crear contraseñas de aplicación sin ella.
3. Crea una **contraseña de aplicación**: <https://myaccount.google.com/apppasswords>. Ponle de nombre
   «La taberna» y copia las 16 letras que salen. Es **solo para esta app**: no es tu contraseña de Gmail
   y la puedes borrar ahí mismo cuando quieras (eso corta el envío al momento).
4. Añade al archivo `.env` (el que no se sube a GitHub):

   ```
   CORREO_USUARIO=tu-taberna@gmail.com
   CORREO_CLAVE=abcd efgh ijkl mnop
   ALQUIMIA_URL=https://la-taberna-de-jhon.euplectes-yo.ts.net
   ```

   `ALQUIMIA_URL` hace falta para que los enlaces de los correos apunten a la dirección pública.
   Sin ella apuntan a `http://localhost:8080` y solo sirven en tu PC.
5. Ejecuta `docker-iniciar.bat` (hay que reconstruir: `docker-compose.yml` pasa las variables nuevas).
6. Prueba el envío: `docker compose exec app python servidor.py probar-correo tu-correo@loquesea.com`.
   Si dice que Gmail no acepta la clave, revisa que sea la contraseña de aplicación y no la normal.

Al arrancar, el registro del servidor dice `Correo para recuperar contraseñas: activo (...)`.

Otro proveedor: pon también `CORREO_SERVIDOR` y `CORREO_PUERTO` (587 con STARTTLS o 465 con SSL) y,
si el remitente no es el mismo usuario, `CORREO_REMITENTE`.

## Seguridad

- **Contraseñas**: nunca se guardan. Se guarda una huella PBKDF2-SHA256 con sal propia por cuenta y
  **600.000 vueltas** (lo que recomienda OWASP). Las huellas antiguas (200.000) se rehacen solas la
  próxima vez que cada persona entra.
- **Enlaces**: token aleatorio de 256 bits; en la base solo se guarda su huella (SHA-256), así que una copia
  de la base no sirve para usarlos. Un solo uso, caducan a los 30 minutos (los de confirmar el correo a
  las 24 horas) y pedir otro anula el anterior. El token va detrás de `#`: el navegador no lo manda al
  servidor en las peticiones normales ni a otras webs, y la app lo borra de la barra de direcciones nada más leerlo.
- **Al cambiar la contraseña** con el enlace se cierran todas las sesiones abiertas de la cuenta y se le
  manda un aviso al correo («si no has sido tú, avisa al DM»).
- **Nadie puede averiguar quién tiene cuenta**: al pedir el enlace la respuesta es siempre la misma, exista
  la cuenta o no, y el correo se manda en segundo plano (tarda lo mismo).
- **Nadie puede llenarle el buzón a otro**: como mucho 5 peticiones cada 15 minutos por conexión y 3 correos
  por hora para la misma cuenta.
- **Solo correos confirmados**: si no, alguien podría poner un correo suyo en la cuenta de otro. Para poner o
  cambiar el correo se pide la contraseña actual, y cada correo solo puede estar en una cuenta.
- **El correo solo lo ve su dueño**: no sale en las listas de la mesa ni lo ve el DM.
- **La dirección de los enlaces** sale solo de `ALQUIMIA_URL` (o localhost), nunca de cabeceras que pueda
  inventarse quien hace la petición.
- **El envío va cifrado** (STARTTLS o SSL) y comprobando el certificado del servidor de correo; si no se
  puede cifrar, no se manda. La clave de Gmail solo está en `.env`.
- El superusuario «DM» no usa correo: su contraseña sigue siendo la de `ALQUIMIA_ADMIN`.
