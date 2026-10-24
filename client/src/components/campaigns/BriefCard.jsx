import { Clock, LayoutGrid } from 'lucide-react';
import { Link } from 'react-router';
import { useTaxonomy } from '../../hooks/useTaxonomy.js';
import { formatBudget, initials, relativeDeadline } from '../../lib/format.js';
import { categoryName, deliverablesSummary } from '../../lib/rights.js';
import { DemoBadge, Pill, Tag } from '../ui/Badge.jsx';
import { MatchRing } from '../ui/Match.jsx';
import { RightsStrip } from '../ui/Rights.jsx';
import { BrandVerifiedBadge } from '../verification/BrandTrust.jsx';

/** Brand tile: the brand's own first kit colour when set (brand data), otherwise navy. */
export function BrandTile({ brand, size = 'md' }) {
  const bg = brand?.kitColors?.[0]?.hex ?? 'var(--color-navy)';
  const dim = size === 'lg' ? 'size-14 text-base rounded-xl' : 'size-[42px] text-[13px] rounded-[10px]';
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center font-bold text-white ${dim}`} style={{ background: bg }}>
      {initials(brand?.companyName ?? '') || '·'}
    </span>
  );
}

/**
 * v9 brief card (.bc): brand tile, title, brand · industry, deliverables + timing tags, rights strip,
 * tools and budget. `match` shows a ring (Phase 7). `preview` renders without a link (B8 preview).
 */
export function BriefCard({ campaign, match, preview = false }) {
  const { data: taxonomy } = useTaxonomy();
  const Root = preview ? 'div' : Link;
  const tools = campaign.requiredTools ?? [];
  return (
    <Root
      {...(preview ? {} : { to: `/campaigns/${campaign._id}` })}
      className="flex flex-col gap-3.5 rounded-lg border border-line bg-white p-[18px] transition-shadow hover:shadow-card"
    >
      <div className="flex items-start gap-3">
        <BrandTile brand={campaign.brand} />
        <div className="min-w-0 flex-1">
          <b className="block text-[17px] tracking-[-0.02em]">{campaign.title}</b>
          <span className="text-[12.5px] text-steel">
            {campaign.clientName ? `For ${campaign.clientName} · via ${campaign.brand?.companyName}` : campaign.brand?.companyName}
            {campaign.category ? ` · ${categoryName(taxonomy, campaign.category)}` : ''}
          </span>
          <BrandVerifiedBadge level={campaign.brand?.trustLevel} compact className="ml-1.5 align-middle" />
        </div>
        {match != null && <MatchRing score={match} />}
        {campaign.brand?.isDemo && match == null && <DemoBadge label="Demo" />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {campaign.deliverables?.length > 0 && (
          <Tag>
            <LayoutGrid className="size-3" /> {deliverablesSummary(campaign.deliverables)}
          </Tag>
        )}
        <Tag>
          <Clock className="size-3" /> {relativeDeadline(campaign.deadline)}
        </Tag>
      </div>
      {campaign.rightsSummary ? <RightsStrip summary={campaign.rightsSummary} /> : <Pill tone="wait" className="self-start">Rights missing</Pill>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] text-steel">
          {tools.length ? (
            <>
              Tools: <b className="text-slate">{tools.join(', ')}</b>
            </>
          ) : (
            'Any tools'
          )}
        </span>
        <b className="tabular-nums">{formatBudget(campaign.budgetMin, campaign.budgetMax)}</b>
      </div>
    </Root>
  );
}
