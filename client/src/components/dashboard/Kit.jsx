import { useState } from 'react';
import { Link } from 'react-router';
import { statusLabel } from '../../lib/status.js';
import { Button } from '../ui/Button.jsx';
import { Dialog } from '../ui/Dialog.jsx';
import { Alert } from '../ui/Feedback.jsx';
import { ApiErrorMessage } from '../verification/BrandTrust.jsx';

/** v9 .stat variants: navy, bone, grey, white, and a gold-outlined highlight. */
const STAT_VARIANTS = {
  navy: 'bg-navy text-white border-navy',
  bone: 'bg-bone text-ink border-bone',
  grey: 'bg-[#e2e6e5] text-ink border-[#e2e6e5]',
  white: 'bg-white text-ink border-line',
  highlight: 'bg-white text-ink border-2 border-gold',
};

/** Real counts only — each tile links to the list it summarises. */
export function StatTile({ label, value, to, hint, variant = 'white' }) {
  const cls = `flex flex-col gap-0.5 rounded-lg border px-5 py-[18px] ${STAT_VARIANTS[variant] ?? STAT_VARIANTS.white}`;
  const body = (
    <>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] opacity-80">{label}</p>
      <p className="text-[36px] font-extrabold leading-[1.1] tracking-[-0.04em] tabular-nums">{value ?? '—'}</p>
      {hint && <p className="text-[12.5px] opacity-80">{hint}</p>}
    </>
  );
  return to ? (
    <Link to={to} className={`${cls} transition-shadow hover:shadow-card`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Status filter as a v9 segmented control. */
export function StatusTabs({ statuses, value, onChange }) {
  return (
    <div className="mb-6 max-w-full overflow-x-auto">
      <div className="inline-flex rounded-full border border-line2 bg-white p-[3px]" role="tablist" aria-label="Filter by status">
        {['', ...statuses].map((s) => {
          const active = value === s;
          return (
            <button
              key={s || 'all'}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onChange(s)}
              className={`shrink-0 whitespace-nowrap rounded-full px-[13px] py-1.5 text-[13px] font-semibold transition-colors ${
                active ? 'bg-navy text-white' : 'text-steel hover:text-ink'
              }`}
            >
              {s ? statusLabel(s) : 'All'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Confirmation step for consequential actions (accept, reject, withdraw, cancel...). */
export function ConfirmAction({ trigger, title, body, confirmLabel, variant = 'primary', onConfirm, error, pending }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onClose={() => setOpen(false)} title={title} size="sm">
        <div className="space-y-5">
          {body && <div className="text-[14px] text-steel">{body}</div>}
          {error && (
            <Alert tone="error">
              <ApiErrorMessage error={error} />
            </Alert>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Go back
            </Button>
            <Button
              variant={variant}
              loading={pending}
              onClick={async () => {
                try {
                  await onConfirm();
                  setOpen(false);
                } catch {
                  // error surfaced via `error` prop
                }
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

export function ListCard({ children, className = '' }) {
  return <li className={`rounded-lg border border-line bg-white p-5 ${className}`}>{children}</li>;
}
