/**
 * utilitários de mapa para buscar coordenadas e abrir links profundos no Google Maps e Waze
 */

export async function getCoordinates(address: string): Promise<{ lat: number; lon: number } | null> {
  if (!address || address.trim() === '') return null;
  
  try {
    // Busca coordenadas no OpenStreetMap Nominatim
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`, {
      headers: {
        'User-Agent': 'MedManagerApp/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Erro na resposta da API Nominatim: ${response.status}`);
    }
    
    const data = await response.json();
    if (data && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      if (!isNaN(lat) && !isNaN(lon)) {
        return { lat, lon };
      }
    }
  } catch (error) {
    console.error('Erro ao buscar coordenadas para o endereço:', address, error);
  }
  
  return null;
}

export async function openGoogleMapsLink(address: string) {
  if (!address) return;
  
  // Abrimos uma nova janela imediatamente para evitar que o bloqueador de popups do navegador bloqueie a ação assíncrona
  const newWindow = window.open('about:blank', '_blank');
  if (!newWindow) return;
  
  newWindow.document.title = 'Abrindo Google Maps...';
  newWindow.document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#334155;background:#f8fafc;">
      <div style="border: 4px solid #e2e8f0; border-top: 4px solid #3478E5; border-radius: 50%; width: 36px; height: 36px; animation: spin 1s linear infinite; margin-bottom: 16px;"></div>
      <p style="font-weight: 600;">Buscando coordenadas do endereço...</p>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    </div>
  `;

  try {
    const coords = await getCoordinates(address);
    if (coords) {
      newWindow.location.href = `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lon}`;
    } else {
      newWindow.location.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    }
  } catch (error) {
    newWindow.location.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }
}

export async function openWazeLink(address: string) {
  if (!address) return;
  
  const newWindow = window.open('about:blank', '_blank');
  if (!newWindow) return;
  
  newWindow.document.title = 'Abrindo Waze...';
  newWindow.document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#334155;background:#f8fafc;">
      <div style="border: 4px solid #e2e8f0; border-top: 4px solid #3478E5; border-radius: 50%; width: 36px; height: 36px; animation: spin 1s linear infinite; margin-bottom: 16px;"></div>
      <p style="font-weight: 600;">Buscando coordenadas do endereço...</p>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    </div>
  `;

  try {
    const coords = await getCoordinates(address);
    if (coords) {
      newWindow.location.href = `https://www.waze.com/ul?ll=${coords.lat},${coords.lon}&navigate=yes`;
    } else {
      newWindow.location.href = `https://www.waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
    }
  } catch (error) {
    newWindow.location.href = `https://www.waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
  }
}
