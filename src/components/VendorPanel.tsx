import React, { useState } from 'react';
import { Vendor } from '../Types/Maintenance';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { supabase } from '../lib/supabaseClient';
import {
  PlusCircle, X, Truck, Phone, Mail, Search,
  ShieldCheck, Fuel, Wrench, Box, Settings, Loader2
} from 'lucide-react';

interface VendorPanelProps {
  vendors: Vendor[];
  setVendors: React.Dispatch<React.SetStateAction<Vendor[]>>;
}

type CategoryFilter = 'Todas' | 'Repuestos' | 'Consumibles' | 'Servicios Técnicos' | 'Combustible';

const CATEGORIES: CategoryFilter[] = ['Todas', 'Repuestos', 'Consumibles', 'Servicios Técnicos', 'Combustible'];

const EMPTY_VENDOR = {
  name: '',
  category: 'Repuestos' as Vendor['category'],
  contactPerson: '',
  email: '',
  phone: '',
};

export const VendorPanel: React.FC<VendorPanelProps> = ({ vendors, setVendors }) => {
  const [isAdding, setIsAdding]             = useState(false);
  const [searchTerm, setSearchTerm]         = useState('');
  const [loading, setLoading]               = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('Todas');
  const [newVendor, setNewVendor]           = useState(EMPTY_VENDOR);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Combustible':        return <Fuel     className="h-5 w-5 text-blue-400" />;
      case 'Repuestos':          return <Wrench   className="h-5 w-5 text-[#E1AD01]" />;
      case 'Consumibles':        return <Box      className="h-5 w-5 text-green-500" />;
      case 'Servicios Técnicos': return <Settings className="h-5 w-5 text-purple-500" />;
      default:                   return <Truck    className="h-5 w-5 text-slate-400" />;
    }
  };

  const handleAddVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const dbEntry = {
      nombre_empresa:  newVendor.name.toUpperCase(),
      contacto_nombre: newVendor.contactPerson.toUpperCase(),
      telefono:        newVendor.phone,
      email:           newVendor.email.toLowerCase(),
      categoria:       newVendor.category,
    };

    try {
      const { data, error } = await supabase
        .from('proveedores')
        .insert([dbEntry])
        .select();

      if (error) throw error;

      if (data) {
        const row = data[0];
        const entry: Vendor = {
          id:            row.id,
          name:          row.nombre_empresa,
          taxId:         'S/N',
          category:      row.categoria,
          contactPerson: row.contacto_nombre,
          email:         row.email,
          phone:         row.telefono,
          location:      'VENEZUELA',
          rating:        5,
          providedItems: [],
        };

        setVendors([entry, ...vendors]);
        setIsAdding(false);
        setNewVendor(EMPTY_VENDOR);
      }
    } catch (err: any) {
      console.error('[VendorPanel] Falla:', err.message);
      alert('ERROR DE INYECCIÓN: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setIsAdding(false);
    setNewVendor(EMPTY_VENDOR);
  };

  const filteredVendors = vendors.filter(v => {
    const matchesSearch   = v.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = activeCategory === 'Todas' || v.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-700 text-left font-sans">

      {/* ACTION HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4
                      bg-white/5 p-4 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-md">

        <div className="relative w-full md:w-96 font-mono">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="FILTRAR ALIADOS..."
            className="w-full bg-black border border-white/10 p-3 pl-10 rounded-xl
                       text-xs text-white outline-none focus:border-[#E1AD01] transition-all
                       uppercase tracking-widest"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex bg-black rounded-xl p-1 border border-white/5 overflow-x-auto">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all
                          whitespace-nowrap tracking-widest
                          ${activeCategory === cat
                            ? 'bg-[#E1AD01] text-black'
                            : 'text-slate-500 hover:text-white'}`}
            >
              {cat}
            </button>
          ))}
        </div>

        <button
          onClick={() => setIsAdding(true)}
          className="w-full md:w-auto flex items-center justify-center gap-2
                     bg-[#E1AD01] text-black px-6 py-3 rounded-xl font-black text-xs
                     hover:bg-white transition-all shadow-lg uppercase tracking-widest"
        >
          <PlusCircle className="h-4 w-4" /> Registrar Aliado
        </button>
      </div>

      {/* VENDOR GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredVendors.length === 0 ? (
          <p className="col-span-3 text-center text-slate-700 text-[10px] font-black
                        uppercase tracking-widest py-16">
            Sin proveedores registrados para esta categoría
          </p>
        ) : (
          filteredVendors.map(vendor => (
            <Card
              key={vendor.id}
              className="bg-[#0f0f0f] border border-white/10 hover:border-[#E1AD01]/40
                         transition-all group shadow-xl"
            >
              <CardHeader className="border-b border-white/5 pb-5 pt-6 flex flex-row items-center gap-4">
                <div className="p-3 bg-white/5 rounded-2xl border border-white/10">
                  {getCategoryIcon(vendor.category)}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <CardTitle className="text-white font-black text-lg tracking-tighter
                                        uppercase leading-tight truncate">
                    {vendor.name}
                  </CardTitle>
                  <span className="text-[9px] text-[#E1AD01] font-mono font-bold uppercase">
                    {vendor.category}
                  </span>
                </div>
              </CardHeader>

              <CardContent className="pt-5 space-y-4 font-mono text-left">
                <div className="space-y-2 text-[10px] uppercase">
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-slate-600 font-bold tracking-widest">Atención</span>
                    <span className="text-white font-black truncate ml-2">{vendor.contactPerson}</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-slate-600 font-bold tracking-widest">ID Sistema</span>
                    <span className="text-slate-500 font-black truncate ml-2 text-[8px]">
                      {vendor.id.slice(0, 18)}…
                    </span>
                  </div>
                </div>

                <div className="pt-3 flex gap-3">
                  <a
                    href={`tel:${vendor.phone}`}
                    className="flex-1 flex items-center justify-center gap-2 bg-white/5
                               hover:bg-[#E1AD01]/20 p-3.5 rounded-xl transition-all border border-white/5"
                  >
                    <Phone className="h-3.5 w-3.5 text-[#E1AD01]" />
                    <span className="text-[9px] font-black uppercase text-white">Call</span>
                  </a>
                  <a
                    href={`mailto:${vendor.email}`}
                    className="flex-1 flex items-center justify-center gap-2 bg-white/5
                               hover:bg-[#E1AD01]/20 p-3.5 rounded-xl transition-all border border-white/5"
                  >
                    <Mail className="h-3.5 w-3.5 text-[#E1AD01]" />
                    <span className="text-[9px] font-black uppercase text-white">Mail</span>
                  </a>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* REGISTER MODAL */}
      {isAdding && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[100]
                        flex items-center justify-center p-4">
          <Card className="bg-[#0f0f0f] border border-[#E1AD01]/30 w-full max-w-lg
                           shadow-2xl overflow-hidden">
            <CardHeader className="flex flex-row justify-between items-center
                                   border-b border-white/5 bg-white/[0.02]">
              <CardTitle className="text-[#E1AD01] text-[10px] font-black uppercase
                                    tracking-[0.3em] flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Alta de Proveedor Valkyron
              </CardTitle>
              <button onClick={handleClose} className="text-slate-500 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </button>
            </CardHeader>

            <CardContent className="pt-6">
              <form onSubmit={handleAddVendor} className="space-y-4 font-mono">

                <div className="space-y-1.5 text-left">
                  <label className="text-[9px] text-slate-600 font-black uppercase">
                    Nombre de la Empresa
                  </label>
                  <input
                    required
                    value={newVendor.name}
                    className="w-full bg-black border border-white/10 p-3 rounded-lg
                               text-white text-xs outline-none focus:border-[#E1AD01] uppercase"
                    onChange={e => setNewVendor({ ...newVendor, name: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5 text-left">
                    <label className="text-[9px] text-slate-600 font-black uppercase">Categoría</label>
                    <select
                      value={newVendor.category}
                      className="w-full bg-black border border-white/10 p-3 rounded-lg
                                 text-white text-xs outline-none focus:border-[#E1AD01]
                                 [&>option]:bg-black [&>option]:text-white"
                      onChange={e => setNewVendor({ ...newVendor, category: e.target.value as any })}
                    >
                      {CATEGORIES.filter(c => c !== 'Todas').map(c => (
                        <option key={c} value={c}>{c.toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 text-left">
                    <label className="text-[9px] text-slate-600 font-black uppercase">
                      Nombre de Contacto
                    </label>
                    <input
                      required
                      value={newVendor.contactPerson}
                      className="w-full bg-black border border-white/10 p-3 rounded-lg
                                 text-white text-xs outline-none focus:border-[#E1AD01] uppercase"
                      onChange={e => setNewVendor({ ...newVendor, contactPerson: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-left">
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-slate-600 font-black uppercase">Teléfono</label>
                    <input
                      required
                      value={newVendor.phone}
                      className="w-full bg-black border border-white/10 p-3 rounded-lg
                                 text-white text-xs outline-none focus:border-[#E1AD01]"
                      onChange={e => setNewVendor({ ...newVendor, phone: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-slate-600 font-black uppercase">Email</label>
                    <input
                      required
                      type="email"
                      value={newVendor.email}
                      className="w-full bg-black border border-white/10 p-3 rounded-lg
                                 text-white text-xs outline-none focus:border-[#E1AD01]"
                      onChange={e => setNewVendor({ ...newVendor, email: e.target.value })}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#E1AD01] text-black font-black py-4 rounded-xl mt-4
                             flex items-center justify-center gap-2 uppercase text-[10px]
                             tracking-widest shadow-2xl disabled:opacity-50 hover:bg-white transition-all"
                >
                  {loading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : 'REGISTRAR PROVEEDOR EN NODO'
                  }
                </button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};