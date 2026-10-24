import { useQuery } from '@tanstack/react-query';
import { Image as ImageIcon, Play, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApplyForm } from '../../components/applications/ApplyPanel.jsx';
import { BrandTile } from '../../components/campaigns/BriefCard.jsx';
import { AiMark, DemoBadge, Pill, StatusPill, Tag } from '../../components/ui/Badge.jsx';
import { Button, ButtonLink } from '../../components/ui/Button.jsx';
import { Card, SectionHead } from '../../components/ui/Card.jsx';
import { Alert, ErrorState, PageLoader } from '../../components/ui/Feedback.jsx';
import { RightsStrip, RightsTicket } from '../../components/ui/Rights.jsx';
import { MatchRing, Reasons } from '../../components/ui/Match.jsx';
import { ToolChip } from '../../components/ui/Trust.jsx';
import { BrandVerifiedBadge } from '../../components/verification/BrandTrust.jsx';
import { toolStateFor } from '../../components/creators/CreatorCard.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { labelOf, useTaxonomy } from '../../hooks/useTaxonomy.js';
import { formatBudget, formatDate, pluralize } from '../../lib/format.js';
import { rightsRows } from '../../lib/rights.js';
import { authLink } from '../../lib/returnTo.js';
import { endpoints } from '../../services/api.js';
import NotFoundPage from './NotFoundPage.jsx';

/* v9 P5 — campaign detail + apply. Signed-in creators see their match ring and the reasons (F4). */

function matchHeading(score) {
  if (score >= 80) return 'You’re a strong match';
  if (score >= 60) return 'You’re a good match';
  return 'A partial match';
}

