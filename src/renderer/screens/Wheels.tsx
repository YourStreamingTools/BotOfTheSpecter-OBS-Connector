import React from 'react';
import { useWheels } from '../state/useWheels';
import { WheelVisual } from './wheels/WheelVisual';
import { IconWheel, IconPlus, IconTrash, IconPlay, IconCopy, IconExternal } from '../icons';
import { MIN_SLICES_TO_SPIN, MAX_WHEEL_SLICES, SPIN_DURATION_MS, spinnableSlices } from '@shared/wheels';
import type { Wheel, WheelInput, WheelSlice } from '@shared/ipc';

export function ScreenWheels() {
  const snap = useWheels();
  const active = snap.wheels.find((w) => w.id === snap.activeWheelId) ?? snap.wheels[0] ?? null;
  const [name, setName] = React.useState(active?.name ?? '');
  const [slices, setSlices] = React.useState<WheelSlice[]>(active?.slices ?? []);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const activeId = active?.id ?? null;

  React.useEffect(() => {
    setName(active?.name ?? '');
    setSlices(active?.slices ?? []);
    setError(null);
  }, [activeId]);

  const spinningThis = snap.spinning && snap.spin?.wheelId === activeId;
  const canSpin = !!active && !snap.spinning && spinnableSlices(slices).length >= MIN_SLICES_TO_SPIN;

  const save = async (nextName = name, nextSlices = slices) => {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.wheels.update(active.id, toInput(nextName, nextSlices));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const createWheel = async () => {
    setBusy(true);
    setError(null);
    try {
      const n = snap.wheels.length + 1;
      const created = await window.api.wheels.create({
        name: `Wheel ${n}`,
        slices: [{ label: 'Option 1' }, { label: 'Option 2' }]
      });
      await window.api.wheels.setActive(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create wheel');
    } finally {
      setBusy(false);
    }
  };

  const addSlice = () => {
    if (!active || slices.length >= MAX_WHEEL_SLICES) return;
    const next = [...slices, { id: '', label: `Option ${slices.length + 1}`, color: '', weight: 1 }];
    setSlices(next);
    void save(name, next);
  };

  const changeSlice = (i: number, label: string) => {
    const next = slices.map((s, idx) => idx === i ? { ...s, label } : s);
    setSlices(next);
  };

  const removeSlice = (i: number) => {
    const next = slices.filter((_, idx) => idx !== i);
    setSlices(next);
    void save(name, next);
  };

  const spin = async () => {
    if (!active) return;
    setError(null);
    try {
      await save();
      await window.api.wheels.spin(active.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Spin failed');
    }
  };

  const copyUrl = async () => {
    if (!snap.overlayUrl) return;
    try {
      await navigator.clipboard.writeText(snap.overlayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Could not copy overlay URL');
    }
  };

  const winner = snap.lastWinner && active && snap.lastWinner.wheelId === active.id
    ? snap.lastWinner
    : null;

  return (
    <div className="screen">
      <div className="row" style={{ marginBottom: 14, gap: 10, alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Wheels</h3>
        <span className="chip">{snap.wheels.length}</span>
        <span style={{ marginLeft: 'auto' }} />
        <button className="btn btn-sm btn-primary" onClick={() => void createWheel()} disabled={busy}>
          <IconPlus size={12} />New wheel
        </button>
      </div>

      {snap.wheels.length === 0 ? (
        <Empty onCreate={() => void createWheel()} />
      ) : (
        <div className="wheels-layout">
          <aside className="card wheels-list">
            <div className="card-head"><h3>Your wheels</h3></div>
            <div className="col" style={{ gap: 6 }}>
              {snap.wheels.map((w) => (
                <button
                  key={w.id}
                  className="wheel-list-item"
                  data-active={w.id === activeId ? 'true' : 'false'}
                  onClick={() => void window.api.wheels.setActive(w.id)}
                >
                  <IconWheel size={14} />
                  <span className="wheel-list-name">{w.name}</span>
                  <span className="chip">{w.slices.length}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="card wheels-stage-card">
            {active && (
              <>
                <WheelVisual
                  slices={active.slices}
                  restDeg={active.restRotationDeg}
                  spinning={!!spinningThis}
                  fromDeg={snap.spin?.fromDeg ?? active.restRotationDeg}
                  toDeg={snap.spin?.toDeg ?? active.restRotationDeg}
                  durationMs={snap.spin?.durationMs ?? SPIN_DURATION_MS}
                />
                <div className="wheel-hub-caption">
                  <strong>{spinningThis ? 'Spinning…' : winner ? winner.label : active.name}</strong>
                  <span>{spinningThis ? 'wait for it' : winner ? 'winner' : `${active.slices.length} options`}</span>
                </div>
                <button className="btn btn-lg btn-primary" onClick={() => void spin()} disabled={!canSpin || busy}>
                  <IconPlay size={14} />{snap.spinning ? 'Spinning…' : 'Spin'}
                </button>
                {error && <div className="wheel-error">{error}</div>}
                <div className="wheel-overlay-row">
                  <span className="mono" title={snap.overlayUrl ?? undefined}>
                    {snap.overlayUrl ?? 'Overlay unavailable'}
                  </span>
                  <button className="btn btn-sm" disabled={!snap.overlayUrl} onClick={() => void copyUrl()}>
                    <IconCopy size={11} />{copied ? 'Copied' : 'Copy URL'}
                  </button>
                  <button className="btn btn-sm" disabled={!snap.overlayUrl} onClick={() => void window.api.wheels.openOverlay()}>
                    <IconExternal size={11} />Preview
                  </button>
                </div>
                <p className="wheel-hint">
                  OBS → Add Source → Browser. Paste the URL, width 1080, height 1080, and tick
                  “Shutdown source when not visible” off. The page is transparent.
                </p>
              </>
            )}
          </section>

          <aside className="card wheels-editor">
            {active && (
              <Editor
                wheel={active}
                name={name}
                slices={slices}
                busy={busy || !!spinningThis}
                onName={setName}
                onNameBlur={() => void save()}
                onSliceChange={changeSlice}
                onSliceBlur={() => void save()}
                onAdd={addSlice}
                onRemove={removeSlice}
                onDelete={() => void window.api.wheels.delete(active.id)}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function toInput(name: string, slices: WheelSlice[]): WheelInput {
  return {
    name,
    slices: slices.map((s) => ({
      id: s.id || undefined,
      label: s.label,
      color: s.color,
      weight: s.weight
    }))
  };
}

function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 48 }}>
      <IconWheel size={36} />
      <h3 style={{ margin: '14px 0 6px' }}>No wheels yet</h3>
      <p style={{ color: 'var(--text-dim)', margin: '0 0 18px' }}>
        Make as many wheels as you like, each with as many options as you want, then switch between them.
      </p>
      <button className="btn btn-primary" onClick={onCreate}><IconPlus size={12} />New wheel</button>
    </div>
  );
}

function Editor({
  wheel, name, slices, busy, onName, onNameBlur, onSliceChange, onSliceBlur, onAdd, onRemove, onDelete
}: {
  wheel: Wheel;
  name: string;
  slices: WheelSlice[];
  busy: boolean;
  onName: (v: string) => void;
  onNameBlur: () => void;
  onSliceChange: (i: number, label: string) => void;
  onSliceBlur: () => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="card-head"><h3>Options</h3></div>
      <label className="label-row">Wheel name</label>
      <input
        className="input"
        value={name}
        disabled={busy}
        onChange={(e) => onName(e.target.value)}
        onBlur={onNameBlur}
      />
      <div className="col" style={{ gap: 8, marginTop: 14, maxHeight: 420, overflowY: 'auto' }}>
        {slices.map((s, i) => (
          <div key={s.id || `new-${i}`} className="row" style={{ gap: 8 }}>
            <span className="wheel-swatch" style={{ background: s.color || 'var(--primary)' }} />
            <input
              className="input"
              value={s.label}
              disabled={busy}
              onChange={(e) => onSliceChange(i, e.target.value)}
              onBlur={onSliceBlur}
              aria-label={`Option ${i + 1}`}
            />
            <button className="btn btn-icon btn-sm" disabled={busy || slices.length <= 1} onClick={() => onRemove(i)} title="Remove option">
              <IconTrash size={12} />
            </button>
          </div>
        ))}
      </div>
      <button className="btn btn-sm" style={{ marginTop: 12 }} disabled={busy || slices.length >= MAX_WHEEL_SLICES} onClick={onAdd}>
        <IconPlus size={12} />Add option
      </button>
      <button className="btn btn-sm btn-danger" style={{ marginTop: 18 }} disabled={busy} onClick={onDelete}>
        <IconTrash size={12} />Delete {wheel.name}
      </button>
    </>
  );
}
