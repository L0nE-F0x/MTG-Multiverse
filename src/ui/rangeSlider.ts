/**
 * A dual-handle range slider built from two overlaid `<input type=range>`
 * elements plus a filled track div. Used by the filter panel for the year
 * and mana-value bounds.
 */
import { clamp, el, listen } from './dom.ts';

export interface DualRangeOptions {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  /** How to render each bound, e.g. so 30 shows as "30+". */
  formatValue?: (v: number) => string;
  onChange: (value: [number, number]) => void;
}

export interface DualRangeHandle {
  el: HTMLElement;
  setValue(value: [number, number]): void;
  destroy(): void;
}

export function createDualRangeSlider(opts: DualRangeOptions): DualRangeHandle {
  const { min, max, step = 1, formatValue = (v) => String(v) } = opts;
  let [lo, hi] = opts.value;

  const fill = el('div', { className: 'mcu-range-fill' });
  const inputLo = el('input', {
    className: 'mcu-range-input mcu-range-input--lo',
    attrs: { type: 'range', min: String(min), max: String(max), step: String(step) },
  });
  const inputHi = el('input', {
    className: 'mcu-range-input mcu-range-input--hi',
    attrs: { type: 'range', min: String(min), max: String(max), step: String(step) },
  });
  const track = el('div', { className: 'mcu-range-track' }, [fill, inputLo, inputHi]);
  const loLabel = el('span', { className: 'mcu-range-readout-lo' });
  const hiLabel = el('span', { className: 'mcu-range-readout-hi' });
  const readout = el('div', { className: 'mcu-range-readout' }, [loLabel, hiLabel]);
  const root = el('div', { className: 'mcu-range' }, [track, readout]);

  function paint(): void {
    inputLo.value = String(lo);
    inputHi.value = String(hi);
    const span = max - min || 1;
    const pctLo = ((lo - min) / span) * 100;
    const pctHi = ((hi - min) / span) * 100;
    fill.style.left = `${pctLo}%`;
    fill.style.width = `${Math.max(0, pctHi - pctLo)}%`;
    loLabel.textContent = formatValue(lo);
    hiLabel.textContent = formatValue(hi);
  }

  const offLo = listen(inputLo, 'input', () => {
    let v = clamp(Number(inputLo.value), min, max);
    if (v > hi) v = hi;
    lo = v;
    paint();
    opts.onChange([lo, hi]);
  });
  const offHi = listen(inputHi, 'input', () => {
    let v = clamp(Number(inputHi.value), min, max);
    if (v < lo) v = lo;
    hi = v;
    paint();
    opts.onChange([lo, hi]);
  });

  paint();

  return {
    el: root,
    setValue(value: [number, number]) {
      [lo, hi] = value;
      paint();
    },
    destroy() {
      offLo();
      offHi();
    },
  };
}
