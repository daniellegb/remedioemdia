
import React from 'react';
import { Medication, AppSettings } from '../types';
import { Plus, Trash2, Pill, AlertTriangle, CalendarDays, CheckCircle2, AlertCircle, XCircle, Clock, Info, Pencil, RefreshCw } from 'lucide-react';
import { calculateDaysOfStockLeft } from '../src/domain/stock';
import { getStockStatusType, getExpiryStatusType, getDaysUntilExpiry } from '../src/domain/medicationRules';
import { FREE_PLAN_LIMITS } from '../constants';

interface Props {
  meds: Medication[];
  settings: AppSettings;
  onAdd: () => void;
  onEdit: (med: Medication) => void;
  onDelete: (id: string) => void;
  onReactivate: (id: string) => void;
  isPremium?: boolean;
  onUpgradeClick?: () => void;
}

const Medications: React.FC<Props> = React.memo(({ meds, settings, onAdd, onEdit, onDelete, onReactivate, isPremium = false, onUpgradeClick }) => {
  const activeMeds = meds.filter(m => m.active !== false && m.active !== 'false' && m.active !== 0);
  const inactiveMeds = meds.filter(m => m.active === false || m.active === 'false' || m.active === 0);
  
  const currentCount = activeMeds.length;
  const maxLimit = FREE_PLAN_LIMITS.medications;
  const percentage = Math.min(100, (currentCount / maxLimit) * 100);

  const [showInactive, setShowInactive] = React.useState(false);
  const hasInactive = inactiveMeds.length > 0;

  // Auto-hide inactive section if there are none left
  React.useEffect(() => {
    if (!hasInactive) {
      setShowInactive(false);
    }
  }, [hasInactive]);

  // Determine progress bar color based on usage percentage
  let barColor = 'bg-blue-600';
  let textColor = 'text-blue-600';
  let badgeColor = 'bg-blue-50 text-blue-700 border-blue-100';

  if (percentage > 50 && percentage <= 80) {
    barColor = 'bg-amber-500';
    textColor = 'text-amber-600';
    badgeColor = 'bg-amber-50 text-amber-700 border-amber-100';
  } else if (percentage > 80 && percentage < 100) {
    barColor = 'bg-orange-500';
    textColor = 'text-orange-600';
    badgeColor = 'bg-orange-50 text-orange-700 border-orange-100';
  } else if (percentage >= 100) {
    barColor = 'bg-red-500';
    textColor = 'text-red-600';
    badgeColor = 'bg-red-50 text-red-700 border-red-100';
  }
  
  const getStockStatus = (med: Medication) => {
    const daysLeft = calculateDaysOfStockLeft(med);
    const statusType = getStockStatusType(med, daysLeft, settings.thresholdRunningOut);

    if (statusType === 'OUT_OF_STOCK') {
      return { label: 'Esgotado', color: 'text-slate-400', bg: 'bg-slate-100', icon: AlertCircle };
    }
    
    if (statusType === 'RUNNING_OUT') {
      return { label: `Acabando (${daysLeft}d)`, color: 'text-orange-500', bg: 'bg-orange-50', icon: AlertTriangle };
    }

    return { label: 'Disponível', color: 'text-green-500', bg: 'bg-green-50', icon: CheckCircle2 };
  };

  const getExpiryStatus = (med: Medication) => {
    const today = new Date();
    const statusType = getExpiryStatusType(med, today, settings.thresholdExpiring);
    const diffDays = getDaysUntilExpiry(med.expiryDate, today);

    if (statusType === 'NO_DATE') return { label: 'Sem data', color: 'text-slate-400', bg: 'bg-slate-50', icon: Info };

    if (statusType === 'EXPIRED') {
      return { label: 'Vencido', color: 'text-red-500', bg: 'bg-red-50', icon: XCircle };
    }

    if (statusType === 'EXPIRING_SOON') {
      return { label: `Vencendo em ${diffDays}d`, color: 'text-orange-500', bg: 'bg-orange-50', icon: Clock };
    }

    return { label: 'Na validade', color: 'text-green-500', bg: 'bg-green-50', icon: CheckCircle2 };
  };

  const renderMedCard = (med: Medication, isInactive: boolean) => {
    const stockStatus = getStockStatus(med);
    const expiryStatus = getExpiryStatus(med);
    const stockPercent = Math.min(100, (med.currentStock / med.totalStock) * 100);

    return (
      <div 
        key={med.id} 
        className={`bg-white p-6 rounded-[32px] border shadow-md relative overflow-hidden group transition-all hover:shadow-xl hover:border-slate-200 ${
          isInactive 
            ? 'opacity-60 border-dashed border-slate-350 bg-slate-50/40 hover:opacity-85' 
            : 'border-slate-100'
        }`}
      >
        {isInactive && (
          <span className="absolute right-4 top-4 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-slate-200 text-slate-600 border border-slate-300 z-10">
            Inativo
          </span>
        )}

        <div className="flex justify-between items-start mb-4">
          <div className="flex flex-col gap-1.5">
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${stockStatus.bg} ${stockStatus.color}`}>
              <stockStatus.icon size={10} />
              Estoque: {stockStatus.label}
            </div>
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${expiryStatus.bg} ${expiryStatus.color}`}>
              <expiryStatus.icon size={10} />
              Validade: {expiryStatus.label}
            </div>
          </div>
        </div>

        <div className="flex gap-4 mb-6">
          <div className={`w-14 h-14 ${isInactive ? 'bg-slate-300' : med.color} text-white rounded-2xl flex items-center justify-center shadow-lg shadow-inner shrink-0`}>
            <Pill size={28} />
          </div>
          <div className="space-y-0.5 min-w-0">
            <h3 className={`text-lg font-bold truncate ${isInactive ? 'text-slate-600' : 'text-slate-900'}`}>{med.name}</h3>
            <p className="text-sm text-slate-500 font-medium truncate">
              {med.dosage} • {med.usageCategory === 'prn' ? 'Se necessário' : (med.dosesPerDay || '1x por dia')}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-slate-400 uppercase tracking-tight">Capacidade</span>
              <span className={`font-bold ${isInactive ? 'text-slate-500' : stockStatus.color}`}>
                {med.currentStock} / {med.totalStock} <span className="text-[10px] opacity-70 uppercase">{med.unit}s</span>
              </span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-700 ${isInactive ? 'bg-slate-400' : stockStatus.color.replace('text-', 'bg-')}`}
                style={{ width: `${stockPercent}%` }}
              />
            </div>
          </div>

          {med.expiryDate && (
            <div className="flex items-center gap-2 p-2 rounded-xl border border-dashed border-slate-100 bg-slate-50/50">
              <CalendarDays size={14} className="text-slate-400" />
              <div className="text-[11px] font-semibold text-slate-600">
                Vence em: {new Date(med.expiryDate + 'T12:00:00').toLocaleDateString('pt-BR')}
              </div>
            </div>
          )}

          {isInactive && (
            <div className="flex items-start gap-2 p-3 rounded-2xl bg-slate-100/50 border border-slate-200 w-full mt-4">
              <AlertTriangle size={14} className="text-slate-500 shrink-0 mt-0.5" />
              <div className="text-[11px] text-slate-500 font-medium leading-relaxed">
                Este medicamento está <strong>inativo</strong>. Ele não gerará lembretes nem aparecerá no cronograma diário.
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-50 flex gap-3">
          {isInactive ? (
            <button 
              type="button"
              onClick={() => onReactivate(med.id)}
              className="flex-1 flex items-center justify-center gap-2 text-sm font-bold text-emerald-600 bg-emerald-50 py-2.5 rounded-xl hover:bg-emerald-600 hover:text-white transition-all border border-emerald-100 cursor-pointer"
            >
              <RefreshCw size={16} />
              Reativar
            </button>
          ) : (
            <button 
              type="button"
              onClick={() => onEdit(med)}
              className="flex-1 flex items-center justify-center gap-2 text-sm font-bold text-blue-600 bg-blue-50/50 py-2.5 rounded-xl hover:bg-blue-600 hover:text-white transition-all border border-blue-100 cursor-pointer"
            >
              <Pencil size={16} />
              Editar
            </button>
          )}
          <button 
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(med.id);
            }}
            className="flex-1 flex items-center justify-center gap-2 text-sm font-bold text-red-600 bg-red-50 py-2.5 rounded-xl hover:bg-red-600 hover:text-white transition-all border border-red-100 cursor-pointer"
          >
            <Trash2 size={16} />
            Excluir
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Meus Medicamentos</h2>
          <p className="text-slate-500 text-sm">Alertas: Vencimento ({settings.thresholdExpiring}d) • Estoque ({settings.thresholdRunningOut}d)</p>
        </div>
        <div className="flex items-center gap-3">
          {hasInactive && (
            <button
              onClick={() => setShowInactive(!showInactive)}
              className={`px-5 py-2.5 rounded-2xl font-bold flex items-center gap-2 border transition-all active:scale-95 cursor-pointer ${
                showInactive 
                  ? 'bg-slate-100 text-slate-700 border-slate-200 shadow-inner'
                  : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200 shadow-md'
              }`}
            >
              <span>Inativos</span>
              <span className="bg-slate-100 text-slate-600 text-xs px-2.5 py-0.5 rounded-full font-black">
                {inactiveMeds.length}
              </span>
            </button>
          )}
          <button 
            onClick={onAdd}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-2xl font-bold flex items-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 active:scale-95 cursor-pointer"
          >
            <Plus size={20} />
            <span>Adicionar</span>
          </button>
        </div>
      </div>

      {/* Indicador de Uso do Plano Gratuito */}
      {!isPremium && (
        <div id="free-plan-meds-limit-indicator" className="bg-white p-5 md:p-6 rounded-3xl border border-slate-100 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
            <p className="text-sm text-slate-600">
              Você cadastrou <strong className={`${textColor}`}>{currentCount} de {maxLimit} medicamentos</strong> ativos no Plano Gratuito.
            </p>
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border w-fit ${badgeColor}`}>
              Plano Gratuito
            </span>
          </div>

          {/* Progress Bar Container */}
          <div className="space-y-1">
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden w-full">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={onUpgradeClick}
            className={`text-xs font-bold transition-colors cursor-pointer block hover:underline text-left ${textColor}`}
          >
            Torne-se Premium e cadastre medicamentos ilimitados.
          </button>
        </div>
      )}

      {/* Grid de Ativos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {activeMeds.map((med) => renderMedCard(med, false))}
      </div>
      
      {activeMeds.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-[40px] border-2 border-dashed border-slate-200 text-slate-400">
          <Pill size={64} className="mb-4 opacity-10" />
          <p className="font-bold text-lg">Nenhum medicamento ativo cadastrado</p>
          <p className="text-sm">Toque em "Adicionar" para começar seu controle.</p>
        </div>
      )}

      {/* Seção de Inativos */}
      {showInactive && inactiveMeds.length > 0 && (
        <div className="space-y-6 pt-8 border-t border-slate-100 mt-8">
          <div>
            <h3 className="text-xl font-bold text-slate-800">Medicamentos Inativos</h3>
            <p className="text-slate-400 text-sm">Estes itens estão pausados e não geram notificações</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {inactiveMeds.map((med) => renderMedCard(med, true))}
          </div>
        </div>
      )}
    </div>
  );
});

export default Medications;
