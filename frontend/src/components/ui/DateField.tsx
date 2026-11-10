import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { PopupShell } from './popup.js';
import { Btn, inputCls } from './ui.js';

const FIRST = '0000-01-01';
const LAST = '9999-12-31';
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function calendarDate(value: string) {
  return new Date(value + 'T00:00:00Z');
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftMonth(date: Date, offset: number) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + offset);
  const end = new Date(next);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  next.setUTCDate(Math.min(day, end.getUTCDate()));
  return next;
}

interface Props {
  id?: string;
  label: string;
  value: string;
  today: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  min?: string;
  max?: string;
  allowClear?: boolean;
}

export function DateField({
  id, label, value, today, onChange, disabled, error, min = FIRST, max = LAST, allowClear = true,
}: Props) {
  const uid = useId();
  const fieldId = id ?? uid;
  const calendarId = uid + '-calendar';
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(today);
  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement | null>(null);
  const focusDay = useRef(false);
  const lower = calendarDate(min).getTime();
  const upper = calendarDate(max).getTime();
  const clamp = (date: Date) => dateKey(new Date(Math.min(upper, Math.max(lower, date.getTime()))));

  const mountPopup = useCallback((element: HTMLDivElement | null) => {
    popup.current = element;
    if (element) {
      element.querySelector<HTMLButtonElement>('[data-calendar-current]')?.focus({ preventScroll: true });
      focusDay.current = false;
    }
  }, []);

  useLayoutEffect(() => {
    if (open && focusDay.current && popup.current) {
      popup.current.querySelector<HTMLButtonElement>('[data-calendar-current]')?.focus();
      focusDay.current = false;
    }
  }, [open, cursor]);

  const close = () => {
    setOpen(false);
    if (popup.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
  };

  const pick = (next: string) => {
    close();
    onChange(next);
  };

  const show = () => {
    const selected = calendarDate(value);
    const valid = Number.isFinite(selected.getTime()) && dateKey(selected) === value;
    setCursor(clamp(valid ? selected : calendarDate(today)));
    setOpen(true);
  };

  const date = calendarDate(cursor);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const first = new Date(date);
  first.setUTCDate(1);
  const last = new Date(first);
  last.setUTCMonth(month + 1, 0);
  const leading = first.getUTCDay();
  const weeks = Math.ceil((leading + last.getUTCDate()) / 7);

  const onDayKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = new Date(date);
    const day = date.getUTCDate();
    switch (event.key) {
      case 'ArrowLeft': next.setUTCDate(day - 1); break;
      case 'ArrowRight': next.setUTCDate(day + 1); break;
      case 'ArrowUp': next.setUTCDate(day - 7); break;
      case 'ArrowDown': next.setUTCDate(day + 7); break;
      case 'Home': next.setUTCDate(day - date.getUTCDay()); break;
      case 'End': next.setUTCDate(day + 6 - date.getUTCDay()); break;
      case 'PageUp':
      case 'PageDown': {
        const offset = (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1);
        next.setTime(shiftMonth(date, offset).getTime());
        break;
      }
      default: return;
    }
    event.preventDefault();
    const key = clamp(next);
    if (key !== cursor) {
      focusDay.current = true;
      setCursor(key);
    }
  };

  return (
    <div className="min-w-0">
      <label htmlFor={fieldId} className="lq-label mb-1">{label}</label>
      <div ref={field} className="flex gap-1">
        <input id={fieldId} className={inputCls} value={value} placeholder="YYYY-MM-DD"
          onChange={(event) => onChange(event.target.value)} disabled={disabled}
          autoComplete="off" spellCheck={false} aria-invalid={Boolean(error)}
          aria-describedby={uid + '-format' + (error ? ' ' + uid + '-error' : '')} />
        <Btn ref={trigger} className="lq-icon-button" aria-label={'Choose ' + label.toLowerCase()}
          aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? calendarId : undefined}
          disabled={disabled} onClick={() => open ? close() : show()}>
          <CalendarDays size={17} aria-hidden="true" />
        </Btn>
      </div>
      <span id={uid + '-format'} className="sr-only">Use year, month, and day in YYYY-MM-DD format.</span>
      {error && <p id={uid + '-error'} role="alert" className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      {open && !disabled && <PopupShell anchor={() => field.current} open onClose={close}
        minWidth={296} minHeight={344} maxHeight={420}>
        <div id={calendarId} ref={mountPopup} role="dialog" aria-label={label + ' calendar'}
          className="lq-calendar" onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
            if (event.key === 'Tab') {
              const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled):not([tabindex="-1"]), select:not(:disabled)',
              ));
              const edge = event.shiftKey ? stops[0] : stops.at(-1);
              if (edge === document.activeElement) close();
            }
          }}>
          <div className="lq-calendar-head">
            <Btn variant="quiet" className="lq-icon-button" aria-label="Previous month"
              disabled={clamp(shiftMonth(date, -1)) === cursor} onClick={() => setCursor(clamp(shiftMonth(date, -1)))}>
              <ChevronLeft size={17} aria-hidden="true" />
            </Btn>
            <p aria-live="polite" className="text-sm font-semibold">{monthFormat.format(date)}</p>
            <Btn variant="quiet" className="lq-icon-button" aria-label="Next month"
              disabled={clamp(shiftMonth(date, 1)) === cursor} onClick={() => setCursor(clamp(shiftMonth(date, 1)))}>
              <ChevronRight size={17} aria-hidden="true" />
            </Btn>
          </div>
          <div className="lq-calendar-years">
            <Btn variant="quiet" onClick={() => setCursor(clamp(shiftMonth(date, -12)))}
              disabled={clamp(shiftMonth(date, -12)) === cursor}>Previous year</Btn>
            <Btn variant="quiet" onClick={() => setCursor(clamp(shiftMonth(date, 12)))}
              disabled={clamp(shiftMonth(date, 12)) === cursor}>Next year</Btn>
          </div>
          <div className="lq-calendar-grid">
          <table role="grid" aria-label={monthFormat.format(date)}>
            <thead><tr>{weekdays.map((weekday) => <th scope="col" abbr={weekday} key={weekday}>{weekday.slice(0, 3)}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: weeks }, (_, week) => (
                <tr key={week}>
                  {weekdays.map((weekday, index) => {
                    const day = week * 7 + index - leading + 1;
                    if (day < 1 || day > last.getUTCDate()) return <td key={weekday} />;
                    const key = String(year).padStart(4, '0') + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
                    return (
                      <td key={weekday} aria-selected={key === value}>
                        <button type="button" className="lq-calendar-day" tabIndex={key === cursor ? 0 : -1}
                          data-calendar-current={key === cursor ? '' : undefined}
                          disabled={key < min || key > max}
                          aria-current={key === today ? 'date' : undefined}
                          aria-label={dayFormat.format(calendarDate(key))} onKeyDown={onDayKey}
                          onClick={() => pick(key)}>{day}</button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="lq-dialog-actions">
            {allowClear && <Btn variant="quiet" disabled={!value} onClick={() => pick('')}>Clear date</Btn>}
            <Btn variant="quiet" onClick={close}>Close calendar</Btn>
          </div>
        </div>
      </PopupShell>}
    </div>
  );
}
