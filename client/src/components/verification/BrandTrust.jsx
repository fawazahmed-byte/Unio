import { BadgeCheck, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';

/** What each brand level means, in words a visitor can trust. signed_up has no badge at all. */
export const BRAND_LEVELS = {
  signed_up: { name: 'Signed up', badge: null, meaning: 'Can browse, draft and publish briefs. Verify the brand to hire creators.' },
  domain_verified: {
    name: 'Verified brand',
    badge: 'Verified brand',
    meaning: 'A UNIO reviewer checked that this brand controls its website domain.',
  },
  business_verified: {
    name: 'Verified business',
    badge: 'Verified business',
    meaning: 'A UNIO reviewer checked the domain and the business registration number on the public register.',
  },
};

export const brandRank = (level) => ['signed_up', 'domain_verified', 'business_verified'].indexOf(level ?? 'signed_up');

/** "Verified brand" / "Verified business". Renders nothing for signed_up, so there is never a fake badge. */
export function BrandVerifiedBadge({ level, compact = false, className = '' }) {
  const info = BRAND_LEVELS[level];
  if (!info?.badge) return null;
  const Icon = level === 'business_verified' ? ShieldCheck : BadgeCheck;
  return (
    <span title={info.meaning} className={`inline-flex items-center gap-1 text-[12px] font-semibold text-ok ${className}`}>
      <Icon className="size-3.5" strokeWidth={2} aria-hidden />
      {compact ? <span className="sr-only">{info.badge}</span> : info.badge}
    </span>
  );
}

/** An API error's message; when the brand is not verified it also links to the Verification page. */
export function ApiErrorMessage({ error }) {
  if (!error) return null;
  return (
    <>
      {error.message}
      {error.code === 'BRAND_NOT_VERIFIED' && (
        <>
          {' '}
          <Link to="/brand/verification" className="font-bold underline">
            Open Verification
          </Link>
        </>
      )}
    </>
  );
}
