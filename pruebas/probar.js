// Pruebas reales del bot, sin internet y sin claves.
// Se ejecuta con:  node pruebas/probar.js
// Además genera public/vista-previa.html para abrir el panel en el navegador.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { responder, normalizar } from '../src/cerebro.js';
import { generarPropuestas, publicarEnRedes } from '../src/publicidad.js';
import { manejar } from '../src/index.js';
import { NEGOCIO } from '../src/negocio.js';
import { panelHtml, chatHtml } from '../src/vistas.js';
import { almacen } from '../src/almacen.js';
import { avisarCorreoNuevo, atenderAsistente } from '../src/asistente.js';
import { trabajo, recibirNuevos, marcadoEnviado } from '../src/correo-puente.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..');

let pasadas = 0;
let falladas = 0;

function revisar(nombre, condicion, detalle = '') {
  if (condicion) {
    pasadas++;
    console.log('  ok   ' + nombre);
  } else {
    falladas++;
    console.log('  FALLA ' + nombre + (detalle ? ' -> ' + detalle : ''));
  }
}

function limpiarMemoria() {
  globalThis.__memoriaBot = new Map();
}

const envVacio = { CLAVE_PANEL: 'clave-de-prueba' };

// ---------- Cerebro ----------
console.log('\nCEREBRO (respuestas a clientes)');

{
  const r = await responder('Hola, ¿a qué hora atienden?', {}, envVacio, NEGOCIO);
  revisar('responde el horario desde las preguntas frecuentes', r.fuente === 'faq' && /9:00/.test(r.texto), JSON.stringify(r));
  revisar('no deriva cuando sabe la respuesta', r.derivar === false);
}

{
  const r = await responder('Necesito hablar con una persona, es urgente', {}, envVacio, NEGOCIO);
  revisar('deriva a humano cuando piden una persona', r.derivar === true, JSON.stringify(r));
}

{
  const r = await responder('¿Cuánto cobran por la contabilidad mensual?', {}, envVacio, NEGOCIO);
  revisar('responde precio con pregunta de calificación', /cuantas boletas|facturas/i.test(normalizar(r.texto)), r.texto);
  revisar('nunca inventa un precio en pesos', !/\$\s?\d/.test(r.texto), r.texto);
}

{
  const r = await responder('¿Trabajan con restaurantes en Valparaíso?', {}, envVacio, NEGOCIO);
  revisar('ante algo que no sabe, usa respaldo y deriva', r.fuente === 'respaldo' && r.derivar === true);
}

{
  const r = await responder('   ', {}, envVacio, NEGOCIO);
  revisar('mensaje vacío no rompe nada', typeof r.texto === 'string' && r.texto.length > 0);
}

{
  const r = await responder('¿Atención los sábados?', {}, { ...envVacio, IA_CLAVE: 'invalida', IA_URL: 'http://127.0.0.1:9/x' }, NEGOCIO);
  revisar('si la IA falla, igual responde con respaldo', r.fuente === 'respaldo' && r.texto.length > 20, JSON.stringify(r));
}

// ---------- Publicidad ----------
console.log('\nPUBLICIDAD (propuestas y aprobación)');

