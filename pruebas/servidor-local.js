// Levanta el bot en tu propio PC para que lo veas funcionando en el navegador.
// Uso:  node pruebas/servidor-local.js
// Luego abrir:  http://localhost:8099/panel?clave=cambiame
// Los datos quedan en memoria: al cerrar se borran (es solo para probar).

import http from 'node:http';
import { exec } from 'node:child_process';
import { manejar } from '../src/index.js';
import { NEGOCIO } from '../src/negocio.js';
import { almacen, nuevoId } from '../src/almacen.js';
import { generarPropuestas } from '../src/publicidad.js';

const PUERTO = Number(process.env.PORT || 8099);
const CLAVE = process.env.CLAVE_PANEL || 'cambiame';
const env = { CLAVE_PANEL: CLAVE, NEGOCIO: NEGOCIO.nombre };

function hace(horas) {
  return new Date(Date.now() - horas * 3600 * 1000).toISOString();
}

async function sembrarEjemplos() {
  const al = almacen(env);
  const yaHay = await al.leer('conversaciones', []);
  if (yaHay.length) return;

  const nombre = 'Cliente de ejemplo';

  await al.escribir('conversaciones', [
    {
      id: nuevoId(),
      canal: 'whatsapp',
      de: '+56911112222',
      nombre: 'María Soto',
      creada: hace(3),
      ultima: hace(1),
      necesitaHumano: true,
      atendida: false,
      mensajes: [
        { rol: 'cliente', texto: 'Hola, necesito hablar con un contador, tengo un problema con el SII', ts: hace(1) },
        { rol: 'bot', texto: NEGOCIO.respaldo, ts: hace(1), fuente: 'derivacion' }
      ]
    },
    {
      id: nuevoId(),
      canal: 'telegram',
      de: '812345',
      nombre: 'Pedro Ramírez',
      creada: hace(6),
      ultima: hace(4),
      necesitaHumano: true,
      atendida: false,
      mensajes: [
        { rol: 'cliente', texto: 'Me llegó una multa y quiero reclamar, esto es urgente', ts: hace(4) },
        { rol: 'bot', texto: NEGOCIO.respaldo, ts: hace(4), fuente: 'derivacion' }
      ]
    },
    {
      id: nuevoId(),
      canal: 'web',
      de: 'web:ejemplo',
      nombre: 'Visita web',
      creada: hace(9),
      ultima: hace(8),
      necesitaHumano: false,
      atendida: true,
      mensajes: [
        { rol: 'cliente', texto: '¿A qué hora atienden?', ts: hace(9) },
        { rol: 'bot', texto: NEGOCIO.preguntas[0].respuesta, ts: hace(9), fuente: 'faq' },
        { rol: 'cliente', texto: 'Gracias!', ts: hace(8) },
        { rol: 'bot', texto: '¡De nada! Quedo atento a cualquier otra consulta.', ts: hace(8), fuente: 'faq' }
      ]
    }
  ]);

  const propuestas = [];
  for (const idea of NEGOCIO.ideasPublicacion.slice(0, 2)) {
    const generadas = await generarPropuestas(idea, NEGOCIO, env);
    for (const p of generadas) {
      propuestas.push({ ...p, id: nuevoId(), estado: 'pendiente', creada: hace(24) });
    }
  }
  await al.escribir('propuestas', propuestas);
}

function aRequest(req) {
  const trozos = [];
  return new Promise((resolve, reject) => {
    req.on('data', (t) => trozos.push(t));
    req.on('end', () => {
      const cabeza = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') cabeza.set(k, v);
        else if (Array.isArray(v)) cabeza.set(k, v.join(','));
      }
      const url = `http://localhost:${PUERTO}${req.url}`;
      const metodo = req.method || 'GET';
      const cuerpo = ['GET', 'HEAD'].includes(metodo) ? undefined : Buffer.concat(trozos);
      resolve(new Request(url, { method: metodo, headers: cabeza, body: cuerpo }));
    });
    req.on('error', reject);
  });
}

async function servicio(req, res) {
  try {
    const request = await aRequest(req);
    const respuesta = await manejar(request, env);
    const texto = await respuesta.text();
    const cabeceras = {};
    respuesta.headers.forEach((v, k) => (cabeceras[k] = v));
    res.writeHead(respuesta.status, cabeceras);
    res.end(texto);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
}

await sembrarEjemplos();

const servidor = http.createServer(servicio);
servidor.listen(PUERTO, () => {
  const panel = `http://localhost:${PUERTO}/panel?clave=${CLAVE}`;
  console.log('');
  console.log('  Bot encendido en tu PC');
  console.log('  Panel:  ' + panel);
  console.log('  Chat:   http://localhost:' + PUERTO + '/chat');
  console.log('');
  console.log('  Para apagarlo: Ctrl + C');
  console.log('');
  if (process.platform === 'win32' && !process.env.NO_ABRIR) {
    exec(`start "" "${panel}"`);
  }
});
