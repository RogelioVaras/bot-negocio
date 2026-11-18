// El "cerebro": decide qué contestar a un cliente.
// Orden: 1) ¿pide hablar con persona o hay un tema delicado? -> deriva a humano
//        2) ¿calza con una pregunta frecuente del config? -> responde esa
//        3) ¿hay clave de IA configurada? -> redacta con IA
//        4) si nada resulta -> respuesta de respaldo y queda en la bandeja

export function normalizar(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function incluyeAlguna(texto, lista) {
  return (lista || []).some((c) => texto.includes(normalizar(c)));
}

function contextoNegocio(config) {
  const servicios = config.servicios
    .map((s) => `- ${s.nombre}: ${s.detalle}`)
    .join('\n');
  return `Eres el asistente de ${config.nombre}, empresa chilena.
Descripción: ${config.descripcionCorta}
Horario: ${config.horario}
Tono: ${config.tono}
Servicios disponibles:
${servicios}

Reglas:
- Responde en máximo 4 frases, en español de Chile, amable y concreto.
- Nunca inventes precios ni plazos legales; si te los piden, pide los datos del caso.
- No prometas resultados tributarios.
- Si el cliente está enojado, pide disculpas y avisa que un contador lo contactará.`;
}

export function iaDisponible(env) {
  return Boolean(env && env.IA_CLAVE);
}

// Llamada genérica al modelo. La usan tanto las respuestas a clientes
// como el asistente personal y los borradores de correo.
export async function conversarIA(mensajes, env, sistema) {
  const lista = sistema ? [{ role: 'system', content: sistema }, ...mensajes] : mensajes;
  const url = (env && env.IA_URL) || 'https://api.deepseek.com/chat/completions';
  const modelo = (env && env.IA_MODELO) || 'deepseek-chat';

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.IA_CLAVE}`
    },
    body: JSON.stringify({ model: modelo, messages: lista, temperature: 0.5, max_tokens: 600 })
  });
  if (!resp.ok) throw new Error('IA respondió ' + resp.status);
  const datos = await resp.json();
  const salida = datos?.choices?.[0]?.message?.content;
  if (!salida) throw new Error('IA sin contenido');
  return salida.trim();
}

async function responderConIA(texto, historial, env, config) {
  const mensajes = [
    ...(historial || []).slice(-6).map((m) => ({
      role: m.rol === 'cliente' ? 'user' : 'assistant',
      content: m.texto
    })),
    { role: 'user', content: texto }
  ];
  return conversarIA(mensajes, env, contextoNegocio(config));
}

export async function responder(texto, opciones = {}, env = {}, config) {
  const cfg = config;
  const limpio = String(texto || '').slice(0, 1500);
  const n = normalizar(limpio);

  if (!n) {
    return { texto: 'No alcancé a leer tu mensaje, ¿me lo escribes de nuevo?', derivar: false, fuente: 'vacio' };
  }

  if (incluyeAlguna(n, cfg.derivarSi)) {
    return { texto: cfg.respaldo, derivar: true, fuente: 'derivacion' };
  }

  for (const p of cfg.preguntas) {
    if (incluyeAlguna(n, p.claves)) {
      return { texto: p.respuesta, derivar: false, fuente: 'faq', tema: p.claves[0] };
    }
  }

  if (env.IA_CLAVE) {
    try {
      const salida = await responderConIA(limpio, opciones.historial, env, cfg);
      return { texto: salida, derivar: false, fuente: 'ia' };
    } catch (e) {
      return { texto: cfg.respaldo, derivar: true, fuente: 'respaldo', error: String(e.message || e) };
    }
  }

  return { texto: cfg.respaldo, derivar: true, fuente: 'respaldo' };
}
