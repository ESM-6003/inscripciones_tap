/**
 * Simulador de Inscripciones TAP
 * Este script simula 500 inscripciones automatizadas al sistema TAP
 * 
 * INSTRUCCIONES:
 * 1. Abrir index.html en el navegador
 * 2. Abrir la consola de desarrollador (F12)
 * 3. Copiar y pegar este archivo completo en la consola
 * 4. Ejecutar: iniciarSimulacion(500)
 */

// ============================================================================
// CONFIGURACIÓN Y DATOS DE PRUEBA
// ============================================================================

const NOMBRES_MASCULINOS = [
  "Juan", "Carlos", "Miguel", "Luis", "Pedro", "José", "Antonio", "Francisco", 
  "Manuel", "Diego", "Javier", "Fernando", "Roberto", "Eduardo", "Ricardo", 
  "Andrés", "Pablo", "Alejandro", "Sergio", "Daniel", "Raúl", "Martín", 
  "Alberto", "Jorge", "Gustavo", "Marcos", "Cristian", "Gabriel", "Adrián", 
  "Sebastián", "Matías", "Nicolás", "Santiago", "Gonzalo", "Facundo", "Tomás",
  "Agustín", "Joaquín", "Valentín", "Ignacio", "Maximiliano", "Bruno", "Lucas",
  "Emanuel", "Ezequiel", "Rodrigo", "Franco", "Damián", "Leandro", "Luciano"
];

const NOMBRES_FEMENINOS = [
  "María", "Ana", "Laura", "Carmen", "Rosa", "Isabel", "Patricia", "Silvia",
  "Mónica", "Andrea", "Claudia", "Gabriela", "Carolina", "Verónica", "Adriana",
  "Lorena", "Paula", "Daniela", "Marcela", "Alejandra", "Natalia", "Susana",
  "Fernanda", "Victoria", "Valeria", "Romina", "Yanina", "Cecilia", "Marina",
  "Florencia", "Camila", "Micaela", "Sofía", "Valentina", "Martina", "Agustina",
  "Lucía", "Julia", "Catalina", "Melina", "Candela", "Julieta", "Antonella",
  "Guadalupe", "Milagros", "Rocío", "Belén", "Abril", "Delfina", "Emilia"
];

const APELLIDOS = [
  "González", "Rodríguez", "Fernández", "López", "Martínez", "García", "Pérez",
  "Sánchez", "Ramírez", "Torres", "Flores", "Rivera", "Gómez", "Díaz", "Cruz",
  "Morales", "Reyes", "Gutiérrez", "Ortiz", "Chávez", "Ruiz", "Jiménez", "Hernández",
  "Mendoza", "Vargas", "Castro", "Romero", "Álvarez", "Suárez", "Vega", "Molina",
  "Castillo", "Navarro", "Moreno", "Ramos", "Núñez", "Guerrero", "Medina", "Rojas",
  "Campos", "Herrera", "Aguilar", "Vázquez", "Silva", "Ríos", "Méndez", "Luna",
  "Peña", "Ortega", "Delgado", "Salazar", "Cortés", "León", "Blanco", "Paredes"
];

const CALLES = [
  "San Martín", "Belgrano", "Rivadavia", "Mitre", "Sarmiento", "9 de Julio",
  "25 de Mayo", "Independencia", "Libertad", "Córdoba", "Tucumán", "Entre Ríos",
  "Santa Fe", "Corrientes", "Mendoza", "Salta", "Jujuy", "Catamarca", "La Rioja",
  "San Juan", "Chaco", "Formosa", "Santiago del Estero", "Misiones", "Buenos Aires"
];

const OBRAS_SOCIALES = [
  "OSDE", "Swiss Medical", "IOMA", "PAMI", "Galeno", "Medifé", "OSECAC", 
  "OSDOP", "Medicus", "OSPE", "OSPEDYC", "OSPLAD", "No tiene"
];

// ============================================================================
// FUNCIONES GENERADORAS DE DATOS ALEATORIOS
// ============================================================================

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomBool(probability = 0.5) {
  return Math.random() < probability;
}

function generarDNI() {
  return String(randomInt(20000000, 45000000));
}

function generarLegajo() {
  const año = randomInt(2018, 2026);
  const numero = String(randomInt(1, 999)).padStart(3, '0');
  return `${año}/${numero}`;
}

function generarTelefono() {
  const prefijo = randomItem(['342', '343', '341', '336', '3400']);
  const numero = String(randomInt(1000000, 9999999));
  return `${prefijo}${numero}`;
}

