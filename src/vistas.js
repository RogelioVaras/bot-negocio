// Pantallas del bot: el panel de aprobación y el chat web.
// Se generan como texto para que el Worker no dependa de archivos.

export function panelHtml(nombreNegocio) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panel del bot — ${nombreNegocio}</title>
<style>
  :root { --tinta:#16202b; --gris:#5b6b7c; --linea:#e3e8ee; --fondo:#f6f8fa; --azul:#1559c7; --verde:#137a4b; --rojo:#b52a2a; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; background:var(--fondo); color:var(--tinta); }
  header { background:#fff; border-bottom:1px solid var(--linea); padding:14px 22px; display:flex; align-items:center; gap:14px; flex-wrap:wrap; position:sticky; top:0; z-index:5; }
  header h1 { font-size:16px; margin:0; font-weight:650; }
  header .punto { width:8px; height:8px; border-radius:50%; background:var(--verde); display:inline-block; }
  header .estado { font-size:12px; color:var(--gris); }
  nav { display:flex; gap:6px; padding:14px 22px 0; }
  nav button { border:1px solid var(--linea); background:#fff; padding:9px 16px; border-radius:9px 9px 0 0; font-size:14px; cursor:pointer; color:var(--gris); }
  nav button.activo { background:#fff; color:var(--tinta); font-weight:650; border-bottom-color:#fff; }
  main { padding:0 22px 60px; max-width:1080px; }
  section { display:none; background:#fff; border:1px solid var(--linea); border-radius:0 12px 12px 12px; padding:20px; }
  section.visible { display:block; }
  h2 { font-size:15px; margin:0 0 14px; }
  .vacio { color:var(--gris); font-size:14px; padding:22px 0; text-align:center; }
  .tarjeta { border:1px solid var(--linea); border-radius:10px; padding:14px; margin-bottom:12px; }
  .fila { display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap; }
  .quien { font-weight:640; font-size:14px; }
  .canal { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#fff; background:var(--gris); padding:3px 8px; border-radius:20px; }
  .canal.telegram { background:#2a9fd6; } .canal.whatsapp { background:#1faa59; } .canal.web { background:#7a5cd6; }
  .hora { font-size:12px; color:var(--gris); }
  .mensajes { margin:12px 0; display:flex; flex-direction:column; gap:8px; max-height:280px; overflow:auto; }
  .msg { max-width:78%; padding:9px 12px; border-radius:12px; font-size:13.5px; line-height:1.45; white-space:pre-wrap; }
  .msg.cliente { align-self:flex-start; background:#eef1f5; }
  .msg.bot { align-self:flex-end; background:#e6effc; }
  button.accion { border:1px solid var(--linea); background:#fff; padding:7px 13px; border-radius:8px; font-size:13px; cursor:pointer; }
  button.accion:hover { background:#f2f5f8; }
  button.primario { background:var(--azul); border-color:var(--azul); color:#fff; }
  button.primario:hover { filter:brightness(1.08); background:var(--azul); }
  button.bien { color:#fff; background:var(--verde); border-color:var(--verde); }
  button.mal { color:var(--rojo); border-color:#e9c4c4; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  textarea, input[type=text] { width:100%; border:1px solid var(--linea); border-radius:9px; padding:11px; font:inherit; font-size:14px; resize:vertical; }
  .badge { font-size:11px; padding:3px 9px; border-radius:20px; background:#fff3cd; color:#7a5a00; }
  .badge.aprobada { background:#dcf3e6; color:#137a4b; } .badge.publicada { background:#dbe7fb; color:#1559c7; } .badge.rechazada { background:#f7dfdf; color:#b52a2a; }
  .aviso { font-size:12.5px; color:var(--gris); background:var(--fondo); border-radius:8px; padding:10px; margin-top:10px; line-height:1.5; }
  .probar { display:flex; gap:8px; margin-bottom:14px; }
  footer { font-size:12px; color:var(--gris); padding:0 22px 30px; }
</style>
</head>
<body>
<header>
  <span class="punto"></span>
  <h1>Panel del bot — ${nombreNegocio}</h1>
  <span class="estado" id="estado">cargando…</span>
</header>

<nav>
  <button class="activo" data-tab="conv">Conversaciones</button>
  <button data-tab="pub">Publicaciones</button>
  <button data-tab="prueba">Probar respuestas</button>
</nav>

<main>
  <section id="conv" class="visible">
    <h2>Clientes que necesitan que respondas tú</h2>
    <div id="listaConv"><div class="vacio">Cargando…</div></div>
  </section>

  <section id="pub">
    <h2>Proponer una publicación</h2>
    <textarea id="idea" rows="2" placeholder="Ejemplo: recordar el vencimiento del F29 de este mes"></textarea>
    <div class="fila" style="margin-top:10px">
      <span class="aviso" style="margin:0">El bot escribe las propuestas. Nada se publica hasta que tú aprietes Aprobar y después Publicar.</span>
      <button class="accion primario" id="generar">Generar propuestas</button>
    </div>
    <div id="listaPub" style="margin-top:18px"></div>
  </section>

  <section id="prueba">
    <h2>Escríbele al bot como si fueras un cliente</h2>
    <div class="probar">
      <input type="text" id="mensajePrueba" placeholder="Escribe una consulta, por ejemplo: ¿cuánto cobran por contabilidad?">
      <button class="accion primario" id="enviarPrueba">Enviar</button>
    </div>
    <div class="mensajes" id="chatPrueba" style="max-height:340px"></div>
  </section>
</main>
<footer>Los cambios de texto del negocio se hacen en el archivo src/negocio.js. La clave del panel se cambia en wrangler.toml.</footer>

<script>
  const clave = new URLSearchParams(location.search).get('clave') || '';
  const pedir = async (ruta, opciones = {}) => {
    const resp = await fetch(ruta, {
      ...opciones,
      headers: { 'content-type': 'application/json', 'x-clave': clave, ...(opciones.headers || {}) }
    });
    const datos = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(datos.error || ('Error ' + resp.status));
    return datos;
  };

  document.querySelectorAll('nav button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('nav button').forEach((x) => x.classList.remove('activo'));
      document.querySelectorAll('section').forEach((x) => x.classList.remove('visible'));
      b.classList.add('activo');
      document.getElementById(b.dataset.tab).classList.add('visible');
      if (b.dataset.tab === 'conv') cargarConversaciones();
      if (b.dataset.tab === 'pub') cargarPropuestas();
    };
  });

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fecha = (iso) => new Date(iso).toLocaleString('es-CL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });

  async function cargarConversaciones() {
    const caja = document.getElementById('listaConv');
    try {
      const { conversaciones = [], resumen } = await pedir('/api/bandeja');
      document.getElementById('estado').textContent =
        (resumen?.pendientes || 0) + ' sin responder · ' + (resumen?.chats || 0) + ' conversaciones en total';
      if (!conversaciones.length) { caja.innerHTML = '<div class="vacio">Ningún cliente esperando respuesta. Cuando alguien pida hablar con una persona, aparecerá aquí.</div>'; return; }
      caja.innerHTML = conversaciones.map((c) => \`
        <div class="tarjeta">
          <div class="fila">
            <div><span class="quien">\${esc(c.nombre)}</span>
              <span class="canal \${esc(c.canal)}">\${esc(c.canal)}</span></div>
            <span class="hora">\${fecha(c.ultima)}</span>
          </div>
          <div class="mensajes">
            \${c.mensajes.slice(-8).map((m) => \`<div class="msg \${m.rol === 'cliente' ? 'cliente' : 'bot'}">\${esc(m.texto)}</div>\`).join('')}
          </div>
          <textarea rows="2" id="resp-\${c.id}" placeholder="Escribe tu respuesta al cliente..."></textarea>
          <div class="fila" style="margin-top:8px">
            <span class="hora">\${c.canal === 'web' ? 'Chat de la web: la respuesta queda guardada' : 'Se envía por ' + esc(c.canal)}</span>
            <div>
              <button class="accion" onclick="resolver('\${c.id}')">Marcar atendida</button>
              <button class="accion primario" onclick="enviarManual('\${c.id}')">Enviar respuesta</button>
            </div>
          </div>
        </div>\`).join('');
    } catch (e) { caja.innerHTML = '<div class="vacio">' + esc(e.message) + '</div>'; }
  }

  window.resolver = async (id) => {
    await pedir('/api/bandeja/resolver', { method: 'POST', body: JSON.stringify({ id }) });
    cargarConversaciones();
  };

  window.enviarManual = async (id) => {
    const caja = document.getElementById('resp-' + id);
    const texto = caja ? caja.value.trim() : '';
    if (!texto) { alert('Escribe primero la respuesta.'); return; }
    const r = await pedir('/api/bandeja/responder', { method: 'POST', body: JSON.stringify({ id, texto }) });
    if (r.enviado) alert('Respuesta enviada al cliente.');
    else if (r.canal === 'web') alert('Respuesta guardada en la conversación. ' + (r.aviso || ''));
    else {
      navigator.clipboard?.writeText(texto);
      alert((r.aviso || 'Ese canal no está conectado.') + '\n\nTu respuesta quedó copiada: pégala en ' + (r.canal || 'la conversación') + '.');
    }
    cargarConversaciones();
  };

  async function cargarPropuestas() {
    const caja = document.getElementById('listaPub');
    const { propuestas = [] } = await pedir('/api/propuestas');
    if (!propuestas.length) { caja.innerHTML = '<div class="vacio">Todavía no hay propuestas. Escribe una idea arriba y aprieta Generar propuestas.</div>'; return; }
    caja.innerHTML = propuestas.map((p) => \`
      <div class="tarjeta">
        <div class="fila">
          <div><strong style="font-size:13.5px">\${esc(p.estilo)}</strong>
            <span class="hora"> · \${esc(p.red)}</span></div>
          <span class="badge \${esc(p.estado)}">\${esc(p.estado)}</span>
        </div>
        <textarea rows="5" style="margin-top:10px" id="txt-\${p.id}" \${p.estado === 'pendiente' ? '' : 'disabled'}>\${esc(p.texto)}</textarea>
        <div class="aviso">\${esc(p.hashtags || '')}</div>
        <div class="fila" style="margin-top:10px">
          \${p.estado === 'pendiente'
            ? \`<button class="accion mal" onclick="cambiarEstado('\${p.id}','rechazar')">Rechazar</button>
               <button class="accion bien" onclick="cambiarEstado('\${p.id}','aprobar')">Aprobar</button>\`
            : p.estado === 'aprobada'
            ? \`<button class="accion primario" onclick="publicar('\${p.id}')">Publicar ahora</button>\`
            : \`<span class="hora">\${p.estado === 'publicada' ? 'Publicada en ' + esc((p.redes || []).map(r => r.red).join(', ') || 'redes') : 'Rechazada'}</span>\`}
        </div>
      </div>\`).join('');
  }

  window.cambiarEstado = async (id, accion) => {
    const caja = document.getElementById('txt-' + id);
    await pedir('/api/propuestas/estado', { method: 'POST', body: JSON.stringify({ id, accion, texto: caja ? caja.value : undefined }) });
    cargarPropuestas();
  };

  window.publicar = async (id) => {
    try {
      const r = await pedir('/api/propuestas/publicar', { method: 'POST', body: JSON.stringify({ id }) });
      alert(r.ok ? 'Publicado correctamente.' : (r.detalle || 'No se pudo publicar.'));
    } catch (e) { alert('No se pudo publicar: ' + e.message); }
    cargarPropuestas();
  };

  document.getElementById('generar').onclick = async () => {
    const idea = document.getElementById('idea').value.trim();
    if (!idea) { alert('Escribe primero la idea de la publicación.'); return; }
    const boton = document.getElementById('generar');
    boton.disabled = true; boton.textContent = 'Escribiendo…';
    try {
      await pedir('/api/propuestas', { method: 'POST', body: JSON.stringify({ idea }) });
      cargarPropuestas();
    } catch (e) { alert(e.message); }
    boton.disabled = false; boton.textContent = 'Generar propuestas';
  };

  document.getElementById('enviarPrueba').onclick = async () => {
    const entrada = document.getElementById('mensajePrueba');
    const texto = entrada.value.trim();
    if (!texto) return;
    const caja = document.getElementById('chatPrueba');
    caja.insertAdjacentHTML('beforeend', '<div class="msg cliente">' + esc(texto) + '</div>');
    entrada.value = '';
    const resp = await pedir('/api/chat', { method: 'POST', body: JSON.stringify({ mensaje: texto, sesion: 'prueba-panel' }) });
    caja.insertAdjacentHTML('beforeend', '<div class="msg bot">' + esc(resp.texto) + '</div>');
    caja.scrollTop = caja.scrollHeight;
  };
  document.getElementById('mensajePrueba').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('enviarPrueba').click(); });

  cargarConversaciones();
</script>
</body>
</html>`;
}

export function chatHtml(nombreNegocio) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Habla con ${nombreNegocio}</title>
<style>
  body { margin:0; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; background:#f6f8fa; display:flex; justify-content:center; padding:30px 14px; }
  .chat { width:100%; max-width:420px; background:#fff; border:1px solid #e3e8ee; border-radius:14px; overflow:hidden; display:flex; flex-direction:column; height:560px; }
  .cab { background:#1559c7; color:#fff; padding:14px 16px; font-weight:600; font-size:14px; }
  .cab small { display:block; font-weight:400; opacity:.85; font-size:12px; margin-top:2px; }
  .hilo { flex:1; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:8px; }
  .m { max-width:80%; padding:9px 12px; border-radius:12px; font-size:13.5px; line-height:1.45; white-space:pre-wrap; }
  .m.bot { background:#e6effc; align-self:flex-start; }
  .m.yo { background:#1559c7; color:#fff; align-self:flex-end; }
  .pie { display:flex; border-top:1px solid #e3e8ee; }
  .pie input { flex:1; border:0; padding:14px; font:inherit; font-size:14px; outline:none; }
  .pie button { border:0; background:#1559c7; color:#fff; padding:0 20px; font-size:14px; cursor:pointer; }
</style>
</head>
<body>
<div class="chat">
  <div class="cab">${nombreNegocio}<small>Respondemos al instante</small></div>
  <div class="hilo" id="hilo"><div class="m bot">Hola, ¿en qué te puedo ayudar?</div></div>
  <div class="pie"><input id="entrada" placeholder="Escribe tu consulta…"><button id="enviar">Enviar</button></div>
</div>
<script>
  const hilo = document.getElementById('hilo');
  const entrada = document.getElementById('entrada');
  const sesion = localStorage.getItem('sesionBot') || Math.random().toString(36).slice(2);
  localStorage.setItem('sesionBot', sesion);
  async function mandar() {
    const texto = entrada.value.trim();
    if (!texto) return;
    entrada.value = '';
    hilo.insertAdjacentHTML('beforeend', '<div class="m yo"></div>');
    hilo.lastChild.textContent = texto;
    const resp = await fetch('/api/chat', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ mensaje: texto, sesion }) });
    const datos = await resp.json();
    hilo.insertAdjacentHTML('beforeend', '<div class="m bot"></div>');
    hilo.lastChild.textContent = datos.texto || 'No pude responder, intenta de nuevo.';
    hilo.scrollTop = hilo.scrollHeight;
  }
  document.getElementById('enviar').onclick = mandar;
  entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') mandar(); });
</script>
</body>
</html>`;
}
