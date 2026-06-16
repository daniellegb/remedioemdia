import React, { useState } from 'react';
import { ArrowLeft, Shield, Download, FileText, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { useAuth } from '../src/hooks/useAuth';
import { ViewType } from '../types';
import { motion } from 'motion/react';
import { supabase } from '../src/lib/supabase';
import { medicationService } from '../src/services/medicationService';
import { appointmentService } from '../src/services/appointmentService';
import { jsPDF } from 'jspdf';

interface Props {
  setView: (view: ViewType) => void;
}

const Privacy: React.FC<Props> = ({ setView }) => {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatBrazilianDate = (dateStr?: string) => {
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

  const getUsageCategoryLabel = (category?: string) => {
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

  const formatUnit = (unit?: string, qty: number = 1) => {
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

  const handleDownloadData = async () => {
    if (!user) {
      setError('Você precisa estar autenticado para baixar seus dados.');
      return;
    }

    setLoading(true);
    setSuccess(false);
    setError(null);

    try {
      // 1. Fetch user data in parallel
      const [medications, appointments, { data: reminders, error: remindersError }, { data: preferences, error: preferencesError }] = await Promise.all([
        medicationService.getMedications(user.id).catch(() => []),
        appointmentService.getAppointments(user.id).catch(() => []),
        supabase.from('medication_reminders').select('*').eq('user_id', user.id),
        supabase.from('user_preferences').select('*').eq('user_id', user.id).maybeSingle()
      ]);

      if (remindersError) console.error('[Privacy] Error fetching reminders:', remindersError.message);
      if (preferencesError) console.error('[Privacy] Error fetching preferences:', preferencesError.message);

      // Create PDF Document
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      let currentY = 20;
      const pageHeight = 297;
      const marginBottom = 20;

      // Self-paging text printers
      const addText = (text: string, x: number, options?: { fontSize?: number; fontStyle?: 'normal' | 'bold'; color?: [number, number, number]; maxWidth?: number }) => {
        if (options?.fontSize) doc.setFontSize(options.fontSize);
        if (options?.fontStyle) doc.setFont('helvetica', options.fontStyle);
        if (options?.color) {
          doc.setTextColor(options.color[0], options.color[1], options.color[2]);
        } else {
          doc.setTextColor(30, 41, 59); // slate-800 default
        }
        
        const width = options?.maxWidth || 180;
        const splitLines = doc.splitTextToSize(text, width);
        const neededHeight = splitLines.length * ((options?.fontSize || 10) * 0.45);
        
        if (currentY + neededHeight > pageHeight - marginBottom) {
          doc.addPage();
          currentY = 20;
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(148, 163, 184); // slate-400
          doc.text("Remédio em Dia - Relatório de Dados da Conta", 15, 12);
          doc.line(15, 14, 195, 14);
          currentY = 20;
        }

        if (options?.fontSize) doc.setFontSize(options.fontSize);
        if (options?.fontStyle) doc.setFont('helvetica', options.fontStyle);
        
        doc.text(splitLines, x, currentY);
        currentY += neededHeight + 2;
      };

      const addSeparatorLine = () => {
        if (currentY + 5 > pageHeight - marginBottom) {
          doc.addPage();
          currentY = 20;
        }
        doc.setDrawColor(226, 232, 240); // slate-200
        doc.line(15, currentY, 195, currentY);
        currentY += 6;
      };

      // --- DOCUMENT HEADER ---
      // Accent bar at the top
      doc.setFillColor(37, 99, 235); // Blue-600
      doc.rect(15, currentY, 180, 4, 'F');
      currentY += 10;

      addText("Remédio em Dia", 15, { fontSize: 24, fontStyle: 'bold', color: [37, 99, 235] });
      addText("Relatório de Dados da Conta", 15, { fontSize: 11, fontStyle: 'bold', color: [100, 116, 139] });
      addText("Este documento serve para consulta amigável de todos os dados salvos em sua conta, em total conformidade com os princípios de transparência (LGPD).", 15, { fontSize: 9, fontStyle: 'normal', color: [100, 116, 139], maxWidth: 175 });
      
      currentY += 4;
      addSeparatorLine();

      // --- DADOS DA CONTA ---
      addText("1. Dados da Conta", 15, { fontSize: 14, fontStyle: 'bold', color: [30, 41, 59] });
      currentY += 2;
      
      const uName = profile?.mode === 'caregiver' && profile?.caregiver_name 
        ? `${profile.caregiver_name} (Cuidador de ${profile?.patient_name || 'Paciente'})`
        : (profile?.name || user?.user_metadata?.full_name || 'Não cadastrado');
      
      addText(`• Nome do Titular: ${uName}`, 18, { fontSize: 10 });
      addText(`• E-mail cadastrado: ${user.email || 'Não informado'}`, 18, { fontSize: 10 });
      
      const registrationDate = user?.created_at ? formatBrazilianDate(user.created_at) : 'Não identificada';
      addText(`• Data de criação da conta: ${registrationDate}`, 18, { fontSize: 10 });
      
      currentY += 4;
      addSeparatorLine();

      // --- MEDICAMENTOS ---
      addText("2. Medicamentos Cadastrados", 15, { fontSize: 14, fontStyle: 'bold', color: [30, 41, 59] });
      currentY += 2;

      if (medications && medications.length > 0) {
        medications.forEach((med, index) => {
          addText(`${index + 1}. ${med.name}`, 18, { fontSize: 11, fontStyle: 'bold', color: [37, 99, 235] });
          const dosageInfo = med.dosage ? `${med.dosage} ${formatUnit(med.unit, 2)}` : 'Não informada';
          addText(`   • Dosagem: ${dosageInfo}`, 18, { fontSize: 10 });
          addText(`   • Categoria: ${getUsageCategoryLabel(med.usageCategory)}`, 18, { fontSize: 10 });
          if (med.times && med.times.length > 0) {
            addText(`   • Horários agendados: ${med.times.join(', ')}`, 18, { fontSize: 10 });
          }
          if (med.notes) {
            addText(`   • Anotações: ${med.notes}`, 18, { fontSize: 10, maxWidth: 165 });
          }
          currentY += 2;
        });
      } else {
        addText("Nenhum medicamento cadastrado no momento.", 18, { fontSize: 10, fontStyle: 'normal', color: [148, 163, 184] });
      }

      currentY += 4;
      addSeparatorLine();

      // --- ESTOQUES ---
      addText("3. Estoques", 15, { fontSize: 14, fontStyle: 'bold', color: [30, 41, 59] });
      currentY += 2;

      if (medications && medications.length > 0) {
        let hasStock = false;
        medications.forEach(med => {
          if (med.currentStock !== undefined || med.totalStock !== undefined) {
            hasStock = true;
            const current = med.currentStock ?? 0;
            const total = med.totalStock ?? 0;
            const unitLabel = formatUnit(med.unit, current);
            addText(`• ${med.name}: Quantidade atual: ${current} ${unitLabel} (Total inicial configurado: ${total} ${formatUnit(med.unit, total)})`, 18, { fontSize: 10 });
          }
        });
        if (!hasStock) {
          addText("Controle de estoque desativado para os medicamentos cadastrados.", 18, { fontSize: 10, color: [100, 116, 139] });
        }
      } else {
        addText("Sem medicamentos para controle de estoque.", 18, { fontSize: 10, fontStyle: 'normal', color: [148, 163, 184] });
      }

      currentY += 4;
      addSeparatorLine();

      // --- LEMBRETES ---
      addText("4. Lembretes Configurados", 15, { fontSize: 14, fontStyle: 'bold', color: [30, 41, 59] });
      currentY += 2;

      if (reminders && reminders.length > 0) {
        reminders.forEach((rem, idx) => {
          const medName = rem.medication_name || 'Medicamento relacionado';
          const time = rem.reminder_time ? rem.reminder_time.substring(0, 5) : 'Não definido';
          const status = rem.active ? 'Ativo' : 'Inativo';
          addText(`• Lembrete #${idx + 1}: ${medName} - Horário: ${time} - Status de disparo: ${status}`, 18, { fontSize: 10 });
        });
      } else {
        addText("Nenhum lembrete automático registrado para notificações push.", 18, { fontSize: 10, fontStyle: 'normal', color: [148, 163, 184] });
      }

      currentY += 4;
      addSeparatorLine();

      // --- CONFIGURAÇÕES ---
      addText("5. Configurações de Uso do Aplicativo", 15, { fontSize: 14, fontStyle: 'bold', color: [30, 41, 59] });
      currentY += 2;

      // Use preferences from DB, fallback to profile preferences or standard defaults
      const expiringThreshold = preferences?.threshold_expiring ?? 7;
      const runningOutThreshold = preferences?.threshold_running_out ?? 5;
      const delayAlert = preferences?.show_delay_disclaimer ? 'Sim (Ativado)' : 'Não (Desativado)';
      const friendlyGreeting = preferences?.show_greeting ? 'Sim (Ativado)' : 'Não (Desativado)';
      const notificationsOn = preferences?.push_notifications_enabled ? 'Sim (Ativado)' : 'Não (Desativado)';
      const preMinutes = preferences?.pre_notification_minutes ?? 0;

      addText(`• Aviso de expiração de medicamentos: Exibir alertas ${expiringThreshold} dias antes de vencer.`, 18, { fontSize: 10 });
      addText(`• Alerta de estoque baixo: Exibir quando restarem menos de ${runningOutThreshold} dias de uso do medicamento.`, 18, { fontSize: 10 });
      addText(`• Exibir aviso de atrasos no Dashboard: ${delayAlert}`, 18, { fontSize: 10 });
      addText(`• Exibir mensagens motivacionais e de carinho: ${friendlyGreeting}`, 18, { fontSize: 10 });
      addText(`• Notificações Push Globais da Conta: ${notificationsOn}`, 18, { fontSize: 10 });
      if (preferences?.push_notifications_enabled) {
        addText(`• Antecipação de notificações: Lembretes emitidos com ${preMinutes} minutos de antecedência do horário regular.`, 18, { fontSize: 10 });
      }

      currentY += 4;
      addSeparatorLine();

      // --- APPOINTMENTS (IF ANY) ---
      if (appointments && appointments.length > 0) {
        addText("6. Compromissos e Consultas", 15, { fontSize: 14, fontStyle: 'bold', color: [30, 41, 59] });
        currentY += 2;
        appointments.forEach((app, index) => {
          addText(`• ${app.type} com Dr(a). ${app.doctor || 'Não informado'} (${app.specialty || 'Especialidade não especificada'})`, 18, { fontSize: 10, fontStyle: 'bold' });
          addText(`  Data: ${formatBrazilianDate(app.date)} às ${app.time}`, 18, { fontSize: 9 });
          if (app.location) addText(`  Local: ${app.location}`, 18, { fontSize: 9 });
          if (app.notes) addText(`  Notas adicionais: ${app.notes}`, 18, { fontSize: 9, maxWidth: 165 });
          currentY += 1;
        });
        currentY += 4;
        addSeparatorLine();
      }

      // --- EXPORT INFORMATION ---
      addText("Informações da Exportação", 15, { fontSize: 11, fontStyle: 'bold', color: [100, 116, 139] });
      currentY += 1;
      
      const generationDate = new Date();
      addText(`• Gerado em: ${generationDate.toLocaleString('pt-BR')}`, 18, { fontSize: 9, color: [100, 116, 139] });
      addText("• Observação: Este relatório foi gerado diretamente pelo sistema e contém apenas informações relacionadas à sua conta e utilização do aplicativo.", 18, { fontSize: 9, color: [100, 116, 139], maxWidth: 175 });

      currentY += 8;
      // Accent bar at the bottom
      doc.setFillColor(226, 232, 240); // slate-200
      doc.rect(15, currentY > 275 ? 275 : currentY, 180, 1, 'F');

      // Generate file name
      const year = generationDate.getFullYear();
      const month = String(generationDate.getMonth() + 1).padStart(2, '0');
      const day = String(generationDate.getDate()).padStart(2, '0');
      const fileName = `remedio-em-dia-${year}-${month}-${day}.pdf`;

      // Save PDF to browser
      doc.save(fileName);
      setSuccess(true);
    } catch (err: any) {
      console.error('[Privacy] PDF generation failed:', err);
      setError('Falha ao gerar o arquivo PDF: ' + (err.message || 'Erro de renderização do PDF.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      id="privacy-page-container"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
      transition={{ duration: 0.3 }}
      className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-0"
    >
      {/* Back Header */}
      <div className="flex items-center gap-4">
        <button
          id="btn-back-to-settings-from-privacy"
          onClick={() => setView('settings')}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-2xl transition-all"
        >
          <ArrowLeft size={16} />
          Voltar
        </button>
      </div>

      {/* Hero Display */}
      <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl p-6 md:p-8 text-white shadow-xl shadow-blue-100 relative overflow-hidden">
        <div className="absolute right-0 bottom-0 translate-x-4 translate-y-4 opacity-10">
          <Shield size={240} />
        </div>
        <div className="relative z-10 space-y-3">
          <div className="p-3 bg-white/10 rounded-2xl w-fit">
            <Shield size={32} />
          </div>
          <h2 className="text-2xl font-bold">Privacidade & Meus Dados</h2>
          <p className="text-blue-100 text-sm max-w-md leading-relaxed">
            Aqui você gerencia as solicitações sobre a custódia, transparência e portabilidade de seus dados pessoais em total conformidade com a LGPD.
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Status Banners */}
        {success && (
          <div id="privacy-success-banner" className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-emerald-800 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
            <CheckCircle2 className="text-emerald-500 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="font-bold">PDF gerado com sucesso!</p>
              <p className="text-emerald-600">Seu relatório de dados pessoais está pronto para download.</p>
            </div>
          </div>
        )}

        {error && (
          <div id="privacy-error-banner" className="bg-red-50 border border-red-100 rounded-2xl p-4 text-red-700 text-sm flex gap-3 items-start animate-in fade-in slide-in-from-top-1 duration-300">
            <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="font-bold">Ocorreu um erro no processo</p>
              <p className="text-red-600">{error}</p>
            </div>
          </div>
        )}

        {/* Baixar meus dados section */}
        <div id="privacy-download-card" className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden p-6 space-y-6">
          <div className="flex gap-4 items-start">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl shrink-0">
              <FileText size={24} />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-slate-800 text-lg">Baixar meus dados</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                Você pode solicitar uma cópia dos dados armazenados em sua conta.
              </p>
            </div>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl text-xs text-slate-500 flex gap-2">
            <Clock size={16} className="text-slate-400 shrink-0 mt-0.5" />
            <p>
              Este relatório apresenta seus dados de forma clara e organizada, contendo apenas informações relevantes da sua conta e utilização do aplicativo.
            </p>
          </div>

          <button
            id="btn-trigger-pdf-download"
            disabled={loading}
            onClick={handleDownloadData}
            className={`w-full font-bold py-4 px-6 rounded-2xl flex items-center justify-center gap-2 transition-all ${
              loading 
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-100 active:scale-[0.98]'
            }`}
          >
            <Download size={18} className={loading ? 'animate-bounce' : ''} />
            {loading ? 'Reunindo dados e gerando PDF...' : 'Baixar PDF'}
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default Privacy;