function generarEmail(nombre, apellido) {
  const dominios = ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com'];
  const nombreClean = nombre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const apellidoClean = apellido.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const numero = randomInt(1, 999);
  
  const formatos = [
    `${nombreClean}.${apellidoClean}@${randomItem(dominios)}`,
    `${nombreClean}${apellidoClean}${numero}@${randomItem(dominios)}`,
    `${nombreClean.charAt(0)}${apellidoClean}@${randomItem(dominios)}`
  ];
  
  return randomItem(formatos);
}

function generarDireccion() {
  const calle = randomItem(CALLES);
  const numero = randomInt(100, 9999);
  return `${calle} ${numero}`;
}

function generarFechaNacimiento(edad) {
  const año = new Date().getFullYear() - edad;
  const mes = String(randomInt(1, 12)).padStart(2, '0');
  const dia = String(randomInt(1, 28)).padStart(2, '0');
  return `${dia}-${mes}-${año}`;
}

function generarEstudiante() {
  const genero = randomItem(["Mujer", "Varon", "Otrx"]);
  const nombre = genero === "Mujer" ? randomItem(NOMBRES_FEMENINOS) : randomItem(NOMBRES_MASCULINOS);
  const apellido = randomItem(APELLIDOS);
  const edad = randomInt(10, 60);
  
  return {
    nombre,
    apellido,
    dni: generarDNI(),
    legajo: generarLegajo(),
    genero,
    telefono: generarTelefono(),
    edad: String(edad),
    direccion: generarDireccion(),
    email: generarEmail(nombre, apellido),
    fecha_nacimiento: generarFechaNacimiento(edad),
    
    // Datos del tutor (más probable si es menor de edad)
    nombre_padre: edad < 18 ? randomItem(NOMBRES_MASCULINOS) + " " + apellido : "",
    nombre_madre: edad < 18 ? randomItem(NOMBRES_FEMENINOS) + " " + apellido : "",
    telefono_emergencia: edad < 18 ? generarTelefono() : "",
    
    // Datos administrativos
    saeta: randomBool(0.3) ? "Si" : "No",
    obra_social: randomItem(OBRAS_SOCIALES),
    seguro_escolar: randomBool(0.7) ? "Si" : "No",
    pago_voluntario: randomBool(0.4) ? "Si" : "No",
    monto: randomBool(0.4) ? String(randomInt(1000, 5000)) : "",
    permiso: randomBool(0.9) ? "Si" : "No"
  };
}

function obtenerMateriasDisponibles() {
  if (typeof window.MATERIAS_CATALOGO === 'undefined') {
    console.error('❌ MATERIAS_CATALOGO no está definido');
    return [];
  }
  
  const materias = [];
  for (const [nombreMateria, datosMateria] of Object.entries(window.MATERIAS_CATALOGO)) {
    if (datosMateria.professors) {
      for (const [nombreProfesor, datosProfesor] of Object.entries(datosMateria.professors)) {
        const años = datosMateria.years || [1];
        materias.push({
          nombre: nombreMateria,
          profesor: nombreProfesor,
          años: años,
          turnos: datosProfesor.turnos || ["Mañana"]
        });
      }
    }
  }
  
  return materias;
}

function generarMateriasParaEstudiante() {
  const materiasDisponibles = obtenerMateriasDisponibles();
  
  if (materiasDisponibles.length === 0) {
    console.error('❌ No hay materias disponibles');
    return [];
  }
  
  // Cada estudiante tendrá entre 1 y 3 materias
  const cantidadMaterias = randomInt(1, 3);
  const materias = [];
  const materiasUsadas = new Set();
  
  for (let i = 0; i < cantidadMaterias; i++) {
    let materia;
    let intentos = 0;
    
    // Evitar materias duplicadas
    do {
      materia = randomItem(materiasDisponibles);
      intentos++;
    } while (materiasUsadas.has(materia.nombre) && intentos < 20);
    
    if (intentos >= 20) break;
    
    materiasUsadas.add(materia.nombre);
    
    materias.push({
      anio: String(randomItem(materia.años)),
      materia: materia.nombre,
      profesor: materia.profesor,
      turno: randomItem(materia.turnos),
      comision: randomItem(["A", "B", "C"])
    });
  }
  
  return materias;
}

// ============================================================================
// FUNCIONES DE SIMULACIÓN DE INSCRIPCIÓN
// ============================================================================

