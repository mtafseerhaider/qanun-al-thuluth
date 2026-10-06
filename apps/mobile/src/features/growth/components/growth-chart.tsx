import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { useThemeColors } from '@/theme/use-theme-colors';

import type { BandCurve, SeriesPoint } from '../utils/growth-rules';

/** Dash pattern per band so bands are told apart by pattern and label, not colour only (02 §7.9). */
const BAND_DASH: Record<number, string | undefined> = {
  3: '2 4',
  5: '2 4',
  15: '6 4',
  25: '6 4',
  50: undefined,
  75: '6 4',
  85: '6 4',
  95: '2 4',
  97: '2 4',
};

const PAD = { top: 12, bottom: 28, start: 40, end: 36 };

/**
 * `GrowthChart` (02 §7.9 region 4, 08 §5): percentile bands from the reference LMS rows and the
 * child's measurements joined by a line. Charts keep their left-to-right age axis in RTL (08 §10).
 * The parent passes a summary label; the screen offers a table view as the accessible alternative.
 */
export function GrowthChart({
  bands,
  points,
  window,
  height = 240,
  accessibilityLabel,
  ageLabel,
  testID,
}: {
  bands: readonly BandCurve[];
  points: readonly SeriesPoint[];
  window: [number, number];
  height?: number;
  accessibilityLabel: string;
  /** Formats an age in months for the x-axis ticks. */
  ageLabel: (months: number) => string;
  testID?: string;
}) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const values = [
    ...bands.flatMap((b) => b.points.map(([, v]) => v)),
    ...points.map((p) => p.value),
  ];
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;
  const spanV = maxV - minV || 1;
  const lo = minV - spanV * 0.05;
  const hi = maxV + spanV * 0.05;
  const [a0, a1] = window;
  const innerW = Math.max(1, width - PAD.start - PAD.end);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (age: number) => PAD.start + ((age - a0) / (a1 - a0 || 1)) * innerW;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * innerH;
  const ticks = Array.from({ length: 5 }, (_, i) => a0 + ((a1 - a0) * i) / 4);
  const vTicks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * i) / 3);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, direction: 'ltr' }}
      {...(testID ? { testID } : {})}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Line
            x1={PAD.start}
            y1={PAD.top + innerH}
            x2={PAD.start + innerW}
            y2={PAD.top + innerH}
            stroke={colors['line-strong']}
            strokeWidth={1}
          />
          {ticks.map((t) => (
            <SvgText
              key={`x${t}`}
              x={x(t)}
              y={height - 8}
              fontSize={10}
              fill={colors['ink-muted']}
              textAnchor="middle"
            >
              {ageLabel(Math.round(t))}
            </SvgText>
          ))}
          {vTicks.map((v) => (
            <SvgText
              key={`y${v}`}
              x={PAD.start - 4}
              y={y(v) + 3}
              fontSize={10}
              fill={colors['ink-muted']}
              textAnchor="end"
            >
              {v >= 10 ? Math.round(v) : v.toFixed(1)}
            </SvgText>
          ))}
          {bands.map((b) => {
            const pts = b.points.filter(([age]) => age >= a0 && age <= a1);
            const last = pts[pts.length - 1];
            return (
              <G key={b.percentile}>
                <Polyline
                  points={pts.map(([age, v]) => `${x(age)},${y(v)}`).join(' ')}
                  fill="none"
                  stroke={b.percentile === 50 ? colors.primary : colors['line-strong']}
                  strokeWidth={b.percentile === 50 ? 1.5 : 1}
                  strokeDasharray={BAND_DASH[b.percentile] ?? 'none'}
                />
                {last ? (
                  <SvgText
                    x={x(last[0]) + 4}
                    y={y(last[1]) + 3}
                    fontSize={10}
                    fill={colors['ink-muted']}
                  >
                    {String(b.percentile)}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
          {points.length > 1 ? (
            <Polyline
              points={points.map((p) => `${x(p.ageMonths)},${y(p.value)}`).join(' ')}
              fill="none"
              stroke={colors.accent}
              strokeWidth={2.5}
            />
          ) : null}
          {points.map((p) => (
            <Circle
              key={p.measuredOn}
              cx={x(p.ageMonths)}
              cy={y(p.value)}
              r={5}
              fill={colors.accent}
              stroke={colors.surface}
              strokeWidth={1.5}
            />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
