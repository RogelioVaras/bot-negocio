// Canal Telegram: el más rápido de conectar (5 minutos, gratis y sin trámites).

export function leerMensaje(update) {
  const m = update?.message || update?.edited_message || update?.callback_query?.message;
  if (!m || !m.chat) return null;
  return {
    chatId: m.chat.id,
    texto: m.text || '',
    nombre: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.chat.username || 'cliente',
    canal: 'telegram'
  };
}

export async function enviarMensaje(token, chatId, texto) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto, disable_web_page_preview: true })
  });
  const datos = await resp.json().catch(() => ({}));
  if (!resp.ok || datos.ok === false) {
    throw new Error(datos?.description || 'Telegram rechazó el mensaje');
  }
  return datos;
}
