import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import {
  COMPARE_LABELS,
  COMPARE_PRESETS,
  RANGE_LABELS,
  compareRangeFor,
  formatRange,
  rangeForPreset,
  rangeLength,
  shiftDays,
  validateRange,
  type ComparePreset,
  type DateRange,
  type RangePreset,
  type WeekStart,
} from "../state/range";

// What a view stores once the picker has been applied. A preset is kept as its
// id, so the view can re-resolve `range` when the day rolls over and "Last 7
// days" keeps meaning the last 7 days (Overview via store.today, Reports on
// each new manifest).
export interface PickerValue {
  preset: RangePreset;
  range: DateRange; // resolved bounds; for `custom`, the custom bounds
  compare: { preset: ComparePreset; range: DateRange } | null;
  weekStart: WeekStart;
}

interface Props {
  value: PickerValue;
  today: string;
  presets: RangePreset[];
  allowCompare: boolean;
  // Longest primary range (Overview: 7). The compare range is not capped.
  maxDays?: number;
  // Days the data source can answer for (Reports: the archive's coverage).
  minDay?: string;
  maxDay?: string;
  // Extra line above the buttons, e.g. what Apply is about to download.
  note?: (range: DateRange, compare: DateRange | null) => ComponentChildren;
  onApply: (value: PickerValue) => void;
}

// Everything the user can touch, held apart from the view's own state: shortcuts
// and inputs edit only this, and nothing is queried until Apply commits it.
interface Draft {
  preset: RangePreset;
  from: string;
  to: string;
  compareOn: boolean;
  cPreset: ComparePreset;
  cFrom: string;
  cTo: string;
  weekStart: WeekStart;
}

function draftFrom(value: PickerValue): Draft {
  const c = value.compare;
  return {
    preset: value.preset,
    from: value.range.from,
    to: value.range.to,
    compareOn: c !== null,
    cPreset: c?.preset ?? "prevPeriod",
    cFrom: c?.range.from ?? value.range.from,
    cTo: c?.range.to ?? value.range.to,
    weekStart: value.weekStart,
  };
}

// Bounds the draft currently points at. A preset follows the week-start switch;
// `custom` is whatever is in the inputs (which may not be a valid date yet).
function resolveDraft(d: Draft, today: string): { range: DateRange; compare: DateRange | null } {
  const range = d.preset === "custom" ? { from: d.from, to: d.to } : (rangeForPreset(d.preset, today, d.weekStart) ?? { from: d.from, to: d.to });
  let compare: DateRange | null = null;
  if (d.compareOn) {
    if (d.cPreset === "custom") compare = { from: d.cFrom, to: d.cTo };
    // Shifting needs real dates; a half-typed one just has no comparison yet.
    else if (validateRange(range) === null) compare = compareRangeFor(d.cPreset, range);
  }
  return { range, compare };
}

// Keep in step with `.drp-panel { width }` in styles.css.
const PANEL_WIDTH = 580;

