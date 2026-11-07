// Datos del local. Lo único que hay que tocar para poner el catálogo en marcha.
window.IZEL = {
  // Número de WhatsApp con código de país, sin "+", espacios ni guiones.
  // Ejemplo para Argentina: 5491123456789 (54 + 9 + área sin 0 + número sin 15)
  whatsapp: '',

  // Dejar vacío si el catálogo se sirve desde el sistema de gestión o como sitio estático.
  // Si el catálogo está en otro dominio, poner acá la dirección del sistema de gestión.
  api: '',

  instagram: 'https://www.instagram.com/izeljoyas/',
  direccion: 'Merlo 2633, B1744OEO Moreno, Provincia de Buenos Aires',
  // Día de la semana (0 = domingo) -> horario en minutos desde las 00:00
  horarios: {
    1: [540, 1140], 2: [540, 1140], 3: [540, 1140], 4: [540, 1140], 5: [540, 1140],
    6: [570, 840],
  },
};
