// Asistente personal: lo que ve Rogelio cuando le escribe al bot desde su celular.
// Solo responde a quien esté configurado como dueño (TELEGRAM_CHAT_ID).

import { almacen } from './almacen.js';
import * as correo from './correo-buzon.js';
import { conversarIA, iaDisponible } from './cerebro.js';
import { enviarMensaje } from './canales/telegram.js';
import { fecha as fmt, recortar, listaNumerada, resumenNuevos } from './formato.js';
import { estadoPuente } from './correo-puente.js';

const AYUDA = `Soy tu asistente. Puedes escribirme:

/correos          ver los últimos correos
/ver 2            leer el correo número 2
/redactar 2       que te proponga una respuesta al correo 2
/enviar           enviar la respuesta propuesta
/responder 2 tu texto    responder al correo 2 con tu texto
/avisos off       dejar de avisarme de correos nuevos
/avisos on        volver a avisarme
/estado           ver cómo está todo conectado
/id               ver mi identificación de chat

Cuando llegue un correo nuevo te aviso solo, con el remitente y el asunto.`;

// El correo puede llegar de dos maneras:
//   "vivo":   el Worker habla directo con el buzón (IMAP o Microsoft Graph)
//   "puente": GitHub revisa el buzón cada 5 minutos y deja los correos acá

function modo(env) {
  return correo.configurado(env) ? 'vivo' : 'puente';
}

async function listaParaMostrar(env, al) {
  if (modo(env) === 'vivo') {
    const lista = await correo.listar(env, al, 8);
    await al.escribir('correo:lista', lista.slice(0, 20));
    return lista;
  }
  return await al.leer('correo:ultimos', []);
}

async function traerLista(env, al) {
  if (modo(env) === 'vivo') {
    const guardada = await al.leer('correo:lista', null);
    if (guardada && guardada.length) return guardada;
  }
  return listaParaMostrar(env, al);
}

