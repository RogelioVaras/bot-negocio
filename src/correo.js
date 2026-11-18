// Conexión con el correo de Outlook / Microsoft 365 usando Microsoft Graph.
//
// Dos formas de entrar, según lo que te permita tu empresa:
//   A) Permiso de aplicación (CORREO_CLIENT_SECRET): lo configura el administrador
//      de TI una vez y no vuelve a pedir nada.
//   B) Permiso delegado (CORREO_REFRESH): tú inicias sesión una vez, el bot guarda
//      el permiso y se renueva solo.
//
// Siempre se usa /users/{CORREO_USUARIO}, que funciona en los dos casos.

export function configurado(env) {
  if (!env || !env.CORREO_USUARIO || !env.CORREO_CLIENT_ID) return false;
  return Boolean(env.CORREO_CLIENT_SECRET || env.CORREO_REFRESH);
}

export function faltaQue(env) {
  if (!env || !env.CORREO_USUARIO) return 'falta CORREO_USUARIO (tu dirección de correo)';
  if (!env.CORREO_CLIENT_ID) return 'falta CORREO_CLIENT_ID (de la aplicación en Azure)';
  if (!env.CORREO_CLIENT_SECRET && !env.CORREO_REFRESH) return 'falta CORREO_CLIENT_SECRET o CORREO_REFRESH';
  return 'todo configurado';
}

function tenant(env) {
  return env.CORREO_TENANT || 'organizations';
}

async function pedirToken(env, cuerpo) {
  const resp = await fetch(`https://login.microsoftonline.com/${tenant(env)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(cuerpo).toString()
  });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(datos.error_description || datos.error || 'Microsoft rechazó el acceso');
  }
  return datos;
}

// Entrega un token vigente. Lo guarda en memoria mientras dure para no pedirlo en cada llamada.
export async function token(env, al) {
  if (!globalThis.__tokenCorreo) globalThis.__tokenCorreo = {};
  const guardado = globalThis.__tokenCorreo[env.CORREO_USUARIO || 'x'];
  if (guardado && guardado.expira > Date.now() + 60000) return guardado.valor;

  let datos;
  if (env.CORREO_CLIENT_SECRET) {
    datos = await pedirToken(env, {
      grant_type: 'client_credentials',
      client_id: env.CORREO_CLIENT_ID,
      client_secret: env.CORREO_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default'
    });
  } else {
    const refresh = (al && (await al.leer('correo:refresh'))) || env.CORREO_REFRESH;
    if (!refresh) throw new Error('No hay permiso guardado de Outlook. Vuelve a iniciar sesión.');
    datos = await pedirToken(env, {
      grant_type: 'refresh_token',
      client_id: env.CORREO_CLIENT_ID,
      refresh_token: refresh,
      scope: 'offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send'
    });
    // Microsoft entrega un permiso nuevo en cada renovación: hay que guardarlo.
    if (datos.refresh_token && al) await al.escribir('correo:refresh', datos.refresh_token);
  }

  const expira = Date.now() + (Number(datos.expires_in || 3600) - 120) * 1000;
  globalThis.__tokenCorreo[env.CORREO_USUARIO || 'x'] = { valor: datos.access_token, expira };
  return datos.access_token;
}

async function consultar(env, al, ruta, opciones = {}) {
  const t = await token(env, al);
  const url = ruta.startsWith('http') ? ruta : `https://graph.microsoft.com/v1.0${ruta}`;
  const resp = await fetch(url, {
    ...opciones,
    headers: {
      authorization: `Bearer ${t}`,
      'content-type': 'application/json',
      ...(opciones.headers || {})
    }
  });
  const texto = await resp.text();
  let datos = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = { crudo: texto };
  }
  if (!resp.ok) throw new Error(datos?.error?.message || `Microsoft respondió ${resp.status}`);
  return datos;
}

const CAMPOS = 'id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments';

function correo(usuario) {
  return `/users/${encodeURIComponent(usuario)}`;
}

export async function listar(env, al, cantidad = 8) {
  const datos = await consultar(
    env,
    al,
    `${correo(env.CORREO_USUARIO)}/mailFolders/inbox/messages?$top=${cantidad}&$select=${CAMPOS}&$orderby=receivedDateTime desc`
  );
  return (datos?.value || []).map((m) => ({
    id: m.id,
    de: m.from?.emailAddress?.address || '',
    nombre: m.from?.emailAddress?.name || '',
    asunto: m.subject || '(sin asunto)',
    fecha: m.receivedDateTime,
    resumen: m.bodyPreview || '',
    adjuntos: !!m.hasAttachments
  }));
}

export async function leerMensaje(env, al, id) {
  const datos = await consultar(
    env,
    al,
    `${correo(env.CORREO_USUARIO)}/messages/${encodeURIComponent(id)}?$select=id,subject,from,toRecipients,receivedDateTime,body`
  );
  return {
    id: datos.id,
    de: datos.from?.emailAddress?.address || '',
    nombre: datos.from?.emailAddress?.name || '',
    para: (datos.toRecipients || []).map((r) => r.emailAddress?.address).join(', '),
    asunto: datos.subject || '(sin asunto)',
    fecha: datos.receivedDateTime,
    cuerpo: limpiarHtml(datos.body?.content || '')
  };
}

export async function responder(env, al, id, texto) {
  await consultar(env, al, `${correo(env.CORREO_USUARIO)}/messages/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ comment: texto })
  });
  return true;
}

export async function enviar(env, al, { para, asunto, texto }) {
  await consultar(env, al, `${correo(env.CORREO_USUARIO)}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject: asunto || '(sin asunto)',
        body: { contentType: 'Text', content: texto },
        toRecipients: String(para)
          .split(/[,;]/)
          .map((d) => d.trim())
          .filter(Boolean)
          .map((d) => ({ emailAddress: { address: d } }))
      },
      saveToSentItems: true
    })
  });
  return true;
}

// Correos nuevos desde la última revisión. La primera vez solo toma la marca
// de posición, para no inundar de correos antiguos.
export async function nuevos(env, al) {
  const usuario = correo(env.CORREO_USUARIO);
  const guardado = await al.leer('correo:delta', null);

  if (!guardado) {
    const datos = await consultar(
      env,
      al,
      `${usuario}/mailFolders/inbox/messages/delta?$top=5&$select=${CAMPOS}`
    );
    if (datos?.['@odata.deltaLink']) await al.escribir('correo:delta', datos['@odata.deltaLink']);
    return { primera: true, nuevos: [] };
  }

  let url = guardado;
  const encontrados = [];
  let deltaFinal = null;

  for (let vueltas = 0; vueltas < 5; vueltas++) {
    const datos = await consultar(env, al, url);
    for (const m of datos?.value || []) {
      if (m['@removed']) continue;
      if (!m.receivedDateTime) continue;
      encontrados.push({
        id: m.id,
        de: m.from?.emailAddress?.address || '',
        nombre: m.from?.emailAddress?.name || '',
        asunto: m.subject || '(sin asunto)',
        fecha: m.receivedDateTime,
        resumen: m.bodyPreview || '',
        adjuntos: !!m.hasAttachments
      });
    }
    if (datos?.['@odata.nextLink']) {
      url = datos['@odata.nextLink'];
    } else {
      deltaFinal = datos?.['@odata.deltaLink'] || guardado;
      break;
    }
  }

  if (deltaFinal) await al.escribir('correo:delta', deltaFinal);
  encontrados.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return { primera: false, nuevos: encontrados };
}

export function limpiarHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
