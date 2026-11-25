// Puerta de entrada del bot. Aquí se decide qué hacer con cada visita o mensaje.
// Rutas:
//   /panel                     panel de aprobación (requiere clave)
//   /chat                      chat para la página web
//   /api/chat                  respuestas del bot
//   /api/bandeja               conversaciones que necesitan a un humano
//   /api/propuestas            propuestas de publicidad (crear, aprobar, publicar)
//   /webhook/telegram          canal Telegram
//   /webhook/whatsapp          canal WhatsApp Cloud API

import { NEGOCIO } from './negocio.js';
import { almacen, nuevoId } from './almacen.js';
import { responder } from './cerebro.js';
import { generarPropuestas, publicarEnRedes } from './publicidad.js';
import { leerMensaje as telegramLeer, enviarMensaje as telegramEnviar } from './canales/telegram.js';
import { verificar as whatsappVerificar, leerMensajes as whatsappLeer, enviarMensaje as whatsappEnviar } from './canales/whatsapp.js';
import { panelHtml, chatHtml } from './vistas.js';
import { atenderAsistente, avisarCorreoNuevo } from './asistente.js';
import { trabajo, recibirNuevos, marcadoEnviado, anotarError } from './correo-puente.js';
import { configurado as correoConfigurado, faltaQue as correoFaltaQue, listar as correoListar } from './correo-buzon.js';

const CLAVE_POR_DEFECTO = 'cambiame';

function json(datos, estado = 200) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store'
    }
  });
}