{
  const props = await generarPropuestas('Recordar el vencimiento del F29', NEGOCIO, {});
  revisar('genera 3 propuestas sin IA', props.length === 3, String(props.length));
  revisar('cada propuesta trae texto utilizable', props.every((p) => p.texto.length > 40));
  revisar('las propuestas incluyen hashtags', props.every((p) => /#/.test(p.hashtags)));
}

{
  const r = await publicarEnRedes({ texto: 'prueba', hashtags: '#x' }, {});
  revisar('sin token de Meta no publica y lo explica', r.ok === false && r.motivo === 'requiere_conexion', JSON.stringify(r));
}

// ---------- Rutas ----------
console.log('\nRUTAS (panel, chat, bandeja)');

{
  const resp = await manejar(new Request('http://local/panel?clave=clave-de-prueba'), envVacio);
  const texto = await resp.text();
  revisar('el panel abre con la clave correcta', resp.status === 200 && texto.includes('Panel del bot'));
  revisar('el panel trae los botones de aprobación', texto.includes('Generar propuestas') && texto.includes('Publicar ahora'));
}

{
  const resp = await manejar(new Request('http://local/panel?clave=mala'), envVacio);
  revisar('el panel rechaza clave incorrecta', resp.status === 401);
}

{
  const resp = await manejar(new Request('http://local/api/bandeja'), envVacio);
  revisar('la API exige clave', resp.status === 401);
}

{
  const resp = await manejar(new Request('http://local/chat'), envVacio);
  const texto = await resp.text();
  revisar('el chat web se sirve', resp.status === 200 && texto.includes('Escribe tu consulta'));
}

// ---------- Flujo completo ----------
console.log('\nFLUJO COMPLETO (cliente pregunta -> bandeja -> propuesta -> aprobación)');

{
  limpiarMemoria();

  const chat1 = await manejar(
    new Request('http://local/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensaje: 'Quiero hablar con un contador por un reclamo', sesion: 's1' })
    }),
    envVacio
  );
  const datos1 = await chat1.json();
  revisar('el chat público responde', chat1.status === 200 && typeof datos1.texto === 'string');

  const bandeja = await manejar(
    new Request('http://local/api/bandeja', { headers: { 'x-clave': 'clave-de-prueba' } }),
    envVacio
  );
  const datosBandeja = await bandeja.json();
  revisar('la conversación que necesita humano llega a la bandeja', datosBandeja.conversaciones.length === 1, JSON.stringify(datosBandeja.resumen));

  const idConv = datosBandeja.conversaciones[0]?.id;

  const respuesta = await manejar(
    new Request('http://local/api/bandeja/responder', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clave': 'clave-de-prueba' },
      body: JSON.stringify({ id: idConv, texto: 'Hola, te llamo en 10 minutos para revisar tu caso.' })
    }),
    envVacio
  );
  const datosRespuesta = await respuesta.json();
  revisar(
    'la respuesta manual se guarda sin fingir envío',
    respuesta.status === 200 && datosRespuesta.guardado === true && datosRespuesta.enviado === false,
    JSON.stringify(datosRespuesta)
  );

  const resuelta = await manejar(
    new Request('http://local/api/bandeja/resolver', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clave': 'clave-de-prueba' },
      body: JSON.stringify({ id: idConv })
    }),
    envVacio
  );
  revisar('se puede marcar como atendida', resuelta.status === 200);

  const bandeja2 = await (await manejar(
    new Request('http://local/api/bandeja', { headers: { 'x-clave': 'clave-de-prueba' } }),
    envVacio
  )).json();
  revisar('después de atenderla sale de la bandeja', bandeja2.conversaciones.length === 0);

  const crear = await manejar(
    new Request('http://local/api/propuestas', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clave': 'clave-de-prueba' },
      body: JSON.stringify({ idea: 'Campaña de fin de año para pymes' })
    }),
    envVacio
  );
  const datosCrear = await crear.json();
  revisar('crea 3 propuestas pendientes', datosCrear.propuestas?.length === 3 && datosCrear.propuestas.every((p) => p.estado === 'pendiente'));

  const idProp = datosCrear.propuestas[0].id;

  const publicarAntes = await manejar(
    new Request('http://local/api/propuestas/publicar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clave': 'clave-de-prueba' },
      body: JSON.stringify({ id: idProp })
    }),
    envVacio
  );
  revisar('no se puede publicar sin aprobar', publicarAntes.status === 400);

  const aprobar = await manejar(
    new Request('http://local/api/propuestas/estado', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clave': 'clave-de-prueba' },
      body: JSON.stringify({ id: idProp, accion: 'aprobar', texto: 'Texto editado por Rogelio' })
    }),
    envVacio
  );
  const datosAprobar = await aprobar.json();
  revisar('aprobar guarda el texto editado', datosAprobar.propuesta?.estado === 'aprobada' && datosAprobar.propuesta?.texto === 'Texto editado por Rogelio');

  const publicarDespues = await manejar(
    new Request('http://local/api/propuestas/publicar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-clave': 'clave-de-prueba' },
      body: JSON.stringify({ id: idProp })
    }),
    envVacio
  );
  const datosPublicar = await publicarDespues.json();
  revisar('sin Meta conectado avisa que falta conexión, no finge que publicó', datosPublicar.ok === false && datosPublicar.motivo === 'requiere_conexion');
}

// ---------- Webhooks ----------
console.log('\nWEBHOOKS (Telegram y WhatsApp)');

{
  limpiarMemoria();
  const resp = await manejar(
    new Request('http://local/webhook/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: { chat: { id: 555 }, from: { first_name: 'Ana' }, text: 'Hola, ¿cuánto cuesta?' } })
    }),
    envVacio
  );
  const datos = await resp.json();
  revisar('acepta mensaje de Telegram sin token configurado', resp.status === 200 && datos.ok === true);

  const convs = await (await manejar(
    new Request('http://local/api/bandeja', { headers: { 'x-clave': 'clave-de-prueba' } }),
    envVacio
  )).json();
  revisar('el mensaje de Telegram quedó guardado', convs.resumen.chats === 1, JSON.stringify(convs.resumen));
}

