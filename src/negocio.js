// Datos del negocio. ESTO ES LO PRIMERO QUE HAY QUE EDITAR.
// Cada frase que aparece aquí es la que el bot usará para responder.

export const NEGOCIO = {
  nombre: 'Varas y Asociados',
  descripcionCorta: 'Contabilidad, remuneraciones y asesoría tributaria para pymes.',
  ciudad: 'Chile',
  horario: 'Lunes a viernes de 9:00 a 18:00 hrs.',
  tono: 'Cercano, claro y sin tecnicismos. Habla en español de Chile. Nunca inventa precios.',

  servicios: [
    { nombre: 'Contabilidad mensual para pymes', detalle: 'Libros, conciliaciones y estados financieros al día.' },
    { nombre: 'Remuneraciones y liquidaciones', detalle: 'Cálculo de sueldos, imposiciones y finiquitos.' },
    { nombre: 'Asesoría tributaria y F29', detalle: 'Declaraciones mensuales y planificación de impuestos.' },
    { nombre: 'Constitución de empresas', detalle: 'Inicio de actividades, SII y patente municipal.' }
  ],

  // Preguntas frecuentes: si el mensaje del cliente contiene alguna "clave", responde esto.
  preguntas: [
    {
      claves: ['horario', 'a que hora', 'atienden', 'abierto'],
      respuesta:
        'Atendemos de lunes a viernes de 9:00 a 18:00 hrs. Si me escribes fuera de ese horario igual te respondo, y un contador te contacta al día siguiente.'
    },
    {
      claves: ['precio', 'cuanto cuesta', 'valor', 'tarifa', 'cobran'],
      respuesta:
        'El valor depende del tamaño y movimiento de tu empresa. Para darte un número exacto necesito revisar tu caso: ¿me cuentas cuántas boletas o facturas emites al mes y si tienes trabajadores?'
    },
    {
      claves: ['f29', 'iva', 'impuesto'],
      respuesta:
        'Preparamos y declaramos el F29 todos los meses, con revisión de un contador antes de enviarlo. Si quieres, te agendo una revisión de tu situación tributaria.'
    },
    {
      claves: ['remuneracion', 'sueldo', 'liquidacion', 'finiquito', 'trabajadores'],
      respuesta:
        'Hacemos remuneraciones, liquidaciones de sueldo, imposiciones y finiquitos. ¿Cuántos trabajadores tiene tu empresa?'
    },
    {
      claves: ['donde estan', 'direccion', 'oficina', 'ubicacion'],
      respuesta:
        'Trabajamos de forma remota con todo Chile y también recibimos en oficina con hora agendada. ¿Te acomoda una reunión por videollamada?'
    },
    {
      claves: ['gracias'],
      respuesta: '¡De nada! Quedo atento a cualquier otra consulta.'
    }
  ],

  // Si el mensaje trae alguna de estas frases, el bot NO improvisa: pasa a la bandeja para que respondas tú.
  derivarSi: [
    'hablar con una persona',
    'hablar con un contador',
    'ejecutivo',
    'reclamo',
    'molesto',
    'estafa',
    'demanda',
    'abogado',
    'urgencia',
    'problema con el sii'
  ],

  respaldo:
    'Buena pregunta. Para responderte bien necesito que un contador revise tu caso: ya avisé al equipo y te contactamos a la brevedad. ¿Me dejas tu nombre y el mejor horario para llamarte?',

  hashtags: ['#contabilidad', '#pymes', '#chile', '#asesoriaTributaria'],

  ideasPublicacion: [
    'Recordatorio: el F29 vence este mes, no lo dejes para el final',
    '3 errores que le cuestan caro a una pyme en su contabilidad',
    'Qué documentos necesitas para constituir tu empresa en Chile'
  ]
};
