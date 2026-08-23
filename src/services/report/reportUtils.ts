import QRCode from 'qrcode';

export const loadImageAsPngDataUrl = (src: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context error'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        resolve(dataUrl);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = (e) => reject(e);
    img.src = src;
  });
};

export const generateQRCodeDataUrl = async (url: string): Promise<string | null> => {
  try {
    return await QRCode.toDataURL(url, {
      margin: 1,
      width: 250,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
  } catch (err) {
    console.error('Erro ao gerar DataURL do QR Code:', err);
    return null;
  }
};

export const formatBrazilianDate = (dateStr?: string): string => {
  if (!dateStr) return 'Não informada';
  try {
    const date = new Date(dateStr);
    const localDay = String(date.getUTCDate()).padStart(2, '0');
    const localMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    return `${localDay}/${localMonth}/${year}`;
  } catch (e) {
    return dateStr || 'Não informada';
  }
};

export const formatDateDDMMYYYY = (dateStr?: string): string => {
  if (!dateStr) return 'Não informada';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }
  return formatBrazilianDate(dateStr);
};

export const getUsageCategoryLabel = (category?: string): string => {
  switch (category) {
    case 'continuous':
      return 'Uso Contínuo';
    case 'period':
      return 'Uso Temporário (Por Período)';
    case 'intervals':
      return 'Intervalos Específicos';
    case 'contraceptive':
      return 'Anticoncepcional';
    case 'prn':
      return 'Se Necessário (Mencionando SOS)';
    default:
      return 'Não especificado';
  }
};

export const formatUnit = (unit?: string, qty: number = 1): string => {
  if (!unit) return '';
  const isPlural = qty > 1;
  switch (unit) {
    case 'comprimido':
      return isPlural ? 'comprimidos' : 'comprimido';
    case 'gota':
      return isPlural ? 'gotas' : 'gota';
    case 'ml':
      return 'mL';
    case 'dose':
      return isPlural ? 'doses' : 'dose';
    default:
      return unit;
  }
};

export interface ConfiguredReminderItem {
  medicationName: string;
  time: string;
  active: boolean;
}

/**
 * Constrói a lista de lembretes configurados diretamente a partir dos medicamentos do usuário (medications.times),
 * sem depender de tabelas intermediárias de lembretes ou de cálculos de agenda para datas específicas.
 */
export const buildConfiguredRemindersFromMedications = (
  medications?: any[] | null
): ConfiguredReminderItem[] => {
  if (!medications || !Array.isArray(medications) || medications.length === 0) {
    return [];
  }

  const reminders: ConfiguredReminderItem[] = [];

  medications.forEach(med => {
    // Medicamentos deletados (soft-deleted) não geram lembretes na lista ativa do usuário
    if (!med || med.deleted) return;

    const times = Array.isArray(med.times) ? [...med.times].sort() : [];
    const isActive = med.active !== false;

    times.forEach(time => {
      if (typeof time === 'string' && time.trim() !== '') {
        reminders.push({
          medicationName: med.name || 'Medicamento relacionado',
          time: time.trim().substring(0, 5),
          active: isActive
        });
      }
    });
  });

  return reminders;
};
