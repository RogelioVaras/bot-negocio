// Formato de correos para los mensajes de Telegram.

export function fecha(valor) {
  try {
    return new Date(valor).toLocaleString('es-CL', {
      timeZone: 'America/Santiago',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return String(valor || '');
  }
}

export function recortar(texto, max) {
  const limpio = String(texto || '').trim();
  return limpio.length > max ? limpio.slice(0, max) + '…' : limpio;
}

export function listaNumerada(correos) {
  return (correos || [])
    .map(
      (c, i) =>
        `${i + 1}. ${c.nombre || c.de}\n   ${recortar(c.asunto, 70)}\n   ${fecha(c.fecha)}${c.adjuntos ? ' · con adjunto' : ''}`
    )
    .join('\n\n');
}

export function resumenNuevos(nuevos) {
  const mostrados = (nuevos || []).slice(0, 5);
  return [
    `${nuevos.length} correo(s) nuevo(s):`,
    '',
    listaNumerada(mostrados),
    '',
    nuevos.length > mostrados.length
      ? `Hay ${nuevos.length - mostrados.length} más. Escribe /correos.`
      : 'Escribe /ver 1 para leer el primero.'
  ].join('\n');
}
