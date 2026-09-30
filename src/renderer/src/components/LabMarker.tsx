import type { ReactNode } from 'react'
import type { MarkerShape } from '@shared/domain/enums'

/** Side of the square the shapes below are drawn in. */
const BOX = 12
const DEFAULT_SIZE = 12

/** The shapes ECharts draws for the same symbol names. */
const SHAPES: Record<MarkerShape, ReactNode> = {
  circle: <circle cx="6" cy="6" r="5" />,
  rect: <rect x="1" y="1" width="10" height="10" />,
  roundRect: <rect x="1" y="1" width="10" height="10" rx="3" />,
  triangle: <path d="M6 1 L11 11 L1 11 Z" />,
  diamond: <path d="M6 0.5 L11.5 6 L6 11.5 L0.5 6 Z" />,
  pin: <path d="M6 11.5 C4 9 1.5 6.8 1.5 4.5 A4.5 4.5 0 0 1 10.5 4.5 C10.5 6.8 8 9 6 11.5 Z" />,
}

/** A lab's chart marker, so the same lab looks the same in lists, tables and charts. */
export function LabMarker({
  color,
  shape,
  size = DEFAULT_SIZE,
}: {
  color: string
  shape: MarkerShape
  size?: number
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BOX} ${BOX}`}
      fill={color}
      aria-hidden
      style={{ flex: 'none' }}
    >
      {SHAPES[shape]}
    </svg>
  )
}
