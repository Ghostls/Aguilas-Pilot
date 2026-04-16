interface FatigueBarProps {
  current: number;
  limit: number;
  label: string;
}

/**
 * Componente de Monitoreo de Fatiga Aeronáutica
 * Implementa la fórmula física: T_restante = T_limite - T_actual
 */
const FatigueBar = ({ current, limit, label }: FatigueBarProps) => {
  // Cálculo de horas restantes basado en el límite de mantenimiento (50h/100h)
  const remaining = limit - (current % limit);
  // El porcentaje refleja el consumo de vida útil del componente
  const percentage = ((current % limit) / limit) * 100;

  const getStatus = () => {
    if (remaining <= 5) return 'critical';
    if (remaining <= 10) return 'warning';
    return 'ok';
  };

  const status = getStatus();

  // Mapeo de colores basado en el esquema de Roberto (Black & Mustard)
  const colorStyles = {
    critical: { text: 'text-red-500', bar: 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]' },
    warning: { text: 'text-[#E1AD01]', bar: 'bg-[#E1AD01] shadow-[0_0_10px_rgba(225,173,1,0.4)]' },
    ok: { text: 'text-slate-400', bar: 'bg-slate-700 shadow-none' }
  };

  const currentStyle = colorStyles[status];

  return (
    <div className="space-y-1.5 group">
      <div className="flex items-center justify-between text-[10px] uppercase font-black tracking-widest">
        <span className="text-slate-500 group-hover:text-slate-300 transition-colors">{label}</span>
        <span className={`font-mono ${currentStyle.text} flex items-center gap-1`}>
          {status === 'critical' && <span className="animate-ping inline-flex h-1.5 w-1.5 rounded-full bg-red-500 mr-1" />}
          {remaining.toFixed(1)}H REM
        </span>
      </div>
      
      {/* Contenedor de la barra estilo Industrial Liquid Glass */}
      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
        <div
          className={`h-full transition-all duration-1000 ease-out ${currentStyle.bar}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      
      {/* Indicador de umbral crítico */}
      {status !== 'ok' && (
        <div className="flex justify-end">
          <span className={`text-[8px] font-bold uppercase italic ${currentStyle.text}`}>
            {status === 'critical' ? 'Requiere Inspección Inmediata' : 'Mantenimiento Próximo'}
          </span>
        </div>
      )}
    </div>
  );
};

export default FatigueBar;