export function ProductivityIllustration({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 300 240"
      className={className}
      aria-hidden="true"
    >
      {/* Lantai elips wajib di bawah semua objek */}
      <ellipse cx="150" cy="196" rx="138" ry="36" fill="var(--floor)" />

      {/* Gear dekoratif di latar belakang */}
      <g
        className="origin-[68px_72px] motion-safe:animate-[spin_16s_linear_infinite]"
      >
        <circle
          cx="68"
          cy="72"
          r="24"
          fill="none"
          stroke="var(--line)"
          strokeWidth="7"
          strokeDasharray="8 6"
        />
        <circle cx="68" cy="72" r="11" fill="var(--primary-soft)" />
      </g>

      {/* Papan Task Board Isometrik (Sisi gelap di belakang + bidang utama miring) */}
      <g transform="translate(56, 38) skewY(-10)">
        {/* Sisi bayangan 3D balok belakang */}
        <rect
          x="8"
          y="8"
          width="148"
          height="112"
          rx="14"
          fill="var(--primary-strong)"
        />
        {/* Permukaan utama papan */}
        <rect
          x="0"
          y="0"
          width="148"
          height="112"
          rx="14"
          fill="var(--primary)"
        />
        {/* Header papan */}
        <rect
          x="12"
          y="12"
          width="124"
          height="16"
          rx="6"
          fill="var(--primary-soft)"
        />
        <circle cx="22" cy="20" r="3.5" fill="var(--danger)" />
        <circle cx="33" cy="20" r="3.5" fill="var(--success)" />
        <rect
          x="44"
          y="17"
          width="54"
          height="6"
          rx="3"
          fill="var(--ink-soft)"
        />

        {/* 3 Kolom Kanban (To Do, Doing, Done) */}
        <rect
          x="12"
          y="36"
          width="36"
          height="64"
          rx="6"
          fill="var(--primary-soft)"
        />
        <rect
          x="56"
          y="36"
          width="36"
          height="64"
          rx="6"
          fill="var(--primary-soft)"
        />
        <rect
          x="100"
          y="36"
          width="36"
          height="64"
          rx="6"
          fill="var(--primary-soft)"
        />

        {/* Kartu dalam kolom */}
        <rect x="16" y="42" width="28" height="16" rx="4" fill="var(--bg)" />
        <rect
          x="19"
          y="46"
          width="18"
          height="4"
          rx="2"
          fill="var(--ink)"
        />
        <rect x="16" y="63" width="28" height="16" rx="4" fill="var(--bg)" />
        <rect
          x="19"
          y="67"
          width="22"
          height="4"
          rx="2"
          fill="var(--ink-soft)"
        />

        <rect x="60" y="42" width="28" height="22" rx="4" fill="var(--bg)" />
        <rect
          x="63"
          y="46"
          width="20"
          height="4"
          rx="2"
          fill="var(--primary-strong)"
        />
        <rect
          x="63"
          y="54"
          width="14"
          height="4"
          rx="2"
          fill="var(--success)"
        />

        {/* Kartu selesai di kolom Done */}
        <rect x="104" y="42" width="28" height="18" rx="4" fill="var(--bg)" />
        <circle cx="118" cy="51" r="5" fill="var(--success)" />
        <path
          d="M115.5 51L117.2 52.8L121 49"
          fill="none"
          stroke="var(--bg)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Balon Chat Grup Terintegrasi (mengambang di kanan depan dengan efek 3D ganda) */}
      <g transform="translate(172, 82) skewY(-8)">
        <rect
          x="6"
          y="7"
          width="88"
          height="64"
          rx="14"
          fill="var(--ink)"
        />
        <rect
          x="0"
          y="0"
          width="88"
          height="64"
          rx="14"
          fill="var(--primary-soft)"
          stroke="var(--primary-strong)"
          strokeWidth="2.5"
        />
        {/* Ekor balon chat */}
        <path
          d="M18 64L10 78L32 64Z"
          fill="var(--primary-soft)"
          stroke="var(--primary-strong)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Isi pesan chat & badge integrasi card */}
        <rect
          x="12"
          y="14"
          width="46"
          height="7"
          rx="3.5"
          fill="var(--ink)"
        />
        <rect
          x="12"
          y="26"
          width="64"
          height="6"
          rx="3"
          fill="var(--ink-soft)"
        />
        <rect
          x="12"
          y="39"
          width="52"
          height="13"
          rx="6"
          fill="var(--primary)"
        />
        <circle cx="21" cy="45.5" r="3" fill="var(--on-primary)" />
        <rect
          x="28"
          y="43.5"
          width="28"
          height="4"
          rx="2"
          fill="var(--on-primary)"
        />
      </g>

      {/* Jam / Badge Produktivitas Bulat (Efek 3D digambar ganda digeser 7px) */}
      <g transform="translate(46, 146)">
        <circle cx="31" cy="29" r="22" fill="var(--ink)" />
        <circle
          cx="24"
          cy="24"
          r="22"
          fill="var(--primary-soft)"
          stroke="var(--primary)"
          strokeWidth="3"
        />
        <path
          d="M24 13V24L32 28"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="24" r="3" fill="var(--danger)" />
      </g>
    </svg>
  );
}
