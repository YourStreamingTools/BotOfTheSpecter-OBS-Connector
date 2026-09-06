import React from 'react';
import { layoutSlices, polar } from '@shared/wheels';
import type { WheelSlice } from '@shared/ipc';

export function WheelVisual({
  slices, restDeg, spinning, fromDeg, toDeg, durationMs, size = 380
}: {
  slices: WheelSlice[];
  restDeg: number;
  spinning: boolean;
  fromDeg: number;
  toDeg: number;
  durationMs: number;
  size?: number;
}) {
  const layout = layoutSlices(slices);
  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [deg, setDeg] = React.useState(restDeg);
  const [transition, setTransition] = React.useState('none');

  React.useEffect(() => {
    if (!spinning) {
      setTransition('none');
      setDeg(restDeg);
      return;
    }
    if (reduce) {
      setTransition('none');
      setDeg(toDeg);
      return;
    }
    setTransition('none');
    setDeg(fromDeg);
    const id = requestAnimationFrame(() => {
      setTransition(`transform ${durationMs}ms cubic-bezier(0.12, 0.7, 0.08, 1)`);
      setDeg(toDeg);
    });
    return () => cancelAnimationFrame(id);
  }, [spinning, fromDeg, toDeg, durationMs, restDeg, reduce]);

  const cx = 100, cy = 100, r = 94;
  const showLabels = layout.length <= 24;

  return (
    <div className="wheel-stage" style={{ width: size, height: size }}>
      <div className="wheel-pointer" aria-hidden />
      <svg
        className="wheel-disk"
        viewBox="0 0 200 200"
        style={{ transform: `rotate(${deg}deg)`, transition }}
      >
        <circle cx={cx} cy={cy} r={98} fill="#0D0D0D" />
        {layout.length === 0 && <circle cx={cx} cy={cy} r={r} fill="#22223B" />}
        {layout.map((s) => {
          if (s.spanDeg >= 359.9) {
            return <circle key={s.id} cx={cx} cy={cy} r={r} fill={s.color} />;
          }
          const a = polar(cx, cy, r, s.startDeg);
          const b = polar(cx, cy, r, s.startDeg + s.spanDeg);
          const large = s.spanDeg > 180 ? 1 : 0;
          const d = `M${cx} ${cy} L${a.x} ${a.y} A${r} ${r} 0 ${large} 1 ${b.x} ${b.y} Z`;
          const p = polar(cx, cy, r * 0.62, s.midDeg);
          const rot = s.midDeg > 90 && s.midDeg < 270 ? s.midDeg + 180 : s.midDeg;
          return (
            <g key={s.id}>
              <path d={d} fill={s.color} />
              {showLabels && s.spanDeg >= 10 && (
                <text
                  x={p.x} y={p.y}
                  fill="#fff" fontSize={s.spanDeg > 28 ? 9 : 7} fontWeight={700}
                  textAnchor="middle" dominantBaseline="middle"
                  transform={`rotate(${rot} ${p.x} ${p.y})`}
                >
                  {s.label.slice(0, 16)}
                </text>
              )}
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={98} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={2} />
      </svg>
    </div>
  );
}
