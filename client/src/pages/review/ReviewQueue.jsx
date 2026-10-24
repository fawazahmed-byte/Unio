import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, Inbox, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/layout/Layouts.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { DemoBadge, Pill, StatusPill } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { Alert, EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { Textarea } from '../../components/ui/Form.jsx';
import { MediaFrame, isPlaceholderUrl } from '../../components/ui/MediaFrame.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { PreChecks, passSummary } from '../../components/verification/PreChecks.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { formatDate } from '../../lib/format.js';
import { embedUrl, isVideoFile } from '../../lib/embed.js';
import { statusLabel } from '../../lib/status.js';
import { endpoints } from '../../services/api.js';
import { BRAND_KIND, BrandReviewDetail } from './BrandReviewDetail.jsx';

const TYPE_LABEL = { tool: 'Tool', workflow: 'Workflow', portfolio: 'Past work', certificate: 'Certificate' };
const KIND = (s) => (s.type === 'tool' ? (s.method === 'challenge' ? 'Tool · challenge' : 'Tool · evidence') : TYPE_LABEL[s.type]);

function ago(value) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(value)) / 60000));
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

/** The recording: played here when the host allows it, otherwise opened in a new tab. The code is shown beside it for comparison. */
function Recording({ url, code }) {
  const placeholder = isPlaceholderUrl(url);
  const embed = !placeholder && embedUrl(url);
  const video = !placeholder && isVideoFile(url);
  return (
    <div className="relative overflow-hidden rounded-lg bg-ink">
      {embed ? (
        <iframe title="Recording" src={embed} className="aspect-video w-full" allow="fullscreen" referrerPolicy="no-referrer" />
      ) : video ? (
        <video src={url} controls preload="metadata" className="aspect-video w-full bg-black" />
      ) : (
        <div className="grid aspect-video place-items-center p-6 text-center text-bone">
          <div className="space-y-3">
            <p className="text-[14px]">{placeholder ? 'This is a placeholder link and cannot be opened.' : 'This host cannot be played here.'}</p>
            {!placeholder && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-bone px-4 py-2 text-[13px] font-semibold text-ink">
                <ExternalLink className="size-3.5" /> Open recording
              </a>
            )}
          </div>
        </div>
      )}
      {code && (
        <span className="absolute left-3 top-3 rounded-sm border-2 border-gold bg-white px-2 py-0.5 font-mono text-[12px] font-medium text-ink shadow-card" title="The code this creator was given. Look for it in the prompt.">
          {code}
        </span>
      )}
    </div>
  );
}

