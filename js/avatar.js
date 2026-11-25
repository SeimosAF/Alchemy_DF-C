// avatar.js — fotos de perfil (una por cuenta).
//
// Cada cuenta puede subir una foto. Aquí, en el navegador, se recorta en cuadrado
// y se reduce a 256x256 antes de mandarla, así que al servidor solo llega una
// imagen pequeña (PNG/JPEG/WebP, máx. 300 KB) que él comprueba sin abrirla.
//
// Para pintar una foto en cualquier sitio basta con escribir:
//     avatar.html(clave, version, 'M', 'avatar avatar-grande')
// Sale la inicial y, en cuanto llega la foto, se pone de fondo. La foto se pide
// con la sesión (no es pública) y se guarda en memoria mientras la página está abierta.
// Sin servidor no hay fotos: se ve la inicial como siempre.
import * as auth from './auth.js';

export const LADO = 256;
const MAX_ARCHIVO = 15 * 1024 * 1024;      // lo que se acepta elegir (luego se reduce)
const cache = new Map();                   // "clave@version" -> objectURL | Promise | null

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// HTML de un avatar: la inicial (o emoji) y, si tiene foto, se carga sola
export function html(clave, version, texto, clases = 'avatar', titulo = '') {
  const v = auth.servidor && clave && version ? Number(version) || 0 : 0;
  return `<span class="${esc(clases)}"${titulo ? ` title="${esc(titulo)}"` : ''}${v ? ` data-avatar="${esc(clave)}" data-avatar-v="${v}"` : ''}>${esc(texto)}</span>`;
}

// Pone (o quita) la foto en un elemento ya pintado
export function poner(el, clave, version) {
  if (!el) return;
  const v = auth.servidor && clave && version ? Number(version) || 0 : 0;
  if (!v) {
    el.removeAttribute('data-avatar'); el.removeAttribute('data-avatar-v');
    el.classList.remove('con-foto'); el.style.backgroundImage = '';
    return;
  }
  if (el.dataset.avatar === clave && el.dataset.avatarV === String(v) && el.classList.contains('con-foto')) return;
  el.dataset.avatar = clave; el.dataset.avatarV = String(v);
  el.classList.remove('con-foto'); el.style.backgroundImage = '';
  rellenar(el);
}

async function url(clave, v) {
  const k = clave + '@' + v;
  if (cache.has(k)) return cache.get(k);
  const p = (async () => {
    try {
      const r = await fetch('/api/avatar/' + encodeURIComponent(clave) + '?v=' + v, { headers: auth.cabeceras(), cache: 'no-store' });
      const tipo = r.headers.get('Content-Type') || '';
      if (!r.ok || !/^image\/(png|jpeg|webp)$/.test(tipo)) return null;
      return URL.createObjectURL(await r.blob());
    } catch (_) { return null; }
  })();
  cache.set(k, p);
  const u = await p;
  cache.set(k, u);
  return u;
}

async function rellenar(el) {
  const clave = el.dataset.avatar, v = el.dataset.avatarV;
  if (!clave || !v) return;
  const u = await url(clave, v);
  if (u && el.dataset.avatar === clave && el.dataset.avatarV === v) {
    el.style.backgroundImage = `url("${u}")`;
    el.classList.add('con-foto');
  }
}

// Cualquier avatar que aparezca en la página se rellena solo (no hace falta llamar a nada al pintar)
export function init() {
  if (!auth.servidor) return;
  let pendiente = false;
  const barrer = () => {
    pendiente = false;
    document.querySelectorAll('[data-avatar-v]:not(.con-foto)').forEach(rellenar);
  };
  new MutationObserver(() => { if (!pendiente) { pendiente = true; requestAnimationFrame(barrer); } })
    .observe(document.body, { childList: true, subtree: true });
  barrer();
}

// ---- Elegir, recortar y subir la foto propia ----
// Devuelve un dataURL de LADO x LADO (WebP si el navegador sabe, si no JPEG), recortado al centro.
export async function prepararFoto(archivo) {
  if (!archivo) throw new Error('No has elegido ninguna foto.');
  if (!/^image\/(png|jpeg|webp|gif|bmp|avif)$/.test(archivo.type)) throw new Error('Elige una imagen (JPG, PNG, WebP o GIF).');
  if (archivo.size > MAX_ARCHIVO) throw new Error('La imagen pesa demasiado (máximo 15 MB).');
  let img;
  try { img = await createImageBitmap(archivo); }
  catch (_) { throw new Error('No se ha podido abrir esa imagen.'); }
  if (img.width < 16 || img.height < 16) throw new Error('La imagen es demasiado pequeña.');
  const lado = Math.min(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = c.height = LADO;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e7d3a6';                // fondo de pergamino si la imagen tiene transparencia
  ctx.fillRect(0, 0, LADO, LADO);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, LADO, LADO);
  img.close?.();
  const blob = await new Promise(res => c.toBlob(b => {
    if (b && b.type === 'image/webp') res(b);
    else c.toBlob(res, 'image/jpeg', 0.88);
  }, 'image/webp', 0.86));
  if (!blob) throw new Error('No se ha podido preparar la foto.');
  return await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(new Error('No se ha podido leer la foto.'));
    fr.readAsDataURL(blob);
  });
}

export async function subir(dataURL) {
  const r = await auth.apiMesa('/api/yo/avatar', { imagen: dataURL });
  if (r.ok && auth.usuario) auth.usuario.avatar = r.avatar;
  return r;
}

export async function quitar(clave) {
  const r = await auth.apiMesa('/api/yo/avatar', { quitar: true, ...(clave ? { usuario: clave } : {}) });
  if (r.ok && auth.usuario && (!clave || clave === auth.usuario.clave)) auth.usuario.avatar = 0;
  return r;
}
