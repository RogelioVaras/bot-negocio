// Revisa el buzón desde GitHub Actions (cada 5 minutos) y avisa al bot.
//
// Por qué existe: Hostinger bloquea las conexiones que vienen de Cloudflare,
// así que el Worker no puede leer el correo. GitHub sí puede.
//
// Lo que hace en cada vuelta:
//   1. Pregunta al bot qué UID ya vio y qué respuestas hay en cola.
//   2. Lee el buzón por IMAP y junta los correos nuevos.
//   3. Se los entrega al bot (el bot avisa por Telegram y los guarda).
//   4. Envía por SMTP las respuestas que tú pediste desde Telegram.

import tls from 'node:tls';
import { Duplex } from 'node:stream';
import { ClienteImap, ClienteSmtp, partirRemitente, decodificarPalabra } from '../src/imap.js';

const {
  CORREO_USUARIO,
  CORREO_CLAVE,
  CORREO_IMAP_HOST,
  CORREO_SMTP_HOST,
  BOT_URL,
  BOT_CLAVE
} = process.env;

const MAX_CORREOS = 6;

function exigir(nombre, valor) {
  if (!valor) {
    console.error(`Falta el dato ${nombre}. Revisa los secrets del repositorio.`);
    process.exit(1);
  }
  return valor;
}

function abrirTls(host, puerto) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: puerto, servername: host }, () => resolve(socket));
    socket.setTimeout(25000, () => socket.destroy(new Error(`El servidor ${host} no respondió a tiempo`)));
    socket.once('error', reject);
  });
}

function comoSocket(socketTls) {
  const { readable, writable } = Duplex.toWeb(socketTls);
  return {
    readable,
    writable,
    close: () => new Promise((ok) => socketTls.end(() => ok()))
  };
}

async function conectarImap() {
  const socket = await abrirTls(CORREO_IMAP_HOST, Number(process.env.CORREO_IMAP_PUERTO || 993));
  const cliente = new ClienteImap(comoSocket(socket));
  await cliente.entrar(CORREO_USUARIO, CORREO_CLAVE);
  await cliente.abrirBandeja();
  return cliente;
}

function recortar(texto, max) {
  const limpio = String(texto || '').trim();
  return limpio.length > max ? limpio.slice(0, max) + '…' : limpio;
}

async function avisarError(mensaje) {
  try {
    await fetch(`${BOT_URL}/api/correo/error?clave=${encodeURIComponent(BOT_CLAVE)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: mensaje })
    });
  } catch (e) {
    console.error('Tampoco pude avisar del error:', e.message);
  }
}

async function principal() {
  exigir('CORREO_USUARIO', CORREO_USUARIO);
  exigir('CORREO_CLAVE', CORREO_CLAVE);
  exigir('CORREO_IMAP_HOST', CORREO_IMAP_HOST);
  exigir('CORREO_SMTP_HOST', CORREO_SMTP_HOST);
  exigir('BOT_URL', BOT_URL);
  exigir('BOT_CLAVE', BOT_CLAVE);

  const base = BOT_URL.replace(/\/+$/, '');
  const urlTrabajo = `${base}/api/correo/trabajo?clave=${encodeURIComponent(BOT_CLAVE)}`;

  const trabajo = await (await fetch(urlTrabajo)).json();
  const ultimoVisto = trabajo.uid === null || trabajo.uid === undefined ? null : Number(trabajo.uid);
  const pendientes = Array.isArray(trabajo.pendientes) ? trabajo.pendientes : [];

  console.log(`UID anterior: ${ultimoVisto}. Respuestas en cola: ${pendientes.length}.`);

  // 1) Correos nuevos
  const cliente = await conectarImap();
  let nuevos = [];
  let maxUid = ultimoVisto;
  try {
    const todos = await cliente.buscarUids('ALL');
    if (!todos.length) {
      console.log('Bandeja vacía.');
    } else {
      const desde = ultimoVisto === null ? Math.max(1, todos.length - 2) : todos.findIndex((u) => u > ultimoVisto);
      const candidatos =
        ultimoVisto === null
          ? todos.slice(-3)
          : desde === -1
          ? []
          : todos.slice(desde).slice(0, MAX_CORREOS);

      for (const uid of candidatos) {
        const cabeceras = await cliente.cabeceras(uid);
        const cuerpo = await cliente.completo(uid);
        const de = partirRemitente(cabeceras.from || '');
        nuevos.push({
          id: String(uid),
          de: de.correo,
          nombre: de.nombre,
          asunto: decodificarPalabra(cabeceras.subject || '') || '(sin asunto)',
          fecha: cabeceras.date || '',
          mensajeId: cabeceras['message-id'] || '',
          resumen: recortar(cuerpo, 160),
          cuerpo: recortar(cuerpo, 3000),
          adjuntos: false
        });
      }

      maxUid = Math.max(...todos);
    }
  } finally {
    await cliente.salir();
  }
  console.log(`Correos nuevos detectados: ${nuevos.length}.`);

  const entrega = await (
    await fetch(`${base}/api/correo/nuevos?clave=${encodeURIComponent(BOT_CLAVE)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uid: maxUid, nuevos })
    })
  ).json();
  console.log(`Avisados al bot: ${entrega.avisados ?? 0}.`);

  // 2) Respuestas en cola
  for (const p of pendientes) {
    try {
      const socket = await abrirTls(CORREO_SMTP_HOST, Number(process.env.CORREO_SMTP_PUERTO || 465));
      const smtp = new ClienteSmtp(comoSocket(socket));
      const asunto = /^re:/i.test(p.asunto || '') ? p.asunto : 'Re: ' + (p.asunto || '(sin asunto)');
      await smtp.enviar({
        usuario: CORREO_USUARIO,
        clave: CORREO_CLAVE,
        de: process.env.CORREO_NOMBRE ? `${process.env.CORREO_NOMBRE} <${CORREO_USUARIO}>` : CORREO_USUARIO,
        para: p.para,
        asunto,
        texto: p.texto,
        enRespuestaA: p.mensajeId || ''
      });
      await fetch(`${base}/api/correo/enviado?clave=${encodeURIComponent(BOT_CLAVE)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: p.id, ok: true, para: p.para, texto: p.texto })
      });
      console.log(`Respondido a ${p.para}.`);
    } catch (e) {
      const mensaje = String(e.message || e);
      console.error(`No pude responder a ${p.para}: ${mensaje}`);
      await fetch(`${base}/api/correo/enviado?clave=${encodeURIComponent(BOT_CLAVE)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: p.id, ok: false, para: p.para, error: mensaje })
      });
    }
  }
}

principal().catch(async (e) => {
  const mensaje = String(e.message || e);
  console.error('Error en la revisión:', mensaje);
  await avisarError(mensaje);
  process.exit(1);
});
