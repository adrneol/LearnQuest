import { useId } from 'react';
import type { ProgressRecord } from '../../types/index.js';
import { Dropdown } from './Dropdown.js';
import { Field, inputCls } from './ui.js';

/**
 * Controlled learning-annotation fields shared by Revision and Player. The
 * caller decides whether edits are written immediately (Revision) or staged
 * behind an explicit/debounced save (Player), but both screens use the same
 * field semantics, labels, and validation.
 */
export interface AnnotationValues {
  confidence: 1 | 2 | 3 | 4 | 5 | null;
  revisionDate: string;
  notes: string;
  keyConcepts: string;
  questions: string;
  codeReproduced: boolean | undefined;
  exerciseDone: boolean | undefined;
  builtExample: boolean | undefined;
  needsRevision: boolean;
}

export function annotationValuesFrom(record: ProgressRecord | null | undefined): AnnotationValues {
  return {
    confidence: (record?.confidence ?? null) as AnnotationValues['confidence'],
    revisionDate: record?.revisionDate ?? '',
    notes: record?.notes ?? '',
    keyConcepts: record?.keyConcepts ?? '',
    questions: record?.questions ?? '',
    codeReproduced: record?.codeReproduced,
    exerciseDone: record?.exerciseDone,
    builtExample: record?.builtExample,
    needsRevision: record?.needsRevision === true,
  };
}

/** Metadata-only patch. Never includes completion, source, positions, or evidence. */
export function annotationPatch(values: AnnotationValues): Partial<ProgressRecord> {
  return {
    confidence: values.confidence ?? undefined,
    revisionDate: isEmptyDate(values.revisionDate) ? null : values.revisionDate,
    notes: values.notes.trim() ? values.notes : undefined,
    keyConcepts: values.keyConcepts.trim() ? values.keyConcepts : undefined,
    questions: values.questions.trim() ? values.questions : undefined,
    codeReproduced: values.codeReproduced,
    exerciseDone: values.exerciseDone,
    builtExample: values.builtExample,
    needsRevision: values.needsRevision,
  };
}

export function isEmptyDate(value: string): boolean {
  return value.trim() === '';
}

/** Strict calendar-date validation for a date-only input. */
export function isValidRevisionDate(value: string): boolean {
  if (isEmptyDate(value)) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

interface Props {
  values: AnnotationValues;
  onChange: (next: AnnotationValues, patch: Partial<ProgressRecord>) => void;
  idPrefix?: string;
  disabled?: boolean;
  /** Review status is rendered by the parent; this only controls the fields. */
  showNeedsRevision?: boolean;
}

export function AnnotationFields({
  values,
  onChange,
  idPrefix,
  disabled = false,
  showNeedsRevision = true,
}: Props) {
  const generated = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const prefix = idPrefix ?? `ann-${generated}`;
  const dateInvalid = !isValidRevisionDate(values.revisionDate);

  const emit = (patch: Partial<AnnotationValues>) => {
    const next = { ...values, ...patch };
    onChange(next, annotationPatch(next));
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <Dropdown
          label="Confidence (1–5)"
          value={values.confidence === null ? '' : String(values.confidence)}
          options={[
            { value: '', label: 'Not rated' },
            ...[1, 2, 3, 4, 5].map((v) => ({
              value: String(v),
              label: `${v} / 5`,
              hint: v <= 2 ? 'low confidence — queues a revision' : undefined,
            })),
          ]}
          onChange={(v) => emit({ confidence: v ? (Number(v) as 1 | 2 | 3 | 4 | 5) : null })}
          disabled={disabled}
        />
      </div>
      <Field label="Revision date">
        <input
          id={`${prefix}-revision-date`}
          type="date"
          className={`${inputCls} ${dateInvalid ? 'border-red-500/50' : ''}`}
          value={values.revisionDate}
          disabled={disabled}
          onChange={(e) => emit({ revisionDate: e.target.value })}
          aria-invalid={dateInvalid}
          aria-describedby={dateInvalid ? `${prefix}-date-error` : undefined}
        />
        {dateInvalid && (
          <span id={`${prefix}-date-error`} className="mt-1 block text-[11px] text-red-300" role="alert">
            Choose a valid calendar date or leave it empty.
          </span>
        )}
      </Field>
      <Field label="Notes">
        <textarea
          id={`${prefix}-notes`}
          className={inputCls}
          rows={2}
          value={values.notes}
          disabled={disabled}
          onChange={(e) => emit({ notes: e.target.value })}
          placeholder="What mattered, what was unclear?"
        />
      </Field>
      <Field label="Key concepts">
        <textarea
          id={`${prefix}-concepts`}
          className={inputCls}
          rows={2}
          value={values.keyConcepts}
          disabled={disabled}
          onChange={(e) => emit({ keyConcepts: e.target.value })}
          placeholder="Terms, patterns, mental models"
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Questions to investigate">
          <textarea
            id={`${prefix}-questions`}
            className={inputCls}
            rows={2}
            value={values.questions}
            disabled={disabled}
            onChange={(e) => emit({ questions: e.target.value })}
            placeholder="One question per line works well"
          />
        </Field>
      </div>
      <fieldset className="sm:col-span-2" disabled={disabled}>
        <legend className="mb-1 text-xs font-medium text-slate-400">Learning evidence</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={values.codeReproduced === true}
              onChange={(e) => emit({ codeReproduced: e.target.checked })}
            />
            Code reproduced
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={values.exerciseDone === true}
              onChange={(e) => emit({ exerciseDone: e.target.checked })}
            />
            Exercise done
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={values.builtExample === true}
              onChange={(e) => emit({ builtExample: e.target.checked })}
            />
            Built example
          </label>
          {showNeedsRevision && (
            <label className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-200">
              <input
                type="checkbox"
                checked={values.needsRevision}
                onChange={(e) => emit({ needsRevision: e.target.checked })}
              />
              Needs revision
            </label>
          )}
        </div>
        <p className="mt-1 text-[10px] text-slate-500">
          An unchecked box means “not recorded” until you toggle it; unchecking a recorded box explicitly records “not done”.
        </p>
      </fieldset>
    </div>
  );
}
