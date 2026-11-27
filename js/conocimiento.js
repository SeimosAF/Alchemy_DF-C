// conocimiento.js — qué sabe cada jugador de los materiales alquímicos (V3.8).
//
// - Catálogo por descubrimiento: un material que da de alta el DM no aparece en el catálogo
//   de un jugador hasta que lo recibe por primera vez (lo apunta el servidor en la colección
//   común «descubrimientos»: material -> { jugador: fecha }).
// - «Desconocido»: el DM puede rellenar toda la ficha de un material y seguir marcándolo como
//   desconocido (campo `unknown` del material). Los jugadores ven su nombre y dónde se encontró,
//   pero no qué hace, y no pueden usarlo en el caldero hasta que el DM lo dé a conocer.
// - Quien no es alquimista ve los materiales alquímicos de su inventario como «Material alquímico», sin más.
// Sin servidor (modo local) quien usa la app es a la vez DM y jugador: lo ve todo.
import { state } from './state.js';
import * as auth from './auth.js';
import * as sync from './sync.js';
import { listaDisciplinas } from './modulos.js';

export const conServidor = () => sync.modo === 'servidor';
// El DM (o cualquiera sin servidor) conoce todo el catálogo
export const veTodo = () => !conServidor() || auth.esDM();
const yo = () => auth.usuario?.clave || '';

export function esAlquimista() {
  if (veTodo()) return true;
  return listaDisciplinas(auth.usuario?.disciplina).includes('alquimista');
}

// ¿Este jugador ha recibido ya este material alguna vez?
export function descubierto(mid) {
  if (veTodo()) return true;
  return !!state.descubrimientos?.[mid]?.[yo()];
}

// La ficha está marcada como desconocida y quien mira no es el DM: solo nombre y lugar
export const infoOculta = m => !!m?.unknown && !veTodo();

// Para el DM: ¿ningún jugador lo ha recibido todavía?
export const quienesLoConocen = mid => Object.keys(state.descubrimientos?.[mid] || {});
export const sinDar = mid => !quienesLoConocen(mid).length;

// El nombre que ve quien no es alquimista
export const NOMBRE_GENERICO = 'Material alquímico';