function html(texto, estado = 200) {
  return new Response(texto, {
    status: estado,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function autorizado(request, env, url) {
  const clave = request.headers.get('x-clave') || url.searchParams.get('clave') || '';
  return clave.length > 0 && clave === (env.CLAVE_PANEL || CLAVE_POR_DEFECTO);
}

async function cuerpo(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// Registra el mensaje del cliente, responde y deja la conversación guardada.
async function atenderMensaje(env, { canal, de, texto, nombre }) {
  const al = almacen(env);
  const conversaciones = await al.leer('conversaciones', []);
  const ahora = new Date().toISOString();

  let conv = conversaciones.find((c) => c.canal === canal && c.de === de);
  if (!conv) {
    conv = { id: nuevoId(), canal, de, nombre: nombre || String(de), mensajes: [], creada: ahora };
    conversaciones.unshift(conv);
  }

  conv.mensajes.push({ rol: 'cliente', texto, ts: ahora });
  const r = await responder(texto, { historial: conv.mensajes }, env, NEGOCIO);
  conv.mensajes.push({ rol: 'bot', texto: r.texto, ts: ahora, fuente: r.fuente });

  conv.ultima = ahora;
  conv.necesitaHumano = !!r.derivar;
  conv.atendida = false;
  if (conv.mensajes.length > 40) conv.mensajes = conv.mensajes.slice(-40);

  await al.escribir('conversaciones', conversaciones.slice(0, 200));
  return r;
}

async function panel(request, env, url) {
  if (!autorizado(request, env, url)) {
    return html(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">
       <h1 style="font-size:18px">Falta la clave del panel</h1>
       <p style="color:#5b6b7c;font-size:14px">Abre la dirección del panel agregando al final: <b>?clave=TU_CLAVE</b></p>
       </body>`,
      401
    );
  }
  return html(panelHtml(NEGOCIO.nombre));
}

async function apiBandeja(request, env) {
  const al = almacen(env);
  const todas = await al.leer('conversaciones', []);
  const pendientes = todas.filter((c) => c.necesitaHumano && !c.atendida);
  return json({
    conversaciones: pendientes,
    resumen: { pendientes: pendientes.length, chats: todas.length }
  });
}

async function apiPropuestas(request, env) {
  const al = almacen(env);
  const lista = await al.leer('propuestas', []);

  if (request.method === 'GET') return json({ propuestas: lista.slice(0, 40) });

  const { idea } = await cuerpo(request);
  const generadas = await generarPropuestas(idea, NEGOCIO, env);
  const nuevas = generadas.map((p) => ({
    ...p,
    id: nuevoId(),
    estado: 'pendiente',
    creada: new Date().toISOString()
  }));
  await al.escribir('propuestas', [...nuevas, ...lista].slice(0, 100));
  return json({ creadas: nuevas.length, propuestas: nuevas });
}

async function apiEstado(request, env) {
  const { id, accion, texto } = await cuerpo(request);
  const al = almacen(env);
  const lista = await al.leer('propuestas', []);
  const p = lista.find((x) => x.id === id);
  if (!p) return json({ error: 'No encontré esa propuesta' }, 404);

  if (accion === 'aprobar') {
    p.estado = 'aprobada';
    p.aprobada = new Date().toISOString();
    if (typeof texto === 'string' && texto.trim()) p.texto = texto.trim();
  } else if (accion === 'rechazar') {
    p.estado = 'rechazada';
  } else {
    return json({ error: 'Acción no válida' }, 400);
  }

  await al.escribir('propuestas', lista);
  return json({ ok: true, propuesta: p });
}

async function apiPublicar(request, env) {
  const { id } = await cuerpo(request);
  const al = almacen(env);
  const lista = await al.leer('propuestas', []);
  const p = lista.find((x) => x.id === id);
  if (!p) return json({ error: 'No encontré esa propuesta' }, 404);
  if (p.estado !== 'aprobada') {
    return json({ ok: false, motivo: 'sin_aprobar', detalle: 'Primero debes aprobar la publicación.' }, 400);
  }

  const resultado = await publicarEnRedes(p, env);
  if (resultado.ok) {
    p.estado = 'publicada';
    p.publicada = new Date().toISOString();
    p.redes = resultado.redes;
  } else if (resultado.motivo === 'requiere_conexion') {
    p.redes = resultado.redes || p.redes;
  } else {
    p.estado = 'error_publicacion';
    p.error = resultado.redes;
  }
  await al.escribir('propuestas', lista);
  return json(resultado);
}

// Quién es el dueño: su chat de Telegram. Puede venir de una variable
// (TELEGRAM_CHAT_ID) o quedar guardado en la memoria del bot.
async function chatDueno(env, al) {
  if (env.TELEGRAM_CHAT_ID) return String(env.TELEGRAM_CHAT_ID);
  const guardado = await al.leer('config:dueno', null);
  return guardado ? String(guardado) : '';
}

// Conecta Telegram solo: toma el token guardado, averigua tu chat y pone el webhook.
async function prepararTelegram(request, env, url) {
  if (!env.TELEGRAM_TOKEN) {
    return json({ ok: false, error: 'Falta el token de Telegram. Guárdalo como TELEGRAM_TOKEN.' }, 400);
  }
  const al = almacen(env);
  const token = env.TELEGRAM_TOKEN;
  const api = (metodo, consulta = '') => `https://api.telegram.org/bot${token}/${metodo}${consulta}`;

  let bot = '';
  let dueno = url.searchParams.get('chat') || '';

  try {
    const yo = await (await fetch(api('getMe'))).json();
    if (!yo.ok) {
      return json(
        {
          ok: false,
          error: yo.description || 'Telegram rechazó el token',
          largoDelToken: String(token).trim().length,
          pareceCompleto: /^\d{8,10}:[A-Za-z0-9_-]{30,}$/.test(String(token).trim())
        },
        400
      );
    }
    bot = yo.result?.username || '';

    if (!dueno) {
      const updates = await (await fetch(api('getUpdates', '?limit=20&timeout=0'))).json();
      const conChat = (updates.result || []).filter((u) => u.message?.chat?.id);
      if (conChat.length) {
        dueno = String(conChat[conChat.length - 1].message.chat.id);
      }
    }
    if (!dueno) {
      const ultimo = await al.leer('config:ultimo_chat', null);
      if (ultimo) dueno = String(ultimo);
    }
  } catch (e) {
    return json({ ok: false, error: 'No pude hablar con Telegram: ' + String(e.message || e) }, 502);
  }

  if (dueno) await al.escribir('config:dueno', dueno);

  const webhook = `${url.origin}/webhook/telegram`;
  const puesto = await (
    await fetch(api('setWebhook'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: webhook, drop_pending_updates: true, allowed_updates: ['message'] })
    })
  ).json();

  return json({
    ok: !!puesto.ok,
    bot,
    dueno: dueno || null,
    webhook,
    detalle: puesto.description || '',
    aviso: dueno
      ? 'Listo: el bot ya sabe quién eres. Escríbele /estado en Telegram.'
      : 'Abre el bot en Telegram, aprieta Empezar y vuelve a abrir esta misma dirección.'
  });
}

// Prueba la conexión con Outlook y devuelve el error exacto si algo falla.
async function probarCorreo(env) {
  if (!correoConfigurado(env)) {
    return json({ ok: false, error: correoFaltaQue(env) }, 400);
  }
  try {
    const mails = await correoListar(env, almacen(env), 1);
    return json({
      ok: true,
      usuario: env.CORREO_USUARIO,
      formaDeEntrar: env.CORREO_CLIENT_SECRET ? 'permiso de aplicación' : 'permiso delegado',
      ejemplo: mails[0] ? { de: mails[0].de, asunto: mails[0].asunto, fecha: mails[0].fecha } : null
    });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 502);
  }
}

// Prueba si el Worker puede abrir una conexión de correo (IMAP) hacia afuera.
// Sirve para saber si Hostinger u otro proveedor se puede leer desde la nube.
async function probarImap(url) {
  const pedido = url.searchParams.get('host');
  const servidores = pedido
    ? [{ host: pedido, puerto: Number(url.searchParams.get('port') || 993) }]
    : [
        { host: 'imap.titan.email', puerto: 993 },
        { host: 'smtp.titan.email', puerto: 465 },
        { host: 'imap.hostinger.com', puerto: 143 }
      ];
  const resultados = [];
  let connect;
  try {
    ({ connect } = await import('cloudflare:sockets'));
  } catch (e) {
    return json({ ok: false, error: 'Este entorno no permite sockets: ' + String(e.message || e) }, 501);
  }

  for (const s of servidores) {
    try {
      const socket = connect({ hostname: s.host, port: s.puerto }, { secureTransport: 'on' });
      await socket.opened;
      const lector = socket.readable.getReader();
      const saludo = await Promise.race([
        lector.read(),
        new Promise((ok) => setTimeout(() => ok({ value: null }), 8000))
      ]);
      const texto = saludo?.value ? new TextDecoder().decode(saludo.value) : '';
      resultados.push({ servidor: s.host, conecta: true, saludo: texto.trim().slice(0, 120) });
      try {
        lector.releaseLock();
        await socket.close();
      } catch (e) {
        // da igual si no cierra limpio en una prueba
      }
    } catch (e) {
      resultados.push({ servidor: s.host, conecta: false, error: String(e.message || e) });
    }
  }
  return json({ ok: resultados.some((r) => r.conecta), resultados });
}

async function webhookTelegram(request, env, url) {
  if (request.method === 'GET') return new Response('Bot activo', { status: 200 });
  if (env.TELEGRAM_SECRETO) {
    const recibido = request.headers.get('x-telegram-bot-api-secret-token');
    if (recibido !== env.TELEGRAM_SECRETO) return new Response('no', { status: 403 });
  }

  const update = await cuerpo(request);
  const entrante = telegramLeer(update);
  if (!entrante || !entrante.texto) return json({ ok: true, omitido: true });

  const alWebhook = almacen(env);
  const dueno = await chatDueno(env, alWebhook);
  const esDueno = Boolean(dueno) && String(entrante.chatId) === dueno;
  const comando = entrante.texto.trim().toLowerCase();

  let respuesta;
  let origen;

  if (esDueno) {
    try {
      respuesta = await atenderAsistente(env, { texto: entrante.texto, chatId: entrante.chatId });
    } catch (e) {
      respuesta = 'Tuve un problema: ' + String((e && e.message) || e);
    }
    origen = 'asistente';
  } else if (!dueno && (comando === '/id' || comando === '/start')) {
    respuesta =
      'Tu identificación de chat es: ' + entrante.chatId +
      '\n\nPásame ese número para dejarte como dueño y que empiece a avisarte de tus correos.';
    origen = 'bienvenida';
  } else {
    const r = await atenderMensaje(env, {
      canal: 'telegram',
      de: String(entrante.chatId),
      texto: entrante.texto,
      nombre: entrante.nombre
    });
    respuesta = r.texto;
    origen = 'cliente';
  }

  // Si todavía no hay dueño configurado, guarda el último chat que escribió
  // para poder dejarlo como dueño desde el panel.
  if (!dueno) {
    await alWebhook.escribir('config:ultimo_chat', String(entrante.chatId));
  }

  // Guarda lo último que llegó, para poder diagnosticar desde el panel.
  try {
    const recibidos = await alWebhook.leer('config:recibidos', []);
    recibidos.unshift({
      texto: String(entrante.texto).slice(0, 200),
      chatId: String(entrante.chatId),
      nombre: entrante.nombre,
      ts: new Date().toISOString(),
      origen
    });
    await alWebhook.escribir('config:recibidos', recibidos.slice(0, 15));
  } catch (e) {
    // si falla el registro, igual se responde
  }

  if (env.TELEGRAM_TOKEN) {
    try {
      await telegramEnviar(env.TELEGRAM_TOKEN, entrante.chatId, respuesta);
    } catch (e) {
      return json({ ok: true, respondido: false, origen, error: String(e.message || e) });
    }
  }
  return json({ ok: true, respondido: true, origen });
}

async function webhookWhatsapp(request, env, url) {
  if (request.method === 'GET') return whatsappVerificar(url, env);

  const cuerpoWa = await cuerpo(request);
  const mensajes = whatsappLeer(cuerpoWa);
  const resultados = [];

  for (const m of mensajes) {
    if (!m.texto) {
      resultados.push({ de: m.de, aviso: m.aviso || 'mensaje sin texto' });
      continue;
    }
    const r = await atenderMensaje(env, { canal: 'whatsapp', de: m.de, texto: m.texto, nombre: m.nombre });
    if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID) {
      try {
        await whatsappEnviar(env, m.de, r.texto);
        resultados.push({ de: m.de, respondido: true });
      } catch (e) {
        resultados.push({ de: m.de, respondido: false, error: String(e.message || e) });
      }
    } else {
      resultados.push({ de: m.de, respondido: false, aviso: 'WhatsApp sin conectar' });
    }
  }
  return json({ ok: true, mensajes: resultados.length, resultados });
}

async function apiChat(request, env) {
  const { mensaje, sesion } = await cuerpo(request);
  if (!mensaje || !String(mensaje).trim()) return json({ error: 'Falta el mensaje' }, 400);

  const r = await atenderMensaje(env, {
    canal: 'web',
    de: 'web:' + (sesion || 'anonimo'),
    texto: String(mensaje).slice(0, 1500),
    nombre: 'Visita web'
  });
  return json({ texto: r.texto, derivar: r.derivar, fuente: r.fuente });
}

async function manejar(request, env) {
  const url = new URL(request.url);
  const ruta = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, x-clave',
        'access-control-allow-methods': 'GET, POST, OPTIONS'
      }
    });
  }

  if (ruta === '/') return Response.redirect(new URL('/panel', url).toString(), 302);
  if (ruta === '/salud') return json({ ok: true, negocio: NEGOCIO.nombre, ia: !!env.IA_CLAVE, correo: correoConfigurado(env) });
  if (ruta === '/panel') return panel(request, env, url);
  if (ruta === '/chat') return html(chatHtml(NEGOCIO.nombre));

  if (ruta === '/api/chat' && request.method === 'POST') return apiChat(request, env);
  if (ruta === '/webhook/telegram') return webhookTelegram(request, env, url);
  if (ruta === '/webhook/whatsapp') return webhookWhatsapp(request, env, url);

  if (ruta.startsWith('/api/')) {
    if (!autorizado(request, env, url)) return json({ error: 'Clave incorrecta' }, 401);
    if (ruta === '/api/telegram/preparar') return prepararTelegram(request, env, url);
    if (ruta === '/api/correo/probar') return probarCorreo(env);
    if (ruta === '/api/prueba-imap') return probarImap(url);
    if (ruta === '/api/correo/trabajo') return json(await trabajo(env));
    if (ruta === '/api/correo/nuevos' && request.method === 'POST') return json(await recibirNuevos(env, await cuerpo(request)));
    if (ruta === '/api/correo/enviado' && request.method === 'POST') return json(await marcadoEnviado(env, await cuerpo(request)));
    if (ruta === '/api/correo/error' && request.method === 'POST') return json(await anotarError(env, await cuerpo(request)));
    if (ruta === '/api/telegram/recibidos') {
      const alRecibidos = almacen(env);
      return json({ recibidos: await alRecibidos.leer('config:recibidos', []) });
    }
    if (ruta === '/api/bandeja' && request.method === 'GET') return apiBandeja(request, env);
    if (ruta === '/api/bandeja/responder' && request.method === 'POST') {
      const { id, texto } = await cuerpo(request);
      const limpio = String(texto || '').trim();
      if (!limpio) return json({ error: 'Falta la respuesta' }, 400);
      const al = almacen(env);
      const lista = await al.leer('conversaciones', []);
      const c = lista.find((x) => x.id === id);
      if (!c) return json({ error: 'No encontré esa conversación' }, 404);

      let enviado = false;
      let aviso = '';
      try {
        if (c.canal === 'telegram' && env.TELEGRAM_TOKEN) {
          await telegramEnviar(env.TELEGRAM_TOKEN, c.de, limpio);
          enviado = true;
        } else if (c.canal === 'whatsapp' && env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID) {
          await whatsappEnviar(env, c.de, limpio);
          enviado = true;
        } else if (c.canal === 'web') {
          aviso = 'El chat de la web no recibe mensajes empujados: queda guardado en la conversación.';
        } else {
          aviso = 'Ese canal todavía no está conectado.';
        }
      } catch (e) {
        aviso = 'No se pudo enviar: ' + String(e.message || e);
      }

      c.mensajes.push({ rol: 'bot', texto: limpio, ts: new Date().toISOString(), manual: true });
      c.atendida = true;
      c.necesitaHumano = false;
      await al.escribir('conversaciones', lista);
      return json({ ok: true, enviado, guardado: true, canal: c.canal, aviso });
    }
    if (ruta === '/api/bandeja/resolver' && request.method === 'POST') {
      const { id } = await cuerpo(request);
      const al = almacen(env);
      const lista = await al.leer('conversaciones', []);
      const c = lista.find((x) => x.id === id);
      if (!c) return json({ error: 'No encontré esa conversación' }, 404);
      c.atendida = true;
      await al.escribir('conversaciones', lista);
      return json({ ok: true });
    }
    if (ruta === '/api/propuestas') return apiPropuestas(request, env);
    if (ruta === '/api/propuestas/estado' && request.method === 'POST') return apiEstado(request, env);
    if (ruta === '/api/propuestas/publicar' && request.method === 'POST') return apiPublicar(request, env);
    return json({ error: 'Ruta no encontrada' }, 404);
  }

  return json({ error: 'Ruta no encontrada' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await manejar(request, env || {});
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },

  // Tarea programada: cada 2 minutos. Avisa de correos nuevos y de clientes esperando.
  async scheduled(event, env, ctx) {
    const alTarea = almacen(env);

    // Interruptor general: /avisos off silencia todos los avisos al dueño.
    if ((await alTarea.leer('avisos:todo', 'on')) === 'off') return;

    try {
      await avisarCorreoNuevo(env);
    } catch (e) {
      // si el correo falla, igual se revisan los clientes
    }

    if (!env.TELEGRAM_TOKEN) return;
    const al = alTarea;
    const duenoAviso = await chatDueno(env, al);
    if (!duenoAviso) return;
    const todas = await al.leer('conversaciones', []);
    const pendientes = todas.filter((c) => c.necesitaHumano && !c.atendida);
    if (!pendientes.length) return;

    // El mismo aviso no se repite cada 2 minutos: solo si cambió la lista de
    // conversaciones pendientes o si pasaron 6 horas desde el último recordatorio.
    const firma = pendientes
      .map((c) => `${c.id}:${(c.mensajes || []).length}`)
      .sort()
      .join('|');
    const previo = await al.leer('avisos:pendientes', null);
    const ahora = Date.now();
    if (previo && previo.firma === firma && ahora - Number(previo.cuando) < 6 * 3600 * 1000) return;
    await al.escribir('avisos:pendientes', { firma, cuando: ahora });

    const lineas = pendientes
      .slice(0, 8)
      .map((c) => `• ${c.nombre} (${c.canal}): ${c.mensajes[c.mensajes.length - 2]?.texto?.slice(0, 90) || ''}`)
      .join('\n');
    await telegramEnviar(
      env.TELEGRAM_TOKEN,
      duenoAviso,
      `Tienes ${pendientes.length} cliente(s) esperando respuesta:\n${lineas}`
    );
  }
};

export { manejar };
