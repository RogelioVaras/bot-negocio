// Publicidad: el bot PROPONE textos, tú apruebas en el panel y recién ahí se publica.
// Nada sale a la calle sin que lo apruebes.

const ESTILOS = [
  {
    estilo: 'Directo',
    armar: (idea, cfg) =>
      `${idea}.\n\nEn ${cfg.nombre} lo resolvemos por ti: ${cfg.descripcionCorta}\n\nEscríbenos y te respondemos el mismo día.`
  },
  {
    estilo: 'Beneficio',
    armar: (idea, cfg) =>
      `${idea}: lo que más le quita tiempo a una pyme.\n\nDeja que ${cfg.nombre} se encargue, con un contador revisando cada número. Tú te dedicas a vender.\n\n¿Conversamos?`
  },
  {
    estilo: 'Pregunta',
    armar: (idea, cfg) =>
      `¿Tienes claro cómo te afecta esto: ${idea.toLowerCase()}?\n\nEn ${cfg.nombre} revisamos tu caso y te lo explicamos sin tecnicismos. ${cfg.horario}`
  }
];

export async function generarPropuestas(idea, config, env = {}) {
  const limpia = String(idea || '').trim() || 'Servicios contables para pymes';
  const propuestas = [];

  if (env.IA_CLAVE) {
    try {
      const salida = await proponerConIA(limpia, config, env);
      if (Array.isArray(salida) && salida.length) return salida;
    } catch (e) {
      // si la IA falla seguimos con las plantillas, nunca se cae el bot
    }
  }

  for (const plantilla of ESTILOS) {
    propuestas.push({
      red: 'Instagram y Facebook',
      estilo: plantilla.estilo,
      idea: limpia,
      texto: plantilla.armar(limpia, config),
      hashtags: config.hashtags.join(' ')
    });
  }
  return propuestas;
}

async function proponerConIA(idea, config, env) {
  const url = env.IA_URL || 'https://api.deepseek.com/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.IA_CLAVE}`
    },
    body: JSON.stringify({
      model: env.IA_MODELO || 'deepseek-chat',
      temperature: 0.8,
      messages: [
        {
          role: 'system',
          content: `Eres el community manager de ${config.nombre} (${config.descripcionCorta}) en Chile.
Escribe publicaciones breves para Instagram y Facebook. Español de Chile, sin emojis excesivos, sin promesas tributarias falsas.
Responde SOLO un JSON válido con esta forma exacta:
[{"red":"Instagram y Facebook","estilo":"...","texto":"...","hashtags":"#uno #dos"}]`
        },
        { role: 'user', content: `Tema de la publicación: ${idea}` }
      ]
    })
  });
  if (!resp.ok) throw new Error('IA respondió ' + resp.status);
  const datos = await resp.json();
  const bruto = datos?.choices?.[0]?.message?.content || '';
  const limpio = bruto.replace(/```json|```/g, '').trim();
  const lista = JSON.parse(limpio);
  return lista
    .filter((p) => p && p.texto)
    .map((p) => ({
      red: p.red || 'Instagram y Facebook',
      estilo: p.estilo || 'IA',
      idea,
      texto: String(p.texto).slice(0, 1800),
      hashtags: p.hashtags || config.hashtags.join(' ')
    }));
}

// Publicación real: necesita el token de Meta y el id de la página.
// Sin eso devuelve requiere_conexion y el panel lo muestra claro.
export async function publicarEnRedes(propuesta, env = {}) {
  if (!env.META_TOKEN || !env.FACEBOOK_PAGE_ID) {
    return {
      ok: false,
      motivo: 'requiere_conexion',
      detalle:
        'Falta conectar Facebook e Instagram (token de Meta y id de página). Hasta entonces la publicación queda aprobada y guardada, lista para salir.'
    };
  }

  const mensaje = propuesta.hashtags ? `${propuesta.texto}\n\n${propuesta.hashtags}` : propuesta.texto;
  const version = env.META_VERSION || 'v21.0';
  const resultado = { ok: true, redes: [] };

  // Facebook: página
  try {
    const resp = await fetch(`https://graph.facebook.com/${version}/${env.FACEBOOK_PAGE_ID}/feed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: mensaje, access_token: env.META_TOKEN })
    });
    const datos = await resp.json();
    if (!resp.ok || datos.error) throw new Error(datos?.error?.message || 'Error de Facebook');
    resultado.redes.push({ red: 'Facebook', id: datos.id });
  } catch (e) {
    resultado.ok = false;
    resultado.redes.push({ red: 'Facebook', error: String(e.message || e) });
  }

  // Instagram: exige una imagen pública ya subida
  if (env.INSTAGRAM_ID && env.IMAGEN_URL) {
    try {
      const crear = await fetch(`https://graph.facebook.com/${version}/${env.INSTAGRAM_ID}/media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_url: env.IMAGEN_URL, caption: mensaje, access_token: env.META_TOKEN })
      });
      const cont = await crear.json();
      if (!crear.ok || cont.error) throw new Error(cont?.error?.message || 'Error de Instagram');

      const publicar = await fetch(`https://graph.facebook.com/${version}/${env.INSTAGRAM_ID}/media_publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creation_id: cont.id, access_token: env.META_TOKEN })
      });
      const pub = await publicar.json();
      if (!publicar.ok || pub.error) throw new Error(pub?.error?.message || 'Error al publicar en Instagram');
      resultado.redes.push({ red: 'Instagram', id: pub.id });
    } catch (e) {
      resultado.ok = false;
      resultado.redes.push({ red: 'Instagram', error: String(e.message || e) });
    }
  } else if (env.INSTAGRAM_ID) {
    resultado.redes.push({ red: 'Instagram', omitido: 'falta IMAGEN_URL (Instagram exige imagen)' });
  }

  return resultado;
}
