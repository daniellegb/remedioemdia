/**
 * Utilitários de mapa para abrir links diretos no Google Maps e Waze
 */

export function openGoogleMapsLink(address: string) {
  if (!address || address.trim() === '') return;
  window.open(
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`,
    '_blank'
  );
}

export function openWazeLink(address: string) {
  if (!address || address.trim() === '') return;
  window.open(
    `https://www.waze.com/ul?q=${encodeURIComponent(address.trim())}&navigate=yes`,
    '_blank'
  );
}
