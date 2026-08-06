import { jsPDF } from 'jspdf';
import { supabase } from '../../lib/supabase';
import { medicationService } from '../medicationService';
import { appointmentService } from '../appointmentService';
import {
  loadImageAsPngDataUrl,
  generateQRCodeDataUrl,
  formatBrazilianDate,
  formatDateDDMMYYYY,
  getUsageCategoryLabel,
  formatUnit
} from './reportUtils';
import { applyHeadersAndFooters, drawInstitutionalFooter } from './pdfHeaderFooter';
import { getMedicationDosesForPeriod } from './doseCalculator';

export interface HistoryReportParams {
  userId: string;
  periodOption: '7' | '30' | '90' | 'all' | 'custom';
  customStartDate?: string;
  customEndDate?: string;
  medsSelection: 'all' | 'specific';
  selectedMeds: string[];
  user?: any;
  profile?: any;
}

export interface UserDataReportParams {
  user: any;
  profile: any;
}

export const reportService = {
  /**
   * Generates and downloads the Medication Taking History PDF Report
   */
  async generateHistoryReport(params: HistoryReportParams): Promise<void> {
    const { userId, periodOption, customStartDate, customEndDate, medsSelection, selectedMeds } = params;

    if (!userId) {
      throw new Error('Você precisa estar autenticado para gerar o relatório.');
    }

    // 1. Fetch latest medications, consumption records and profile in parallel
    const [freshMeds, recordsResult, profileResult] = await Promise.all([
      medicationService.getMedications(userId).catch(() => []),
      supabase.from('consumption_records').select('*').eq('user_id', userId).order('date', { ascending: false }),
      params.profile
        ? Promise.resolve({ data: params.profile })
        : supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    ]);

    const freshRecords = recordsResult.data || [];
    const userProfile = profileResult?.data || params.profile || null;
    let authUser = params.user || null;

    if (!authUser && userId) {
      try {
        const { data } = await supabase.auth.getUser();
        if (data?.user?.id === userId) {
          authUser = data.user;
        }
      } catch (e) {
        // ignore
      }
    }

    // Resolve patient name
    let patientName = 'Não informado';
    if (userProfile?.mode === 'caregiver' && userProfile?.patient_name?.trim()) {
      patientName = userProfile.patient_name.trim();
    } else if (userProfile?.name?.trim()) {
      patientName = userProfile.name.trim();
    } else if (userProfile?.full_name?.trim()) {
      patientName = userProfile.full_name.trim();
    } else if (authUser?.user_metadata?.full_name?.trim()) {
      patientName = authUser.user_metadata.full_name.trim();
    } else if (authUser?.user_metadata?.name?.trim()) {
      patientName = authUser.user_metadata.name.trim();
    } else if (authUser?.email) {
      patientName = authUser.email.split('@')[0];
    }

    // 2. Determine period start and end dates
    const todayObj = new Date();
    const todayStr = todayObj.toISOString().split('T')[0];

    let reportStartDate = todayStr;
    let reportEndDate = todayStr;

    if (periodOption === '7') {
      const start = new Date();
      start.setDate(start.getDate() - 6);
      reportStartDate = start.toISOString().split('T')[0];
    } else if (periodOption === '30') {
      const start = new Date();
      start.setDate(start.getDate() - 29);
      reportStartDate = start.toISOString().split('T')[0];
    } else if (periodOption === '90') {
      const start = new Date();
      start.setDate(start.getDate() - 89);
      reportStartDate = start.toISOString().split('T')[0];
    } else if (periodOption === 'all') {
      let minDate = todayStr;
      if (freshRecords.length > 0) {
        freshRecords.forEach((r: any) => {
          if (r.date && r.date < minDate) minDate = r.date;
        });
      }
      if (freshMeds.length > 0) {
        freshMeds.forEach((m: any) => {
          if (m.startDate && m.startDate < minDate) minDate = m.startDate;
        });
      }
      reportStartDate = minDate;
    } else if (periodOption === 'custom') {
      if (!customStartDate || !customEndDate) {
        throw new Error('Por favor, informe as datas inicial e final para o período personalizado.');
      }
      if (customStartDate > customEndDate) {
        throw new Error('A data inicial não pode ser posterior à data final.');
      }
      reportStartDate = customStartDate;
      reportEndDate = customEndDate;
    }

    // 3. Filter medications based on selection
    const medsToReport = medsSelection === 'all'
      ? freshMeds
      : freshMeds.filter((m: any) => selectedMeds.includes(m.id));

    if (medsToReport.length === 0) {
      throw new Error('Nenhum medicamento selecionado ou disponível para o relatório.');
    }

    // 4. Initialize jsPDF
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // 5. Pre-load assets (Logo and QR Code)
    let logoDataUrl: string | null = null;
    try {
      logoDataUrl = await loadImageAsPngDataUrl('/remedio-em-dia-logo-horizontal.png');
    } catch (imgErr) {
      // Fallback to text title if logo image fails to load
    }

    let qrCodeDataUrl: string | null = null;
    try {
      qrCodeDataUrl = await generateQRCodeDataUrl('https://remedioemdia.com');
    } catch (qrErr) {
      console.warn('Erro ao gerar QR Code para o PDF:', qrErr);
    }

    let currentY = 40;
    const pageHeight = 297;
    const marginBottom = 25;

    const checkPageOverflow = (neededHeight: number) => {
      if (currentY + neededHeight > pageHeight - marginBottom) {
        doc.addPage();
        currentY = 40;
      }
    };

    // --- DOCUMENT HEADER METADATA (PAGE 1) ---
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85); // slate-700

    doc.text(`Paciente: ${patientName}`, 15, currentY);
    currentY += 5;

    doc.text(`Período: ${formatDateDDMMYYYY(reportStartDate)} a ${formatDateDDMMYYYY(reportEndDate)}`, 15, currentY);
    currentY += 5;

    const genDateObj = new Date();
    const day = String(genDateObj.getDate()).padStart(2, '0');
    const month = String(genDateObj.getMonth() + 1).padStart(2, '0');
    const year = genDateObj.getFullYear();
    const hours = String(genDateObj.getHours()).padStart(2, '0');
    const minutes = String(genDateObj.getMinutes()).padStart(2, '0');
    const formattedGenDateTime = `${day}/${month}/${year} às ${hours}:${minutes}`;

    doc.text(`Gerado em: ${formattedGenDateTime}`, 15, currentY);
    currentY += 6;

    doc.setDrawColor(108, 200, 176); // Brand Green `#6CC8B0`
    doc.setLineWidth(0.2);
    doc.line(15, currentY, 195, currentY);
    currentY += 8;

    // Stats for general summary
    let totalMeds = 0;
    let totalPlanned = 0;
    let totalTaken = 0;
    let totalMissed = 0;

    // Generate data and draw for each medication
    medsToReport.forEach((med: any, medIndex: number) => {
      // Compute doses
      const medDoses = getMedicationDosesForPeriod(med, reportStartDate, reportEndDate, freshRecords);

      // Calculate statistics
      const plannedCount = med.usageCategory === 'prn' ? 0 : medDoses.length;
      const takenCount = medDoses.filter(d => d.status === 'taken').length;
      const missedCount = med.usageCategory === 'prn' ? 0 : medDoses.filter(d => d.status === 'skipped' || d.status === 'missed').length;

      // Add to general totals
      totalMeds++;
      totalPlanned += plannedCount;
      totalTaken += takenCount;
      totalMissed += missedCount;

      // Section Separator (between medications)
      if (medIndex > 0) {
        checkPageOverflow(25);
        doc.setDrawColor(108, 200, 176); // Brand Green `#6CC8B0`
        doc.setLineWidth(0.2);
        doc.line(15, currentY - 2, 195, currentY - 2);
        currentY += 6;
      }

      // DRAW MEDICATION SECTION
      checkPageOverflow(30);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(46, 124, 195); // Brand Blue `#2E7CC3`
      const medStatusSuffix = med.deleted ? ' (Inativo - Histórico)' : med.active === false ? ' (Inativo)' : '';
      doc.text(`${med.name}${medStatusSuffix}`, 15, currentY);
      currentY += 5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105); // slate-600
      const dosageStr = med.dosage ? `${med.dosage} ${formatUnit(med.unit, 2)}` : 'Não informada';
      const frequencyStr = med.usageCategory === 'prn' ? 'Se necessário' : 
                           med.times && med.times.length > 0 ? `${med.times.length}x ao dia (${med.times.join(', ')})` : '-';
      const categoryStr = getUsageCategoryLabel(med.usageCategory);
      doc.text(`Dosagem: ${dosageStr}   |   Frequência: ${frequencyStr}   |   Categoria: ${categoryStr}`, 15, currentY);
      currentY += 7;

      // Draw Table Header
      checkPageOverflow(15);
      doc.setFillColor(248, 250, 252); // slate-50
      doc.rect(15, currentY - 4, 180, 8, 'F');
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139); // slate-500
      doc.text("Data", 18, currentY + 1);
      doc.text("Horário Previsto", 63, currentY + 1);
      doc.text("Confirmação", 108, currentY + 1);
      doc.text("Situação", 158, currentY + 1);
      
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setLineWidth(0.2);
      doc.line(15, currentY + 4, 195, currentY + 4);
      currentY += 8;

      // Draw Table Body
      if (medDoses.length === 0) {
        checkPageOverflow(12);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text("Nenhum registro encontrado para este medicamento no período selecionado.", 18, currentY);
        currentY += 8;
      } else {
        medDoses.forEach(dose => {
          checkPageOverflow(8);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(51, 65, 85); // slate-700
          
          doc.text(formatBrazilianDate(dose.date), 18, currentY);
          doc.text(dose.scheduledTime, 63, currentY);
          doc.text(dose.confirmationTime || 'Não confirmada', 108, currentY);
          
          if (dose.status === 'taken') {
            doc.setTextColor(16, 185, 129); // emerald-500
            doc.text("Tomado", 158, currentY);
          } else if (dose.status === 'missed') {
            doc.setTextColor(245, 158, 11); // amber-500
            doc.text("Atrasado", 158, currentY);
          } else if (dose.status === 'skipped') {
            doc.setTextColor(239, 68, 68); // red-500
            doc.text("Não tomado", 158, currentY);
          } else {
            doc.setTextColor(100, 116, 139); // slate-500
            doc.text("Pendente", 158, currentY);
          }
          
          doc.setDrawColor(241, 245, 249); // slate-100
          doc.setLineWidth(0.15);
          doc.line(15, currentY + 2, 195, currentY + 2);
          currentY += 6;
        });
      }

      // Draw Medication Summary Card
      checkPageOverflow(24);
      doc.setFillColor(248, 250, 252); // slate-50
      doc.setDrawColor(108, 200, 176); // Brand Green `#6CC8B0`
      doc.setLineWidth(0.25);
      doc.roundedRect(15, currentY - 2, 180, 18, 3, 3, 'FD');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139); // slate-500

      // Column 1: Previstas
      doc.text("Previstas", 22, currentY + 3);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(51, 65, 85); // slate-700
      doc.text(`${plannedCount}`, 22, currentY + 11);

      // Column 2: Realizadas
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text("Realizadas", 62, currentY + 3);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(46, 124, 195); // Brand Blue `#2E7CC3`
      doc.text(`${takenCount}`, 62, currentY + 11);

      // Column 3: Perdidas
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text("Perdidas", 102, currentY + 3);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(239, 68, 68); // Red
      doc.text(`${missedCount}`, 102, currentY + 11);

      // Column 4: Adesão
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text("Adesão", 142, currentY + 3);

      const rateStr = plannedCount > 0 ? `${((takenCount / plannedCount) * 100).toFixed(1)}%` : '-';
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      if (plannedCount === 0) {
        doc.setTextColor(100, 116, 139);
      } else {
        const pct = (takenCount / plannedCount) * 100;
        if (pct >= 90) {
          doc.setTextColor(16, 185, 129); // emerald-500
        } else if (pct >= 70) {
          doc.setTextColor(245, 158, 11); // amber-500
        } else {
          doc.setTextColor(239, 68, 68); // red-500
        }
      }
      doc.text(rateStr, 142, currentY + 11);

      currentY += 22; // Spacing after card
    });

    // --- GENERAL SUMMARY SECTION ---
    checkPageOverflow(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(46, 124, 195); // Brand Blue `#2E7CC3`
    doc.text("Resumo Geral de Adesão", 15, currentY);
    currentY += 6;

    doc.setFillColor(240, 247, 255); // soft blue-50
    doc.setDrawColor(46, 124, 195); // Brand Blue `#2E7CC3`
    doc.setLineWidth(0.3);
    doc.roundedRect(15, currentY - 2, 180, 28, 3, 3, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85); // slate-700

    doc.text(`• Medicamentos incluídos: ${totalMeds}`, 22, currentY + 4);
    doc.text(`• Total de tomadas previstas: ${totalPlanned}`, 22, currentY + 10);
    doc.text(`• Total de tomadas realizadas: ${totalTaken}`, 22, currentY + 16);
    doc.text(`• Total de doses não tomadas: ${totalMissed}`, 22, currentY + 22);

    // Large adherence percentage on the right
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(46, 124, 195); // Brand Blue `#2E7CC3`
    doc.text("Adesão Geral:", 120, currentY + 9);

    const overallPctStr = totalPlanned > 0 ? `${((totalTaken / totalPlanned) * 100).toFixed(1)}%` : '-';
    doc.setFontSize(22);
    if (totalPlanned === 0) {
      doc.setTextColor(100, 116, 139);
    } else {
      const pct = (totalTaken / totalPlanned) * 100;
      if (pct >= 90) {
        doc.setTextColor(16, 185, 129); // emerald-500
      } else if (pct >= 70) {
        doc.setTextColor(245, 158, 11); // amber-500
      } else {
        doc.setTextColor(239, 68, 68); // red-500
      }
    }
    doc.text(overallPctStr, 120, currentY + 19);

    currentY += 32; // Spacing after summary

    // --- LAST PAGE INSTITUTIONAL AREA ---
    drawInstitutionalFooter(doc, currentY, qrCodeDataUrl, pageHeight, marginBottom);

    // --- HEADERS AND FOOTERS LOOP ---
    applyHeadersAndFooters(doc, {
      logoDataUrl,
      reportTitle: "Relatório de Histórico de Tomadas"
    });

    // Save the PDF
    doc.save(`historico-tomadas-${reportStartDate}-a-${reportEndDate}.pdf`);
  },

  /**
   * Generates and downloads the Account Personal Data PDF Report (Download My Data)
   */
  async generateUserDataReport(params: UserDataReportParams): Promise<void> {
    const { user, profile } = params;

    if (!user) {
      throw new Error('Você precisa estar autenticado para baixar seus dados.');
    }

    // 1. Fetch user data in parallel
    const [medications, appointments, { data: reminders, error: remindersError }, { data: preferences, error: preferencesError }, { data: consumptionRecords, error: consumptionError }] = await Promise.all([
      medicationService.getMedications(user.id).catch(() => []),
      appointmentService.getAppointments(user.id).catch(() => []),
      supabase.from('medication_reminders').select('*').eq('user_id', user.id),
      supabase.from('user_preferences').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('consumption_records').select('*').eq('user_id', user.id).order('date', { ascending: false })
    ]);

    if (remindersError) console.error('[reportService] Error fetching reminders:', remindersError.message);
    if (preferencesError) console.error('[reportService] Error fetching preferences:', preferencesError.message);
    if (consumptionError) console.error('[reportService] Error fetching consumption records:', consumptionError);

    // 2. Create PDF Document
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // 3. Pre-load logo image and static QR code
    let logoDataUrl: string | null = null;
    try {
      logoDataUrl = await loadImageAsPngDataUrl('/remedio-em-dia-logo-horizontal.png');
    } catch (imgErr) {
      // Fallback to text title if logo image fails to load
    }

    let qrCodeDataUrl: string | null = null;
    try {
      qrCodeDataUrl = await generateQRCodeDataUrl('https://remedioemdia.com');
    } catch (qrErr) {
      console.warn('Erro ao gerar QR Code para o PDF:', qrErr);
    }

    let currentY = 40;
    const pageHeight = 297;
    const marginBottom = 25;

    // Self-paging text printers
    const addText = (text: string, x: number, options?: { fontSize?: number; fontStyle?: 'normal' | 'bold' | 'italic'; color?: [number, number, number]; maxWidth?: number }) => {
      if (options?.fontSize) doc.setFontSize(options.fontSize);
      if (options?.fontStyle) doc.setFont('helvetica', options.fontStyle);
      if (options?.color) {
        doc.setTextColor(options.color[0], options.color[1], options.color[2]);
      } else {
        doc.setTextColor(51, 65, 85); // slate-700 default
      }
      
      const width = options?.maxWidth || (195 - x);
      const splitLines = doc.splitTextToSize(text, width);
      const neededHeight = splitLines.length * ((options?.fontSize || 9) * 0.45);
      
      if (currentY + neededHeight > pageHeight - marginBottom) {
        doc.addPage();
        currentY = 40;
      }

      if (options?.fontSize) doc.setFontSize(options.fontSize);
      if (options?.fontStyle) doc.setFont('helvetica', options.fontStyle);
      if (options?.color) {
        doc.setTextColor(options.color[0], options.color[1], options.color[2]);
      } else {
        doc.setTextColor(51, 65, 85);
      }
      
      doc.text(splitLines, x, currentY);
      currentY += neededHeight + 2.5;
    };

    const addSeparatorLine = () => {
      if (currentY + 6 > pageHeight - marginBottom) {
        doc.addPage();
        currentY = 40;
      }
      doc.setDrawColor(108, 200, 176); // Brand Green `#6CC8B0`
      doc.setLineWidth(0.2);
      doc.line(15, currentY, 195, currentY);
      currentY += 8;
    };

    const addSectionHeader = (title: string) => {
      if (currentY + 14 > pageHeight - marginBottom) {
        doc.addPage();
        currentY = 40;
      }
      doc.setFillColor(248, 250, 252); // soft slate-50
      doc.rect(15, currentY, 180, 8, 'F');
      doc.setDrawColor(46, 124, 195); // Brand Blue `#2E7CC3`
      doc.setLineWidth(0.4);
      doc.line(15, currentY, 15, currentY + 8); // left accent bar
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(46, 124, 195); // Brand Blue `#2E7CC3`
      doc.text(title, 19, currentY + 5.5);
      currentY += 12;
    };

    // --- INTRODUCTORY METADATA ---
    addText("Este documento serve para consulta amigável de todos os dados salvos em sua conta, em total conformidade com os princípios de transparência e portabilidade da Lei Geral de Proteção de Dados (LGPD).", 15, { fontSize: 8.5, fontStyle: 'italic', color: [100, 116, 139], maxWidth: 180 });
    currentY += 2;
    addSeparatorLine();

    // --- DADOS DA CONTA ---
    addSectionHeader("1. Dados da Conta");
    
    const uName = profile?.mode === 'caregiver' && profile?.caregiver_name 
      ? `${profile.caregiver_name} (Cuidador de ${profile?.patient_name || 'Paciente'})`
      : (profile?.name || user?.user_metadata?.full_name || 'Não cadastrado');
    
    addText(`• Nome do Titular: ${uName}`, 18, { fontSize: 9.5 });
    addText(`• E-mail cadastrado: ${user.email || 'Não informado'}`, 18, { fontSize: 9.5 });
    
    const registrationDate = user?.created_at ? formatBrazilianDate(user.created_at) : 'Não identificada';
    addText(`• Data de criação da conta: ${registrationDate}`, 18, { fontSize: 9.5 });
    
    currentY += 4;
    addSeparatorLine();

    // --- MEDICAMENTOS ---
    addSectionHeader("2. Medicamentos Cadastrados");

    if (medications && medications.length > 0) {
      medications.forEach((med, index) => {
        const statusSuffix = med.deleted ? ' (Inativo - Histórico)' : med.active === false ? ' (Inativo)' : ' (Ativo)';
        addText(`${index + 1}. ${med.name}${statusSuffix}`, 18, { fontSize: 10, fontStyle: 'bold', color: (med.deleted || med.active === false) ? [100, 116, 139] : [46, 124, 195] });
        const dosageInfo = med.dosage ? `${med.dosage} ${formatUnit(med.unit, 2)}` : 'Não informada';
        addText(`   • Dosagem: ${dosageInfo}`, 18, { fontSize: 9 });
        addText(`   • Categoria: ${getUsageCategoryLabel(med.usageCategory)}`, 18, { fontSize: 9 });
        if (med.times && med.times.length > 0) {
          addText(`   • Horários agendados: ${med.times.join(', ')}`, 18, { fontSize: 9 });
        }
        if (med.deleted && med.deleted_at) {
          addText(`   • Data da inativação: ${formatBrazilianDate(med.deleted_at)}`, 18, { fontSize: 9, color: [100, 116, 139] });
        }
        if (med.notes) {
          addText(`   • Anotações: ${med.notes}`, 18, { fontSize: 9, maxWidth: 165 });
        }
        
        // Adiciona histórico de consumo
        const records = (consumptionRecords || []).filter((r: any) => r.medication_id === med.id);
        if (records.length > 0) {
          const formattedHistory = records.slice(0, 8).map((r: any) => {
            const statusLabel = r.status === 'taken' ? 'Tomado' : r.status === 'skipped' ? 'Pulado' : 'Atrasado';
            return `${formatBrazilianDate(r.date)} às ${r.scheduled_time} (${statusLabel})`;
          }).join(', ');
          addText(`   • Histórico de consumo recente: ${formattedHistory}${records.length > 8 ? '...' : ''}`, 18, { fontSize: 8.5, color: [100, 116, 139], maxWidth: 165 });
        } else {
          addText(`   • Histórico de consumo: Nenhum registro de consumo`, 18, { fontSize: 8.5, color: [148, 163, 184] });
        }
        currentY += 2;
      });
    } else {
      addText("Nenhum medicamento cadastrado no momento.", 18, { fontSize: 9.5, fontStyle: 'italic', color: [148, 163, 184] });
    }

    currentY += 4;
    addSeparatorLine();

    // --- ESTOQUES ---
    addSectionHeader("3. Controle de Estoques");

    if (medications && medications.length > 0) {
      let hasStock = false;
      medications.forEach(med => {
        if (med.currentStock !== undefined || med.totalStock !== undefined) {
          hasStock = true;
          const current = med.currentStock ?? 0;
          const total = med.totalStock ?? 0;
          const unitLabel = formatUnit(med.unit, current);
          addText(`• ${med.name}: Quantidade atual: ${current} ${unitLabel} (Total inicial configurado: ${total} ${formatUnit(med.unit, total)})`, 18, { fontSize: 9.5 });
        }
      });
      if (!hasStock) {
        addText("Controle de estoque desativado para os medicamentos cadastrados.", 18, { fontSize: 9.5, color: [100, 116, 139] });
      }
    } else {
      addText("Sem medicamentos para controle de estoque.", 18, { fontSize: 9.5, fontStyle: 'italic', color: [148, 163, 184] });
    }

    currentY += 4;
    addSeparatorLine();

    // --- LEMBRETES ---
    addSectionHeader("4. Lembretes Configurados");

    if (reminders && reminders.length > 0) {
      reminders.forEach((rem, idx) => {
        const medName = rem.medication_name || 'Medicamento relacionado';
        const time = rem.reminder_time ? rem.reminder_time.substring(0, 5) : 'Não definido';
        const status = rem.active ? 'Ativo' : 'Inativo';
        addText(`• Lembrete #${idx + 1}: ${medName} - Horário: ${time} - Status de disparo: ${status}`, 18, { fontSize: 9.5 });
      });
    } else {
      addText("Nenhum lembrete automático registrado para notificações push.", 18, { fontSize: 9.5, fontStyle: 'italic', color: [148, 163, 184] });
    }

    currentY += 4;
    addSeparatorLine();

    // --- CONFIGURAÇÕES ---
    addSectionHeader("5. Configurações de Uso do Aplicativo");

    // Use preferences from DB, fallback to profile preferences or standard defaults
    const expiringThreshold = preferences?.threshold_expiring ?? 7;
    const runningOutThreshold = preferences?.threshold_running_out ?? 5;
    const delayAlert = preferences?.show_delay_disclaimer ? 'Sim (Ativado)' : 'Não (Desativado)';
    const friendlyGreeting = preferences?.show_greeting ? 'Sim (Ativado)' : 'Não (Desativado)';
    const notificationsOn = preferences?.push_notifications_enabled ? 'Sim (Ativado)' : 'Não (Desativado)';
    const preMinutes = preferences?.pre_notification_minutes ?? 0;

    addText(`• Aviso de expiração de medicamentos: Exibir alertas ${expiringThreshold} dias antes de vencer.`, 18, { fontSize: 9.5 });
    addText(`• Alerta de estoque baixo: Exibir quando restarem menos de ${runningOutThreshold} dias de uso do medicamento.`, 18, { fontSize: 9.5 });
    addText(`• Exibir aviso de atrasos no Dashboard: ${delayAlert}`, 18, { fontSize: 9.5 });
    addText(`• Exibir mensagens motivacionais e de carinho: ${friendlyGreeting}`, 18, { fontSize: 9.5 });
    addText(`• Notificações Push Globais da Conta: ${notificationsOn}`, 18, { fontSize: 9.5 });
    if (preferences?.push_notifications_enabled) {
      addText(`• Antecipação de notificações: Lembretes emitidos com ${preMinutes} minutos de antecedência do horário regular.`, 18, { fontSize: 9.5 });
    }

    currentY += 4;
    addSeparatorLine();

    // --- APPOINTMENTS (IF ANY) ---
    if (appointments && appointments.length > 0) {
      addSectionHeader("6. Compromissos e Consultas");
      appointments.forEach((app, index) => {
        const statusSuffix = app.deleted ? ' (Inativo - Histórico)' : app.active === false ? ' (Inativo)' : ' (Agendado)';
        addText(`• ${app.type} com Dr(a). ${app.doctor || 'Não informado'} (${app.specialty || 'Especialidade não especificada'})${statusSuffix}`, 18, { fontSize: 9.5, fontStyle: 'bold', color: (app.deleted || app.active === false) ? [100, 116, 139] : [51, 65, 85] });
        addText(`  Data: ${formatBrazilianDate(app.date)} às ${app.time}`, 18, { fontSize: 9 });
        if (app.deleted && app.deleted_at) {
          addText(`  Data da inativação: ${formatBrazilianDate(app.deleted_at)}`, 18, { fontSize: 9, color: [100, 116, 139] });
        }
        if (app.location) addText(`  Local: ${app.location}`, 18, { fontSize: 9 });
        if (app.notes) addText(`  Notas adicionais: ${app.notes}`, 18, { fontSize: 9, maxWidth: 165 });
        currentY += 1;
      });
      currentY += 4;
      addSeparatorLine();
    }

    // --- EXPORT INFORMATION ---
    addText("Informações da Exportação", 15, { fontSize: 10.5, fontStyle: 'bold', color: [100, 116, 139] });
    currentY += 1;
    
    const generationDate = new Date();
    addText(`• Gerado em: ${generationDate.toLocaleString('pt-BR')}`, 18, { fontSize: 8.5, color: [100, 116, 139] });
    addText("• Observação: Este relatório foi gerado diretamente pelo sistema e contém apenas informações relacionadas à sua conta e utilização do aplicativo.", 18, { fontSize: 8.5, color: [100, 116, 139], maxWidth: 175 });

    currentY += 8;

    // --- LAST PAGE INSTITUTIONAL AREA ---
    drawInstitutionalFooter(doc, currentY, qrCodeDataUrl, pageHeight, marginBottom);

    // --- HEADERS AND FOOTERS LOOP ---
    applyHeadersAndFooters(doc, {
      logoDataUrl,
      reportTitle: "Relatório de Dados da Conta"
    });

    // Generate file name
    const year = generationDate.getFullYear();
    const month = String(generationDate.getMonth() + 1).padStart(2, '0');
    const day = String(generationDate.getDate()).padStart(2, '0');
    const fileName = `remedio-em-dia-${year}-${month}-${day}.pdf`;

    // Save PDF to browser
    doc.save(fileName);
  }
};
