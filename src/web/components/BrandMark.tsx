export function BrandMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" fill="none" aria-hidden="true">
      <rect
        x="120"
        y="48"
        width="272"
        height="416"
        rx="44"
        stroke="var(--foreground)"
        strokeWidth="26"
      />
      <path
        d="M234 84H278M234 430H278"
        stroke="var(--foreground)"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <path
        transform="translate(-10 0)"
        d="M208 130Q215 126 222 130L253 148Q260 152 260 160V179Q260 188 266 194L279 205Q286 210 294 206L311 196Q318 192 325 196L356 214Q363 218 363 226V262Q363 270 356 274L325 292Q318 296 311 292L280 274Q273 270 273 262V244Q273 234 265 228L252 217Q244 212 237 216L222 224Q215 228 208 224L177 206Q170 202 170 194V160Q170 152 177 148Z"
        fill="var(--primary)"
      />
      <path
        d="M192 335L214 355L192 375M251 375H299"
        stroke="var(--foreground)"
        strokeWidth="16"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
