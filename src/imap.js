// Leer y responder correo por IMAP y SMTP, sin Microsoft Graph.
// Sirve para buzones de Hostinger, cPanel, Titan, Gmail, etc.
//
// Se usa la conexión TCP de Cloudflare (cloudflare:sockets) con TLS directo
// en los puertos 993 (IMAP) y 465 (SMTP).

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function unir(a, b) {
  const salida = new Uint8Array(a.length + b.length);
  salida.set(a, 0);
  salida.set(b, a.length);
  return salida;
}

// Lector con buffer: entrega líneas (terminadas en CRLF) y bloques de bytes.
export class Lector {
  constructor(stream) {
    this.reader = stream.getReader();
    this.buf = new Uint8Array(0);
  }

  async llenar() {
    const { value, done } = await this.reader.read();
    if (done) throw new Error('La conexión con el correo se cerró');
    this.buf = unir(this.buf, value);
  }

  async linea() {
    for (;;) {
      for (let i = 0; i + 1 < this.buf.length; i++) {
        if (this.buf[i] === 13 && this.buf[i + 1] === 10) {
          const texto = DEC.decode(this.buf.subarray(0, i));
          this.buf = this.buf.subarray(i + 2);
          return texto;
        }
      }
      await this.llenar();
    }
  }

  async bytes(cantidad) {
    while (this.buf.length < cantidad) await this.llenar();
    const salida = this.buf.slice(0, cantidad);
    this.buf = this.buf.subarray(cantidad);
    return salida;
  }

  liberar() {
    try {
      this.reader.releaseLock();
    } catch (e) {
      // sin importancia al cerrar
    }
  }
}

