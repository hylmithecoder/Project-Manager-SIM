---
name: "nextjs-clean-isometric-ui"
description: "Bikin atau ubah UI Next.js + Tailwind bergaya clean dengan ilustrasi flat isometrik, tema biru (default) atau kuning parking (Auto Smart Parking)."
---

# Next.js — Clean Isometric UI

Gaya: minimalist/clean, flat, whitespace lega, palet terbatas, ilustrasi flat isometrik, tombol soft-shadow, font Plus Jakarta Sans. Versi web dari skill `figma-clean-isometric-ui` (tema biru) dan `maui-yellow-parking-ui` (tema kuning). Dua tema memakai token yang sama lewat CSS variables, jadi komponen tidak perlu diubah saat ganti tema.

## Workflow

1. Cek proyek dulu: baca `package.json` (versi `next`, `react`, `tailwindcss`), struktur `app/` vs `pages/`, `src/` atau tidak, alias import (`tsconfig.json` → `paths`), dan file CSS global. Ikuti konvensi yang sudah ada.
2. Tentukan tema: biru (default) atau `parking` (kuning). Kalau user menyebut parkir/Auto Smart Parking/kuning → `parking`.
3. Pasang fondasi bila belum ada: font via `next/font/google`, token di CSS global, komponen dasar di `components/ui/`, ilustrasi di `components/illustrations/`.
4. Bangun halaman sebagai Server Component; jadikan `"use client"` hanya bagian yang butuh state/event (tombol login, form).
5. Jalankan `npm run lint` dan `npm run build` (atau pnpm/bun sesuai lockfile) bila memungkinkan, perbaiki error, lalu lapor singkat file yang dibuat/diubah.

## Font (app/layout.tsx)

```tsx
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" data-theme="default" className={jakarta.variable}>
      <body className="bg-bg font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
```

Ganti `data-theme="parking"` untuk tema kuning (atau pasang di wrapper halaman tertentu).

## Token — Tailwind v4 (globals.css)

```css
@import "tailwindcss";

:root,
[data-theme="default"] {
  --bg: #ffffff;
  --primary: #3b63d6;
  --primary-strong: #3554b8;   /* sisi bayangan ilustrasi, hover */
  --primary-soft: #e9eefb;     /* chip, latar ikon */
  --on-primary: #ffffff;       /* teks di atas tombol primary */
  --accent-text: #3b63d6;      /* eyebrow, link */
  --ink: #1b2440;              /* judul */
  --ink-soft: #2f3e75;
  --muted: #6b7488;
  --subtle: #9aa3b5;
  --line: #dce3ee;
  --floor: #eef1f7;            /* lantai elips ilustrasi */
  --success: #2fa36b;
  --danger: #e5534b;
}

[data-theme="parking"] {
  --primary: #f5b800;
  --primary-strong: #d99a00;
  --primary-soft: #fff6d9;
  --on-primary: #1b2440;       /* teks di atas kuning SELALU navy */
  --accent-text: #a87400;
  --line: #e6e2d6;
  --floor: #f4f1e8;
}

@theme inline {
  --color-bg: var(--bg);
  --color-primary: var(--primary);
  --color-primary-strong: var(--primary-strong);
  --color-primary-soft: var(--primary-soft);
  --color-on-primary: var(--on-primary);
  --color-accent-text: var(--accent-text);
  --color-ink: var(--ink);
  --color-ink-soft: var(--ink-soft);
  --color-muted: var(--muted);
  --color-subtle: var(--subtle);
  --color-line: var(--line);
  --color-floor: var(--floor);
  --color-success: var(--success);
  --color-danger: var(--danger);
  --font-sans: var(--font-jakarta), ui-sans-serif, system-ui, sans-serif;
  --radius-btn: 16px;
  --radius-card: 20px;
  --shadow-soft: 0 6px 16px rgb(27 36 64 / 0.10);
  --shadow-glow: 0 8px 20px color-mix(in srgb, var(--primary-strong) 30%, transparent);
}
```

