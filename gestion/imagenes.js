// Valida el contenido real de una imagen por sus primeros bytes (nunca por la extensión del
// nombre de archivo, que se puede mentir). La usan tanto la subida manual (server.js) como la
// sincronización con Google Drive (drive.js).
export function extensionImagen(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return '.webp';
  return null;
}
