export const COLORS = [
  '#000000', // Black
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#22c55e', // Green
  '#eab308', // Yellow
  '#a855f7', // Purple
];

export const TOOLS = {
  SELECT: 'select',
  PEN: 'pen',
  MARKER: 'marker',
  ERASER: 'eraser',
  AREA_ERASER: 'area_eraser',
  TEXT: 'text',
  LINE: 'line',
  CIRCLE: 'circle',
  RECTANGLE: 'rectangle',
} as const;

export type ToolType = (typeof TOOLS)[keyof typeof TOOLS];