function Screenshot({ url, n }) {
  const [broken, setBroken] = useState(false);
  const placeholder = isPlaceholderUrl(url);
  return (
    <a href={placeholder ? undefined : url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-md border border-line bg-soft" aria-label={`Screenshot ${n}`}>
      {placeholder || broken ? (
        <span className="grid aspect-video place-items-center px-2 text-center text-[12px] text-steel">{placeholder ? 'Placeholder link' : `Screenshot ${n}: open link`}</span>
      ) : (
        <img src={url} alt={`Submitted screenshot ${n}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="aspect-video w-full object-cover" />
      )}
    </a>
  );
}

const addYear = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 12);
  return d;
};

function Detail({ s, onDecided }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const pending = s.status === 'PENDING';
  const certificate = s.type === 'certificate';
  const outcome = certificate ? 'Certified' : 'Verified';

  const decide = useMutation({
    mutationFn: (decision) => endpoints.review.decide(s._id, { decision, note: note.trim() }),
    onSuccess: (data, decision) => {
      qc.invalidateQueries({ queryKey: ['review'] });
      qc.invalidateQueries({ queryKey: ['pub'] });
      toast.success(decision === 'VERIFIED' ? `Marked as ${outcome.toLowerCase()}.` : decision === 'REJECTED' ? 'Rejected, with your reason sent to the creator.' : 'Sent back to the creator for more.');
      onDecided();
    },
  });
  const withReason = (decision) => {
    if (note.trim().length < 10) return setNoteError('Add a reason (at least 10 characters). It is sent to the creator.');
    setNoteError('');
    decide.mutate(decision);
  };

  const expiry = addYear();
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={s.creator?.displayName ?? '?'} src={s.creator?.photoUrl} />
          <div className="min-w-0">
            <h2 className="truncate text-[17px]">
              {s.creator?.displayName ?? 'Creator'} · {s.subject}
            </h2>
            <p className="truncate text-[12.5px] text-steel">
              {pending ? `Submitted ${ago(s.submittedAt)} ago` : `${statusLabel(s.status)} ${formatDate(s.reviewedAt)}`}
              {s.challengeCode && ` · code ${s.challengeCode}`}
              {s.creator?.isDemo && ' · '}
              {s.creator?.isDemo && <DemoBadge />}
            </p>
          </div>
        </div>
        {s.checks?.length > 0 && <Pill tone={s.checks.every((c) => c.result === 'pass') ? 'ok' : 'wait'}>Automatic pre-checks {passSummary(s.checks)}</Pill>}
      </div>

      <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          {s.recordingUrl && <Recording url={s.recordingUrl} code={s.challengeCode} />}
          {s.screenshotUrls?.length > 0 && (
            <div className="grid grid-cols-2 gap-2.5">
              {s.screenshotUrls.map((u, i) => (
                <Screenshot key={u} url={u} n={i + 1} />
              ))}
            </div>
          )}
          {certificate && (
            <div className="space-y-2 rounded-lg border border-line bg-soft p-4 text-[14px]">
              <p className="eyebrow">Certificate</p>
              <p className="font-semibold">{[s.certificate?.issuer, s.certificate?.title].filter(Boolean).join(' · ')}</p>
              <a href={s.certificate?.verifyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 break-all font-semibold text-navy hover:underline">
                <ExternalLink className="size-3.5 shrink-0" /> Open the verify link
              </a>
              {s.certificate?.fileUrl && (
                <a href={s.certificate.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 break-all text-navy hover:underline">
                  <ExternalLink className="size-3.5 shrink-0" /> Certificate file
                </a>
              )}
              <p className="text-[12.5px] text-steel">Check the name on the certificate matches this creator, and that the issuer’s page confirms it.</p>
            </div>
          )}
          {s.portfolioItem && (
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <MediaFrame item={s.portfolioItem} aspect="aspect-[4/5]" hover={false} />
              <div className="space-y-1.5 text-[14px]">
                <p className="eyebrow">Piece under review</p>
                <p className="font-semibold">{s.portfolioItem.title}</p>
                {s.portfolioItem.description && <p className="text-steel">{s.portfolioItem.description}</p>}
              </div>
            </div>
          )}
          {!s.recordingUrl && !certificate && s.evidenceUrls?.length > 0 && (
            <div>
              <p className="eyebrow mb-1.5">Evidence links</p>
              <ul className="space-y-1.5">
                {s.evidenceUrls.map((u) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-[14px] text-navy hover:underline">
                      <ExternalLink className="size-3.5 shrink-0" />
                      <span className="truncate">{u}</span>
                    </a>
                    {isPlaceholderUrl(u) && <span className="ml-2 text-[12px] text-steel">placeholder link</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {s.description && (
            <div>
              <p className="eyebrow mb-1">{s.type === 'workflow' ? 'Workflow description' : 'Creator notes'}</p>
              <p className="whitespace-pre-line text-[14px] leading-relaxed">{s.description}</p>
            </div>
          )}
          <Link to={`/creators/${s.creatorId}`} target="_blank" className="inline-block text-[13px] text-navy hover:underline">
            Open public profile
          </Link>
        </div>

        <div className="min-w-0 space-y-4">
          <PreChecks checks={s.checks} />
          {s.flagged && (
            <Alert tone="warning" title="Possible duplicate">
              A link in this submission was also submitted by a different creator. Compare them before deciding.
            </Alert>
          )}
          {pending ? (
            <>
              <Textarea
                label="Reason"
                hint="Required to reject or ask for more · sent to the creator"
                rows={2}
                placeholder="e.g. Code not visible in the prompt box"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                error={noteError}
                maxLength={1000}
              />
              {decide.error && <Alert tone="error">{decide.error.message}</Alert>}
              <div className="flex flex-wrap gap-2">
                <Button variant="success" onClick={() => decide.mutate('VERIFIED')} loading={decide.isPending && decide.variables === 'VERIFIED'}>
                  <Check className="size-4" /> Approve · {outcome} 12 mo
                </Button>
                <Button variant="danger" onClick={() => withReason('REJECTED')} loading={decide.isPending && decide.variables === 'REJECTED'}>
                  <X className="size-4" /> Reject
                </Button>
                <Button variant="ghost" onClick={() => withReason('ASK_MORE')} loading={decide.isPending && decide.variables === 'ASK_MORE'}>
                  Ask for more
                </Button>
              </div>
              <p className="text-[12.5px] text-steel">
                {['tool', 'certificate'].includes(s.type)
                  ? `Approving sets ${s.subject} to ${outcome} until ${formatDate(expiry)} and logs your name on the decision.`
                  : 'Approving marks this claim verified and logs your name on the decision.'}
              </p>
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

const TABS = [
  ['tools', 'Tools'],
  ['certificates', 'Certificates'],
  ['flagged', 'Flagged'],
  ['brands', 'Brands'],
];

export default function ReviewQueue() {
  useDocumentTitle('Verification queue');
  const [tab, setTab] = useState('tools');
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const brands = tab === 'brands';
  const query = useQuery({
    queryKey: ['review', { status, tab, page }],
    queryFn: () => (brands ? endpoints.review.brandList({ status, page, limit: 20 }) : endpoints.review.list({ status, tab, page, limit: 20 })),
  });
  // The Brands tab label needs its own count while another tab is open.
  const brandQueue = useQuery({ queryKey: ['review', 'brand-count'], queryFn: () => endpoints.review.brandList({ status: 'PENDING', limit: 1 }) });
  const items = query.data?.items ?? [];
  const active = items.find((s) => s._id === selected) ?? items[0];
  const tabs = { ...(brands ? {} : query.data?.tabs), brands: brandQueue.data?.tabs?.all ?? 0 };
  const counts = query.data?.counts ?? {};

  return (
    <>
      <PageHeader
        eyebrow="Reviewer"
        title="Verification queue"
        description={brands ? 'Domain and business claims from brands. Automatic pre-checks first. You make the call.' : 'Automatic pre-checks first. You make the call.'}
        actions={
          <div className="inline-flex rounded-full border border-line2 bg-white p-[3px]" role="tablist" aria-label="Queue">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={tab === key}
                onClick={() => {
                  setTab(key);
                  setPage(1);
                  setSelected(null);
                }}
                className={`whitespace-nowrap rounded-full px-[13px] py-1.5 text-[13px] font-semibold transition-colors ${tab === key ? 'bg-navy text-white' : 'text-steel hover:text-ink'}`}
              >
                {label} · {tabs[key] ?? 0}
              </button>
            ))}
          </div>
        }
      />

      <div className="mt-5 mb-4 flex flex-wrap gap-2" role="group" aria-label="Show">
        {[['PENDING', 'Waiting'], ['VERIFIED', 'Verified'], ['REJECTED', 'Rejected']].map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={status === key}
            onClick={() => {
              setStatus(key);
              setPage(1);
              setSelected(null);
            }}
            className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${status === key ? 'border-navy bg-navy text-white' : 'border-line2 bg-white text-steel hover:text-ink'}`}
          >
            {label} · {counts[key] ?? 0}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <Skeleton className="h-64" />
      ) : query.error ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : items.length === 0 ? (
        <EmptyState icon={status === 'PENDING' ? Inbox : ShieldAlert} title={status === 'PENDING' ? 'Queue is clear' : 'Nothing here'}>
          {status === 'PENDING' ? 'No submissions are waiting in this tab.' : 'No submissions with this status in this tab.'}
        </EmptyState>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card className="overflow-hidden">
              <ul role="listbox" aria-label="Submissions">
                {items.map((s) => {
                  const on = s._id === active?._id;
                  return (
                    <li key={s._id} role="option" aria-selected={on}>
                      <button
                        type="button"
                        onClick={() => setSelected(s._id)}
                        className={`flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left last:border-0 ${on ? 'bg-navy text-white' : 'hover:bg-soft'}`}
                      >
                        <Avatar name={(brands ? s.brand?.companyName : s.creator?.displayName) ?? '?'} src={brands ? undefined : s.creator?.photoUrl} size="sm" />
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-[14px]">{brands ? s.brand?.companyName : s.creator?.displayName}</b>
                          <span className={`block truncate text-[12.5px] ${on ? 'text-bone' : 'text-steel'}`}>
                            {brands ? `${BRAND_KIND(s)} verification` : `${s.subject} · ${KIND(s)}`}
                            {!brands && s.flagged && ' · duplicate match'}
                          </span>
                        </span>
                        <span className={`text-[12px] ${on ? 'text-bone' : 'text-steel'}`}>{ago(s.status === 'PENDING' ? s.submittedAt : s.reviewedAt ?? s.updatedAt)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Pagination page={query.data.page} totalPages={query.data.totalPages} onChange={setPage} />
          </div>
          {active && (brands ? <BrandReviewDetail key={active._id} s={active} onDecided={() => setSelected(null)} /> : <Detail key={active._id} s={active} onDecided={() => setSelected(null)} />)}
        </div>
      )}
    </>
  );
}
