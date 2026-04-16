import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { 
  ShieldCheck, UserPlus, Mail, Lock, Briefcase, 
  MapPin, Loader2, X, Wrench, Shield, Plane, Landmark 
} from 'lucide-react';

export const Register = ({ onClose }: { onClose: () => void }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    nombre: '',
    rol: 'MECANICO' as 'CEO' | 'ADMIN' | 'MECANICO' | 'PILOTO',
    sede: 'Lara' as 'Lara' | 'Maturín'
  });

  const roles = [
    { id: 'MECANICO', label: 'Técnico', icon: Wrench, desc: 'MRO & Hangar' },
    { id: 'PILOTO', label: 'Piloto', icon: Plane, desc: 'Vuelos & Fuel' },
    { id: 'ADMIN', label: 'Admin', icon: Landmark, desc: 'Finanzas & Almacén' },
    { id: 'CEO', label: 'CEO', icon: Shield, desc: 'Control Total' },
  ];

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error: authError } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
      options: {
        data: {
          nombre_completo: formData.nombre.toUpperCase(),
          rol: formData.rol,
          sede: formData.sede
        }
      }
    });

    if (authError) {
      alert("ERROR DE SISTEMA: " + authError.message);
    } else {
      alert(`DESPLIEGUE EXITOSO: ${formData.nombre} ha sido dado de alta como ${formData.rol}.`);
      onClose();
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[200] flex items-center justify-center p-4">
      <div className="bg-[#0a0a0a] border border-[#E1AD01]/30 w-full max-w-xl rounded-[2.5rem] overflow-hidden shadow-[0_0_100px_rgba(225,173,1,0.15)] animate-in zoom-in-95 duration-300">
        
        {/* HEADER TÁCTICO */}
        <div className="p-6 bg-[#E1AD01] flex justify-between items-center text-black">
          <div className="flex items-center gap-3">
            <UserPlus className="h-5 w-5" />
            <h3 className="font-black uppercase text-xs tracking-[0.3em] italic">Reclutamiento de Personal Águilas Pilot</h3>
          </div>
          <button onClick={onClose} className="hover:rotate-90 transition-transform duration-300">
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleRegister} className="p-10 space-y-8 font-mono">
          
          {/* SELECTOR DE ROL VISUAL */}
          <div className="space-y-4">
            <label className="text-[9px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Asignar Rango de Autoridad</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {roles.map((rol) => (
                <button
                  key={rol.id}
                  type="button"
                  onClick={() => setFormData({...formData, rol: rol.id as any})}
                  className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 group ${
                    formData.rol === rol.id 
                    ? 'bg-[#E1AD01] border-[#E1AD01] text-black shadow-lg shadow-[#E1AD01]/20' 
                    : 'bg-white/5 border-white/5 text-slate-500 hover:border-white/10 hover:bg-white/[0.08]'
                  }`}
                >
                  <rol.icon className={`h-5 w-5 ${formData.rol === rol.id ? 'text-black' : 'group-hover:text-[#E1AD01]'}`} />
                  <div className="text-center">
                    <p className="text-[10px] font-black uppercase">{rol.label}</p>
                    <p className={`text-[7px] font-bold opacity-60 ${formData.rol === rol.id ? 'text-black' : ''}`}>{rol.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* NOMBRE Y SEDE */}
            <div className="space-y-4 text-left">
              <div className="space-y-2">
                <label className="text-[9px] text-slate-500 font-black uppercase ml-1 tracking-widest">Identidad Completa</label>
                <input required className="w-full bg-black border border-white/10 p-4 rounded-2xl text-white text-xs outline-none focus:border-[#E1AD01] transition-all uppercase" 
                  onChange={e => setFormData({...formData, nombre: e.target.value})} placeholder="NOMBRE DEL OPERADOR" />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] text-slate-500 font-black uppercase ml-1 tracking-widest">Sede Asignada</label>
                <div className="flex bg-black rounded-2xl p-1 border border-white/10">
                  {['Lara', 'Maturín'].map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setFormData({...formData, sede: loc as any})}
                      className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase transition-all ${
                        formData.sede === loc ? 'bg-white/10 text-white' : 'text-slate-600 hover:text-slate-400'
                      }`}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* CREDENCIALES */}
            <div className="space-y-4 text-left">
              <div className="space-y-2">
                <label className="text-[9px] text-slate-500 font-black uppercase ml-1 tracking-widest">Email Corporativo</label>
                <input type="email" required className="w-full bg-black border border-white/10 p-4 rounded-2xl text-white text-xs outline-none focus:border-[#E1AD01] transition-all" 
                  placeholder="ID@AGUILASPILOT.COM" onChange={e => setFormData({...formData, email: e.target.value})} />
              </div>
              <div className="space-y-2">
                <label className="text-[9px] text-slate-500 font-black uppercase ml-1 tracking-widest">Clave de Acceso</label>
                <input type="password" required className="w-full bg-black border border-white/10 p-4 rounded-2xl text-white text-xs outline-none focus:border-[#E1AD01] transition-all" 
                  placeholder="••••••••" onChange={e => setFormData({...formData, password: e.target.value})} />
              </div>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading} 
            className="w-full bg-[#E1AD01] text-black font-black py-5 rounded-2xl uppercase text-[11px] tracking-[0.5em] shadow-xl hover:bg-white hover:scale-[1.01] transition-all flex items-center justify-center gap-3 active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Ejecutar Alta de Personal"}
          </button>
        </form>

        <div className="bg-white/5 p-4 text-center border-t border-white/10">
          <p className="text-[7px] text-slate-600 font-black uppercase tracking-[0.4em]">Valkyron OS — Strategic Human Resources Module</p>
        </div>
      </div>
    </div>
  );
};