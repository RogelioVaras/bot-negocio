// Buzón de correo por IMAP/SMTP: la misma cara que el módulo de Graph,
// para que el asistente no sepa de qué proveedor se trata.

import { almacen } from './almacen.js';
import { ClienteImap, ClienteSmtp, partirRemitente, decodificarPalabra, aTextoPlano } from './imap.js';

const PUERTO_IMAP = 993;
const PUERTO_SMTP = 465;

export function configurado(env) {
  return Boolean(env && env.CORREO_USUARIO && env.CORREO_CLAVE && env.CORREO_IMAP_HOST);
}

export function faltaQue(env) {
  if (!env || !env.CORREO_USUARIO) return 'falta CORREO_USUARIO (tu dirección de correo)';
  if (!env.CORREO_CLAVE) return 'falta CORREO_CLAVE (la contraseña del correo)';
  if (!env.CORREO_IMAP_HOST) return 'falta CORREO_IMAP_HOST (ejemplo: mail.tudominio.cl)';
  return 'todo configurado';
}

function puerto(env, nombre, porDefecto) {
  return Number(env[nombre] || porDefecto);
}

async function conectar(env) {
  let connect;
  try {
    ({ connect } = await import('cloudflare:sockets'));
  } catch (e) {
    throw new Error('Este servidor no permite conexiones de correo: ' + String(e.message || e));
  }
  const socket = connect(
    { hostname: env.CORREO_IMAP_HOST, port: puerto(env, 'CORREO_IMAP_PUERTO', PUERTO_IMAP) },
    { secureTransport: 'on' }
  );
  await socket.opened;
  const cliente = new ClienteImap(socket);
  await cliente.entrar(env.CORREO_USUARIO, env.CORREO_CLAVE);
  await cliente.abrirBandeja();
  return cliente;
}

function aCorreo(uid, cabeceras) {
  const de = partirRemitente(cabeceras.from || '');
  return {
    id: String(uid),
    de: de.correo,
    nombre: de.nombre,
    asunto: decodificarPalabra(cabeceras.subject || '') || '(sin asunto)',
    fecha: cabeceras.date || '',
    resumen: '',
    adjuntos: false,
    mensajeId: cabeceras['message-id'] || ''
  };
}

export async function listar(env, al, cantidad = 8) {
  const cliente = await conectar(env);
  try {
    const todos = await cliente.buscarUids('ALL');
    const ultimos = todos.slice(-cantidad).reverse();
    const salida = [];
    for (const uid of ultimos) {
      const cabeceras = await cliente.cabeceras(uid);
      salida.push(aCorreo(uid, cabeceras));
    }
    return salida;
  } finally {
    await cliente.salir();
  }
}

export async function leerMensaje(env, al, uid) {
  const cliente = await conectar(env);
  try {
    const cabeceras = await cliente.cabeceras(uid);
    const cuerpo = await cliente.cuerpo(uid);
    const base = aCorreo(uid, cabeceras);
    return {
      ...base,
      para: decodificarPalabra(cabeceras.to || ''),
      cuerpo: aTextoPlano(cuerpo, cabeceras['content-type'] || '')
    };
  } finally {
    await cliente.salir();
  }
}

// Responde con el mismo asunto y encadenado al correo original.
export async function responder(env, al, uid, texto) {
  const cliente = await conectar(env);
  let cabeceras;
  try {
    cabeceras = await cliente.cabeceras(uid);
  } finally {
    await cliente.salir();
  }

  const destinatario = partirRemitente(cabeceras.from || '').correo;
  if (!destinatario) throw new Error('No pude leer a quién hay que responderle');

  const asunto = decodificarPalabra(cabeceras.subject || '');
  const conRe = /^re:/i.test(asunto) ? asunto : 'Re: ' + (asunto || '(sin asunto)');

  await enviar(env, al, {
    para: destinatario,
    asunto: conRe,
    texto,
    enRespuestaA: cabeceras['message-id'] || ''
  });
  return true;
}

export async function enviar(env, al, { para, asunto, texto, enRespuestaA }) {
  if (!env.CORREO_SMTP_HOST) throw new Error('Falta CORREO_SMTP_HOST para poder enviar correos');
  let connect;
  try {
    ({ connect } = await import('cloudflare:sockets'));
  } catch (e) {
    throw new Error('Este servidor no permite conexiones de correo: ' + String(e.message || e));
  }
  const socket = connect(
    { hostname: env.CORREO_SMTP_HOST, port: puerto(env, 'CORREO_SMTP_PUERTO', PUERTO_SMTP) },
    { secureTransport: 'on' }
  );
  await socket.opened;
  const smtp = new ClienteSmtp(socket);
  await smtp.enviar({
    usuario: env.CORREO_USUARIO,
    clave: env.CORREO_CLAVE,
    de: env.CORREO_NOMBRE ? `${env.CORREO_NOMBRE} <${env.CORREO_USUARIO}>` : env.CORREO_USUARIO,
    para,
    asunto,
    texto,
    enRespuestaA
  });
  return true;
}

// Correos nuevos desde la última revisión. La primera vez solo guarda la marca.
export async function nuevos(env, al) {
  const cliente = await conectar(env);
  try {
    const marca = await al.leer('imap:uid', null);
    const todos = await cliente.buscarUids('ALL');

    if (!marca) {
      const ultimo = todos.length ? todos[todos.length - 1] : 0;
      await al.escribir('imap:uid', ultimo);
      return { primera: true, nuevos: [], ultimo };
    }

    const desde = Number(marca) + 1;
    const pendientes = todos.filter((uid) => uid >= desde).slice(-10);
    if (!pendientes.length) return { primera: false, nuevos: [], ultimo: marca };

    const encontrados = [];
    for (const uid of pendientes) {
      const cabeceras = await cliente.cabeceras(uid);
      encontrados.push(aCorreo(uid, cabeceras));
    }

    await al.escribir('imap:uid', pendientes[pendientes.length - 1]);
    encontrados.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    return { primera: false, nuevos: encontrados, ultimo: pendientes[pendientes.length - 1] };
  } finally {
    await cliente.salir();
  }
}

export { almacen };
