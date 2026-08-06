import { isContraceptivePauseDay, calculatePeriodDoses } from '../../domain/medicationRules';

export interface DoseReportItem {
  date: string;
  scheduledTime: string;
  confirmationTime: string;
  status: 'taken' | 'skipped' | 'missed' | 'pending';
  statusLabel: string;
}

export const getDatesInRange = (startDateStr: string, endDateStr: string): string[] => {
  const dates: string[] = [];
  const start = new Date(startDateStr + 'T12:00:00');
  const end = new Date(endDateStr + 'T12:00:00');
  const current = new Date(start);

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
};

export const getMedicationDosesForPeriod = (
  med: any,
  startDateStr: string,
  endDateStr: string,
  records: any[]
): DoseReportItem[] => {
  const dates = getDatesInRange(startDateStr, endDateStr);
  const medDoses: DoseReportItem[] = [];

  const todayObj = new Date();
  const todayStr = todayObj.toISOString().split('T')[0];
  const currentHours = String(todayObj.getHours()).padStart(2, '0');
  const currentMinutes = String(todayObj.getMinutes()).padStart(2, '0');
  const currentTimeStr = `${currentHours}:${currentMinutes}`;

  // PRN (As needed) medications
  if (med.usageCategory === 'prn') {
    const prnRecords = records.filter(
      r => r.medication_id === med.id && r.date >= startDateStr && r.date <= endDateStr && r.status === 'taken'
    );
    // Sort chronologically
    prnRecords.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.scheduled_time.localeCompare(b.scheduled_time);
    });

    return prnRecords.map(r => {
      let confTime = '-';
      if (r.created_at) {
        try {
          const date = new Date(r.created_at);
          const hours = String(date.getHours()).padStart(2, '0');
          const minutes = String(date.getMinutes()).padStart(2, '0');
          confTime = `${hours}:${minutes}`;
        } catch (e) {
          confTime = r.scheduled_time || '-';
        }
      } else {
        confTime = r.scheduled_time || '-';
      }

      return {
        date: r.date,
        scheduledTime: '-',
        confirmationTime: confTime,
        status: 'taken' as const,
        statusLabel: 'Tomado'
      };
    });
  }

  // Generate period doses if category is "period"
  let periodDoses: any[] = [];
  if (med.usageCategory === 'period' && med.startDate && med.times && med.times.length > 0) {
    const sortedTimes = [...med.times].sort();
    periodDoses = calculatePeriodDoses(
      med.startDate,
      med.times[0] || '',
      sortedTimes,
      (med.durationDays || 0) * sortedTimes.length
    );
  }

  dates.forEach(dStr => {
    const d = new Date(dStr + 'T12:00:00');
    const medStartDate = med.startDate ? new Date(med.startDate + 'T00:00:00') : null;
    const medEndDate = med.endDate ? new Date(med.endDate + 'T23:59:59') : null;

    if (medStartDate && d < medStartDate) return;

    // Contraceptive pause day rule
    if (med.usageCategory === 'contraceptive' && isContraceptivePauseDay(med, d)) {
      return;
    }

    if (med.usageCategory !== 'period' && medEndDate && d > medEndDate) return;

    // Interval days rule
    if (med.usageCategory === 'continuous' || med.usageCategory === 'intervals') {
      if (medStartDate) {
        const diffTime = d.getTime() - medStartDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));
        const interval = med.intervalDays || 1;
        if (diffDays % interval !== 0) return;
      }
    }

    // Determine expected times for this day
    let timesOnDay: string[] = [];
    if (med.usageCategory === 'period') {
      timesOnDay = periodDoses.filter(p => p.date === dStr).map(p => p.time);
    } else {
      timesOnDay = med.times || [];
    }

    timesOnDay.forEach(tStr => {
      // Find actual record
      const record = records.find(r => r.medication_id === med.id && r.date === dStr && r.scheduled_time === tStr);

      let status: 'taken' | 'skipped' | 'missed' | 'pending' = 'pending';
      let statusLabel = 'Pendente';
      let confTime = '-';

      if (record) {
        if (record.status === 'taken') {
          status = 'taken';
          statusLabel = 'Tomado';
          if (record.created_at) {
            try {
              const rDate = new Date(record.created_at);
              const hours = String(rDate.getHours()).padStart(2, '0');
              const minutes = String(rDate.getMinutes()).padStart(2, '0');
              confTime = `${hours}:${minutes}`;
            } catch (e) {
              confTime = record.scheduled_time || '-';
            }
          } else {
            confTime = record.scheduled_time || '-';
          }
        } else if (record.status === 'skipped') {
          status = 'skipped';
          statusLabel = 'Não tomado';
        } else if (record.status === 'missed') {
          status = 'missed';
          statusLabel = 'Atrasado';
        }
      } else {
        // No record: check if past
        if (dStr < todayStr) {
          status = 'skipped';
          statusLabel = 'Não tomado';
        } else if (dStr === todayStr) {
          if (tStr < currentTimeStr) {
            status = 'missed';
            statusLabel = 'Atrasado';
          } else {
            status = 'pending';
            statusLabel = 'Pendente';
          }
        } else {
          status = 'pending';
          statusLabel = 'Pendente';
        }
      }

      medDoses.push({
        date: dStr,
        scheduledTime: tStr,
        confirmationTime: confTime,
        status,
        statusLabel
      });
    });
  });

  // Sort chronological
  medDoses.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.scheduledTime.localeCompare(b.scheduledTime);
  });

  return medDoses;
};