export function DateRangePicker({ value, today, presets, allowCompare, maxDays, minDay, maxDay, note, onApply }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(value));
  const valueRef = useRef(value);
  valueRef.current = value;

  // `popover="auto"` gives top-layer rendering, Escape and click-outside
  // dismissal for free; both just close it, which is Cancel because the draft
  // is only ever committed by Apply. Every open starts from the applied value.
  // Anchor positioning is not available everywhere yet, so the panel is placed
  // from the trigger's rect and kept inside the viewport.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const onBeforeToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      setDraft(draftFrom(valueRef.current));
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      // Not laid out yet while closed, so use the width the stylesheet gives it.
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 16);
      el.style.top = `${Math.round(r.bottom + 6)}px`;
      el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
    };
    el.addEventListener("beforetoggle", onBeforeToggle);
    return () => el.removeEventListener("beforetoggle", onBeforeToggle);
  }, []);

  const { range, compare } = resolveDraft(draft, today);
  const rangeError = validateRange(range, { maxDays, minDay, maxDay });
  const compareError = draft.compareOn
    ? compare
      ? validateRange(compare, { minDay, maxDay })
      : "Pick a valid range first"
    : null;
  const invalid = rangeError ?? compareError;

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const pickPreset = (preset: RangePreset) => {
    const r = rangeForPreset(preset, today, draft.weekStart);
    patch(r ? { preset, from: r.from, to: r.to } : { preset });
  };
  // Typing in an input leaves any shortcut: the selection becomes `custom`.
  const editRange = (p: Partial<DateRange>) => patch({ preset: "custom", from: p.from ?? range.from, to: p.to ?? range.to });
  const pickCompare = (cPreset: ComparePreset) => {
    const r = cPreset === "custom" ? null : validateRange(range) === null ? compareRangeFor(cPreset, range) : null;
    patch(r ? { cPreset, cFrom: r.from, cTo: r.to } : { cPreset });
  };
  const editCompare = (p: Partial<DateRange>) => {
    const base = compare ?? { from: draft.cFrom, to: draft.cTo };
    patch({ cPreset: "custom", cFrom: p.from ?? base.from, cTo: p.to ?? base.to });
  };

  const apply = () => {
    if (invalid) return;
    onApply({
      preset: draft.preset,
      range,
      compare: draft.compareOn && compare ? { preset: draft.cPreset, range: compare } : null,
      weekStart: draft.weekStart,
    });
    panel.current?.hidePopover();
  };

  // Input limits: a primary range can be at most `maxDays` long, whichever end
  // is being edited, and neither end may leave the data's coverage.
  const latest = maxDay && maxDay < today ? maxDay : today;
  const span = maxDays ? maxDays - 1 : null;
  const clampMin = (day: string) => (minDay && day < minDay ? minDay : day);
  const clampMax = (day: string) => (day > latest ? latest : day);
  const validFrom = validateRange({ from: range.from, to: range.from }) === null;
  const validTo = validateRange({ from: range.to, to: range.to }) === null;
  const fromMin = minDay && span !== null && validTo ? clampMin(shiftDays(range.to, -span)) : minDay;
  const toMax = span !== null && validFrom ? clampMax(shiftDays(range.from, span)) : latest;

  const applied = value.range;
  const triggerLabel =
    formatRange(applied, today) + (value.compare ? ` vs ${formatRange(value.compare.range, today)}` : "");

  return (
    <div class="drp">
      <button
        ref={trigger}
        type="button"
        class="btn drp-trigger"
        title={RANGE_LABELS[value.preset]}
        {...({ popovertarget: id } as object)}
      >
        {triggerLabel} ▾
      </button>
      <div ref={panel} id={id} popover="auto" class="drp-panel">
        <div class="drp-body">
          <div class="drp-shortcuts" role="group" aria-label="Date range shortcuts">
            {presets
              .filter((p) => p !== "custom")
              .map((p) => (
                <button type="button" class={draft.preset === p ? "active" : ""} onClick={() => pickPreset(p)}>
                  {RANGE_LABELS[p]}
                </button>
              ))}
            <div class="drp-week segmented" role="group" aria-label="Week starts on">
              <span class="muted">Week starts</span>
              <button type="button" class={draft.weekStart === "sun" ? "active" : ""} onClick={() => patch({ weekStart: "sun" })}>
                Sun
              </button>
              <button type="button" class={draft.weekStart === "mon" ? "active" : ""} onClick={() => patch({ weekStart: "mon" })}>
                Mon
              </button>
            </div>
          </div>

          <div class="drp-main">
            <div class="drp-fields">
              <label>
                From
                <input
                  type="date"
                  value={range.from}
                  min={fromMin}
                  max={validTo ? range.to : latest}
                  onInput={(e) => editRange({ from: (e.target as HTMLInputElement).value })}
                />
              </label>
              <span class="drp-sep">–</span>
              <label>
                To
                <input
                  type="date"
                  value={range.to}
                  min={validFrom ? range.from : minDay}
                  max={toMax}
                  onInput={(e) => editRange({ to: (e.target as HTMLInputElement).value })}
                />
              </label>
              {!rangeError && <span class="muted drp-len">{rangeLength(range)} day(s)</span>}
            </div>
            {rangeError && <div class="drp-error">{rangeError}</div>}

            {allowCompare && (
              <>
                <label class="drp-compare-toggle">
                  <input type="checkbox" checked={draft.compareOn} onChange={(e) => patch({ compareOn: (e.target as HTMLInputElement).checked })} />
                  Compare
                </label>
                {draft.compareOn && (
                  <>
                    <div class="drp-compare-presets" role="group" aria-label="Comparison shortcuts">
                      {COMPARE_PRESETS.filter((p) => p !== "custom").map((p) => (
                        <button type="button" class={draft.cPreset === p ? "active" : ""} onClick={() => pickCompare(p)}>
                          {COMPARE_LABELS[p]}
                        </button>
                      ))}
                    </div>
                    <div class="drp-fields">
                      <label>
                        From
                        <input
                          type="date"
                          value={compare?.from ?? ""}
                          min={minDay}
                          max={latest}
                          onInput={(e) => editCompare({ from: (e.target as HTMLInputElement).value })}
                        />
                      </label>
                      <span class="drp-sep">–</span>
                      <label>
                        To
                        <input
                          type="date"
                          value={compare?.to ?? ""}
                          min={minDay}
                          max={latest}
                          onInput={(e) => editCompare({ to: (e.target as HTMLInputElement).value })}
                        />
                      </label>
                    </div>
                    {compareError && <div class="drp-error">{compareError}</div>}
                  </>
                )}
              </>
            )}
            {maxDays && <div class="muted drp-hint">Overview shows at most {maxDays} days. Use Reports for longer ranges.</div>}
            {!invalid && note?.(range, draft.compareOn ? compare : null)}
          </div>
        </div>
        <div class="drp-actions">
          <button type="button" class="btn" onClick={() => panel.current?.hidePopover()}>
            Cancel
          </button>
          <button type="button" class="btn primary" disabled={invalid !== null} onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
