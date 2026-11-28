// V3.10.1: al cruzar el portal de la mesa (el planeta del centro) la página se recarga para ir al selector
// de campañas. Este guion va en el <head>, sin módulos, para que el remolino esté pintado desde el primer
// fotograma de la página nueva y la transición no dé un fogonazo. auth.js lo abre al enseñar el pergamino.
(function () {
  try {
    var d = sessionStorage.getItem('taberna.portal');
    if (!d) return;
    sessionStorage.removeItem('taberna.portal');
    var p = JSON.parse(d) || {};
    var raiz = document.documentElement;
    if (typeof p.x === 'number') raiz.style.setProperty('--portal-x', p.x + '%');
    if (typeof p.y === 'number') raiz.style.setProperty('--portal-y', p.y + '%');
    raiz.classList.add('portal-llegada');
    // Por si nadie lo abre (algo falla al cargar): a los 6 s se quita solo
    setTimeout(function () { if (!raiz.classList.contains('portal-abriendo')) raiz.classList.remove('portal-llegada'); }, 6000);
  } catch (_) {}
})();
