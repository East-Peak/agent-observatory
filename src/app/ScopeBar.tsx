import { RANGE_OPTIONS } from '@/domain/dateRange';
import { SOURCE_OPTIONS } from '@/domain/sources';
import { useScope } from './ScopeProvider';
import { cn } from '@/lib/utils';

const optionClass = (active: boolean): string =>
  cn(
    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
    active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
  );

/**
 * The shared scope control — a time-range segment and a source segment. All panels render one; each
 * reads and writes the single {@link useScope} state, so a selection persists across navigation. Emits
 * the frozen house-style testids the smoke + oracle drive (range-filter / range-option, source-filter /
 * source-option, aria-current on the active option). Source dots use the shared categorical palette.
 */
export function ScopeBar() {
  const { scope, setRange, setSource } = useScope();
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2" data-testid="range-filter" role="group" aria-label="Time range">
        <span className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">Range</span>
        <div className="inline-flex rounded-lg border border-border bg-card/50 p-0.5">
          {RANGE_OPTIONS.map((opt) => {
            const active = scope.range === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                data-testid="range-option"
                aria-current={active ? 'true' : undefined}
                onClick={() => setRange(opt.key)}
                className={optionClass(active)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2" data-testid="source-filter" role="group" aria-label="Source">
        <span className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">Source</span>
        <div className="inline-flex rounded-lg border border-border bg-card/50 p-0.5">
          {SOURCE_OPTIONS.map((opt) => {
            const active = scope.source === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                data-source={opt.key}
                data-testid="source-option"
                aria-current={active ? 'true' : undefined}
                onClick={() => setSource(opt.key)}
                className={optionClass(active)}
              >
                {opt.key !== 'all' && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(--color-source-${opt.key})` }}
                    aria-hidden="true"
                  />
                )}
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