{
  const resp = await manejar(
    new Request('http://local/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=secreto&hub.challenge=12345'),
    { ...envVacio, WHATSAPP_VERIFY: 'secreto' }
  );
  revisar('WhatsApp verifica el webhook devolviendo el reto', resp.status === 200 && (await resp.text()) === '12345');

  const malo = await manejar(
    new Request('http://local/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1'),
    { ...envVacio, WHATSAPP_VERIFY: 'secreto' }
  );
  revisar('WhatsApp rechaza token equivocado', malo.status === 403);
}

// ---------- Asistente de Telegram + correo Outlook ----------
console.log('\nASISTENTE (Telegram del dueño + correo Outlook)');

function interceptar(rutas) {
  const original = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (url, opciones = {}) => {
    const u = String(url);
    llamadas.push({ url: u, metodo: opciones.method || 'GET', cuerpo: String(opciones.body || '') });
    for (const [patron, responder] of rutas) {
      if (u.includes(patron)) return responder(u, opciones);
    }
    return new Response(JSON.stringify({ error: { message: 'sin simulación para ' + u } }), { status: 404 });
  };
  return {
    llamadas,
    restaurar() {
      globalThis.fetch = original;
    }
  };
}

const LISTA_GRAPH = {
  value: [
    {
      id: 'M1',
      subject: 'Solicitud de F29 marzo',
      from: { emailAddress: { address: 'cliente@empresa.cl', name: 'Claudia Pérez' } },
      receivedDateTime: '2026-11-17T10:00:00Z',
      bodyPreview: 'Necesito el F29 de marzo',
      hasAttachments: false
    },
    {
      id: 'M2',
      subject: 'Re: liquidaciones',
      from: { emailAddress: { address: 'rrhh@empresa.cl', name: 'RRHH' } },
      receivedDateTime: '2026-11-16T09:00:00Z',
      bodyPreview: 'Adjunto el archivo',
      hasAttachments: true
    }
  ]
};

const CORREO_NUEVO = {
  id: 'M3',
  subject: 'Nuevo correo urgente',
  from: { emailAddress: { address: 'jefe@empresa.cl', name: 'Jefe' } },
  receivedDateTime: '2026-11-17T12:00:00Z',
  bodyPreview: 'Revisar hoy',
  hasAttachments: false
};

function simulacionGraph(deltaConNuevo = true) {
  return [
    [
      'login.microsoftonline.com',
      () => new Response(JSON.stringify({ access_token: 'tok-graph', expires_in: 3600, refresh_token: 'r2' }), { status: 200 })
    ],
    [
      '/messages/delta',
      (u) =>
        u.includes('token=') && deltaConNuevo
          ? new Response(JSON.stringify({ value: [CORREO_NUEVO], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/x?token=2' }), { status: 200 })
          : new Response(JSON.stringify({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/users/x/mailFolders/inbox/messages/delta?token=1' }), { status: 200 })
    ],
    [
      '/reply',
      () => new Response('', { status: 202 })
    ],
    [
      '/sendMail',
      () => new Response('', { status: 202 })
    ],
    [
      '/messages/M1?',
      () =>
        new Response(
          JSON.stringify({
            id: 'M1',
            subject: 'Solicitud de F29 marzo',
            from: { emailAddress: { address: 'cliente@empresa.cl', name: 'Claudia Pérez' } },
            toRecipients: [{ emailAddress: { address: 'rogelio@empresa.cl' } }],
            receivedDateTime: '2026-11-17T10:00:00Z',
            body: { content: '<html><body><p>Hola Rogelio,</p><p>Necesito el F29 de marzo.</p></body></html>' }
          }),
          { status: 200 }
        )
    ],
    [
      '/mailFolders/inbox/messages?',
      () => new Response(JSON.stringify(LISTA_GRAPH), { status: 200 })
    ],
    [
      'api.deepseek.com',
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'Estimada Claudia, revisaré el F29 y le confirmo hoy.' } }] }), {
          status: 200
        })
    ],
    [
      'api.telegram.org',
      () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })
    ]
  ];
}

const envDueno = {
  CLAVE_PANEL: 'clave-de-prueba',
  TELEGRAM_TOKEN: 'tok-telegram',
  TELEGRAM_CHAT_ID: '999',
  CORREO_USUARIO: 'rogelio@empresa.cl',
  CORREO_CLIENT_ID: 'app-id',
  CORREO_CLIENT_SECRET: 'secreto',
  IA_CLAVE: 'ia-falsa'
};

function mensajeTelegram(chatId, texto) {
  return new Request('http://local/webhook/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: { chat: { id: chatId }, from: { first_name: 'Rogelio' }, text: texto } })
  });
}