Tailwind v3: taruh variabel `:root`/`[data-theme]` yang sama di `globals.css` (setelah `@tailwind` directives), lalu di `tailwind.config` → `theme.extend.colors` petakan tiap nama ke `"var(--nama)"`, `fontFamily.sans` ke `["var(--font-jakarta)", ...]`, `borderRadius` `btn`/`card`, `boxShadow` `soft`/`glow`.

Aturan warna: hanya pakai kelas token (`bg-primary`, `text-ink`, `border-line`, …). Jangan menulis hex atau warna bawaan Tailwind (`blue-600`, `yellow-400`) di komponen.

## Komponen dasar

`components/ui/button.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline" | "ghost";
const base =
  "inline-flex h-[54px] w-full items-center justify-center gap-3 rounded-btn px-5 text-base font-semibold " +
  "transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 " +
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary shadow-glow hover:bg-primary-strong",
  outline: "border-[1.5px] border-line bg-white text-ink shadow-soft hover:bg-floor/60",
  ghost: "text-accent-text hover:bg-primary-soft",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>(
  ({ variant = "primary", className = "", ...props }, ref) => (
    <button ref={ref} className={`${base} ${variants[variant]} ${className}`} {...props} />
  ),
);
Button.displayName = "Button";
```

Kalau proyek sudah memakai `cva`/`clsx`/`tailwind-merge` atau shadcn/ui, pakai itu dan petakan variannya ke token di atas (shadcn: set `--primary` dsb. di tema mereka, jangan buat sistem kedua).

Kelas lain yang dipakai berulang:
- Kartu: `rounded-card border border-line bg-white p-4 shadow-soft`
- Chip: `inline-flex items-center rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-accent-text`
- Eyebrow: `text-[13px] font-bold uppercase tracking-[0.18em] text-accent-text`
- Judul: `text-[29px] font-extrabold leading-9 text-ink` (desktop `md:text-4xl`)
- Body: `text-[15px] leading-[1.55] text-muted`
- Caption: `text-[12.5px] font-medium text-subtle`
- Input: `h-[52px] w-full rounded-btn border-[1.5px] border-line bg-white px-4 text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/20`

## Template halaman login / onboarding

Mobile-first, satu kolom terpusat; di `md+` jadi split: panel ilustrasi bertint di kiri, konten di kanan.

```tsx
import { ProductivityIllustration } from "@/components/illustrations/productivity";
import { GoogleButton } from "./google-button";

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh md:grid-cols-2">
      <section className="hidden items-center justify-center bg-primary-soft/60 md:flex">
        <ProductivityIllustration className="w-[min(80%,520px)]" />
      </section>
      <section className="flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="w-full max-w-[360px]">
          <ProductivityIllustration className="mx-auto mb-9 w-[300px] md:hidden" />
          <p className="text-[13px] font-bold uppercase tracking-[0.18em] text-accent-text">Welcome to</p>
          <h1 className="mt-2 text-[29px] font-extrabold leading-9 text-ink md:text-4xl">Management System</h1>
          <p className="mt-3.5 text-[15px] leading-[1.55] text-muted">
            When you are confused about managing your task, come to us.
          </p>
          <div className="mt-10"><GoogleButton /></div>
          <p className="mt-4 text-[12.5px] font-medium text-subtle">Aman &amp; cepat via Akun Google</p>
        </div>
      </section>
    </main>
  );
}
```

`google-button.tsx` adalah komponen `"use client"` yang membungkus `<Button variant="outline">` dengan ikon Google SVG 22px. Kalau proyek memakai Auth.js/NextAuth, panggil `signIn("google")` (client) atau server action; jika tidak ada auth, beri `onClick` TODO dan sebutkan ke user.

