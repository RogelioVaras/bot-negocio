// Guarda datos en Cloudflare KV si está conectado; si no, en memoria (sirve para pruebas).
// En memoria NO sobrevive a un reinicio del Worker: por eso el README insiste con el KV.

export function almacen(env) {
  const kv = env && env.DATOS;
  if (!globalThis.__memoriaBot) globalThis.__memoriaBot = new Map();
  const mem = globalThis.__memoriaBot;

  return {
    async leer(clave, porDefecto = null) {
      if (kv) {
        const valor = await kv.get(clave, 'json');
        return valor === null || valor === undefined ? porDefecto : valor;
      }
      if (!mem.has(clave)) return porDefecto;
      return JSON.parse(mem.get(clave));
    },
    async escribir(clave, valor) {
      const texto = JSON.stringify(valor);
      if (kv) return kv.put(clave, texto);
      mem.set(clave, texto);
    }
  };
}

export function nuevoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
