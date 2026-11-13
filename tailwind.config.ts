// tailwind.config.ts — VALKYRON OS · B&M MANTENIMIENTO AERONÁUTICO
// ─────────────────────────────────────────────────────────────────────────────
// CHANGELOG (REBRAND B&M):
//   [UI]  font-sans → Archivo Variable; font-mono → JetBrains Mono Variable
//         (ambas autoalojadas vía @fontsource-variable, cargadas en index.css).
//   [NEW] Paleta `bm` (bg-bm-red, text-bm-steel, border-bm-line, bg-bm-ok-tint…)
//         con los mismos hex de src/theme/bm-theme.css. Uso preferente en
//         módulos nuevos; los colores semánticos shadcn ya apuntan a B&M.
//   [NEW] Colores semánticos success / warning con su tinte (variables CSS).
//   [NEW] fontFamily.display para títulos y cifras (con .bm-heading / .bm-figure).
//   [UI]  --radius pasa a 0.75rem (en index.css): rounded-lg/md/sm de shadcn
//         quedan en 12/10/8 px. rounded-xl y rounded-2xl conservan sus valores.
//   [NEW] boxShadow bm-pop (menús, popovers) y bm-sheet (diálogos).
// PRESERVADO: darkMode class, content, container, todos los colores shadcn,
//   alert, status, sidebar, glass (legado, para módulos aún no migrados),
//   keyframes/animaciones, boxShadow.glass, backdropBlur, tailwindcss-animate.
// ─────────────────────────────────────────────────────────────────────────────
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['"Archivo Variable"', 'Archivo', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Archivo Variable"', 'Archivo', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          tint: "hsl(var(--primary-tint))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          tint: "hsl(var(--success-tint))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          tint: "hsl(var(--warning-tint))",
        },
        alert: {
          ok: "hsl(var(--alert-ok))",
          warning: "hsl(var(--alert-warning))",
          critical: "hsl(var(--alert-critical))",
        },
        status: {
          online: "hsl(var(--online))",
          offline: "hsl(var(--offline))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Paleta de marca B&M (hex fijos, iguales a src/theme/bm-theme.css)
        bm: {
          white: '#FFFFFF',
          canvas: '#F2F3F5',
          ink: '#1B1D22',
          steel: '#5F6670',
          line: '#E3E5E9',
          field: '#D9DCE1',
          hint: '#9AA0A8',
          red: '#D42125',
          'red-deep': '#A9161B',
          'red-tint': '#FCEBEC',
          ok: '#18794E',
          'ok-tint': '#E7F5EE',
          warn: '#B45309',
          'warn-tint': '#FEF3E2',
        },
        // Legado (tema teal oscuro). Se conserva hasta migrar los módulos que lo usan.
        glass: {
          base: '#0a0f14',
          fg: '#e6f1ef',
          edge: '#00d4c8',
          accent: '#00d4c8',
          'accent-fg': '#03070b',
          active: 'rgba(0,212,200,0.15)',
          'active-fg': '#00d4c8',
          warn: 'rgba(245,158,11,0.15)',
          'warn-fg': '#f59e0b',
          danger: 'rgba(239,68,68,0.15)',
          'danger-fg': '#ef4444',
          muted: 'rgba(148,163,184,0.12)',
          'muted-fg': '#94a3b8',
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-slow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-slow": "pulse-slow 2s ease-in-out infinite",
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)',
        'bm-pop': '0 1px 2px rgba(27,29,34,0.04), 0 12px 32px -12px rgba(27,29,34,0.18)',
        'bm-sheet': '0 24px 64px -12px rgba(27,29,34,0.35)',
      },
      backdropBlur: {
        xl: '24px',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