Teks, judul, dan tagline menyesuaikan permintaan user; yang di atas hanya contoh.

## Pola halaman lain

- **Dashboard**: header sapaan (`text-sm text-muted` + `text-2xl font-bold text-ink`) + avatar; grid kartu statistik (`grid gap-3 sm:grid-cols-2 lg:grid-cols-4`); daftar item dalam kartu dengan chip status.
- **Empty state**: ilustrasi kecil (`w-48`) + judul `text-lg font-bold` + body + Button primary.
- **Tema parking**: kartu "Kendaraan aktif" (plat nomor `text-xl font-bold tracking-wider`, lokasi, durasi berjalan, chip status), aksi cepat 2×2 (ikon dalam lingkaran `bg-primary-soft`), riwayat parkir sebagai list kartu. Status: hijau = tersedia/gate terbuka, merah = penuh/ditolak, kuning = proses.
- Ikon UI: pakai `lucide-react` jika sudah terpasang (stroke 1.75, `text-ink`); jangan menambah library ikon baru tanpa alasan.
- Jaga whitespace: maksimal 3 blok visual di layar onboarding; konten utama `max-w-[360px]` untuk auth, `max-w-6xl` untuk dashboard.

## Ilustrasi flat isometrik

Tulis sebagai komponen React berisi SVG inline di `components/illustrations/*.tsx`, menerima `className`. Pakai CSS variables untuk warna agar ikut tema:

```tsx
export function ProductivityIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 240" className={className} role="img" aria-label="Ilustrasi manajemen tugas">
      <ellipse cx="150" cy="196" rx="138" ry="36" fill="var(--floor)" />
      {/* objek utama: fill="var(--primary)", sisi gelap fill="var(--primary-strong)",
          sisi terang fill="var(--primary-soft)", detail fill="var(--ink)" / "var(--ink-soft)" */}
    </svg>
  );
}
```

Aturan gaya:
- Elips lantai `var(--floor)` di bawah semua objek.
- Maksimal 3–4 warna token + satu aksen kecil (`var(--danger)` atau `var(--success)`).
- Efek 3D: balok isometrik = atas `--primary`, sisi kiri `--primary-strong`, sisi kanan `--primary-soft`; objek bulat digambar ganda, versi gelap digeser 6–10px ke belakang.
- Bidang miring: `transform="skewY(-10)"` atau `skewX(-28)`. Gear dekoratif: lingkaran dengan `strokeDasharray` tebal warna `var(--line)`.
- Tema biru/produktivitas: jam, kalender, checklist, buku, pensil. Tema parking: mobil isometrik, palang gate (tiang navy + lengan bergaris kuning-navy), rambu P, kartu RFID/KTM, ponsel dengan centang, tiket, pin lokasi.
- Ilustrasi dekoratif yang sudah dijelaskan teks di sekitarnya: ganti `role/aria-label` dengan `aria-hidden="true"`.
- Animasi opsional dan halus saja (mis. gear berputar pelan via `animate-[spin_12s_linear_infinite]` dengan `motion-safe:`), selalu hormati `prefers-reduced-motion`.
- Jangan menyalin ilustrasi berhak cipta (Storyset, unDraw, dll.) atau logo resmi perusahaan; kalau user punya aset brand sendiri, pakai itu (taruh di `public/` dan render dengan `next/image`).

## Checklist sebelum selesai

- Tidak ada hex atau warna bawaan Tailwind di komponen; semua lewat token.
- Tema `parking`: teks di atas kuning navy (`text-on-primary`), bukan putih.
- Font Plus Jakarta Sans aktif lewat `--font-jakarta`.
- Hanya bagian interaktif yang `"use client"`.
- Fokus keyboard terlihat (ring), kontras teks cukup, tombol minimal tinggi 44px.
- Layout rapi di lebar 360px dan di desktop.
- Lint/build lolos bila bisa dijalankan; jika tidak, sebutkan ke user.
