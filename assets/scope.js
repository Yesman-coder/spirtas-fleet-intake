/* =========================================================
   Spirtas Worldwide — Fleet Intake
   What counts as demolition and construction equipment.

   The La Guaira works need demolition and construction plant.
   A company's own list often carries everything they own —
   laboratory benches, pickup trucks, office furniture — and
   those should not land in the fleet database.

   Nothing is ever silently thrown away. Each machine comes out
   as one of three:

     in      clearly demolition or construction plant
     out     clearly something else
     review  not clear enough to decide either way

   Only `in` joins the fleet. `out` is kept aside, visible to
   admins and never counted. `review` is kept aside too and
   waits for a person, because a wrong guess that quietly drops
   a real excavator is worse than a short list to check.

   Both languages are matched, accent-insensitive, because the
   same file often mixes them.
   ========================================================= */

(function (root) {
  'use strict';

  function fold(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /* Demolition and construction plant. Spanish and English together
     because supplier lists mix them freely. */
  var IN_SCOPE = [
    // earthmoving
    'excavador', 'excavator', 'retroexcavador', 'backhoe', 'jumbo',
    'bulldozer', 'dozer', 'topador', 'traxcavator',
    'cargador', 'loader', 'pala cargadora', 'payloader', 'minicargador', 'skid steer', 'skidsteer',
    'motoniveladora', 'grader', 'moto niveladora',
    'escrepa', 'scraper', 'mototrailla',
    // demolition specific
    'demolicion', 'demolition', 'martillo', 'hammer', 'breaker', 'rompedor',
    'cizalla', 'shear', 'pulverizador', 'pulverizer', 'grapple', 'pinza',
    'trituradora', 'crusher', 'chancadora', 'zaranda', 'criba', 'screening', 'screen plant',
    // lifting and handling
    'grua', 'crane', 'telehandler', 'manipulador telescopico', 'montacargas', 'forklift',
    'elevador', 'manlift', 'plataforma elevadora', 'boom lift', 'scissor lift',
    'winche', 'hoist', 'polipasto',
    // compaction and paving
    'compactador', 'compactor', 'rodillo', 'roller', 'vibrocompactador',
    'rana', 'jumping jack', 'plancha compactadora', 'placa vibratoria',
    'asfalto', 'asphalt', 'pavimentadora', 'paver', 'finisher', 'fresadora', 'milling',
    'distribuidor de asfalto', 'chipseal',
    // concrete
    'concreto', 'concrete', 'hormigon', 'mezcladora', 'mixer', 'trompo',
    'bomba de concreto', 'concrete pump', 'planta de concreto', 'batch plant',
    'vibrador de concreto', 'regla vibratoria',
    // haulage and site transport
    'volteo', 'dump truck', 'dumper', 'volquete', 'tolva',
    'chuto', 'tractocamion', 'prime mover', 'lowboy', 'cama baja', 'gondola',
    'remolque', 'trailer', 'semi remolque', 'hookloader', 'roll off', 'rolloff',
    'cisterna', 'water truck', 'camion cisterna', 'tanquero',
    'combustible', 'fuel truck',
    // drilling, piling, foundations
    'perforadora', 'drill', 'piloteadora', 'pile driver', 'hinca', 'barrenadora',
    'auger', 'zanjadora', 'trencher',
    // site support plant
    'planta electrica', 'generador', 'generator', 'genset', 'grupo electrogeno',
    'compresor', 'compressor', 'soldadora', 'welder', 'welding',
    'torre de iluminacion', 'light tower', 'lighting tower', 'iluminacion',
    'bomba', 'pump', 'motobomba', 'dewatering',
    'banda transportadora', 'conveyor', 'stacker', 'apilador',
    'silo', 'tolva de almacenamiento',
    'andamio', 'scaffold', 'encofrado', 'formwork', 'puntal', 'shoring',
    'contenedor', 'container', 'trailer de oficina', 'site office',
    // haulage and site trucks, once the passenger vehicles above are ruled out
    'truck', 'camion', 'tanker', 'tanquero', 'flatbed', 'plataforma',
    'articulated boom', 'brazo articulado', 'boom platform',
    'barredora', 'sweeper',
    // rebar and concrete finishing
    'rebar', 'cabilla', 'dobladora', 'bender', 'cortadora', 'cutter',
    'screed', 'regla vibratoria', 'alisadora', 'power trowel', 'llana',
    // survey: part of setting out any construction works
    'total station', 'estacion total', 'teodolito', 'theodolite',
    'nivel automatico', 'automatic level', 'laser level', 'nivel laser',
    'gps receiver', 'receptor gps', 'topograf', 'survey',
    'construction equipment', 'equipo de construccion', 'maquinaria pesada',
    // on-site fuel and water storage
    'tanque', 'tank', 'cisterna de combustible', 'diesel tank'
  ];

  /* Checked BEFORE the in-scope list, because these win outright. A row
     reading "Pickup 4X4 Flatbed" contains "flatbed", which would otherwise
     read as a flatbed truck; it is still a pickup. */
  var STRONG_OUT = [
    'pickup', 'pick up', 'camioneta', 'suv', 'jeep', 'rustico',
    'automovil', 'automobile', 'sedan', 'coupe', 'carro particular',
    'motocicleta', 'motorcycle', 'scooter', 'bicicleta', 'bicycle',
    'autobus', 'minibus', 'microbus', 'passenger van', 'van de pasajeros',
    'ambulancia', 'ambulance',
    'vehiculo liviano', 'light vehicle', 'vehiculos livianos',
    'laboratorio', 'laboratory', 'microscopio', 'microscope',
    'balanza', 'centrifuga', 'espectro', 'probeta', 'picnometro',
    'viscosimetro', 'penetrometro', 'granatario', 'horno de laboratorio',
    'oficina', 'escritorio', 'desk', 'silla', 'chair', 'mobiliario',
    'furniture', 'archivador', 'computador', 'computer', 'laptop',
    'impresora', 'printer', 'servidor', 'fotocopiadora', 'copier',
    'aire acondicionado', 'air conditioner', 'nevera', 'refrigerator',
    'agricola', 'agricultural', 'arado', 'cosechadora', 'harvester',
    'sembradora', 'fumigadora', 'farm tractor',
    'lancha', 'boat', 'embarcacion', 'yate', 'jet ski',
    'neumatico', 'llanta', 'tire', 'bateria', 'filtro', 'repuesto', 'spare part'
  ];

  /* Clearly not construction plant. */
  var OUT_OF_SCOPE = [
    // passenger and light vehicles
    'automovil', 'automobile', 'sedan', 'coupe', 'car ', 'carro particular',
    'motocicleta', 'motorcycle', 'moto ', 'scooter', 'bicicleta', 'bicycle',
    'autobus', 'bus ', 'minibus', 'microbus', 'van de pasajeros', 'passenger van',
    'ambulancia', 'ambulance', 'patrulla', 'police',
    'camioneta pickup', 'pickup', 'suv', 'jeep', 'rustico',
    'vehiculo liviano', 'light vehicle', 'vehiculos livianos',
    // laboratory and testing
    'laboratorio', 'laboratory', 'ensayo', 'probeta', 'balanza analitica',
    'microscopio', 'microscope', 'centrifuga', 'espectro', 'horno de laboratorio',
    'granatario', 'picnometro', 'viscosimetro', 'penetrometro',
    // office and IT
    'oficina', 'office', 'escritorio', 'desk', 'silla', 'chair', 'mobiliario',
    'furniture', 'archivador', 'computador', 'computer', 'laptop', 'impresora',
    'printer', 'servidor', 'server', 'telefono', 'fotocopiadora', 'copier',
    'aire acondicionado', 'air conditioner', 'nevera', 'refrigerator', 'cocina',
    // agriculture and marine
    'agricola', 'agricultural', 'arado', 'plough', 'plow', 'cosechadora',
    'harvester', 'sembradora', 'fumigadora', 'tractor agricola', 'farm tractor',
    'lancha', 'boat', 'embarcacion', 'yate', 'jet ski',
    // consumables and small tools
    'herramienta menor', 'hand tool', 'taladro manual', 'esmeril de banco',
    'papeleria', 'consumible', 'repuesto', 'spare part', 'neumatico', 'llanta',
    'tire', 'bateria', 'filtro',
    // testing and measuring instruments — materials-lab kit, not site plant.
    // Checked after the in-scope list, so a "Tanker Truck" is still a truck.
    'balance', 'balanza', 'scale', 'bascula', 'granataria',
    'density gauge', 'densimetro', 'nuclear', 'moisture', 'humedad',
    'tester', 'medidor', 'termometro', 'thermometer', 'calibrador',
    // a row that says only "Vehicle" is a vehicle, not plant; anything that
    // also names a machine has already matched above.
    'vehicle', 'vehiculo'
  ];

  /* "Tractor" is the awkward one: a crawler tractor is a dozer and belongs,
     a farm tractor does not. These qualifiers settle it. */
  // "Truck tractor" is a prime mover, not a farm machine, and it is how most
  // of these lists name the unit that pulls a lowboy.
  var TRACTOR_IN  = ['oruga', 'crawler', 'shovel', 'shovell', 'dozer', 'd6', 'd7', 'd8', 'd9',
                     'cadenas', 'track', 'riego', 'chuto', 'truck', 'camion',
                     'tipper', 'volteo', 'lowboy', 'remolque', 'semi'];
  var TRACTOR_OUT = ['agricola', 'farm', 'granja', 'cortacesped', 'jardin'];

  function classify(machine) {
    // Everything the row says about what it is, in one string.
    var hay = fold([
      machine && machine.type, machine && machine.type_es,
      machine && machine.typeEs, machine && machine.brand,
      machine && machine.model, machine && machine.machine_family,
      machine && machine.family, machine && machine.familyEs,
      machine && machine.machine_family_es,
      machine && machine.description
    ].filter(Boolean).join(' '));

    if (!hay) return { scope: 'review', reason: 'Nothing describes what this machine is' };

    var padded = ' ' + hay + ' ';

    if (/\btractor/.test(hay)) {
      for (var ti = 0; ti < TRACTOR_IN.length; ti++) {
        if (padded.indexOf(TRACTOR_IN[ti]) !== -1) {
          return { scope: 'in', reason: 'Crawler or construction tractor' };
        }
      }
      for (var to = 0; to < TRACTOR_OUT.length; to++) {
        if (padded.indexOf(TRACTOR_OUT[to]) !== -1) {
          return { scope: 'out', reason: 'Agricultural tractor' };
        }
      }
      return { scope: 'review', reason: 'Tractor, but not clear which kind' };
    }

    // Ruled out before anything else, so a pickup described as a flatbed is
    // still a pickup.
    for (var s = 0; s < STRONG_OUT.length; s++) {
      if (padded.indexOf(STRONG_OUT[s]) !== -1) {
        return { scope: 'out', reason: 'Matched "' + STRONG_OUT[s].trim() + '"' };
      }
    }

    for (var i = 0; i < IN_SCOPE.length; i++) {
      if (padded.indexOf(IN_SCOPE[i]) !== -1) {
        return { scope: 'in', reason: 'Matched "' + IN_SCOPE[i].trim() + '"' };
      }
    }

    for (var o = 0; o < OUT_OF_SCOPE.length; o++) {
      if (padded.indexOf(OUT_OF_SCOPE[o]) !== -1) {
        return { scope: 'out', reason: 'Matched "' + OUT_OF_SCOPE[o].trim() + '"' };
      }
    }

    return { scope: 'review', reason: 'Not recognised as construction plant' };
  }

  function summarize(machines) {
    var out = { in: 0, out: 0, review: 0, outSamples: [], reviewSamples: [] };
    (machines || []).forEach(function (m) {
      var r = classify(m);
      m._scope = r.scope;
      m._scopeReason = r.reason;
      out[r.scope]++;
      var label = [m.brand, m.type || m.typeEs, m.model].filter(Boolean).join(' ').slice(0, 44);
      if (r.scope === 'out' && out.outSamples.length < 6 && label) out.outSamples.push(label);
      if (r.scope === 'review' && out.reviewSamples.length < 6 && label) out.reviewSamples.push(label);
    });
    return out;
  }

  root.FleetScope = { classify: classify, summarize: summarize, fold: fold };
})(typeof window !== 'undefined' ? window : this);