export async function atenderAsistente(env, { texto, chatId }) {
  const al = almacen(env);
  const limpio = String(texto || '').trim();
  // Acepta "/estado", "estado", " /Estado " con o sin espacios de más.
  const sinBarra = limpio.replace(/^[/\s]+/, '');
  const partes = sinBarra.split(/\s+/);
  const comando = (partes[0] || '').toLowerCase().split('@')[0].replace(/[.,;:!?]+$/, '');
  const resto = partes.slice(1).join(' ');
  const n = Number(partes[1]);

  if (comando === 'id') {
    return `Tu identificación de chat es: ${chatId}\n\nHay que dejarla configurada en el bot para que te reconozca como dueño.`;
  }

  if (comando === 'estado') {
    const duenoGuardado = env.TELEGRAM_CHAT_ID || (await al.leer('config:dueno', null));
    let lineaCorreo;
    if (modo(env) === 'vivo') {
      lineaCorreo = `Correo: conectado directo a ${env.CORREO_USUARIO || env.CORREO_IMAP_HOST}`;
    } else {
      const puente = await estadoPuente(env);
      lineaCorreo = `Correo: vía GitHub Actions. Última revisión: hace ${puente.hace}`;
      if (puente.pendientes) lineaCorreo += `\nRespuestas en cola: ${puente.pendientes} (salen en la próxima revisión)`;
      if (puente.error) lineaCorreo += `\nÚltimo error: ${puente.error}`;
      if (!puente.ultimaRevision) lineaCorreo += '\nTodavía no ha corrido ninguna revisión.';
    }
    const lineas = [
      lineaCorreo,
      `IA para redactar: ${iaDisponible(env) ? 'activa' : 'no configurada (uso mis propias palabras)'}`,
      `Avisos de correo nuevo: ${(await al.leer('correo:avisos', 'on')) === 'off' ? 'apagados' : 'encendidos'}`,
      `Dueño reconocido: ${duenoGuardado || 'todavía no configurado'}${String(duenoGuardado) === String(chatId) ? ' (ese eres tú)' : ''}`
    ];
    return lineas.join('\n');
  }

  if (comando === 'avisos') {
    const valor = (resto || '').toLowerCase();
    if (valor !== 'on' && valor !== 'off') return 'Escribe /avisos on o /avisos off';
    await al.escribir('correo:avisos', valor);
    return valor === 'on' ? 'Listo, te aviso cuando llegue correo nuevo.' : 'Listo, no te aviso más de correos nuevos.';
  }

  if (comando === 'ayuda' || comando === 'start' || comando === 'help') {
    return AYUDA;
  }

  // Desde aquí todo necesita el correo conectado.
  if (comando === 'correos') {
    try {
      const lista = await listaParaMostrar(env, al);
      if (!lista.length) {
        return modo(env) === 'vivo'
          ? 'No tienes correos en la bandeja de entrada.'
          : 'Todavía no tengo correos guardados. GitHub revisa el buzón cada 5 minutos; apenas llegue algo te aviso.';
      }
      return `Tus últimos ${lista.length} correos:\n\n${listaNumerada(lista)}\n\nEscribe /ver 1 para leer el primero.`;
    } catch (e) {
      return 'No pude leer tu correo: ' + recortar(e.message || e, 200);
    }
  }

  if (comando === 'ver') {
    if (!Number.isInteger(n) || n < 1) return 'Escribe /ver 2 (el número del correo que quieres leer).';
    try {
      const lista = await traerLista(env, al);
      const elegido = lista[n - 1];
      if (!elegido) return `No tengo un correo número ${n}. Escribe /correos para ver la lista.`;
      let m = elegido;
      if (modo(env) === 'vivo') {
        m = await correo.leerMensaje(env, al, elegido.id);
        await al.escribir('correo:actual', { id: m.id, numero: n, de: m.de, asunto: m.asunto });
      }
      const cuerpo = m.cuerpo || m.resumen || '(sin texto)';
      return `De: ${m.nombre || m.de}\nAsunto: ${m.asunto}\nFecha: ${fmt(m.fecha)}\n\n${recortar(cuerpo, 1200)}\n\n/redactar ${n}  ·  /responder ${n} tu texto`;
    } catch (e) {
      return 'No pude abrir ese correo: ' + recortar(e.message || e, 200);
    }
  }

  if (comando === 'responder') {
    const textoRespuesta = resto.replace(/^\d+\s*/, '').trim();
    if (!Number.isInteger(n) || n < 1) return 'Escribe /responder 2 tu texto';
    if (!textoRespuesta) return 'Me falta el texto. Ejemplo: /responder 2 Gracias, lo reviso hoy.';
    try {
      const lista = await traerLista(env, al);
      const elegido = lista[n - 1];
      if (!elegido) return `No tengo un correo número ${n}. Escribe /correos.`;

      if (modo(env) === 'vivo') {
        await correo.responder(env, al, elegido.id, textoRespuesta);
        return `Respondido a ${elegido.nombre || elegido.de}:\n\n${recortar(textoRespuesta, 300)}`;
      }

      const pendientes = await al.leer('correo:pendientes', []);
      pendientes.push({
        id: 'r' + Date.now().toString(36),
        uid: elegido.id,
        para: elegido.de,
        asunto: elegido.asunto,
        mensajeId: elegido.mensajeId || '',
        texto: textoRespuesta,
        ts: new Date().toISOString()
      });
      await al.escribir('correo:pendientes', pendientes.slice(-20));
      return `Listo, la respuesta a ${elegido.nombre || elegido.de} quedó en cola. Sale en la próxima revisión de GitHub (menos de 15 minutos). Te aviso cuando se envíe.`;
    } catch (e) {
      return 'No pude responder: ' + recortar(e.message || e, 200);
    }
  }

  if (comando === 'redactar') {
    if (!Number.isInteger(n) || n < 1) return 'Escribe /redactar 2 (el número del correo a responder).';
    if (!iaDisponible(env)) return 'Para redactar necesito una clave de IA configurada. Mientras tanto usa /responder 2 tu texto.';
    try {
      const lista = await traerLista(env, al);
      const elegido = lista[n - 1];
      if (!elegido) return `No tengo un correo número ${n}. Escribe /correos.`;
      const m = modo(env) === 'vivo' ? await correo.leerMensaje(env, al, elegido.id) : elegido;
      const cuerpo = m.cuerpo || m.resumen || '';
      const borrador = await conversarIA(
        [{ role: 'user', content: `Correo recibido:\nDe: ${m.nombre} <${m.de}>\nAsunto: ${m.asunto}\n\n${recortar(cuerpo, 3000)}\n\nEscribe la respuesta.` }],
        env,
        'Eres el asistente de un contador chileno. Redacta una respuesta breve, cordial y profesional en español de Chile. No inventes datos ni comprometas plazos. Solo el texto de la respuesta, sin asunto.'
      );
      await al.escribir('correo:borrador', {
        id: elegido.id,
        numero: n,
        para: m.de,
        asunto: m.asunto,
        mensajeId: m.mensajeId || '',
        texto: borrador
      });
      return `Borrador para ${m.de}:\n\n${recortar(borrador, 900)}\n\nSi te sirve, escribe /enviar. Si no, /descartar.`;
    } catch (e) {
      return 'No pude redactar: ' + recortar(e.message || e, 200);
    }
  }

  if (comando === 'enviar') {
    const borrador = await al.leer('correo:borrador', null);
    if (!borrador || !borrador.texto) return 'No tengo ningún borrador pendiente. Usa /redactar 1 para generar uno.';
    try {
      if (modo(env) === 'vivo') {
        await correo.responder(env, al, borrador.id, borrador.texto);
        await al.escribir('correo:borrador', null);
        return `Enviado a ${borrador.para}.`;
      }
      const pendientes = await al.leer('correo:pendientes', []);
      pendientes.push({
        id: 'r' + Date.now().toString(36),
        uid: borrador.id,
        para: borrador.para,
        asunto: borrador.asunto || '',
        mensajeId: borrador.mensajeId || '',
        texto: borrador.texto,
        ts: new Date().toISOString()
      });
      await al.escribir('correo:pendientes', pendientes.slice(-20));
      await al.escribir('correo:borrador', null);
      return `Encolado para ${borrador.para}. Sale en la próxima revisión de GitHub (menos de 15 minutos).`;
    } catch (e) {
      return 'No pude enviar: ' + recortar(e.message || e, 200);
    }
  }

  if (comando === 'descartar') {
    await al.escribir('correo:borrador', null);
    return 'Borrador descartado.';
  }

  // Texto libre: si hay IA, conversa como asistente; si no, muestra la ayuda.
  if (iaDisponible(env)) {
    try {
      const respuesta = await conversarIA(
        [{ role: 'user', content: limpio }],
        env,
        'Eres el asistente personal de un contador chileno. Responde breve, en español de Chile. No tienes acceso a internet. Si te piden acciones sobre el correo, indícales los comandos: /correos, /ver 2, /redactar 2, /enviar.'
      );
      return respuesta;
    } catch (e) {
      return 'No pude responder: ' + recortar(e.message || e, 150) + '\n\n' + AYUDA;
    }
  }

  return 'No entendí: ' + recortar(limpio, 60) + '\n\n' + AYUDA;
}

