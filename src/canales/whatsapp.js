// Canal WhatsApp Cloud API (el oficial de Meta).
// Requiere: cuenta en Meta for Developers, número verificado y WHATSAPP_TOKEN.

// Meta llama con hub.mode / hub.verify_token / hub.challenge al guardar el webhook.
export function verificar(url, env) {
  const modo = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const reto = url.searchParams.get('hub.challenge');
  if (modo === 'subscribe' && token && token === env.WHATSAPP_VERIFY) {
    return new Response(reto || 'ok', { status: 200 });
  }
  return new Response('No autorizado', { status: 403 });
}

export function leerMensajes(cuerpo) {
  const salida = [];
  const eventos = cuerpo?.entry || [];
  for (const entrada of eventos) {
    for (const cambio of entrada.changes || []) {
      const valor = cambio.value || {};
      for (const m of valor.messages || []) {
        if (m.type !== 'text') {
          salida.push({
            de: m.from,
            texto: '',
            nombre: valor.contacts?.[0]?.profile?.name || m.from,
            canal: 'whatsapp',
            aviso: `Mensaje de tipo ${m.type}: responder a mano`
          });
          continue;
        }
        salida.push({
          de: m.from,
          texto: m.text?.body || '',
          nombre: valor.contacts?.[0]?.profile?.name || m.from,
          canal: 'whatsapp',
          telefonoId: valor.metadata?.phone_number_id
        });
      }
    }
  }
  return salida;
}

export async function enviarMensaje(env, para, texto) {
  const version = env.META_VERSION || 'v21.0';
  const telefonoId = env.WHATSAPP_PHONE_ID;
  const resp = await fetch(`https://graph.facebook.com/${version}/${telefonoId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: para,
      type: 'text',
      text: { body: texto.slice(0, 4000) }
    })
  });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok || datos.error) throw new Error(datos?.error?.message || 'WhatsApp rechazó el mensaje');
  return datos;
}
