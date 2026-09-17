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
    dropSub: 'CSV or Excel — whatever format your list is already in. We will read it and show you what we found before adding anything.',

    importReading: 'Reading your file…',
    importFound: 'Read {file} — using the sheet "{sheet}", headers on row {row}.',
    importEmpty: 'We could not find any rows in that file. Try another sheet or another file.',
    importFailed: 'We could not read that file. Please check it opens in Excel, then try again.',
    importTitle: 'Check what we found',
    importLede: 'We read your file and guessed which column is which. Fix anything that looks wrong, then add the rows.',
    importSheetLabel: 'Sheet',
    importHeaderLabel: 'Header row',
    importRowWord: 'Row',
    importRowsWord: 'rows',
    importIgnore: '— not in my file —',
    importWillAdd: '{n} rows ready to add',
    importNoRows: 'Nothing to add with these settings. Try a different sheet or header row.',
    importExtraKept: 'Extra columns kept with each row: {cols}',
    importCancel: 'Cancel',
    importConfirm: 'Add these rows',
    importDone: '{n} rows added below — review them and submit when ready.',
    importBigList: 'That is a long list, so the table may feel slow. You can still submit it.',
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
    submitErrNetwork: 'We couldn’t reach our servers. Check your connection and try again — nothing was lost.',
    submitErrServer: 'Your submission was rejected: {msg}',
    submitErrOffline: 'This form isn’t connected to its database yet. Please contact Spirtas Worldwide directly.',

    successTitle: 'Thank you — your registration has been received',
    successBody: 'Your company details and machinery list are saved in our fleet database. Our team reviews new registrations within a few business days.',
    successRef: 'Reference number',
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
    dropSub: 'CSV o Excel — en el formato que ya tenga su lista. La leeremos y le mostraremos lo que encontramos antes de agregar nada.',

    importReading: 'Leyendo su archivo…',
    importFound: 'Leímos {file} — usando la hoja "{sheet}", encabezados en la fila {row}.',
    importEmpty: 'No encontramos filas en ese archivo. Pruebe con otra hoja u otro archivo.',
    importFailed: 'No pudimos leer ese archivo. Verifique que abra en Excel e inténtelo de nuevo.',
    importTitle: 'Revise lo que encontramos',
    importLede: 'Leímos su archivo y adivinamos qué columna es cuál. Corrija lo que esté mal y luego agregue las filas.',
    importSheetLabel: 'Hoja',
    importHeaderLabel: 'Fila de encabezados',
    importRowWord: 'Fila',
    importRowsWord: 'filas',
    importIgnore: '— no está en mi archivo —',
    importWillAdd: '{n} filas listas para agregar',
    importNoRows: 'No hay nada que agregar con esta configuración. Pruebe otra hoja o fila de encabezados.',
    importExtraKept: 'Columnas adicionales conservadas en cada fila: {cols}',
    importCancel: 'Cancelar',
    importConfirm: 'Agregar estas filas',
    importDone: '{n} filas agregadas abajo — revíselas y envíe cuando esté listo.',
    importBigList: 'Es una lista larga, la tabla puede tardar en responder. Puede enviarla igualmente.',
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
    submitErrNetwork: 'No pudimos conectar con nuestros servidores. Revise su conexión e inténtelo de nuevo — no se perdió nada.',
    submitErrServer: 'Su envío fue rechazado: {msg}',
    submitErrOffline: 'Este formulario aún no está conectado a su base de datos. Por favor contacte directamente a Spirtas Worldwide.',

    successTitle: 'Gracias — su registro ha sido recibido',
    successBody: 'Los datos de su empresa y su lista de maquinaria están guardados en nuestra base de datos de flota. Nuestro equipo revisa los registros nuevos en unos días hábiles.',
    successRef: 'Número de referencia',
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
/* Column names we recognise, normalised (lowercase, no accents, no
   punctuation — see normalizeHeader). Order matters: the first field whose
   alias list contains a header wins, so the more specific fields are listed
   before the ones whose names are prefixes of others.

   These come from the files companies have actually sent, not from a
   standard. Anything not listed here is still imported — it is kept as an
   extra column and shown in the mapping panel so it can be assigned by
   hand. Add new spellings here as you meet them. */
var HEADER_ALIASES = {
  // Specific compounds first: "PRECIO POR DIA" must not be claimed by `price`
  // before `priceperday` gets a look, and "MODELO / MARCA" must not be read
  // as a model when the column really holds both.
  price: [
    'priceday', 'preciodia', 'dayrate', 'pricedayrate', 'preciopordia', 'priceperday',
    'price', 'precio', 'tarifa', 'costo', 'valor', 'alquiler', 'renta', 'preciodiario'
  ],
  capacity: ['capacity', 'capacidad', 'cap', 'tonelaje', 'tonelada', 'toneladas', 'potencia', 'kva', 'hp'],
  unitId: [
    'id', 'unitid', 'identificador', 'identificacion', 'serial', 'nroserial', 'numeroserial',
    'placa', 'placaserial', 'codigo', 'cod', 'chasis', 'vin', 'matricula', 'activo',
    'nroactivo', 'item', 'no', 'n', 'nro', 'numero', 'ref', 'referencia'
  ],
  brand: ['brand', 'marca', 'fabricante', 'manufacturer', 'make'],
  model: ['model', 'modelo', 'modelomarca', 'marcamodelo'],
  type: [
    'type', 'tipo', 'descripcion', 'description', 'desc', 'equipo', 'equipment',
    'maquina', 'maquinaria', 'categoria', 'category', 'clasificacion', 'classification',
    'tipodescripcion', 'descripciontipo', 'familia', 'family', 'subtipo', 'denominacion',
    'articulo', 'bien', 'unidad'
  ],
  age: ['age', 'antiguedad', 'edad', 'anio', 'ano', 'year', 'anofabricacion', 'anomodelo', 'fabricacion'],
  location: [
    'location', 'ubicacion', 'sede', 'base', 'zona', 'sitio', 'lugar', 'ciudad',
    'estado', 'region', 'almacen', 'patio', 'obra'
  ],
  contact: ['contact', 'contacto', 'responsable', 'encargado', 'telefono', 'email', 'correo', 'celular']
};
