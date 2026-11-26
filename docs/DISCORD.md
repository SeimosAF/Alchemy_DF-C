# Discord en la taberna: cómo configurarlo

Se entra siempre con **nombre y contraseña**. Discord sirve para dos cosas:

- **Crear cuenta sin la palabra de paso.** En «Crear cuenta» aparece el botón azul **Crear con Discord**.
  La persona escribe su nombre y su contraseña (dos veces) y, en lugar de la palabra de paso, demuestra
  con Discord quién es. Cada cuenta de Discord solo puede crear **una** cuenta, así nadie fabrica cuentas
  en masa. Además la cuenta queda **pendiente** hasta que tú (o un DM) la apruebes en «Quién está en línea».
- **Vincular Discord** a una cuenta que ya existe, desde el **Perfil**.

Quien tiene la palabra de paso crea su cuenta como siempre, al momento. El superusuario «DM» no cambia.
La app solo pide a Discord el permiso **identify** (su id y su nombre). No lee mensajes, servidores
ni el correo. Se hace una sola vez y tarda unos 10 minutos. Sin configurarlo, todo sigue igual.

## 1. Crear la aplicación en Discord

1. Entra en <https://discord.com/developers/applications> con tu cuenta de Discord.
2. Pulsa **New Application** (arriba a la derecha).
3. Ponle de nombre **La taberna de Jhon**, marca la casilla de los términos y pulsa **Create**.
4. (Opcional) En **General Information** puedes subir un icono y una descripción. Es lo que verán
   tus jugadores cuando Discord les pregunte si dejan entrar a la app.

## 2. Copiar el Client ID y el Client Secret

1. En el menú de la izquierda, entra en **OAuth2**.
2. En **Client information**, copia el **Client ID** (un número largo).
3. Debajo, en **Client Secret**, pulsa **Reset Secret**, confirma y copia el texto que aparece.
   Solo se enseña una vez; si lo pierdes, vuelve a pulsar **Reset Secret** y cambia el `.env`.
4. **El Client Secret es una contraseña.** No lo pegues en Discord, ni en GitHub, ni en un chat.
   Solo va en el archivo `.env` (que no se sube a GitHub).

## 3. Apuntar las direcciones de vuelta (Redirects)

En la misma página **OAuth2**, en **Redirects**, pulsa **Add Redirect** y añade estas dos,
**exactamente así** (sin barra al final):

```
https://TU-MAQUINA.TU-RED.ts.net/api/discord/vuelta
http://localhost:8080/api/discord/vuelta
```

La primera es la de internet (Tailscale Funnel): cambia `TU-MAQUINA.TU-RED.ts.net` por tu dirección de Funnel, la misma que pones en `ALQUIMIA_URL`. La segunda sirve para entrar desde tu PC con
`http://localhost:8080`. Pulsa **Save Changes** abajo.

No hace falta tocar **OAuth2 URL Generator**, ni la pestaña **Bot**: la app no usa bot.

## 4. Ponerlo en el archivo `.env`

Abre el archivo `.env` de la carpeta de la app (el mismo donde está `ALQUIMIA_ADMIN`) y añade:

```
DISCORD_CLIENT_ID=el número que copiaste
DISCORD_CLIENT_SECRET=el secreto que copiaste
ALQUIMIA_URL=https://TU-MAQUINA.TU-RED.ts.net
```

Sin comillas y sin espacios alrededor del `=`.

## 5. Reiniciar la app

- **Con Docker:** doble clic en `docker-iniciar.bat` (lo reconstruye y lee el `.env` nuevo).
- **Sin Docker:** cierra la ventana de `iniciar.bat` y vuelve a abrirlo.

En la consola debe salir:

```
Discord: activo (vuelve a https://TU-MAQUINA.TU-RED.ts.net/api/discord/vuelta)
```

## 6. Probarlo

1. Entra con tu cuenta (nombre y contraseña). Abre tu **Perfil** (menú de la cuenta, arriba a la
   derecha) y pulsa **Vincular con Discord**. Discord te pregunta, aceptas y vuelves con el aviso
   «Discord vinculado a tu cuenta».
2. Para un jugador nuevo sin palabra de paso: en **Crear cuenta** escribe nombre y contraseña (dos veces)
   y pulsa **Crear con Discord**. Le saldrá que su cuenta espera aprobación.
3. A ti te sale un aviso. Ve a **Quién está en línea**: arriba verás «Cuentas de Discord esperando
   aprobación». Pulsa **Aprobar y sentar en esta mesa** (entra como jugador alquimista en la mesa en
   la que estás) o **Rechazar**.
4. El jugador entra con su nombre y su contraseña.

El botón **Crear con Discord** solo sale si hay palabra de paso (`ALQUIMIA_CLAVE`). Sin ella cualquiera
puede crear cuenta, así que Discord no haría falta.

## Si algo falla

| Lo que ves | Qué hacer |
|---|---|
| No sale el botón | Sale solo en «Crear cuenta». Falta `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` o `ALQUIMIA_CLAVE` en `.env`, o no reiniciaste la app. |
| Discord dice «Invalid OAuth2 redirect_uri» | La dirección de vuelta no está en **Redirects** tal cual (revisa https/http, el puerto y que no sobre una barra). |
| «Discord no aceptó la petición» | El Client Secret no es el bueno. Haz **Reset Secret**, cópialo otra vez al `.env` y reinicia. |
| «No se pudo hablar con Discord» | El PC (o el contenedor de Docker) no tiene internet. |
| «Empieza y termina con Discord en el mismo navegador» | Se abrió el enlace de Discord en otro navegador o pasaron más de 10 minutos. Vuelve a pulsar el botón. |
| «Esa cuenta de Discord ya está vinculada a…» | Ese Discord ya es de otra cuenta. Desvincúlalo allí primero (Perfil). |
| «Con esa cuenta de Discord ya se creó la cuenta…» | Cada Discord crea una sola cuenta. Que entre con esa, o recházala tú si estaba pendiente y que la cree de nuevo. |
| «Tu cuenta todavía espera a que el DM la apruebe» | Apruébala en «Quién está en línea». |

## ¿Y la palabra de paso de la mesa (`ALQUIMIA_CLAVE`)?

Se queda igual: quien la tiene crea su cuenta al momento. Discord es el camino para quien no la tiene,
con tu aprobación. Si alguna vez la palabra de paso se filtra, cámbiala en el `.env` y reinicia.