{
  limpiarMemoria();
  globalThis.__tokenCorreo = {};
  const m = interceptar(simulacionGraph());
  try {
    const resp = await manejar(mensajeTelegram(999, '/correos'), envDueno);
    const datos = await resp.json();
    const enviado = m.llamadas.find((l) => l.url.includes('sendMessage'));
    revisar('el dueño recibe la lista de correos', datos.origen === 'asistente' && /Claudia Pérez/.test(enviado?.cuerpo || ''), enviado?.cuerpo?.slice(0, 120));
    revisar('Microsoft recibe permiso de aplicación', m.llamadas.some((l) => l.url.includes('login.microsoftonline.com') && l.cuerpo.includes('client_credentials')));
  } finally {
    m.restaurar();
  }
}

{
  limpiarMemoria();
  globalThis.__tokenCorreo = {};
  const m = interceptar(simulacionGraph());
  try {
    await manejar(mensajeTelegram(999, '/correos'), envDueno);
    m.llamadas.length = 0;
    const resp = await manejar(mensajeTelegram(999, '/ver 1'), envDueno);
    const datos = await resp.json();
    const enviado = m.llamadas.find((l) => l.url.includes('sendMessage'));
    const cuerpo = enviado?.cuerpo || '';
    revisar('/ver 1 trae el cuerpo del correo', datos.origen === 'asistente' && /Necesito el F29 de marzo/.test(cuerpo), cuerpo.slice(0, 160));
    revisar('el HTML del correo queda limpio', !/<p>|<\/p>|<html>/.test(cuerpo));
  } finally {
    m.restaurar();
  }
}

{
  limpiarMemoria();
  globalThis.__tokenCorreo = {};
  const m = interceptar(simulacionGraph());
  try {
    await manejar(mensajeTelegram(999, '/correos'), envDueno);
    m.llamadas.length = 0;
    await manejar(mensajeTelegram(999, '/responder 1 Gracias, lo reviso hoy mismo.'), envDueno);
    const respuesta = m.llamadas.find((l) => l.url.includes('/reply'));
    revisar('responder un correo llama a Microsoft con el texto', !!respuesta && /lo reviso hoy mismo/.test(respuesta.cuerpo), respuesta?.cuerpo?.slice(0, 120));
    revisar('la respuesta va al correo elegido', !!respuesta && respuesta.url.includes('/messages/M1/reply'));
  } finally {
    m.restaurar();
  }
}

{
  limpiarMemoria();
  globalThis.__tokenCorreo = {};
  const m = interceptar(simulacionGraph());
  try {
    await manejar(mensajeTelegram(999, '/correos'), envDueno);
    const borrador = await (await manejar(mensajeTelegram(999, '/redactar 1'), envDueno)).json();
    const enviadoBorrador = m.llamadas.filter((l) => l.url.includes('sendMessage')).pop();
    revisar('redactar propone un texto con IA', /Estimada Claudia/.test(enviadoBorrador?.cuerpo || ''), enviadoBorrador?.cuerpo?.slice(0, 120));
    revisar('el borrador NO se envía solo', !m.llamadas.some((l) => l.url.includes('/reply')));

    m.llamadas.length = 0;
    await manejar(mensajeTelegram(999, '/enviar'), envDueno);
    const respuesta = m.llamadas.find((l) => l.url.includes('/reply'));
    revisar('enviar manda el borrador solo cuando lo apruebas', !!respuesta && /Estimada Claudia/.test(respuesta.cuerpo));
  } finally {
    m.restaurar();
  }
}

{
  limpiarMemoria();
  globalThis.__tokenCorreo = {};
  const m = interceptar(simulacionGraph());
  try {
    await manejar(mensajeTelegram(999, '/correos'), envDueno);
    await manejar(mensajeTelegram(999, '/redactar 1'), envDueno);
    await manejar(mensajeTelegram(999, '/descartar'), envDueno);
    m.llamadas.length = 0;
    await manejar(mensajeTelegram(999, '/enviar'), envDueno);
    revisar('/descartar borra el borrador pendiente', !m.llamadas.some((l) => l.url.includes('/reply')));
  } finally {
    m.restaurar();
  }
}

{
  limpiarMemoria();
  globalThis.__tokenCorreo = {};
  const m = interceptar(simulacionGraph());
  try {
    const envSinCorreo = { CLAVE_PANEL: 'clave-de-prueba', TELEGRAM_TOKEN: 'tok-telegram', TELEGRAM_CHAT_ID: '999' };
    await manejar(mensajeTelegram(999, '/correos'), envSinCorreo);
    const enviado = m.llamadas.find((l) => l.url.includes('sendMessage'));
    revisar('sin correo conectado /correos avisa y no falla', /todavía no tengo correos guardados|no conecto/i.test(enviado?.cuerpo || ''), enviado?.cuerpo?.slice(0, 120));

    await manejar(mensajeTelegram(999, '/estado'), envSinCorreo);
    const estado = m.llamadas.filter((l) => l.url.includes('sendMessage')).pop();
    revisar('/estado explica cómo está el correo', /GitHub Actions|conectado directo/.test(estado?.cuerpo || ''), estado?.cuerpo?.slice(0, 160));
  } finally {
    m.restaurar();
  }
}