function cita(texto) {
  return '"' + String(texto).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// base64 de un texto UTF-8 sin depender de unescape, que no existe en Workers.
export function textoABase64(texto) {
  const bytes = ENC.encode(String(texto || ''));
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

// ---------- decodificación de correos ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Abytes(texto) {
  const limpio = String(texto).replace(/[^A-Za-z0-9+/=]/g, '');
  const salida = [];
  let buffer = 0;
  let bits = 0;
  for (const c of limpio) {
    if (c === '=') break;
    const v = B64.indexOf(c);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      salida.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(salida);
}

export function decodificarQuotedPrintable(texto) {
  return String(texto)
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function decodificarPalabra(texto) {
  return String(texto || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (todo, charset, tipo, dato) => {
    try {
      let bytes;
      if (tipo.toUpperCase() === 'B') {
        bytes = base64Abytes(dato);
      } else {
        // En Q, cada carácter cuenta como un byte (Latin-1), no como UTF-8.
        const plano = decodificarQuotedPrintable(dato.replace(/_/g, ' '));
        bytes = Uint8Array.from(Array.from(plano).map((c) => c.charCodeAt(0) & 0xff));
      }
      const esUtf = /utf-?8/i.test(charset);
      return new TextDecoder(esUtf ? 'utf-8' : 'iso-8859-1').decode(bytes);
    } catch (e) {
      return todo;
    }
  });
}

export function aTextoPlano(cuerpo, tipoContenido = '') {
  const esHtml = /text\/html/i.test(tipoContenido) || /<html|<body|<div|<p[\s>]/i.test(String(cuerpo).slice(0, 400));
  if (!esHtml) return String(cuerpo || '').trim();
  return String(cuerpo)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Separa cabeceras del cuerpo y devuelve las cabeceras en minúscula.
export function leerCabeceras(bruto) {
  const texto = String(bruto || '');
  const corte = texto.search(/\r?\n\r?\n/);
  const soloCabeceras = corte >= 0 ? texto.slice(0, corte) : texto;
  const cuerpo = corte >= 0 ? texto.slice(corte).replace(/^\r?\n\r?\n/, '') : '';
  const cabeceras = {};
  let ultima = null;
  for (const linea of soloCabeceras.split(/\r?\n/)) {
    if (/^\s/.test(linea) && ultima) {
      cabeceras[ultima] += ' ' + linea.trim();
      continue;
    }
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(linea);
    if (m) {
      ultima = m[1].toLowerCase();
      cabeceras[ultima] = m[2];
    }
  }
  return { cabeceras, cuerpo };
}

export function partirCorreo(bruto) {
  const { cabeceras, cuerpo } = leerCabeceras(bruto);
  const tipo = cabeceras['content-type'] || 'text/plain';
  let texto = cuerpo;
  if (/base64/i.test(cabeceras['content-transfer-encoding'] || '')) {
    texto = DEC.decode(base64Abytes(cuerpo));
  } else if (/quoted-printable/i.test(cabeceras['content-transfer-encoding'] || '')) {
    texto = decodificarQuotedPrintable(cuerpo);
  }
  // Si es multipart, busca la primera parte de texto.
  const limite = /boundary="?([^";]+)"?/i.exec(tipo);
  if (/multipart/i.test(tipo) && limite) {
    const partes = texto.split('--' + limite[1]);
    for (const parte of partes) {
      if (/content-type:\s*text\/plain/i.test(parte)) {
        const { cabeceras: c2, cuerpo: b2 } = leerCabeceras(parte);
        if (/base64/i.test(c2['content-transfer-encoding'] || '')) return aTextoPlano(DEC.decode(base64Abytes(b2)), 'text/plain');
        if (/quoted-printable/i.test(c2['content-transfer-encoding'] || '')) return aTextoPlano(decodificarQuotedPrintable(b2), 'text/plain');
        return aTextoPlano(b2, 'text/plain');
      }
    }
    for (const parte of partes) {
      if (/content-type:\s*text\/html/i.test(parte)) {
        const { cabeceras: c3, cuerpo: b3 } = leerCabeceras(parte);
        const limpio = /base64/i.test(c3['content-transfer-encoding'] || '') ? DEC.decode(base64Abytes(b3)) : b3;
        return aTextoPlano(limpio, 'text/html');
      }
    }
  }
  return aTextoPlano(texto, tipo);
}

export function partirRemitente(de) {
  const texto = decodificarPalabra(de || '');
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>/.exec(texto);
  if (m) return { nombre: m[1].trim(), correo: m[2].trim() };
  return { nombre: '', correo: texto.trim() };
}

// ---------- cliente IMAP ----------

export class ClienteImap {
  constructor(socket) {
    this.socket = socket;
    this.writer = socket.writable.getWriter();
    this.lector = new Lector(socket.readable);
    this.n = 0;
  }

  async escribir(texto) {
    await this.writer.write(ENC.encode(texto));
  }

  async comando(texto) {
    const marca = 'a' + ++this.n;
    await this.escribir(`${marca} ${texto}\r\n`);
    const partes = [];
    for (;;) {
      const linea = await this.lector.linea();
      const literal = /\{(\d+)\}$/.exec(linea);
      if (literal) {
        const datos = await this.lector.bytes(Number(literal[1]));
        partes.push({ linea, datos });
        continue;
      }
      partes.push({ linea });
      if (linea.startsWith(marca + ' ')) {
        return { ok: /\sOK\b/i.test(linea), estado: linea, partes };
      }
    }
  }

  async entrar(usuario, clave) {
    const saludo = await this.lector.linea();
    if (!/^\*\s+OK/i.test(saludo)) throw new Error('El servidor de correo no respondió como IMAP: ' + saludo.slice(0, 80));
    const r = await this.comando(`LOGIN ${cita(usuario)} ${cita(clave)}`);
    if (!r.ok) throw new Error('Usuario o clave de correo incorrectos (el servidor dijo: ' + r.estado.slice(0, 100) + ')');
  }

  async abrirBandeja() {
    const r = await this.comando('SELECT INBOX');
    if (!r.ok) throw new Error('No pude abrir la bandeja de entrada: ' + r.estado.slice(0, 100));
    let uids = 0;
    for (const p of r.partes) {
      const m = /UIDVALIDITY\s+(\d+)/i.exec(p.linea);
      if (m) uids = Number(m[1]);
    }
    return { uidvalidez: uids };
  }

  async buscarUids(rango) {
    const r = await this.comando(`UID SEARCH ${rango}`);
    if (!r.ok) return [];
    for (const p of r.partes) {
      if (/^\*\s+SEARCH/i.test(p.linea)) {
        return p.linea.replace(/^\*\s+SEARCH\s*/i, '').trim().split(/\s+/).filter(Boolean).map(Number);
      }
    }
    return [];
  }

  async cabeceras(uid) {
    const r = await this.comando(
      `UID FETCH ${uid} (UID BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])`
    );
    for (const p of r.partes) {
      if (p.datos) {
        const { cabeceras } = leerCabeceras(DEC.decode(p.datos));
        return cabeceras;
      }
    }
    return {};
  }

  async cuerpo(uid) {
    const r = await this.comando(`UID FETCH ${uid} (UID BODY.PEEK[TEXT])`);
    for (const p of r.partes) {
      if (p.datos && p.datos.length) return DEC.decode(p.datos);
    }
    // Sin texto: pedir el mensaje completo y quedarse con lo útil
    const completo = await this.comando(`UID FETCH ${uid} (UID BODY.PEEK[])`);
    for (const p of completo.partes) {
      if (p.datos && p.datos.length) return partirCorreo(DEC.decode(p.datos));
    }
    return '(este correo no tiene texto legible)';
  }

  async salir() {
    try {
      await this.comando('LOGOUT');
    } catch (e) {
      // da igual
    }
    try {
      this.lector.liberar();
      await this.socket.close();
    } catch (e) {
      // da igual
    }
  }

  // Mensaje completo (cabeceras + cuerpo), ya decodificado a texto legible.
  async completo(uid) {
    const r = await this.comando(`UID FETCH ${uid} (UID BODY.PEEK[])`);
    for (const p of r.partes) {
      if (p.datos && p.datos.length) return partirCorreo(DEC.decode(p.datos));
    }
    return '';
  }
}

// ---------- cliente SMTP ----------

export class ClienteSmtp {
  constructor(socket) {
    this.socket = socket;
    this.writer = socket.writable.getWriter();
    this.lector = new Lector(socket.readable);
  }

  async escribir(texto) {
    await this.writer.write(ENC.encode(texto));
  }

  async esperar(esperado) {
    const linea = await this.lector.linea();
    const codigo = Number(String(linea).slice(0, 3));
    if (!String(esperado).includes(String(codigo).charAt(0)) || linea.startsWith('4') || linea.startsWith('5')) {
      throw new Error('El servidor de envío respondió: ' + linea.slice(0, 120));
    }
    return linea;
  }

  async enviar({ usuario, clave, de, para, asunto, texto, enRespuestaA }) {
    await this.esperar([2]);
    await this.escribir('EHLO bot-negocio\r\n');
    let cabecera = await this.lector.linea();
    while (/^\d{3}-/.test(cabecera)) cabecera = await this.lector.linea();

    await this.escribir('AUTH LOGIN\r\n');
    await this.esperar([3]);
    await this.escribir(btoa(usuario) + '\r\n');
    await this.esperar([3]);
    await this.escribir(btoa(clave) + '\r\n');
    await this.esperar([2]);

    await this.escribir(`MAIL FROM:<${usuario}>\r\n`);
    await this.esperar([2]);
    await this.escribir(`RCPT TO:<${para}>\r\n`);
    await this.esperar([2]);
    await this.escribir('DATA\r\n');
    await this.esperar([3]);

    const cuerpo = textoABase64(texto).replace(/(.{76})/g, '$1\r\n');
    const cabeceras = [
      `From: ${de || usuario}`,
      `To: ${para}`,
      `Subject: =?UTF-8?B?${textoABase64(asunto)}?=`,
      enRespuestaA ? `In-Reply-To: ${enRespuestaA}` : '',
      enRespuestaA ? `References: ${enRespuestaA}` : '',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64'
    ]
      .filter(Boolean)
      .join('\r\n');

    // La línea en blanco entre cabeceras y cuerpo es obligatoria.
    const mensaje = cabeceras + '\r\n\r\n' + cuerpo;

    await this.escribir(mensaje + '\r\n.\r\n');
    await this.esperar([2]);
    try {
      await this.escribir('QUIT\r\n');
      this.lector.liberar();
      await this.socket.close();
    } catch (e) {
      // da igual
    }
  }
}
