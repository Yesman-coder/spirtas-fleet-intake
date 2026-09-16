/* =========================================================
   Spirtas Worldwide — Fleet Intake
   English / Spanish text dictionary.
   Edit the strings below to change any wording on the page.
   ========================================================= */

var I18N = {
  en: {
    brandTag: 'Demolition · Remediation · Emergency Response',
    eyebrow: 'Equipment Network Registration',
    h1: 'Register your company &amp; submit your machinery list',
    lede: 'Tell us who you are, then add your equipment one by one or upload your existing list. Everything you submit goes straight into our fleet database for review.',
    step1: 'Company',
    step2: 'Equipment',
    step3: 'Submit',

    companyTitle: 'Company Registration',
    companyHint: 'Basic contact details so we know who to follow up with.',
    lblCompanyName: 'Company Name',
    lblContactPerson: 'Contact Person',
    lblEmail: 'Email',
    lblPhone: 'Phone',
    errRequired: 'This field is required.',
    errEmail: 'Enter a valid email address.',

    equipTitle: 'Machinery List',
    equipHint: 'Add units manually, upload a spreadsheet, or both — you can review and edit everything below before submitting.',
    tabManual: 'Add manually',
    tabUpload: 'Upload a file',
    dropTitle: 'Drop your file here',
    dropSub: 'CSV or Excel (.csv, .xlsx, .xls) — column headers in English or Spanish are both fine.',
    browseBtn: 'Choose file',
    addRow: 'Add row',
    colBrand: 'Brand',
    colType: 'Type',
    colModel: 'Model',
    colId: 'ID',
    colCapacity: 'Capacity',
    colAge: 'Age',
    colLocation: 'Location',
    colPrice: 'Price/Day (24h)',
    colContact: 'Contact (optional)',
    eqEmpty: 'No equipment added yet — add a row or upload a file.',
    eqCount1: '1 unit added',
    eqCountN: '{n} units added',

    submitNote: 'By submitting, you agree that Spirtas Worldwide may contact you about the equipment listed here.',
    submitBtn: 'Submit registration',
    submitting: 'Submitting…',
    submitErrCompany: 'Please complete all required company fields.',
    submitErrEquip: 'Add at least one piece of equipment with a brand and model before submitting.',

    successTitle: 'Thank you — your submission is on its way',
    successBody: 'We’ve sent your company details and machinery list to our team. If you don’t hear from us within a few business days, please reach out directly.',
    downloadCopy: 'Download a copy of what you submitted',
    submitAnother: 'Submit another registration',

    footer: '© <span id="year"></span> Spirtas Worldwide — Complete Risk Transfer™',

    placeholderBrand: 'Caterpillar',
    placeholderType: 'Excavator',
    placeholderModel: '320 GC',
    placeholderId: 'CAT-0417',
    placeholderCapacity: '20 t',
    placeholderAge: '3 yrs',
    placeholderLocation: 'City, Country',
    placeholderPrice: '$ / day',
    placeholderContact: 'Name · phone or email'
  },

  es: {
    brandTag: 'Demolición · Remediación · Respuesta a Emergencias',
    eyebrow: 'Registro de Red de Equipos',
    h1: 'Registre su empresa y envíe su lista de maquinaria',
    lede: 'Cuéntenos quién es usted y luego agregue su equipo uno por uno o suba su lista existente. Todo lo que envíe pasa directamente a nuestra base de datos de flota para revisión.',
    step1: 'Empresa',
    step2: 'Equipo',
    step3: 'Enviar',

    companyTitle: 'Registro de la Empresa',
    companyHint: 'Datos básicos de contacto para saber con quién dar seguimiento.',
    lblCompanyName: 'Nombre de la Empresa',
    lblContactPerson: 'Persona de Contacto',
    lblEmail: 'Correo Electrónico',
    lblPhone: 'Teléfono',
    errRequired: 'Este campo es obligatorio.',
    errEmail: 'Ingrese un correo electrónico válido.',

    equipTitle: 'Lista de Maquinaria',
    equipHint: 'Agregue unidades manualmente, suba una hoja de cálculo, o ambos — puede revisar y editar todo antes de enviar.',
    tabManual: 'Agregar manualmente',
    tabUpload: 'Subir un archivo',
    dropTitle: 'Arrastre su archivo aquí',
    dropSub: 'CSV o Excel (.csv, .xlsx, .xls) — encabezados de columna en inglés o español, ambos funcionan.',
    browseBtn: 'Elegir archivo',
    addRow: 'Agregar fila',
    colBrand: 'Marca',
    colType: 'Tipo',
    colModel: 'Modelo',
    colId: 'ID',
    colCapacity: 'Capacidad',
    colAge: 'Antigüedad',
    colLocation: 'Ubicación',
    colPrice: 'Precio/Día (24h)',
    colContact: 'Contacto (opcional)',
    eqEmpty: 'Aún no se ha agregado equipo — agregue una fila o suba un archivo.',
    eqCount1: '1 unidad agregada',
    eqCountN: '{n} unidades agregadas',

    submitNote: 'Al enviar, usted acepta que Spirtas Worldwide pueda contactarlo sobre el equipo aquí indicado.',
    submitBtn: 'Enviar registro',
    submitting: 'Enviando…',
    submitErrCompany: 'Complete todos los campos obligatorios de la empresa.',
    submitErrEquip: 'Agregue al menos un equipo con marca y modelo antes de enviar.',

    successTitle: 'Gracias — su envío está en camino',
    successBody: 'Hemos enviado los datos de su empresa y la lista de maquinaria a nuestro equipo. Si no recibe respuesta en unos días hábiles, contáctenos directamente.',
    downloadCopy: 'Descargar una copia de lo enviado',
    submitAnother: 'Enviar otro registro',

    footer: '© <span id="year"></span> Spirtas Worldwide — Complete Risk Transfer™',

    placeholderBrand: 'Caterpillar',
    placeholderType: 'Excavadora',
    placeholderModel: '320 GC',
    placeholderId: 'CAT-0417',
    placeholderCapacity: '20 t',
    placeholderAge: '3 años',
    placeholderLocation: 'Ciudad, País',
    placeholderPrice: '$ / día',
    placeholderContact: 'Nombre · teléfono o correo'
  }
};

/* Header aliases used to auto-match uploaded spreadsheet columns,
   regardless of language, accents or capitalization. */
var HEADER_ALIASES = {
  brand: ['brand', 'marca'],
  type: ['type', 'tipo'],
  model: ['model', 'modelo'],
  unitId: ['id', 'unitid', 'unit id', 'identificador', 'identificacion'],
  capacity: ['capacity', 'capacidad'],
  age: ['age', 'antiguedad', 'edad', 'anio', 'ano'],
  location: ['location', 'ubicacion'],
  price: ['priceday', 'preciodia', 'price', 'precio', 'dayrate', 'pricedayrate', 'preciopordia'],
  contact: ['contact', 'contacto']
};