{
  limpiarMemoria();
  globalThis.__tokenCorreo = {};
  const m = interceptar(simulacionGraph());
  try {
    const resp = await manejar(mensajeTelegram(1234, 'Hola, cuánto cuesta la contabilidad'), envDueno);
    const datos = await resp.json();
    revisar('un desconocido NO recibe los correos del dueño', datos.origen === 'cliente' && !m.llamadas.some((l) => l.url.includes('graph.microsoft.com')));
  } finally {
    m.restaurar();
  }
}

{
  limpiarMemoria();
  const m = interceptar(simulacionGraph());
  try {
    const resp = await manejar(mensajeTelegram(777, '/id'), { CLAVE_PANEL: 'x', TELEGRAM_TOKEN: 'tok-telegram' });
    const datos = await resp.json();
    const enviado = m.llamadas.find((l) => l.url.includes('sendMessage'));
    revisar('/id entrega el chat para configurarlo', datos.origen === 'bienvenida' && /777/.test(enviado?.cuerpo || ''), enviado?.cuerpo?.slice(0, 100));
  } finally {
    m.restaurar();
  }
}

{
  limpiarMemoria();
  globalThis.__tokenCorreo = {};
  const m = interceptar(simulacionGraph());
  try {
    const al = almacen(envDueno);
    await al.escribir('correo:delta', 'https://graph.microsoft.com/v1.0/users/x/mailFolders/inbox/messages/delta?token=1');
    await al.escribir('correo:avisos', 'on');
    const r = await avisarCorreoNuevo(envDueno);
    const enviado = m.llamadas.find((l) => l.url.includes('sendMessage'));
    revisar('avisa solo cuando llega correo nuevo', r.enviado === true && r.cantidad === 1, JSON.stringify(r));
    revisar('el aviso trae remitente y asunto', /Nuevo correo urgente/.test(enviado?.cuerpo || ''), enviado?.cuerpo?.slice(0, 160));

    m.llamadas.length = 0;
    await al.escribir('correo:avisos', 'off');
    const r2 = await avisarCorreoNuevo(envDueno);
    revisar('/avisos off silencia las notificaciones', r2.enviado === false && r2.motivo === 'avisos apagados', JSON.stringify(r2));
    revisar('silenciado no manda nada', m.llamadas.length === 0);
  } finally {
    m.restaurar();
  }
}

{
  limpiarMemoria();
  globalThis.__tokenCorreo = {};
  const m = interceptar(simulacionGraph(false));
  try {
    const al = almacen(envDueno);
    await al.escribir('correo:delta', 'https://graph.microsoft.com/v1.0/users/x/mailFolders/inbox/messages/delta?token=1');
    await al.escribir('correo:avisos', 'on');
    const r = await avisarCorreoNuevo(envDueno);
    revisar('sin correos nuevos no molesta', r.enviado === false && r.motivo === 'sin correos nuevos', JSON.stringify(r));
  } finally {
    m.restaurar();
  }
}

{
  limpiarMemoria();
  globalThis.__tokenCorreo = {};
  const m = interceptar(simulacionGraph());
  try {
    const al = almacen(envDueno);
    const r = await avisarCorreoNuevo(envDueno);
    revisar('la primera revisión solo toma posición (no inunda)', r.enviado === false && /primera/.test(r.motivo), JSON.stringify(r));
    revisar('guarda la marca de posición en el almacén', !!(await al.leer('correo:delta', null)));
  } finally {
    m.restaurar();
  }
}

// ---------- Correo por IMAP/SMTP (Hostinger y otros) ----------
console.log('\nCORREO POR IMAP/SMTP');

import {
  ClienteImap,
  ClienteSmtp,
  decodificarPalabra,
  partirCorreo,
  leerCabeceras,
  partirRemitente,
  textoABase64
} from '../src/imap.js';
import * as buzon from '../src/correo-buzon.js';

const TE = new TextEncoder();
const TD = new TextDecoder();

