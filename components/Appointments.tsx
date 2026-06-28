import React from 'react';
import { Appointment } from '../types';
import { Calendar, MapPin, Stethoscope, TestTubeDiagonal, Plus, Pencil, Trash2, Navigation, Map as MapIcon, RefreshCw } from 'lucide-react';
import { FREE_PLAN_LIMITS } from '../constants';
import { openGoogleMapsLink, openWazeLink } from '../src/utils/mapUtils';

interface Props {
  appointments: Appointment[];
  onAddClick: () => void;
  onEditClick: (app: Appointment) => void;
  onDeleteClick: (id: string) => void;
  onReactivateClick: (id: string) => void;
  isPremium?: boolean;
  onUpgradeClick?: () => void;
}

const Appointments: React.FC<Props> = React.memo(({ appointments, onAddClick, onEditClick, onDeleteClick, onReactivateClick, isPremium = false, onUpgradeClick }) => {
  const activeApps = appointments.filter(a => a.active !== false && a.active !== 'false' && a.active !== 0);
  const inactiveApps = appointments.filter(a => a.active === false || a.active === 'false' || a.active === 0);

  const currentCount = activeApps.length;
  const maxLimit = FREE_PLAN_LIMITS.appointments;
  const percentage = Math.min(100, (currentCount / maxLimit) * 100);

  const [showInactive, setShowInactive] = React.useState(false);
  const hasInactive = inactiveApps.length > 0;

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

  const openGoogleMaps = (address: string) => {
    openGoogleMapsLink(address);
  };

  const openWaze = (address: string) => {
    openWazeLink(address);
  };

  const renderAppCard = (app: Appointment, isInactive: boolean) => {
    return (
      <div 
        key={app.id} 
        className={`bg-white p-6 rounded-[32px] border shadow-md flex flex-col md:flex-row md:items-center gap-6 group hover:border-blue-200 transition-all relative overflow-hidden ${
          isInactive 
            ? 'opacity-60 border-dashed border-slate-300 bg-slate-50/40 hover:opacity-85' 
            : 'border-slate-100'
        }`}
      >
        {/* Indicador de Tipo Lateral */}
        <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${isInactive ? 'bg-slate-300' : app.type === 'Consulta' ? 'bg-blue-500' : 'bg-purple-500'}`} />
        
        {isInactive && (
          <span className="absolute right-4 top-4 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-slate-200 text-slate-600 border border-slate-300">
            Inativo
          </span>
        )}

        <div className="flex items-center gap-4 flex-1">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all ${
            isInactive
              ? 'bg-slate-200 text-slate-500'
              : app.type === 'Consulta' 
                ? 'bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white shadow-sm' 
                : 'bg-purple-50 text-purple-600 group-hover:bg-purple-600 group-hover:text-white shadow-sm'
          }`}>
            {app.type === 'Consulta' ? <Stethoscope size={30} /> : <TestTubeDiagonal size={30} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                isInactive 
                  ? 'bg-slate-100 text-slate-600'
                  : app.type === 'Consulta' 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'bg-purple-100 text-purple-700'
              }`}>
                {app.type}
              </span>
            </div>
            <h3 className={`text-xl font-bold truncate ${isInactive ? 'text-slate-600' : 'text-slate-900'}`}>{app.doctor}</h3>
            <p className="text-slate-500 font-medium text-sm truncate">{app.specialty}</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-6 md:gap-10">
          {/* Seção de Data */}
          <div className="flex gap-3">
            <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 shrink-0">
              <Calendar size={18} />
            </div>
            <div className="flex flex-col justify-center">
              <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest leading-none mb-1">Data e Hora</div>
              <div className="font-bold text-slate-700 text-sm whitespace-nowrap">
                {app.date.split('-').reverse().join('/')} • {app.time}
              </div>
            </div>
          </div>

          {/* Seção de Local */}
          <div className="flex gap-3">
            <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 shrink-0">
              <MapPin size={18} />
            </div>
            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex flex-col justify-center">
                <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest leading-none mb-1">Local</div>
                <div className="font-bold text-slate-700 text-sm truncate max-w-[180px]">{app.location}</div>
              </div>
              
              {app.location && (
                <div className="flex gap-2">
                  <button 
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openGoogleMaps(app.location); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 text-slate-600 text-[10px] font-bold rounded-lg hover:bg-blue-600 hover:text-white transition-all border border-slate-100 hover:border-blue-600 shadow-sm"
                  >
                    <MapIcon size={12} />
                    Maps
                  </button>
                  <button 
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openWaze(app.location); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 text-slate-600 text-[10px] font-bold rounded-lg hover:bg-blue-600 hover:text-white transition-all border border-slate-100 hover:border-blue-600 shadow-sm"
                  >
                    <Navigation size={12} />
                    Waze
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {isInactive && (
          <div className="flex items-start gap-2 p-3 rounded-2xl bg-slate-100 border border-slate-200 w-full mt-4 md:mt-0">
            <Calendar size={14} className="text-slate-500 shrink-0 mt-0.5" />
            <p className="text-[11px] font-medium text-slate-500 leading-relaxed">
              Este compromisso está inativo e não gerará notificações ou aparecerá em eventos futuros.
            </p>
          </div>
        )}

        <div className="flex gap-3 pt-4 border-t border-slate-50 w-full md:w-auto">
          {isInactive ? (
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); onReactivateClick(app.id); }}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-50 text-emerald-600 text-xs font-bold rounded-xl hover:bg-emerald-600 hover:text-white transition-all border border-emerald-100 cursor-pointer"
            >
              <RefreshCw size={14} />
              Reativar
            </button>
          ) : (
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); onEditClick(app); }}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-50 text-blue-600 text-xs font-bold rounded-xl hover:bg-blue-600 hover:text-white transition-all border border-blue-100"
            >
              <Pencil size={14} />
              Editar
            </button>
          )}
          <button 
            type="button"
            onClick={(e) => { e.stopPropagation(); onDeleteClick(app.id); }}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 text-xs font-bold rounded-xl hover:bg-red-600 hover:text-white transition-all border border-red-100"
          >
            <Trash2 size={14} />
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
          <h2 className="text-2xl font-bold">Compromissos</h2>
          <p className="text-slate-500">Consultas, exames e retornos</p>
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
                {inactiveApps.length}
              </span>
            </button>
          )}
          <button 
            onClick={onAddClick}
            className="bg-blue-600 text-white p-3 rounded-2xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-100 flex items-center gap-2 px-6 cursor-pointer"
          >
            <Plus size={20} />
            <span className="font-bold">Agendar</span>
          </button>
        </div>
      </div>

      {/* Indicador de Uso do Plano Gratuito */}
      {!isPremium && (
        <div id="free-plan-appointments-limit-indicator" className="bg-white p-5 md:p-6 rounded-3xl border border-slate-100 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
            <p className="text-sm text-slate-600">
              Você cadastrou <strong className={`${textColor}`}>{currentCount} de {maxLimit} compromissos</strong> ativos no Plano Gratuito.
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
            Torne-se Premium e cadastre compromissos ilimitados.
          </button>
        </div>
      )}

      {/* Lista de Ativos */}
      <div className="space-y-4">
        {activeApps.map((app) => renderAppCard(app, false))}
        
        {activeApps.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 bg-slate-50 rounded-[40px] border-2 border-dashed border-slate-200 text-slate-400">
            <Calendar size={48} className="mb-4 opacity-20" />
            <p className="font-bold text-lg text-slate-500">Nenhum compromisso ativo marcado</p>
            <p className="text-sm">Toque em "Agendar" para registrar uma nova consulta.</p>
          </div>
        )}
      </div>

      {/* Seção de Inativos */}
      {showInactive && inactiveApps.length > 0 && (
        <div className="space-y-4 pt-8 border-t border-slate-100 mt-8">
          <div>
            <h3 className="text-xl font-bold text-slate-800">Compromissos Inativos</h3>
            <p className="text-slate-400 text-sm">Estes compromissos estão pausados e não geram notificações</p>
          </div>
          <div className="space-y-4">
            {inactiveApps.map((app) => renderAppCard(app, true))}
          </div>
        </div>
      )}
    </div>
  );
});

export default Appointments;