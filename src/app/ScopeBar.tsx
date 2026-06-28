import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import { useScope } from './ScopeProvider';

/**
 * The shared scope control: a time-range segment and a source segment. Each panel renders one;
 * all of them read and write the single {@link useScope} state, so a selection persists across
 * navigation. Emits the house-style testids the frozen smoke drives:
 *   - `range-filter` / `range-option` (active option carries `aria-current="true"`)
 *   - `source-filter` / `source-option` (active option carries `aria-current="true"`)
 */
export function ScopeBar() {
  const { scope, setRange, setSource } = useScope();
  return (
    <div className="scopebar">
      <div className="scopebar__group" data-testid="range-filter" role="group" aria-label="Time range">
        <span className="scopebar__label">Range</span>
        <div className="segmented">
          {RANGE_OPTIONS.map((opt) => {
            const active = scope.range === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                className="segmented__option"
                data-testid="range-option"
                aria-current={active ? 'true' : undefined}
                onClick={() => setRange(opt.key)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="scopebar__group"
        data-testid="source-filter"
        role="group"
        aria-label="Source"
      >
        <span className="scopebar__label">Source</span>
        <div className="segmented">
          {SOURCE_OPTIONS.map((opt) => {
            const active = scope.source === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                className="segmented__option"
                data-source={opt.key}
                data-testid="source-option"
                aria-current={active ? 'true' : undefined}
                onClick={() => setSource(opt.key)}
              >
                <span className="source-dot" data-source={opt.key} aria-hidden="true" />
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
