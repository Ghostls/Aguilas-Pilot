// src/components/VendorPanel.tsx
// VALKYRON OS v2.0 — Proveedores · B&M MANTENIMIENTO AERONÁUTICO
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG v2.0 — REBRAND B&M + CONEXIONES:
//   [FIX] Alta: setVendors([entry, ...vendors]) usaba la lista capturada al
//         renderizar; si la flota/proveedores se refrescaban mientras se
//         guardaba, se perdían filas. Ahora es funcional (prev => ...).
//   [FIX] Alta: si el INSERT no devuelve fila (RLS sin SELECT), data[0] era
//         undefined y la pantalla fallaba. Ahora se avisa y se cierra limpio.
//   [FIX] Filtro: v.name / vendor.id nulos rompían el render (toLowerCase /
//         slice sobre undefined). Se normalizan con String(... ?? '').
//   [FIX] Llamar / Escribir con teléfono o correo vacío abrían "tel:undefined".
//         Ahora quedan deshabilitados; el teléfono se limpia para el enlace.
//   [UI]  Estética B&M (bm-ui): barra con búsqueda, categorías segmentadas con
//         conteo, tarjetas con contacto completo, alta en BmModal.
// PRESERVADO ÍNTEGRO: categorías, payload a `proveedores`, mapeo a Vendor,
//   filtro por nombre + categoría, reseteo del formulario al cerrar.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Vendor } from '../Types/Maintenance';
import { supabase } from '../lib/supabaseClient';
import {
  BmModal, BmField, BmSelect, BmBadge, BmEmpty,
  bmInput, bmBtn, bmIconTone, type BmTone,
} from './brand/bm-ui';
import {
  PlusCircle, Truck, Phone, Mail, Search,
  ShieldCheck, Fuel, Wrench, Box, Settings, Loader2, User, X,
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

// [v2.0] Tono por categoría (antes: colores sueltos sobre negro)
const CATEGORY_TONE: Record<string, BmTone> = {
  'Combustible':        'info',
  'Repuestos':          'red',
  'Consumibles':        'ok',
  'Servicios Técnicos': 'dark',
};

// [v2.0] Normalizadores defensivos
const texto = (v: unknown): string => String(v ?? '').trim();
const telHref = (phone: unknown): string => texto(phone).replace(/[^\d+]/g, '');

export const VendorPanel: React.FC<VendorPanelProps> = ({ vendors, setVendors }) => {
  const [isAdding, setIsAdding]             = useState(false);
  const [searchTerm, setSearchTerm]         = useState('');
  const [loading, setLoading]               = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('Todas');
  const [newVendor, setNewVendor]           = useState(EMPTY_VENDOR);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Combustible':        return <Fuel     className="h-5 w-5" />;
      case 'Repuestos':          return <Wrench   className="h-5 w-5" />;
      case 'Consumibles':        return <Box      className="h-5 w-5" />;
      case 'Servicios Técnicos': return <Settings className="h-5 w-5" />;
      default:                   return <Truck    className="h-5 w-5" />;
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

      // [FIX v2.0] Sin fila de vuelta no hay con qué pintar la tarjeta
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) {
        alert('Proveedor enviado, pero el servidor no devolvió el registro. Recargue el módulo para verlo.');
        setIsAdding(false);
        setNewVendor(EMPTY_VENDOR);
        return;
      }

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

      // [FIX v2.0] Actualización funcional: no pisa cambios concurrentes
      setVendors(prev => [entry, ...prev.filter(v => String(v.id) !== String(entry.id))]);
      setIsAdding(false);
      setNewVendor(EMPTY_VENDOR);
    } catch (err: any) {
      console.error('[VendorPanel] Falla:', err?.message);
      alert('ERROR DE INYECCIÓN: ' + (err?.message ?? 'Desconocido'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setIsAdding(false);
    setNewVendor(EMPTY_VENDOR);
  };

  const term = searchTerm.toLowerCase();
  const filteredVendors = vendors.filter(v => {
    const matchesSearch   = texto(v.name).toLowerCase().includes(term);
    const matchesCategory = activeCategory === 'Todas' || v.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  // [v2.0] Conteo por categoría para los segmentos
  const countFor = (cat: CategoryFilter) =>
    cat === 'Todas' ? vendors.length : vendors.filter(v => v.category === cat).length;

  const hayFiltro = !!searchTerm.trim() || activeCategory !== 'Todas';

  return (
    <div className="bm-app space-y-4 text-left text-bm-ink sm:space-y-5">

      {/* ACTION HEADER */}
      <div className="space-y-3 rounded-[24px] border border-bm-line bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-bm-hint" />
            <input
              type="search"
              aria-label="Buscar proveedor por nombre"
              placeholder="Buscar proveedor por nombre"
              className={`${bmInput} pl-11 pr-11`}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button type="button" onClick={() => setSearchTerm('')} aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-bm-steel hover:bg-bm-canvas hover:text-bm-ink">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button type="button" onClick={() => setIsAdding(true)} className={`${bmBtn.primary} w-full md:w-auto`}>
            <PlusCircle className="h-5 w-5" /> Registrar proveedor
          </button>
        </div>

        <div role="group" aria-label="Filtrar por categoría"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
          {CATEGORIES.map(cat => {
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                aria-pressed={active}
                onClick={() => setActiveCategory(cat)}
                className={`flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm transition-colors ${
                  active ? 'bg-bm-ink font-semibold text-white' : 'border border-bm-line font-medium text-bm-steel hover:text-bm-ink'
                }`}
              >
                {cat}
                <span className={`bm-num rounded-full px-1.5 text-[11px] ${active ? 'bg-white/15' : 'bg-bm-canvas'}`}>
                  {countFor(cat)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* VENDOR GRID */}
      {filteredVendors.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-bm-line bg-white">
          {vendors.length === 0 ? (
            <BmEmpty
              icon={<Truck className="h-5 w-5" />}
              title="Sin proveedores registrados"
              text="Registre a sus proveedores de repuestos, consumibles, servicios y combustible."
              action={
                <button type="button" onClick={() => setIsAdding(true)} className={bmBtn.primary}>
                  <PlusCircle className="h-5 w-5" /> Registrar proveedor
                </button>
              }
            />
          ) : (
            <BmEmpty
              icon={<Search className="h-5 w-5" />}
              title="Ningún proveedor coincide"
              text="Pruebe con otro nombre o cambie de categoría."
              action={hayFiltro ? (
                <button type="button" onClick={() => { setSearchTerm(''); setActiveCategory('Todas'); }}
                  className={bmBtn.secondary}>
                  Ver todos
                </button>
              ) : undefined}
            />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredVendors.map(vendor => {
            const tone   = CATEGORY_TONE[texto(vendor.category)] ?? 'neutral';
            const phone  = telHref(vendor.phone);
            const email  = texto(vendor.email);
            const idCorto = texto(vendor.id).slice(0, 8).toUpperCase();
            return (
              <article key={vendor.id} className="flex flex-col rounded-[20px] border border-bm-line bg-white p-4 sm:p-5">
                <header className="flex items-start gap-3.5">
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${bmIconTone[tone]}`}>
                    {getCategoryIcon(texto(vendor.category))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="bm-heading line-clamp-2 break-words text-base uppercase leading-tight" title={texto(vendor.name)}>
                      {texto(vendor.name) || 'Sin nombre'}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <BmBadge tone={tone === 'red' || tone === 'dark' ? 'neutral' : tone}>
                        {texto(vendor.category) || 'Sin categoría'}
                      </BmBadge>
                      {idCorto && <span className="font-data text-[11px] text-bm-hint">#{idCorto}</span>}
                    </div>
                  </div>
                </header>

                <dl className="mt-4 flex-1 space-y-2 border-t border-bm-line pt-4 text-sm">
                  <div className="flex items-center gap-2.5">
                    <dt className="sr-only">Atención</dt>
                    <User className="h-4 w-4 shrink-0 text-bm-steel" aria-hidden="true" />
                    <dd className="truncate uppercase">{texto(vendor.contactPerson) || <span className="normal-case text-bm-hint">Sin contacto</span>}</dd>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <dt className="sr-only">Teléfono</dt>
                    <Phone className="h-4 w-4 shrink-0 text-bm-steel" aria-hidden="true" />
                    <dd className="bm-num truncate">{texto(vendor.phone) || <span className="text-bm-hint">Sin teléfono</span>}</dd>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <dt className="sr-only">Correo</dt>
                    <Mail className="h-4 w-4 shrink-0 text-bm-steel" aria-hidden="true" />
                    <dd className="truncate">{email || <span className="text-bm-hint">Sin correo</span>}</dd>
                  </div>
                </dl>

                <div className="mt-4 flex gap-2">
                  {phone ? (
                    <a href={`tel:${phone}`} className={`${bmBtn.secondary} ${bmBtn.sm} flex-1`}>
                      <Phone className="h-4 w-4" /> Llamar
                    </a>
                  ) : (
                    <span aria-disabled="true" className={`${bmBtn.secondary} ${bmBtn.sm} flex-1 cursor-not-allowed opacity-50 hover:!border-bm-line hover:!text-bm-ink`}>
                      <Phone className="h-4 w-4" /> Llamar
                    </span>
                  )}
                  {email ? (
                    <a href={`mailto:${email}`} className={`${bmBtn.secondary} ${bmBtn.sm} flex-1`}>
                      <Mail className="h-4 w-4" /> Escribir
                    </a>
                  ) : (
                    <span aria-disabled="true" className={`${bmBtn.secondary} ${bmBtn.sm} flex-1 cursor-not-allowed opacity-50 hover:!border-bm-line hover:!text-bm-ink`}>
                      <Mail className="h-4 w-4" /> Escribir
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* REGISTER MODAL */}
      <BmModal
        open={isAdding}
        onClose={handleClose}
        busy={loading}
        title="Registrar proveedor"
        subtitle="Alta en el directorio de proveedores de B&M"
        icon={<ShieldCheck className="h-5 w-5" />}
        tone="red"
        z={100}
      >
        <form onSubmit={handleAddVendor} className="space-y-4">
          <BmField label="Nombre de la empresa" htmlFor="vd-name" required>
            <input
              id="vd-name"
              required
              autoComplete="organization"
              value={newVendor.name}
              className={`${bmInput} uppercase`}
              onChange={e => setNewVendor({ ...newVendor, name: e.target.value })}
            />
          </BmField>

          <div className="grid gap-4 sm:grid-cols-2">
            <BmField label="Categoría" htmlFor="vd-cat">
              <BmSelect
                id="vd-cat"
                value={newVendor.category}
                onChange={e => setNewVendor({ ...newVendor, category: e.target.value as any })}
              >
                {CATEGORIES.filter(c => c !== 'Todas').map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </BmSelect>
            </BmField>
            <BmField label="Persona de contacto" htmlFor="vd-contact" required>
              <input
                id="vd-contact"
                required
                autoComplete="name"
                value={newVendor.contactPerson}
                className={`${bmInput} uppercase`}
                onChange={e => setNewVendor({ ...newVendor, contactPerson: e.target.value })}
              />
            </BmField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <BmField label="Teléfono" htmlFor="vd-phone" required>
              <input
                id="vd-phone"
                required
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={newVendor.phone}
                className={`${bmInput} bm-num`}
                onChange={e => setNewVendor({ ...newVendor, phone: e.target.value })}
              />
            </BmField>
            <BmField label="Correo" htmlFor="vd-email" required>
              <input
                id="vd-email"
                required
                type="email"
                inputMode="email"
                autoComplete="email"
                value={newVendor.email}
                className={bmInput}
                onChange={e => setNewVendor({ ...newVendor, email: e.target.value })}
              />
            </BmField>
          </div>

          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row">
            <button type="button" onClick={handleClose} disabled={loading} className={`${bmBtn.secondary} sm:flex-1`}>
              Cancelar
            </button>
            <button type="submit" disabled={loading} className={`${bmBtn.primary} sm:flex-[2]`}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
              {loading ? 'Registrando…' : 'Registrar proveedor'}
            </button>
          </div>
        </form>
      </BmModal>
    </div>
  );
};
