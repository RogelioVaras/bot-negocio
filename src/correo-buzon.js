// Elige con qué se lee el correo, sin que el resto del bot se entere:
//   - Si hay CORREO_IMAP_HOST  -> IMAP/SMTP  (Hostinger, cPanel, Titan, Gmail...)
//   - Si hay Azure configurado -> Microsoft Graph (correo de empresa Microsoft)

import * as graph from './correo.js';
import * as imap from './correo-imap.js';

export function esImap(env) {
  return Boolean(env && env.CORREO_IMAP_HOST);
}

export function configurado(env) {
  return esImap(env) ? imap.configurado(env) : graph.configurado(env);
}

export function faltaQue(env) {
  return esImap(env) ? imap.faltaQue(env) : graph.faltaQue(env);
}

export function listar(env, al, cantidad) {
  return esImap(env) ? imap.listar(env, al, cantidad) : graph.listar(env, al, cantidad);
}

export function leerMensaje(env, al, id) {
  return esImap(env) ? imap.leerMensaje(env, al, id) : graph.leerMensaje(env, al, id);
}

export function responder(env, al, id, texto) {
  return esImap(env) ? imap.responder(env, al, id, texto) : graph.responder(env, al, id, texto);
}

export function enviar(env, al, datos) {
  return esImap(env) ? imap.enviar(env, al, datos) : graph.enviar(env, al, datos);
}

export function nuevos(env, al) {
  return esImap(env) ? imap.nuevos(env, al) : graph.nuevos(env, al);
}

export { esImap as usaImap };
