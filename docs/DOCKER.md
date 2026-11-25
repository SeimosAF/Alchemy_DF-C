# Jugar a la vez desde Madrid y Murcia: Docker + Tailscale

La app corre en el PC de Moisés dentro de Docker. El amigo entra desde su casa
a través de Tailscale, una red privada entre vuestros aparatos. Nada se abre a
internet. La app solo está disponible mientras ese PC está encendido.

Explicación completa y alternativas: https://claude.ai/artifact/Gx8JndhJFTi2nuCurEpiqz

## 1. Instalar Docker Desktop (una vez, en el PC de Moisés)

1. Descarga Docker Desktop para Windows desde https://www.docker.com/products/docker-desktop/ e instálalo.
   Si te ofrece activar WSL 2, acepta y reinicia.
2. Abre Docker Desktop y espera a que ponga "Engine running".
3. En Settings > General marca "Start Docker Desktop when you sign in" para que arranque con Windows.

## 2. Arrancar la app con Docker

Atajo: con Docker Desktop abierto, doble clic en `docker-iniciar.bat` (arranca y abre el navegador)
y `docker-parar.bat` para pararla. A mano es así:

1. En la carpeta del repo, copia `.env.example` como `.env` y escribe una palabra de paso larga
   en `ALQUIMIA_CLAVE=`. Hace falta para crear cuentas en la app. En `ALQUIMIA_ADMIN=` pon la
   contraseña fija del superusuario **DM**. Ese archivo no se sube a GitHub.
2. Abre una terminal en la carpeta del repo (clic derecho > "Abrir en Terminal") y ejecuta:

       docker compose up -d --build

   La primera vez tarda unos minutos. Después abre http://localhost:8080 y crea tu cuenta
   (la primera cuenta es la del DM).

| Quiero...                         | Comando                                   |
| --------------------------------- | ----------------------------------------- |
| Ver si está viva                  | `docker compose ps`                       |
| Ver errores                       | `docker compose logs -f app`              |
| Parar (los datos se quedan)       | `docker compose down`                     |
| Actualizar tras cambiar el código | `docker compose up -d --build`            |

Con Docker la base de datos vive en el volumen `datos`, no en la carpeta `datos/` del repo.
`iniciar.bat` sigue funcionando sin Docker, pero usa su propia base en `datos/`: usa uno u otro, no los dos.

## 3. Conectar a tu amigo con Tailscale ("La taberna de Jhon")

1. Crea una cuenta gratuita en https://tailscale.com e instala Tailscale en tu PC.
2. Tu amigo instala Tailscale y crea su propia cuenta.
3. Ponle nombre al PC: en https://login.tailscale.com/admin/machines, en tu PC, "..." > "Edit machine name...",
   desmarca "Auto-generate from OS hostname" y escribe `taberna-de-jhon`.
4. En https://login.tailscale.com/admin/dns comprueba que MagicDNS está activado y pulsa "Enable HTTPS".
   Ahí verás también el nombre de tu red, algo como `tail1234.ts.net`.
5. Con la app en marcha, abre una terminal y escribe:

       tailscale serve --bg 8080

   Desde ese momento la app está en `https://taberna-de-jhon.tail1234.ts.net` (con el nombre de tu red),
   con candado y sin `:8080`. Solo la ven tu red de Tailscale y quien invites. Se mantiene aunque reinicies.
   Para quitarlo: `tailscale serve reset`.
6. En la página de máquinas, en tu PC: "..." > "Share..." y envía la invitación a tu amigo.
   Cuando la acepte, abre la dirección `https://taberna-de-jhon....ts.net` y escribe la contraseña.

Si no carga: comprueba que tu PC está encendido, que Docker dice "running" y que `tailscale serve status`
muestra el puerto 8080.

## 4. Copias de seguridad

El servidor guarda solo una copia al arrancar y cada 24 horas, y conserva las 7 últimas
dentro del volumen (`/data/copias/`). Para sacar una copia a tu PC y llevarla a OneDrive:

    docker compose cp app:/data/copias ./copias-docker

Restaurar una copia (por ejemplo `mi-copia.db`):

    docker compose stop app
    docker compose cp ./mi-copia.db app:/data/alquimia.db
    docker compose start app