// Servidor de mentira: recibe comandos, responde según el guion y anota lo escrito.
function servidorFalso(manejador, saludo = '') {
  let control;
  const readable = new ReadableStream({
    start(c) {
      control = c;
      if (saludo) c.enqueue(TE.encode(saludo));
    }
  });
  const escritos = [];
  const estado = {};
  let resto = '';
  const writable = new WritableStream({
    write(trozo) {
      const texto = TD.decode(trozo);
      escritos.push(texto);
      const lineas = (resto + texto).split('\r\n');
      resto = lineas.pop();
      for (const linea of lineas) {
        const respuesta = manejador(linea, estado);
        if (respuesta) control.enqueue(TE.encode(respuesta));
      }
    }
  });
  return {
    readable,
    writable,
    escritos,
    estado,
    cerrar() {
      try {
        control.close();
      } catch (e) {
        // ya cerrado
      }
    }
  };
}

function literal(texto) {
  return `${texto.length === TE.encode(texto).length ? `{${TE.encode(texto).length}}` : `{${TE.encode(texto).length}}`}\r\n${texto}`;
}

const CABECERAS_M1 =
  'From: "Claudia Perez" <cliente@empresa.cl>\r\n' +
  'To: Rogelio <rogelio@empresacl.cl>\r\n' +
  'Subject: =?UTF-8?B?U29saWNpdHVkIGRlIEYyOSBtYXJ6bw==?=\r\n' +
  'Date: Tue, 17 Nov 2026 10:00:00 -0300\r\n' +
  'Message-ID: <abc123@empresa.cl>\r\n\r\n';

function guionImap(linea, estado) {
  const marca = linea.split(' ')[0];
  const orden = linea.slice(marca.length + 1).toUpperCase();
  if (orden.startsWith('LOGIN')) return `* OK Logged in\r\n${marca} OK Login completed\r\n`;
  if (orden.startsWith('SELECT')) {
    return `* FLAGS (\\Seen \\Answered)\r\n* OK [UIDVALIDITY 7] UIDs valid\r\n* 12 EXISTS\r\n${marca} OK [READ-WRITE] Select completed\r\n`;
  }
  if (orden.startsWith('UID SEARCH ALL')) return `* SEARCH 101 102\r\n${marca} OK Search completed\r\n`;
  if (orden.startsWith('UID SEARCH')) return `* SEARCH 103\r\n${marca} OK\r\n`;
  if (orden.startsWith('UID FETCH')) {
    if (orden.includes('HEADER.FIELDS')) {
      return `* 1 FETCH (UID 101 BODY[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)] ${literal(CABECERAS_M1)})\r\n${marca} OK Fetch completed\r\n`;
    }
    if (orden.includes('BODY.PEEK[TEXT]')) {
      const cuerpo = '=Hola Rogelio,=0A=0ANecesito el F29 de marzo.=0A=0ASaludos';
      return `* 1 FETCH (UID 101 BODY[TEXT] ${literal(cuerpo)})\r\n${marca} OK Fetch completed\r\n`;
    }
    return `${marca} OK\r\n`;
  }
  if (orden.startsWith('LOGOUT')) return `* BYE\r\n${marca} OK\r\n`;
  return `${marca} OK\r\n`;
}

{
  const servidor = servidorFalso(guionImap, '* OK Dovecot ready\r\n');
  const cliente = new ClienteImap(servidor);
  await cliente.entrar('rogelio@empresacl.cl', 'clave');
  const bandeja = await cliente.abrirBandeja();
  revisar('IMAP: entra y abre la bandeja', bandeja.uidvalidez === 7, JSON.stringify(bandeja));

  const uids = await cliente.buscarUids('ALL');
  revisar('IMAP: lista los correos', uids.join(',') === '101,102', uids.join(','));

  const cab = await cliente.cabeceras(101);
  revisar('IMAP: lee el remitente', /cliente@empresa\.cl/.test(cab.from || ''), cab.from);
  revisar('IMAP: decodifica el asunto en base64', decodificarPalabra(cab.subject) === 'Solicitud de F29 marzo', cab.subject);

  const cuerpo = await cliente.cuerpo(101);
  revisar('IMAP: trae el texto del correo', /Necesito el F29 de marzo/.test(partirCorreo('Content-Type: text/plain\r\n\r\n' + cuerpo)), cuerpo.slice(0, 80));
  servidor.cerrar();
}