function llenarFormulario(datosEstudiante, materias) {
  const form = document.getElementById('inscripcionForm');
  if (!form) {
    throw new Error('No se encontró el formulario de inscripción');
  }
  
  // Llenar datos del estudiante
  for (const [campo, valor] of Object.entries(datosEstudiante)) {
    const input = form.querySelector(`[name="${campo}"]`);
    if (input) {
      input.value = valor;
    }
  }
  
  // Limpiar materias existentes
  const materiasContainer = document.getElementById('materiasContainer');
  if (!materiasContainer) {
    throw new Error('No se encontró el contenedor de materias');
  }
  
  // Mantener solo el primer bloque de materia
  const bloquesMaterias = materiasContainer.querySelectorAll('[data-materia-item]');
  for (let i = 1; i < bloquesMaterias.length; i++) {
    bloquesMaterias[i].remove();
  }
  
  // Llenar materias
  materias.forEach((materia, index) => {
    if (index > 0) {
      // Agregar nuevo bloque de materia
      const addBtn = document.getElementById('addMateriaBtn');
      if (addBtn) {
        addBtn.click();
      }
    }
    
    // Esperar un momento para que se cree el bloque
    setTimeout(() => {
      const bloques = materiasContainer.querySelectorAll('[data-materia-item]');
      const bloque = bloques[index];
      
      if (bloque) {
        const anioSelect = bloque.querySelector('.materia-anio');
        const materiaSelect = bloque.querySelector('.materia-materia');
        const profesorSelect = bloque.querySelector('.materia-profesor');
        const turnoSelect = bloque.querySelector('.materia-turno');
        const comisionSelect = bloque.querySelector('.materia-comision');
        
        if (anioSelect) anioSelect.value = materia.anio;
        
        // Trigger change para actualizar los selectores dependientes
        if (anioSelect) {
          const event = new Event('change', { bubbles: true });
          anioSelect.dispatchEvent(event);
        }
        
        setTimeout(() => {
          if (materiaSelect) materiaSelect.value = materia.materia;
          if (materiaSelect) {
            const event = new Event('change', { bubbles: true });
            materiaSelect.dispatchEvent(event);
          }
          
          setTimeout(() => {
            if (profesorSelect) profesorSelect.value = materia.profesor;
            if (turnoSelect) turnoSelect.value = materia.turno;
            if (comisionSelect) comisionSelect.value = materia.comision;
          }, 50);
        }, 50);
      }
    }, index * 100);
  });
}

async function enviarInscripcion() {
  return new Promise((resolve, reject) => {
    const form = document.getElementById('inscripcionForm');
    if (!form) {
      reject(new Error('No se encontró el formulario'));
      return;
    }
    
    // Simular el envío del formulario
    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    const resultado = form.dispatchEvent(submitEvent);
    
    if (resultado) {
      // Esperar un poco para que se procese
      setTimeout(() => resolve(), 500);
    } else {
      reject(new Error('El formulario fue cancelado'));
    }
  });
}

// ============================================================================
// FUNCIÓN PRINCIPAL DE SIMULACIÓN
// ============================================================================

let simulacionEnCurso = false;
let simulacionCancelada = false;

async function simularInscripcion(numero, total) {
  if (simulacionCancelada) {
    throw new Error('Simulación cancelada por el usuario');
  }
  
  console.log(`\n📝 Inscripción ${numero}/${total}`);
  
  // Generar datos
  const estudiante = generarEstudiante();
  const materias = generarMateriasParaEstudiante();
  
  console.log(`   👤 ${estudiante.nombre} ${estudiante.apellido}`);
  console.log(`   📚 ${materias.length} materia(s): ${materias.map(m => m.materia).join(', ')}`);
  
  // Llenar formulario
  llenarFormulario(estudiante, materias);
  
  // Esperar a que se llenen todos los campos
  await new Promise(resolve => setTimeout(resolve, materias.length * 200 + 500));
  
  // Enviar inscripción
  await enviarInscripcion();
  
  // Simular tiempo de procesamiento humano
  const tiempoEspera = randomInt(1000, 3000);
  await new Promise(resolve => setTimeout(resolve, tiempoEspera));
  
  console.log(`   ✅ Inscripción completada`);
}

