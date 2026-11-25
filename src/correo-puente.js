// Puente de correo por GitHub Actions.
// El Worker no puede conectarse a Hostinger, así que GitHub revisa el buzón
// cada 5 minutos y le entrega los correos aquí. El Worker los guarda, te avisa
// por Telegram y encola las respuestas que tú pidas.

import { almacen } from './almacen.js';
import { enviarMensaje } from './canales/telegram.js';
import { fecha, resumenNuevos } from './formato.js';

async function dueno(env, al) {
  return env.TELEGRAM_CHAT_ID || (await al.leer('config:dueno', null));
}

// Lo que el script de GitHub pregunta al empezar: qué UID ya vio y qué debe enviar.
export async function trabajo(env) {
  const al = almacen(env);
  return {
    uid: await al.leer('correo:uid', null),
    pendientes: await al.leer('correo:pendientes', []),
    ultimaRevision: await al.leer('correo:revision', null)
  };
}

// El script entrega los correos nuevos (ya con el cuerpo recortado).
export async function recibirNuevos(env, cuerpo) {
  const al = almacen(env);
  const nuevos = Array.isArray(cuerpo.nuevos) ? cuerpo.nuevos : [];
  const uid = cuerpo.uid;

  if (uid !== undefined && uid !== null) await al.escribir('correo:uid', uid);
  await al.escribir('correo:revision', new Date().toISOString());

  if (!nuevos.length) return { ok: true, avisados: 0 };

  const previos = await al.leer('correo:ultimos', []);
  const vistos = new Set((previos || []).map((c) => String(c.id)));
  const limpios = nuevos.filter((c) => c && c.id && !vistos.has(String(c.id)));
  if (!limpios.length) return { ok: true, avisados: 0 };

  await al.escribir('correo:ultimos', [...limpios, ...previos].slice(0, 20));
  await al.escribir('correo:sinLeer', (await al.leer('correo:sinLeer', 0)) + limpios.length);

  const para = await dueno(env, al);
  if (env.TELEGRAM_TOKEN && para && (await al.leer('correo:avisos', 'on')) !== 'off') {
    await enviarMensaje(env.TELEGRAM_TOKEN, para, resumenNuevos(limpios));
  }
  return { ok: true, avisados: limpios.length };
}

// El script avisa cómo le fue con cada respuesta encolada.
export async function marcadoEnviado(env, cuerpo) {
  const al = almacen(env);
  const pendientes = await al.leer('correo:pendientes', []);
  const resto = pendientes.filter((p) => String(p.id) !== String(cuerpo.id));
  await al.escribir('correo:pendientes', resto);

  const para = await dueno(env, al);
  if (env.TELEGRAM_TOKEN && para && (await al.leer('avisos:todo', 'on')) !== 'off') {
    const texto = cuerpo.ok
      ? `Respondido a ${cuerpo.para || 'el cliente'}:\n\n${String(cuerpo.texto || '').slice(0, 300)}`
      : `No pude enviar la respuesta a ${cuerpo.para || 'el cliente'}: ${String(cuerpo.error || 'error desconocido').slice(0, 200)}`;
    try {
      await enviarMensaje(env.TELEGRAM_TOKEN, para, texto);
    } catch (e) {
      // si Telegram falla, la cola ya quedó actualizada
    }
  }
  return { ok: true, quedan: resto.length };
}

// Guarda el error del puente para que /estado lo muestre.
export async function anotarError(env, cuerpo) {
  const al = almacen(env);
  await al.escribir('correo:error', {
    mensaje: String(cuerpo.error || '').slice(0, 400),
    cuando: new Date().toISOString()
  });
  const para = await dueno(env, al);
  const ultimo = await al.leer('correo:errorAvisado', null);
  const ahora = Date.now();
  // No molestar más de una vez cada 6 horas con el mismo problema.
  if (
    env.TELEGRAM_TOKEN &&
    para &&
    (await al.leer('avisos:todo', 'on')) !== 'off' &&
    (!ultimo || ahora - Number(ultimo) > 6 * 3600 * 1000)
  ) {
    await al.escribir('correo:errorAvisado', ahora);
    try {
      await enviarMensaje(
        env.TELEGRAM_TOKEN,
        para,
        `No pude revisar tu correo:\n${String(cuerpo.error || '').slice(0, 300)}\n\nRevisa /estado.`
      );
    } catch (e) {
      // sin importancia
    }
  }
  return { ok: true };
}

export async function estadoPuente(env) {
  const al = almacen(env);
  const revision = await al.leer('correo:revision', null);
  const error = await al.leer('correo:error', null);
  const pendientes = (await al.leer('correo:pendientes', [])).length;
  return {
    ultimaRevision: revision,
    hace: revision ? Math.round((Date.now() - new Date(revision).getTime()) / 60000) + ' min' : 'nunca',
    pendientes,
    error: error ? `${error.mensaje} (${fecha(error.cuando)})` : null
  };
}
