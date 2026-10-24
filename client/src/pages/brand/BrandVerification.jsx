import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Check, Lock, Send, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/layout/Layouts.jsx';
import { Pill } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card, SectionHead } from '../../components/ui/Card.jsx';
import { Alert, ErrorState, PageLoader } from '../../components/ui/Feedback.jsx';
import { Input, Select } from '../../components/ui/Form.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { BRAND_LEVELS, brandRank } from '../../components/verification/BrandTrust.jsx';
import { PreChecks } from '../../components/verification/PreChecks.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { formatDate } from '../../lib/format.js';
import { endpoints } from '../../services/api.js';

const QUERY_KEY = ['mine', 'brand-verification'];

const PROOF_KINDS = [
  { id: 'dns', label: 'DNS record', hint: 'A TXT record on your domain. Strongest proof.' },
  { id: 'instagram', label: 'Instagram', hint: 'The bio of your official page.' },
  { id: 'linkedin', label: 'LinkedIn', hint: 'The About text of your company page.' },
  { id: 'youtube', label: 'YouTube', hint: 'The description of your official channel.' },
];

const ID_TYPES = [
  { id: 'GSTIN', label: 'GSTIN', placeholder: '22AAAAA0000A1Z5', hint: '15 characters.' },
  { id: 'CIN', label: 'CIN', placeholder: 'U12345MH2020PTC123456', hint: '21 characters.' },
  { id: 'UDYAM', label: 'Udyam number', placeholder: 'UDYAM-MH-12-1234567', hint: 'Format UDYAM-XX-00-0000000.' },
];

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function timeLeft(until, now) {
  const mins = Math.max(0, Math.floor((new Date(until) - now) / 60000));
  return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`;
}

/** v9 step marker: done (green check), current (navy), or locked (grey). */
function StepDot({ n, state }) {
  const cls = state === 'done' ? 'bg-ok text-white' : state === 'current' ? 'bg-navy text-white' : 'bg-line text-steel';
  return (
    <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold ${cls}`}>
      {state === 'done' ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : state === 'locked' ? <Lock className="size-3" aria-hidden /> : n}
    </span>
  );
}

const STATUS_PILL = {
  SELF_REPORTED: ['neutral', 'Not submitted'],
  PENDING: ['wait', 'Pending review'],
  VERIFIED: ['ok', 'Verified'],
  REJECTED: ['att', 'Not verified'],
};

function ReviewerNote({ claim }) {
  if (!claim?.reviewNote || claim.status === 'PENDING' || claim.status === 'VERIFIED') return null;
  return (
    <Alert tone={claim.status === 'REJECTED' ? 'error' : 'info'} title={claim.status === 'REJECTED' ? 'Not verified' : 'The reviewer needs more'}>
      {claim.reviewNote}
    </Alert>
  );
}