async function iniciarSimulacion(cantidad = 500, loteSize = 10) {
  if (simulacionEnCurso) {
    console.warn('⚠️ Ya hay una simulación en curso. Usa detenerSimulacion() para cancelarla.');
    return;
  }
  
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║       SIMULADOR DE INSCRIPCIONES TAP - Sistema Automatizado  ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🎯 Objetivo: ${cantidad} inscripciones`);
  console.log(`📦 Procesamiento en lotes de: ${loteSize}`);
  console.log('');
  console.log('💡 Tip: Para detener la simulación, ejecuta: detenerSimulacion()');
  console.log('');
  
  simulacionEnCurso = true;
  simulacionCancelada = false;
  
  const inicio = Date.now();
  let completadas = 0;
  let errores = 0;
  
  try {
    for (let lote = 0; lote < Math.ceil(cantidad / loteSize); lote++) {
      if (simulacionCancelada) break;
      
      const loteInicio = lote * loteSize;
      const loteFin = Math.min(loteInicio + loteSize, cantidad);
      
      console.log(`\n┌─── LOTE ${lote + 1}/${Math.ceil(cantidad / loteSize)} (inscripciones ${loteInicio + 1} a ${loteFin}) ───┐`);
      
      for (let i = loteInicio; i < loteFin; i++) {
        if (simulacionCancelada) break;
        
        try {
          await simularInscripcion(i + 1, cantidad);
          completadas++;
        } catch (error) {
          console.error(`   ❌ Error en inscripción ${i + 1}:`, error.message);
          errores++;
        }
      }
      
      console.log(`└─── Lote completado: ${completadas}/${cantidad} exitosas, ${errores} errores ───┘`);
      
      // Pausa entre lotes
      if (lote < Math.ceil(cantidad / loteSize) - 1 && !simulacionCancelada) {
        console.log(`\n⏸️  Pausa de 2 segundos antes del siguiente lote...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    console.error('\n❌ Error crítico en la simulación:', error);
  } finally {
    simulacionEnCurso = false;
    
    const duracion = ((Date.now() - inicio) / 1000).toFixed(2);
    const promedio = (duracion / completadas).toFixed(2);
    
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                    RESUMEN DE SIMULACIÓN                      ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`✅ Inscripciones completadas: ${completadas}`);
    console.log(`❌ Errores: ${errores}`);
    console.log(`⏱️  Tiempo total: ${duracion} segundos`);
    console.log(`📊 Promedio por inscripción: ${promedio} segundos`);
    console.log('');
    
    if (simulacionCancelada) {
      console.log('⚠️ Simulación cancelada por el usuario');
    } else if (completadas === cantidad) {
      console.log('🎉 ¡Simulación completada exitosamente!');
    } else {
      console.log('⚠️ Simulación finalizada con errores');
    }
    
    console.log('');
  }
}

function detenerSimulacion() {
  if (!simulacionEnCurso) {
    console.log('⚠️ No hay ninguna simulación en curso.');
    return;
  }
  
  simulacionCancelada = true;
  console.log('\n⏹️  Deteniendo simulación... (puede tardar unos segundos)');
}

// ============================================================================
// FUNCIONES DE UTILIDAD
// ============================================================================

function obtenerEstadisticas() {
  const registros = JSON.parse(localStorage.getItem('tap_web_mvp_registros') || '[]');
  
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              ESTADÍSTICAS DE INSCRIPCIONES TAP                ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📊 Total de inscripciones: ${registros.length}`);
  
  if (registros.length > 0) {
    const porGenero = registros.reduce((acc, r) => {
      acc[r.genero] = (acc[r.genero] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\n👥 Por género:');
    for (const [genero, cantidad] of Object.entries(porGenero)) {
      console.log(`   ${genero}: ${cantidad}`);
    }
    
    const materias = {};
    registros.forEach(r => {
      if (r.materia) {
        materias[r.materia] = (materias[r.materia] || 0) + 1;
      }
    });
    
    console.log('\n📚 Top 10 materias más elegidas:');
    Object.entries(materias)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([materia, cantidad], index) => {
        console.log(`   ${index + 1}. ${materia}: ${cantidad}`);
      });
  }
  
  console.log('');
}

function limpiarTodo() {
  if (confirm('⚠️ ¿Estás seguro de que quieres eliminar TODAS las inscripciones?')) {
    localStorage.removeItem('tap_web_mvp_registros');
    console.log('✅ Todas las inscripciones han sido eliminadas.');
    if (typeof renderHistorial === 'function') {
      renderHistorial();
    }
  }
}

// ============================================================================
// EXPORTAR FUNCIONES GLOBALES
// ============================================================================

window.iniciarSimulacion = iniciarSimulacion;
window.detenerSimulacion = detenerSimulacion;
window.obtenerEstadisticas = obtenerEstadisticas;
window.limpiarInscripciones = limpiarTodo;

// ============================================================================
// MENSAJE DE BIENVENIDA
// ============================================================================

console.log('');
console.log('╔═══════════════════════════════════════════════════════════════╗');
console.log('║      🎵 SIMULADOR DE INSCRIPCIONES TAP - Cargado ✅           ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('📌 Comandos disponibles:');
console.log('');
console.log('   iniciarSimulacion(500)     - Simular 500 inscripciones');
console.log('   iniciarSimulacion(100, 5)  - Simular 100 inscripciones en lotes de 5');
console.log('   detenerSimulacion()        - Detener la simulación en curso');
console.log('   obtenerEstadisticas()      - Ver estadísticas de inscripciones');
console.log('   limpiarInscripciones()     - Eliminar todas las inscripciones');
console.log('');
console.log('💡 Ejemplo rápido: iniciarSimulacion(10) para probar con 10 inscripciones');
console.log('');
