import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, X } from 'lucide-react';
import { useState } from 'react';
import { DemoBadge, Pill, StatusPill } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { Alert } from '../../components/ui/Feedback.jsx';
import { Textarea } from '../../components/ui/Form.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { PreChecks, passSummary } from '../../components/verification/PreChecks.jsx';
import { formatDate } from '../../lib/format.js';
import { statusLabel } from '../../lib/status.js';
import { endpoints } from '../../services/api.js';

export const BRAND_KIND = (s) => (s.level === 'domain' ? 'Domain' : 'Business');

const PROOF_LABEL = { dns: 'DNS TXT record', instagram: 'Instagram bio', linkedin: 'LinkedIn page', youtube: 'YouTube channel' };

function Row({ label, children }) {
  return (
    <div>
      <dt className="text-[12px] text-steel">{label}</dt>
      <dd className="break-words text-[14px] font-medium">{children}</dd>
    </div>
  );
}

const ago = (value) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(value)) / 60000));
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
};

/** One brand verification claim: what the brand submitted, the automatic pre-check, and the decision. */
export function BrandReviewDetail({ s, onDecided }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const pending = s.status === 'PENDING';
  const domain = s.level === 'domain';
  const dnsCheck = s.checks?.find((c) => c.id === 'dns_txt');

  const decide = useMutation({
    mutationFn: (decision) => endpoints.review.brandDecide(s._id, { decision, note: note.trim() }),
    onSuccess: (_data, decision) => {
      qc.invalidateQueries({ queryKey: ['review'] });
      qc.invalidateQueries({ queryKey: ['pub'] });
      toast.success(decision === 'VERIFIED' ? 'Brand level raised.' : decision === 'REJECTED' ? 'Rejected, with your reason sent to the brand.' : 'Sent back to the brand for more.');
      onDecided();
    },
  });
  const withReason = (decision) => {
    if (note.trim().length < 10) return setNoteError('Add a reason (at least 10 characters). It is sent to the brand.');
    setNoteError('');
    decide.mutate(decision);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-[17px]">
            {s.brand?.companyName ?? 'Brand'} · {BRAND_KIND(s)} verification
          </h2>
          <p className="truncate text-[12.5px] text-steel">
            {pending ? `Submitted ${ago(s.submittedAt)} ago` : `${statusLabel(s.status)} ${formatDate(s.reviewedAt)}`}
            {s.brand?.accountType === 'agency' && ' · Agency'}
            {s.brand?.isDemo && ' · '}
            {s.brand?.isDemo && <DemoBadge />}
          </p>
        </div>
        {s.checks?.length > 0 && <Pill tone={s.checks.every((c) => c.result === 'pass') ? 'ok' : 'wait'}>Automatic pre-check {passSummary(s.checks)}</Pill>}
      </div>

      <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          {domain ? (
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Row label="Brand">{s.brand?.companyName}</Row>
              <Row label="Website">
                <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-navy hover:underline">
                  {s.websiteUrl} <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                </a>
              </Row>
              <Row label="Work email">{s.workEmail}</Row>
              <Row label="Email matches website">
                <Pill tone={s.emailMatch ? 'ok' : 'att'}>{s.emailMatch ? `Match · ${s.websiteDomain}` : 'No match'}</Pill>
              </Row>
              <Row label="Code the brand was given">
                <code className="rounded-sm border-2 border-gold bg-white px-2 py-0.5 font-mono text-[13px]">{s.challengeCode}</code>
              </Row>
              <Row label="Where the brand says it is">
                {PROOF_LABEL[s.proof?.kind] ?? '—'}
                {s.proof?.kind === 'dns' && ` · ${s.proof.domain}`}
              </Row>
              {s.proof?.url && (
                <Row label="Proof link">
                  <a href={s.proof.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-navy hover:underline">
                    {s.proof.url} <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  </a>
                </Row>
              )}
              {s.proof?.kind === 'dns' && dnsCheck && (
                <Row label="Automatic pre-check (DNS)">
                  <Pill tone={dnsCheck.result === 'pass' ? 'ok' : dnsCheck.result === 'fail' ? 'att' : 'wait'}>
                    {dnsCheck.result === 'pass' ? 'Code found' : dnsCheck.result === 'fail' ? 'Code not found' : 'Could not check'}
                  </Pill>
                </Row>
              )}
            </dl>
          ) : (
            <>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Row label="Brand">{s.brand?.companyName}</Row>
                <Row label="Registration type">{s.business?.idType}</Row>
                <Row label="Number">
                  <code className="font-mono text-[14px]">{s.business?.idNumber}</code>
                </Row>
                <Row label="Legal name">{s.business?.legalName}</Row>
              </dl>
              <Alert tone="info" title="Check on the public portal">
                The format was checked automatically. Look the number up on the government portal (GST, MCA or Udyam) and confirm that the legal name matches.
              </Alert>
            </>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <PreChecks checks={s.checks} />
          {pending ? (
            <>
              <Textarea
                label="Reason"
                hint="Required to reject or ask for more · sent to the brand"
                rows={2}
                placeholder="e.g. The code is not in the DNS record yet"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                error={noteError}
                maxLength={1000}
              />
              {decide.error && <Alert tone="error">{decide.error.message}</Alert>}
              <div className="flex flex-wrap gap-2">
                <Button variant="success" onClick={() => decide.mutate('VERIFIED')} loading={decide.isPending && decide.variables === 'VERIFIED'}>
                  <Check className="size-4" /> Approve · {domain ? 'Verified brand' : 'Verified business'}
                </Button>
                <Button variant="danger" onClick={() => withReason('REJECTED')} loading={decide.isPending && decide.variables === 'REJECTED'}>
                  <X className="size-4" /> Reject
                </Button>
                <Button variant="ghost" onClick={() => withReason('ASK_MORE')} loading={decide.isPending && decide.variables === 'ASK_MORE'}>
                  Ask for more
                </Button>
              </div>
              <p className="text-[12.5px] text-steel">Approving raises this brand's level and logs your name and the time on the decision. It does not expire.</p>
            </>
          ) : (
            <div className="rounded-md border border-line bg-soft p-4 text-[14px]">
              <StatusPill status={s.status} />
              {s.reviewNote && <p className="mt-2 text-steel">{s.reviewNote}</p>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
