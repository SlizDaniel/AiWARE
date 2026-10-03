import type { SVGProps } from 'react'

// Ikony rysowane jedną kreską (1.6 px, zaokrąglone końce) w siatce 20×20 — jeden styl na całą stronę.

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

/** Rzut hali: obrys i regały. */
export function MapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <path d="M6 7v6M10 7v6M14 7v3" />
    </Icon>
  )
}

/** Regał z półkami. */
export function StockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 2.5v15M16.5 2.5v15M3.5 7h13M3.5 12h13" />
      <rect x="5.5" y="3.8" width="3.5" height="3.2" />
      <rect x="10" y="8.8" width="4.5" height="3.2" />
      <rect x="5.5" y="13.8" width="4" height="3.2" />
    </Icon>
  )
}

/** Kolejka zatwierdzeń: podkładka z odhaczeniem. */
export function QueueIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3.5H5.5a1.5 1.5 0 0 0-1.5 1.5v11a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V5a1.5 1.5 0 0 0-1.5-1.5H13" />
      <rect x="7" y="2.5" width="6" height="2.5" rx="0.8" />
      <path d="m7.3 11.2 1.9 1.9 3.6-3.8" />
    </Icon>
  )
}

/** Historia: zegar z cofającą strzałką. */
export function HistoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.6 10a6.4 6.4 0 1 0 1.9-4.5" />
      <path d="M3.2 3.6v2.6h2.6" />
      <path d="M10 6.5V10l2.4 1.6" />
    </Icon>
  )
}

/** Procedury: segregator. */
export function ProcedureIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 2.5h8.5l2 2v13H5a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 5 2.5Z" />
      <path d="M7 7h6M7 10h6M7 13h3.5" />
    </Icon>
  )
}

/** Dashboard: wskaźnik zegarowy. */
export function GaugeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 14.5a7 7 0 1 1 14 0" />
      <path d="m10 14.5 3.2-4.6" />
      <path d="M2.5 17.5h15" />
    </Icon>
  )
}

/** Ustawienia: suwaki. */
export function SlidersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 5.5h8M14.5 5.5H17M3 14.5h2.5M9 14.5h8" />
      <circle cx="12.7" cy="5.5" r="1.8" />
      <circle cx="7.2" cy="14.5" r="1.8" />
    </Icon>
  )
}

export function MicIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="7.2" y="2.5" width="5.6" height="9.5" rx="2.8" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
    </Icon>
  )
}

export function MicOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.8 8.6V5.3a2.8 2.8 0 0 0-5.3-1.2M7.2 7.6v1.6a2.8 2.8 0 0 0 4.4 2.3" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 9 4.2M15.5 9.5a5.4 5.4 0 0 1-.3 1.7M10 15v2.5M3 3l14 14" />
    </Icon>
  )
}

export function SendIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 10h11M10.5 5.5 15 10l-4.5 4.5" />
    </Icon>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 10.5 3.8 3.8L16 6" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 5l10 10M15 5 5 15" />
    </Icon>
  )
}

export function UndoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 4.5 3.5 8 7 11.5" />
      <path d="M3.5 8h8.5a4.5 4.5 0 0 1 0 9H8" />
    </Icon>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13 13 4 4" />
    </Icon>
  )
}

export function EditIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.5 4 16 7.5l-8.5 8.5H4v-3.5L12.5 4Z" />
      <path d="m10.5 6 3.5 3.5" />
    </Icon>
  )
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 3v9.5M6 8.8l4 4 4-4M3.5 16.5h13" />
    </Icon>
  )
}

export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 13V3.5M6 7.2l4-4 4 4M3.5 16.5h13" />
    </Icon>
  )
}

export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16 10a6 6 0 1 1-1.8-4.3" />
      <path d="M16.4 3.4v3.3h-3.3" />
    </Icon>
  )
}

export function LogoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3" />
      <path d="M12.5 6.5 16 10l-3.5 3.5M16 10H7.5" />
    </Icon>
  )
}

export function PinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 17.5s-5.5-5-5.5-9a5.5 5.5 0 0 1 11 0c0 4-5.5 9-5.5 9Z" />
      <circle cx="10" cy="8.5" r="2" />
    </Icon>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 4v12M4 10h12" />
    </Icon>
  )
}

export function ChevronIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
    </Icon>
  )
}