function CreatorMatch({ match, name }) {
  if (!match) return null;
  return (
    <div className="mb-5 border-b border-line pb-5">
      <div className="flex items-center gap-4">
        <MatchRing score={match.score} size="lg" />
        <div>
          <h2 className="text-[19px]">{matchHeading(match.score)}</h2>
          <p className="text-[13.5px] text-steel">{name ? `${name}, here’s why` : 'Here’s why'}</p>
        </div>
      </div>
      <Reasons items={match.reasons} className="mt-4 text-[13.5px]" />
      {match.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12.5px] text-wait">
          {match.warnings.map((w) => (
            <li key={w}>· {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STILL_RE = /still|image|photo|frame|poster|banner|carousel|thumbnail/i;
const IMAGE_TYPES = ['photo', 'static', 'poster', 'thumb'];

function Fact({ label, children }) {
  return (
    <div className="border-line px-3.5 py-3 [&:nth-child(odd)]:border-r max-sm:[&:nth-child(-n+2)]:border-b sm:border-r sm:last:border-r-0">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-steel">{label}</p>
      <p className="mt-1.5 text-[16px] font-bold tabular-nums">{children}</p>
    </div>
  );
}

function SidePanel({ campaign, viewer, user, applyFocus, roleNotice, onSignIn }) {
  if (viewer?.isOwner) {
    return (
      <>
        <h2 className="text-[19px]">This is your campaign</h2>
        <p className="mt-1 text-[13.5px] text-steel">
          {campaign.status === 'open' ? 'Live on Campaigns.' : `Status: ${campaign.status}. Only you can see this page.`}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <ButtonLink to={`/brand/campaigns/${campaign._id}/applicants`}>Review applicants</ButtonLink>
          <ButtonLink to={`/brand/campaigns/${campaign._id}/edit`} variant="secondary">
            Edit campaign
          </ButtonLink>
        </div>
      </>
    );
  }
  if (viewer?.application) {
    return (
      <>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[19px]">You applied</h2>
          <StatusPill status={viewer.application.status} />
        </div>
        <p className="mt-1 text-[13.5px] text-steel">Submitted {formatDate(viewer.application.submittedAt)}</p>
        <ButtonLink to="/creator/applications" variant="secondary" className="mt-5 w-full">
          View my applications
        </ButtonLink>
      </>
    );
  }
  if (user?.role === 'creator') {
    return (
      <>
        <CreatorMatch match={campaign.match} name={user.name?.split(' ')[0]} />
        <h2 className="mb-1 text-[19px]">Apply to this brief</h2>
        <p className="mb-5 text-[13.5px] text-steel">Budget {formatBudget(campaign.budgetMin, campaign.budgetMax)}</p>
        <ApplyForm campaign={campaign} autoFocus={applyFocus} />
      </>
    );
  }
  return (
    <>
      <h2 className="text-[19px]">Apply to this brief</h2>
      <p className="mt-1 text-[13.5px] text-steel">Budget {formatBudget(campaign.budgetMin, campaign.budgetMax)}</p>
      {campaign.rightsSummary && <RightsStrip summary={campaign.rightsSummary} className="mt-4" />}
      {roleNotice && user?.role === 'brand' ? (
        <Alert tone="info" className="mt-5">
          Applications come from creator accounts. You’re signed in as a brand — you can{' '}
          <Link to="/brand/campaigns/new" className="underline">
            post your own brief
          </Link>{' '}
          or <Link to="/creators" className="underline">invite creators</Link>.
        </Alert>
      ) : (
        <>
          <Button size="lg" className="mt-5 w-full" onClick={onSignIn}>
            Apply to this brief
          </Button>
          {!user && <p className="mt-2 text-center text-[13px] text-steel">You’ll sign in with a creator account first. Nothing is sent until you confirm.</p>}
        </>
      )}
    </>
  );
}

export default function CampaignDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: taxonomy } = useTaxonomy();
  const [applyFocus, setApplyFocus] = useState(false);
  const [roleNotice, setRoleNotice] = useState(false);

  const query = useQuery({ queryKey: ['pub', 'campaign', id, user?._id ?? 'guest'], queryFn: () => endpoints.campaigns.get(id) });
  const me = useQuery({ queryKey: ['mine', 'profile'], queryFn: endpoints.creator.profile, enabled: user?.role === 'creator' });
  const campaign = query.data?.campaign;
  const viewer = query.data?.viewer;
  useDocumentTitle(campaign?.title ?? 'Campaign');

  // Resume the apply flow after sign-in: focus the form for review, never auto-submit.
  useEffect(() => {
    if (params.get('intent') !== 'apply' || !campaign || !user) return;
    if (user.role === 'creator' && !viewer?.application) setApplyFocus(true);
    if (user.role === 'brand') setRoleNotice(true);
    setParams(
      (p) => {
        p.delete('intent');
        return p;
      },
      { replace: true },
    );
  }, [params, campaign, viewer, user, setParams]);

  const onSignIn = () => {
    if (!user) return navigate(authLink('login', `/campaigns/${id}?intent=apply`));
    return setRoleNotice(true);
  };

  if (query.isLoading) return <PageLoader label="Loading brief" />;
  if (query.error?.status === 404 || query.error?.status === 400) return <NotFoundPage what="campaign" />;
  if (query.error) {
    return (
      <div className="container-page py-16">
        <ErrorState error={query.error} onRetry={query.refetch} />
      </div>
    );
  }

  const brand = campaign.brand;
  const tools = campaign.requiredTools ?? [];
  const contentLabel = campaign.contentType ? labelOf(taxonomy, 'contentTypes', campaign.contentType) : null;
  const aiStructured = campaign.aiFilledFields?.includes('deliverables');
  const swatches = brand?.kitColors ?? [];
  const rows = rightsRows(campaign.rights, taxonomy);
  const subline = [
    (campaign.formats ?? []).join(' + '),
    campaign.lengthNote,
    (campaign.languages ?? []).length ? campaign.languages.join(', ') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="container-page pb-14 pt-6">
      <nav aria-label="Breadcrumb" className="mb-4 text-[13px] text-steel">
        <Link to="/campaigns" className="hover:text-ink">
          Campaigns
        </Link>{' '}
        / <b className="font-semibold text-ink">{campaign.title}</b>
      </nav>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card pad className="sm:p-[22px]">
            <div className="flex items-start gap-4">
              <BrandTile brand={brand} size="lg" />
              <div className="min-w-0">
                <h1 className="text-[26px] leading-tight sm:text-[34px]">{campaign.title}</h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-steel">
                  <span>
                    For <b className="font-bold text-ink">{campaign.clientName ?? brand?.companyName}</b>
                    {campaign.clientName ? ` · via ${brand?.companyName}` : ''}
                    {campaign.category ? ` · ${labelOf(taxonomy, 'specializations', campaign.category)}` : ''}
                  </span>
                  {brand?.accountType === 'agency' && <Pill dot={false}>Agency</Pill>}
                  <BrandVerifiedBadge level={brand?.trustLevel} />
                  {brand?.isDemo && <DemoBadge label="Demo brand" />}
                  {campaign.status !== 'open' && <StatusPill status={campaign.status} />}
                </div>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 rounded-md border border-line sm:grid-cols-4">
              <Fact label="Budget">{formatBudget(campaign.budgetMin, campaign.budgetMax)}</Fact>
              <Fact label="Deadline">{campaign.deadline ? formatDate(campaign.deadline) : 'Flexible'}</Fact>
              <Fact label="Applicants">{campaign.applicantCount ?? 0}</Fact>
              <Fact label="Revisions">{campaign.revisionsIncluded != null ? pluralize(campaign.revisionsIncluded, 'round') : '—'}</Fact>
            </div>
            <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-ink">{campaign.brief}</p>
          </Card>

          {campaign.deliverables?.length > 0 && (
            <Card>
              <SectionHead title="Deliverables" action={aiStructured ? <AiMark label="AI-structured" /> : null} />
              <ul>
                {campaign.deliverables.map((d, i) => {
                  const still = IMAGE_TYPES.includes(campaign.contentType) || STILL_RE.test(d.title);
                  const Icon = still ? ImageIcon : Play;
                  const kind = IMAGE_TYPES.includes(campaign.contentType) ? contentLabel : still ? 'Still images' : contentLabel;
                  return (
                    <li key={`${d.title}-${i}`} className="flex items-center gap-3.5 border-t border-line px-5 py-3.5 first:border-t-0">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line2">
                        <Icon className="size-4" strokeWidth={1.8} aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <b className="block text-[15px] font-semibold">
                          {(d.quantity ?? 1) > 1 ? `${d.quantity} × ` : ''}
                          {d.title}
                        </b>
                        <span className="text-[13px] text-steel">{d.description || (i === 0 ? subline : '')}</span>
                      </div>
                      {kind && <Tag className="max-sm:hidden">{kind}</Tag>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <Card pad>
              <p className="eyebrow">Style</p>
              <p className="mt-3 text-[15px]">{campaign.style || 'Open to your style.'}</p>
              {swatches.length > 0 && (
                <div className="mt-3.5 flex flex-wrap gap-2" aria-label="Brand colours">
                  {swatches.map((c) => (
                    <span key={`${c.name}-${c.hex}`} title={`${c.name} ${c.hex}`} className="size-[30px] rounded-[7px] border border-black/5" style={{ background: c.hex }} />
                  ))}
                </div>
              )}
            </Card>
            <Card pad>
              <p className="eyebrow">Tools wanted</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tools.length ? (
                  tools.map((t) => <ToolChip key={t} name={t} state={me.data ? toolStateFor(me.data, t) : 'self'} />)
                ) : (
                  <span className="text-[15px]">Any tools — show what works.</span>
                )}
              </div>
              <p className="mt-3 text-[13px] text-steel">
                {me.data ? 'Ticks show tools UNIO has verified on your profile.' : 'Creators see which of these UNIO has verified for them.'}
              </p>
            </Card>
          </div>

          <div id="rights" className="scroll-mt-24">
            {rows.length ? (
              <RightsTicket eyebrow="Commercial use · set by the brand" title="What the brand can do with your work" rows={rows} note={null} />
            ) : (
              <Alert tone="warning" title="Rights missing">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldAlert className="size-4" /> This draft can’t be opened until usage, region, duration and exclusivity are set.
                </span>
              </Alert>
            )}
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <Card pad>
            <SidePanel campaign={campaign} viewer={viewer} user={user} applyFocus={applyFocus} roleNotice={roleNotice} onSignIn={onSignIn} />
          </Card>
          <Card pad>
            <p className="text-[13px] leading-relaxed text-steel">
              {viewer?.isOwner
                ? 'Creators see this page as written. Rights shown here are what they agree to when they apply.'
                : campaign.match
                  ? 'Only you see this match. Brands reviewing applicants see the same score and reasons.'
                  : 'Only creators can apply. The brand sees your price, pitch, chosen work and that you accepted these rights.'}
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