{
  revisar('Asunto con acentos se decodifica', decodificarPalabra('=?iso-8859-1?Q?Reuni=F3n_ma=F1ana?=') === 'Reunión mañana');
  revisar('Remitente "Nombre <correo>" se separa', partirRemitente('"Claudia Perez" <cliente@empresa.cl>').correo === 'cliente@empresa.cl');
  revisar('Remitente sin nombre se reconoce', partirRemitente('cliente@empresa.cl').correo === 'cliente@empresa.cl');

  const html = 'Content-Type: text/html; charset=utf-8\r\n\r\n<html><body><p>Hola <b>Rogelio</b></p><p>F29 listo</p></body></html>';
  const limpio = partirCorreo(html);
  revisar('Correo HTML queda en texto legible', /Hola Rogelio/.test(limpio) && !/<p>/.test(limpio), limpio.slice(0, 60));

  const qp = 'Content-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nRevisi=F3n r=E1pida';
  revisar('Quoted-printable se decodifica', /Revisión rápida/.test(partirCorreo(qp)), partirCorreo(qp));

  const plegadas = leerCabeceras('Subject: una linea\r\n muy larga\r\nFrom: a@b.cl\r\n\r\ncuerpo');
  revisar('Cabeceras partidas en dos líneas se unen', /una linea muy larga/.test(plegadas.cabeceras.subject));
}

{
  // Envío por SMTP
  let enDatos = false;
  const servidor = servidorFalso((linea, estado) => {
    if (enDatos) {
      if (linea === '.') {
        enDatos = false;
        return '250 2.0.0 Ok: queued as 1A2B\r\n';
      }
      return null;
    }
    if (linea.startsWith('EHLO')) return '250-smtp.titan.email\r\n250-AUTH LOGIN\r\n250 SIZE 1000000\r\n';
    if (linea.startsWith('AUTH LOGIN')) return '334 VXNlcm5hbWU6\r\n';
    if (/^[A-Za-z0-9+/=]+$/.test(linea) && !estado.usuario) {
      estado.usuario = true;
      return '334 UGFzc3dvcmQ6\r\n';
    }
    if (/^[A-Za-z0-9+/=]+$/.test(linea) && !estado.clave) {
      estado.clave = true;
      return '235 2.7.0 Authentication successful\r\n';
    }
    if (linea === 'MAIL FROM:<rogelio@empresacl.cl>') return '250 OK\r\n';
    if (linea.startsWith('RCPT TO:')) return '250 OK\r\n';
    if (linea === 'DATA') {
      enDatos = true;
      return '354 End data with <CR><LF>.<CR><LF>\r\n';
    }
    if (linea === 'QUIT') return '221 Bye\r\n';
    return null;
  }, '220 smtp.titan.email ESMTP Postfix\r\n');

  const smtp = new ClienteSmtp(servidor);
  await smtp.enviar({
    usuario: 'rogelio@empresacl.cl',
    clave: 'clave',
    de: 'Rogelio <rogelio@empresacl.cl>',
    para: 'cliente@empresa.cl',
    asunto: 'Re: Solicitud de F29 marzo',
    texto: 'Hola Claudia, reviso el F29 y te confirmo hoy.',
    enRespuestaA: '<abc123@empresa.cl>'
  });

  const todo = servidor.escritos.join('');
  revisar('SMTP: se autentica', /AUTH LOGIN/.test(todo) && todo.includes(textoABase64('clave')));
  revisar('SMTP: arma el destinatario', /RCPT TO:<cliente@empresa\.cl>/.test(todo));
  revisar('SMTP: encadena la respuesta al correo original', /In-Reply-To: <abc123@empresa\.cl>/.test(todo));
  revisar('SMTP: el asunto va en base64 con acentos', /Subject: =\?UTF-8\?B\?/.test(todo));

  const partes = todo.split('\r\n\r\n');
  const cuerpoB64 = partes[partes.length - 1].replace(/\r\n\.\r\n$/, '').replace(/\s+/g, '');
  const decodificado = Buffer.from(cuerpoB64, 'base64').toString('utf8');
  revisar('SMTP: el texto llega intacto', decodificado.includes('reviso el F29 y te confirmo hoy'), decodificado.slice(0, 60));
  servidor.cerrar();
}

{
  const sinClave = { CORREO_USUARIO: 'a@b.cl', CORREO_IMAP_HOST: 'mail.b.cl' };
  revisar('Elige IMAP cuando hay CORREO_IMAP_HOST', buzon.usaImap(sinClave) === true);
  revisar('IMAP sin clave avisa qué falta', /CORREO_CLAVE/.test(buzon.faltaQue(sinClave)), buzon.faltaQue(sinClave));
  revisar('Graph se usa cuando no hay IMAP', buzon.usaImap({ CORREO_CLIENT_ID: 'x' }) === false);
}

// ---------- Puente de correo por GitHub Actions ----------
console.log('\nPUENTE DE CORREO (GitHub entrega, el bot avisa)');