// Aviso automático de correo nuevo cuando el Worker sí alcanza el buzón.
// En modo puente el aviso lo manda correo-puente.js cuando GitHub entrega.
export async function avisarCorreoNuevo(env) {
  if (!correo.configurado(env)) return { enviado: false, motivo: 'correo por puente: avisa GitHub' };
  if (!env.TELEGRAM_TOKEN) return { enviado: false, motivo: 'falta token de Telegram' };

  const al = almacen(env);
  const dueno = env.TELEGRAM_CHAT_ID || (await al.leer('config:dueno', null));
  if (!dueno) return { enviado: false, motivo: 'falta el chat del dueño' };

  if ((await al.leer('correo:avisos', 'on')) === 'off') return { enviado: false, motivo: 'avisos apagados' };

  const { primera, nuevos } = await correo.nuevos(env, al);
  if (primera) return { enviado: false, motivo: 'primera revisión: tomé la marca de posición' };
  if (!nuevos.length) return { enviado: false, motivo: 'sin correos nuevos' };

  await al.escribir('correo:ultimos', [...nuevos, ...(await al.leer('correo:ultimos', []))].slice(0, 20));
  await enviarMensaje(env.TELEGRAM_TOKEN, dueno, resumenNuevos(nuevos));
  return { enviado: true, cantidad: nuevos.length };
}