/** Level 2: website + work email on that domain, then a one-time code placed in DNS or an official profile. */
function DomainStep({ data }) {
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const claim = data.domain;
  const verified = brandRank(data.level) >= 1;
  const pending = claim?.status === 'PENDING';
  const codeActive = !!claim?.codeActive && !pending && !verified;

  const [website, setWebsite] = useState(claim?.websiteUrl ?? data.websiteUrl ?? '');
  const [workEmail, setWorkEmail] = useState(claim?.workEmail ?? '');
  const [match, setMatch] = useState(null);
  const [kind, setKind] = useState('dns');
  const [proofUrl, setProofUrl] = useState('');

  // Instant, nothing saved: does this email belong to this website? Debounced so typing is not a request per key.
  useEffect(() => {
    setMatch(null);
    if (verified || pending || !website.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail.trim())) return undefined;
    const t = setTimeout(() => {
      endpoints.brand.checkDomain({ websiteUrl: website.trim(), workEmail: workEmail.trim() }).then(setMatch, () => setMatch(null));
    }, 400);
    return () => clearTimeout(t);
  }, [website, workEmail, verified, pending]);

  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });
  const getCode = useMutation({
    mutationFn: () => endpoints.brand.domainCode({ websiteUrl: website.trim(), workEmail: workEmail.trim() }),
    onSuccess: () => {
      setProofUrl('');
      refresh();
      qc.invalidateQueries({ queryKey: ['mine', 'brand-profile'] });
    },
  });
  const send = useMutation({
    mutationFn: () => endpoints.brand.submitDomain({ kind, ...(kind !== 'dns' ? { proofUrl: proofUrl.trim() } : {}) }),
    onSuccess: () => {
      toast.success('Submitted. A UNIO reviewer will check it.');
      refresh();
    },
    onError: refresh,
  });

  const dns = kind === 'dns';
  const domain = claim?.websiteDomain;
  const step = verified ? 'done' : 'current';

  return (
    <Card>
      <SectionHead
        title="Domain verification"
        action={<Pill tone={verified ? 'ok' : STATUS_PILL[claim?.status ?? 'SELF_REPORTED'][0]}>{verified ? 'Verified' : STATUS_PILL[claim?.status ?? 'SELF_REPORTED'][1]}</Pill>}
      />
      <div className="space-y-5 p-5">
        <div className="flex items-start gap-3">
          <StepDot n={2} state={step} />
          <p className="text-[14px] text-steel">
            Show that you control your company website. You need a work email on the same domain, and a one-time code that you place on that domain or on your official
            profile. This unlocks hiring creators.
          </p>
        </div>

        {verified && (
          <Alert tone="success" title="Domain verified">
            {data.websiteUrl ? `${data.websiteUrl} is confirmed as your brand's website.` : 'Your website domain is confirmed.'} You can now hire creators.
          </Alert>
        )}

        {pending && (
          <div className="space-y-4">
            <Alert tone="success" title="Your domain is with a reviewer">
              Submitted {formatDate(claim.submittedAt)}. You will see the decision here.
            </Alert>
            <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
              <div>
                <dt className="text-[12px] text-steel">Website</dt>
                <dd className="font-medium">{claim.websiteUrl}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-steel">Work email (only reviewers see it)</dt>
                <dd className="font-medium">{claim.workEmail}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-steel">Where the code is</dt>
                <dd className="font-medium">{claim.proof?.kind === 'dns' ? `DNS TXT record on ${claim.proof.domain}` : claim.proof?.url}</dd>
              </div>
            </dl>
            <PreChecks checks={claim.checks} />
          </div>
        )}

        {!verified && !pending && (
          <>
            <ReviewerNote claim={claim} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Company website"
                required
                placeholder="https://yourcompany.com"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                disabled={codeActive}
                autoComplete="url"
              />
              <Input
                label="Work email on that domain"
                required
                type="email"
                placeholder="you@yourcompany.com"
                value={workEmail}
                onChange={(e) => setWorkEmail(e.target.value)}
                disabled={codeActive}
                autoComplete="email"
                hint="Your sign-in email can stay as it is. Gmail, Yahoo and Outlook addresses do not count."
              />
            </div>

            {match && (match.match ? (
              <Alert tone="success">
                {match.emailDomain} matches {match.websiteDomain}.
              </Alert>
            ) : (
              <Alert tone="error" title="This email does not match the website">
                {match.reason}
              </Alert>
            ))}
            {getCode.error && (
              <Alert tone="error" title={getCode.error.code === 'DOMAIN_MISMATCH' ? 'This email does not match the website' : undefined}>
                {getCode.error.message}
              </Alert>
            )}
            {claim?.codeExpired && !codeActive && <Alert tone="warning">Your code expired. Get a new one and place it again.</Alert>}

            {!codeActive && (
              <Button onClick={() => getCode.mutate()} loading={getCode.isPending} disabled={!match?.match}>
                Get my code
              </Button>
            )}

            {codeActive && (
              <div className="space-y-5">
                <div className="relative overflow-hidden rounded-lg bg-ink p-6 text-white">
                  <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full border-[18px] border-white/[0.05]" />
                  <p className="eyebrow text-mist">Your one-time code · {domain}</p>
                  <p className="mt-3 break-all font-mono text-[34px] font-medium tracking-[0.08em] sm:text-[48px]" aria-label={`Code ${claim.challengeCode.split('').join(' ')}`}>
                    {claim.challengeCode}
                  </p>
                  <p className="mt-3 text-[13px] text-bone">Valid for {timeLeft(claim.challengeExpiresAt, now)} · works once · place it in one of the places below</p>
                </div>

                <fieldset>
                  <legend className="text-[13px] font-semibold">Where will you put the code?</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {PROOF_KINDS.map((p) => (
                      <label
                        key={p.id}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 text-[14px] ${kind === p.id ? 'border-navy bg-soft ring-1 ring-navy' : 'border-line bg-white'}`}
                      >
                        <input type="radio" name="proof-kind" value={p.id} checked={kind === p.id} onChange={() => setKind(p.id)} className="mt-1 accent-[var(--color-navy)]" />
                        <span>
                          <b className="block">{p.label}</b>
                          <span className="text-[12.5px] text-steel">{p.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {dns ? (
                  <ol className="list-decimal space-y-1.5 pl-5 text-[14px]">
                    <li>Open the DNS settings for {domain} (where you manage the domain).</li>
                    <li>
                      Add a <b>TXT</b> record on <code className="rounded-sm border border-line2 bg-soft px-1.5 py-0.5 font-mono text-[12px]">{domain}</code> whose value contains{' '}
                      <code className="rounded-sm border border-line2 bg-soft px-1.5 py-0.5 font-mono text-[12px]">{claim.challengeCode}</code>.
                    </li>
                    <li>Save it, then press Submit. DNS can take a few minutes to update. The reviewer checks it again.</li>
                  </ol>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[14px]">
                      Put <code className="rounded-sm border border-line2 bg-soft px-1.5 py-0.5 font-mono text-[12px]">{claim.challengeCode}</code> in the {kind === 'youtube' ? 'description' : 'bio'} of your
                      official {PROOF_KINDS.find((p) => p.id === kind).label} page, then paste its link.
                    </p>
                    <Input label={`Link to your ${PROOF_KINDS.find((p) => p.id === kind).label} page`} required placeholder={`https://www.${kind}.com/…`} value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} />
                  </div>
                )}

                <Alert tone="ai">A hint check runs first (for DNS it looks for the code). It can be wrong, and a UNIO reviewer decides.</Alert>
                {send.error && (
                  <Alert tone="error">
                    {send.error.message}
                    {['CHALLENGE_EXPIRED', 'CODE_USED', 'NO_ACTIVE_CHALLENGE', 'WEBSITE_CHANGED'].includes(send.error.code) && ' Get a new code to try again.'}
                  </Alert>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => send.mutate()} loading={send.isPending} disabled={!dns && !proofUrl.trim()}>
                    Submit for review <Send className="size-4" />
                  </Button>
                  <Button variant="ghost" onClick={() => getCode.mutate()} loading={getCode.isPending}>
                    Get a different code
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/** Level 3: one registration number + legal name. Format is checked here; a reviewer checks the public portal. */
function BusinessStep({ data }) {
  const qc = useQueryClient();
  const toast = useToast();
  const unlocked = brandRank(data.level) >= 1;
  const verified = brandRank(data.level) >= 2;
  const claim = data.business;
  const pending = claim?.status === 'PENDING';

  const [idType, setIdType] = useState(claim?.business?.idType ?? 'GSTIN');
  const [idNumber, setIdNumber] = useState(claim?.business?.idNumber ?? '');
  const [legalName, setLegalName] = useState(claim?.business?.legalName ?? '');
  const meta = ID_TYPES.find((t) => t.id === idType);

  const send = useMutation({
    mutationFn: () => endpoints.brand.submitBusiness({ idType, idNumber: idNumber.trim(), legalName: legalName.trim() }),
    onSuccess: () => {
      toast.success('Submitted. A UNIO reviewer will check it on the public register.');
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
  const fieldError = (name) => send.error?.details?.find((d) => d.field === name)?.message;

  return (
    <Card>
      <SectionHead
        title="Business verification"
        action={<Pill tone={verified ? 'ok' : unlocked ? STATUS_PILL[claim?.status ?? 'SELF_REPORTED'][0] : 'neutral'}>{verified ? 'Verified' : unlocked ? STATUS_PILL[claim?.status ?? 'SELF_REPORTED'][1] : 'Locked'}</Pill>}
      />
      <div className="space-y-5 p-5">
        <div className="flex items-start gap-3">
          <StepDot n={3} state={verified ? 'done' : unlocked ? 'current' : 'locked'} />
          <p className="text-[14px] text-steel">
            Add one registration number and your legal name. We check the format here, and a UNIO reviewer looks the number up on the public government portal. UNIO does not
            see tax filings or documents.
          </p>
        </div>

        {!unlocked && <Alert tone="info">Verify your domain first. Business verification comes after it.</Alert>}
        {verified && (
          <Alert tone="success" title="Business verified">
            {claim?.business?.legalName ? `${claim.business.legalName} is confirmed.` : 'Your business is confirmed.'}
          </Alert>
        )}
        {unlocked && pending && (
          <Alert tone="success" title="Your business details are with a reviewer">
            {claim.business.idType} {claim.business.idNumber} · {claim.business.legalName}. Submitted {formatDate(claim.submittedAt)}.
          </Alert>
        )}

        {unlocked && !verified && !pending && (
          <form
            noValidate
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              send.mutate();
            }}
          >
            <ReviewerNote claim={claim} />
            <div className="grid gap-3 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)]">
              <Select label="Registration number type" value={idType} onChange={(e) => setIdType(e.target.value)}>
                {ID_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <Input
                label={`${meta.label} number`}
                required
                placeholder={meta.placeholder}
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value.toUpperCase())}
                error={fieldError('idNumber')}
                hint={meta.hint}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Input label="Legal name" required placeholder="As on the registration, for example Acme Private Limited" value={legalName} onChange={(e) => setLegalName(e.target.value)} error={fieldError('legalName')} />
            {send.error && !send.error.details?.length && <Alert tone="error">{send.error.message}</Alert>}
            <Button type="submit" loading={send.isPending} disabled={!idNumber.trim() || !legalName.trim()}>
              Submit for review <Send className="size-4" />
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}

export default function BrandVerification() {
  useDocumentTitle('Verification');
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: endpoints.brand.verification });

  if (q.isLoading) return <PageLoader />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;

  const data = q.data;
  const level = data.level;
  const who = data.accountType === 'agency' ? 'your agency' : 'your brand';
  const headline = { signed_up: `Verify ${who} to hire creators`, domain_verified: 'Verified brand', business_verified: 'Verified business' }[level];
  const steps = [
    ['Signed up', 'Browse, draft and publish briefs.', 'done'],
    ['Domain verified', 'Hire creators. A "Verified brand" badge shows on your briefs.', brandRank(level) >= 1 ? 'done' : 'current'],
    ['Business verified', 'A "Verified business" badge, after a reviewer checks your registration number.', brandRank(level) >= 2 ? 'done' : brandRank(level) >= 1 ? 'current' : 'locked'],
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Account"
        title="Verification"
        description="Anyone can sign up with a normal email. Verifying tells creators that a real company is behind the brief, and it is needed to hire."
      />

      <div className="relative overflow-hidden rounded-xl bg-[linear-gradient(120deg,var(--color-ink)_0%,var(--color-navy)_55%,var(--color-slate)_100%)] p-6 text-white sm:p-8">
        <div className="max-w-xl space-y-3">
          <p className="eyebrow text-mist">{data.companyName}</p>
          <h2 className="flex items-center gap-2 text-[30px] text-white sm:text-[36px]">
            {brandRank(level) >= 1 && <BadgeCheck className="size-7 shrink-0" aria-hidden />}
            {headline}
          </h2>
          <p className="text-bone">{BRAND_LEVELS[level].meaning}</p>
        </div>
      </div>

      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map(([title, detail, state], i) => (
          <li key={title}>
            <Card pad className="h-full">
              <div className="flex items-center gap-2.5">
                <StepDot n={i + 1} state={state} />
                <b>{title}</b>
              </div>
              <p className="mt-2 text-[13px] text-steel">{detail}</p>
            </Card>
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2">
        <DomainStep data={data} />
        <BusinessStep data={data} />
      </div>

      <p className="flex items-start gap-2 text-[12.5px] text-steel">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        Verification shows that UNIO checked a domain and a registration number. It is not a guarantee about a brand's conduct.
      </p>
    </div>
  );
}