{
  limpiarMemoria();
  const m = interceptar([
    ['api.telegram.org', () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })]
  ]);
  const envPuente = { CLAVE_PANEL: 'x', TELEGRAM_TOKEN: 'tok-telegram', TELEGRAM_CHAT_ID: '999' };
  try {
    const al = almacen(envPuente);
    const t0 = await trabajo(envPuente);
    revisar('puente: parte sin UID ni cola', t0.uid === null && t0.pendientes.length === 0, JSON.stringify(t0));

    const correo1 = {
      id: '105',
      de: 'ana@cliente.cl',
      nombre: 'Ana Díaz',
      asunto: 'Solicitud de F29',
      fecha: '2026-11-17T12:00:00Z',
      mensajeId: '<m105@cliente.cl>',
      cuerpo: 'Hola, necesito el F29 de marzo. Gracias.'
    };
    await recibirNuevos(envPuente, { uid: 105, nuevos: [correo1] });

    const aviso = m.llamadas.find((l) => l.url.includes('sendMessage'));
    revisar('puente: avisa por Telegram con remitente y asunto', /Ana Díaz/.test(aviso?.cuerpo || '') && /Solicitud de F29/.test(aviso?.cuerpo || ''), aviso?.cuerpo?.slice(0, 160));

    const t1 = await trabajo(envPuente);
    revisar('puente: guarda el UID visto', t1.uid === 105, JSON.stringify(t1.uid));

    await recibirNuevos(envPuente, { uid: 105, nuevos: [correo1] });
    revisar('puente: no repite el mismo correo', (await al.leer('correo:ultimos', [])).length === 1);

    const lista = await atenderAsistente(envPuente, { texto: 'correos', chatId: '999' });
    revisar('puente: /correos muestra lo que trajo GitHub', /Solicitud de F29/.test(lista), lista.slice(0, 80));

    const ver = await atenderAsistente(envPuente, { texto: 'ver 1', chatId: '999' });
    revisar('puente: /ver 1 muestra el cuerpo guardado', /necesito el F29 de marzo/.test(ver), ver.slice(0, 100));

    const resp = await atenderAsistente(envPuente, { texto: 'responder 1 Gracias, lo reviso hoy mismo', chatId: '999' });
    revisar('puente: /responder deja la respuesta en cola', /quedó en cola/.test(resp), resp.slice(0, 120));

    const cola = await al.leer('correo:pendientes', []);
    revisar('puente: la cola guarda destinatario, asunto e hilo', cola.length === 1 && cola[0].para === 'ana@cliente.cl' && cola[0].mensajeId === '<m105@cliente.cl>', JSON.stringify(cola[0]));

    const t2 = await trabajo(envPuente);
    revisar('puente: el script ve la respuesta pendiente', t2.pendientes.length === 1);

    const estado = await atenderAsistente(envPuente, { texto: 'estado', chatId: '999' });
    revisar('puente: /estado dice que va por GitHub', /GitHub Actions/.test(estado) && /en cola/.test(estado), estado.slice(0, 160));

    await marcadoEnviado(envPuente, { id: cola[0].id, ok: true, para: 'ana@cliente.cl', texto: 'Gracias, lo reviso hoy mismo' });
    revisar('puente: al enviarse sale de la cola', (await al.leer('correo:pendientes', [])).length === 0);
    const confirmacion = m.llamadas.filter((l) => l.url.includes('sendMessage')).pop();
    revisar('puente: confirma el envío por Telegram', /Respondido a ana@cliente\.cl/.test(confirmacion?.cuerpo || ''), confirmacion?.cuerpo?.slice(0, 120));
  } finally {
    m.restaurar();
  }
}

// ---------- Vistas para el navegador ----------
console.log('\nVISTAS');

{
  const panel = panelHtml(NEGOCIO.nombre);
  const chat = chatHtml(NEGOCIO.nombre);
  revisar('el panel es HTML completo', panel.startsWith('<!doctype html>') && panel.trim().endsWith('</html>'));
  revisar('el chat es HTML completo', chat.startsWith('<!doctype html>') && chat.trim().endsWith('</html>'));
  revisar('el panel muestra el nombre del negocio', panel.includes(NEGOCIO.nombre));

  const carpeta = path.join(raiz, 'public');
  fs.mkdirSync(carpeta, { recursive: true });
  fs.writeFileSync(path.join(carpeta, 'vista-previa-panel.html'), panel, 'utf8');
  fs.writeFileSync(path.join(carpeta, 'vista-previa-chat.html'), chat, 'utf8');
  revisar('se generó la vista previa del panel en public/', fs.existsSync(path.join(carpeta, 'vista-previa-panel.html')));
}

console.log('\n----------------------------------------');
console.log(`Resultado: ${pasadas} pruebas ok, ${falladas} fallidas`);
if (falladas > 0) {
  console.log('HAY FALLAS: el bot no está listo así.');
  process.exit(1);
}
console.log('Todo el bot quedó verificado.');
