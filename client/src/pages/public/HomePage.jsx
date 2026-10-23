import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Images, MapPin, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { AiMark, DemoBadge, Tag } from '../../components/ui/Badge.jsx';
import { ButtonLink } from '../../components/ui/Button.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Feedback.jsx';
import { Segmented } from '../../components/ui/Form.jsx';
import { MatchRing, Reasons } from '../../components/ui/Match.jsx';
import { MediaFrame } from '../../components/ui/MediaFrame.jsx';
import { ToolChain, TrustLevelTag } from '../../components/ui/Trust.jsx';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';
import { formatINR } from '../../lib/format.js';
import { statusLabel } from '../../lib/status.js';
import { endpoints } from '../../services/api.js';

/*
 * v9 P1 — "anatomy of a piece". Data rules:
 * - Proof wall and the creator card use real featured creators/pieces from GET /creators.
 * - The hero diagram, tab mock-ups and journey band are labelled EXAMPLES with generic names:
 *   generations, versions, rights and challenge codes don't exist as data yet, and no real
 *   profile is shown with claims its records don't support.
 */

/** Real featured work: one piece from each featured creator. */
function useFeatured() {
  const query = useQuery({
    queryKey: ['pub', 'creators', { sort: 'featured', limit: 8 }],
    queryFn: () => endpoints.creators.list({ sort: 'featured', limit: 8 }),
  });
  const creators = query.data?.items ?? [];
  const work = creators.flatMap((c) => (c.portfolioPreview ?? []).slice(0, 1).map((p) => ({ ...p, creator: c })));
  return { ...query, creators, work };
}

/* ---------- 1. Hero: anatomy of a piece ---------- */

function VersionDots({ dark = true }) {
  const base = dark ? 'bg-white/[0.08] text-bone' : 'bg-line text-slate';
  return (
    <div className="flex items-center">
      <span className={`rounded-[5px] px-[7px] py-[3px] font-mono text-[11px] font-bold ${base}`}>v1</span>
      <i className="w-4 border-t border-steel" aria-hidden />
      <span className={`rounded-[5px] px-[7px] py-[3px] font-mono text-[11px] font-bold ${base}`}>v2</span>
      <i className="w-4 border-t border-steel" aria-hidden />
      <span className="rounded-[5px] bg-ok px-[7px] py-[3px] font-mono text-[11px] font-bold text-white">v3 ✓</span>
    </div>
  );
}

function AnnotationTag({ n, title, side, children }) {
  return (
    <div className={`an-tag flex items-center ${side === 'l' ? 'an-l md:justify-end' : 'an-r'}`}>
      <span className={`mr-2.5 font-mono text-[11px] text-mist md:mx-2.5 ${side === 'l' ? 'md:order-2' : ''}`}>{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl border border-slate bg-navy/85 px-3.5 py-3 text-white backdrop-blur md:max-w-[230px] md:flex-none xl:max-w-[300px]">
        <span className="eyebrow text-mist">{title}</span>
        {children}
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="hero-steel pb-9 pt-[68px]">
      <div className="container-page flex flex-col items-center gap-5 pt-9 text-center md:pt-16">
        <span className="eyebrow text-mist">AI content marketplace · Made in India</span>
        <h1 className="max-w-[900px] text-[40px] tracking-[-0.05em] text-white md:text-[72px]">
          Every frame has a <em className="!text-mist">story.</em>
          <br />
          UNIO shows it.
        </h1>
        <p className="max-w-[620px] text-[15.5px] leading-relaxed text-bone md:text-lg">
          Hire AI creators by how they actually work — the tools they’ve proven, every version they made, and exactly what you’re allowed to do with
          the result.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink to="/brand/campaigns/new" variant="light" size="lg">
            <Sparkles className="size-4" /> Describe your idea
          </ButtonLink>
          <ButtonLink to="/register?role=creator" variant="outline-light" size="lg">
            Join as a creator
          </ButtonLink>
        </div>
      </div>

      <div className="container-page mt-8 grid grid-cols-1 items-center gap-5 md:mt-14 md:grid-cols-[1fr_240px_1fr] md:gap-0 xl:grid-cols-[1fr_280px_1fr]" aria-label="Example: the anatomy of a piece on UNIO">
        <div className="flex flex-col gap-2.5 md:gap-[34px]">
          <AnnotationTag n="01" title="Tool chain" side="l">
            <ToolChain dark steps={['Midjourney', { name: 'Kling', verified: true }, { name: 'Runway', verified: true }, 'CapCut']} />
          </AnnotationTag>
          <AnnotationTag n="02" title="Effort" side="l">
            <b className="text-[14px]">42 generations · 4 days</b>
          </AnnotationTag>
          <AnnotationTag n="03" title="Made by" side="l">
            <div className="flex items-center gap-2">
              <Avatar name="Example Creator" size="sm" />
              <b className="text-[14px]">An AI video creator</b>
            </div>
            <TrustLevelTag level={5} className="self-start" />
          </AnnotationTag>
        </div>

        <div className="order-first mx-auto flex w-[220px] flex-col items-center gap-3 md:order-none md:w-full">
          <div className="relative w-full overflow-hidden rounded-[26px] border-[6px] border-[#0b1a22] shadow-[0_40px_80px_-30px_rgba(0,0,0,.8),0_0_0_1px_var(--color-slate)]">
            <video
              src="/hero-reel.mp4"
              className="aspect-[9/16] w-full bg-navy object-cover"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-label="Example UNIO launch reel"
            />
          </div>
          <span className="font-mono text-[11px] text-mist">Example · skincare launch reel</span>
        </div>

        <div className="flex flex-col gap-2.5 md:gap-[34px]">
          <AnnotationTag n="04" title="Versions" side="r">
            <VersionDots />
            <span className="text-[12.5px] text-mist">Approved after 2 rounds of notes</span>
          </AnnotationTag>
          <AnnotationTag n="05" title="Rights" side="r">
            <b className="text-[14px]">Paid ads · India · 6 months</b>
            <span className="text-[12.5px] text-mist">Non-exclusive · AI label on posts</span>
          </AnnotationTag>
          <AnnotationTag n="06" title="Proof" side="r">
            <b className="font-mono text-[13px]">UNIO-7F3K</b>
            <span className="text-[12.5px] text-mist">Kling verified on a live recording</span>
          </AnnotationTag>
        </div>
      </div>
      <p className="container-page mt-9 text-center font-mono text-[11px] tracking-[0.08em] text-steel">
        Example — the anatomy of a piece on UNIO. Every one carries all six.
      </p>
    </section>
  );
}

/* ---------- 2. Content-type marquee ---------- */

const CONTENT = ['AI video', 'UGC ads', 'AI avatars', '3D product', 'Motion graphics', 'Fashion lookbooks', 'Music visuals', 'Food stills', 'Explainers', 'Regional voice-overs'];

function Marquee() {
  return (
    <div className="overflow-hidden border-y border-line2 bg-bone" aria-hidden>
      <div className="flex w-max animate-marquee py-4 motion-reduce:animate-none">
        {[...CONTENT, ...CONTENT].map((t, i) => (
          <span key={`${t}-${i}`} className="flex items-center whitespace-nowrap">
            <span className="px-[22px] text-[22px] font-bold tracking-[-0.03em] text-navy">{t}</span>
            <i className="not-italic text-steel">✦</i>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- 3. What are you here to do? ---------- */

function Steps({ items }) {
  return (
    <ol className="flex flex-col gap-3.5">
      {items.map(([title, body], i) => (
        <li key={title} className="grid grid-cols-[32px_1fr] gap-x-3 gap-y-0.5">
          <span className="row-span-2 grid size-7 place-items-center rounded-full bg-navy text-[12px] font-bold text-white">{i + 1}</span>
          <b className="text-[14px]">{title}</b>
          <span className="text-[13.5px] text-steel">{body}</span>
        </li>
      ))}
    </ol>
  );
}

const MOCK = 'absolute shadow-pop';

function ExampleTag() {
  return <span className="absolute right-3 top-3 z-10 font-mono text-[10px] uppercase tracking-[0.14em] text-steel">Example</span>;
}

/** Compact v9-style creator card built from a real public profile (no invented ratings or badges). */
function MiniCreatorCard({ creator }) {
  const piece = creator.portfolioPreview?.[0];
  return (
    <Link to={`/creators/${creator._id}`} className="flex flex-col overflow-hidden rounded-lg border border-line bg-white transition-shadow hover:shadow-pop">
      <div className="relative">
        <MediaFrame item={piece ?? { _id: creator._id }} aspect="aspect-[16/11]" className="rounded-none" showLabel={false} hover={false} />
        {piece?.category && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-ink/80 px-2.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur">{piece.category}</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex items-center gap-2.5">
          <Avatar name={creator.displayName} src={creator.photoUrl} size="sm" />
          <div className="min-w-0">
            <b className="block truncate text-[15px] tracking-[-0.01em]">{creator.displayName}</b>
            <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-steel">
              {creator.location && (
                <>
                  <MapPin className="size-3" /> {creator.location} ·
                </>
              )}
              {statusLabel(creator.availability)}
            </span>
          </div>
        </div>
        {creator.skills?.[0] && <span className="text-[13.5px] font-semibold text-slate">{creator.skills[0]}</span>}
        {creator.tools?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {creator.tools.slice(0, 3).map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
        )}
        <div className="mt-auto flex items-center justify-between border-t border-[#edf0ef] pt-2.5 text-[13px]">
          {creator.startingPrice != null ? (
            <span className="text-steel">
              From <b className="text-ink">{formatINR(creator.startingPrice)}</b> / piece
            </span>
          ) : (
            <span />
          )}
          {creator.isDemo && <DemoBadge label="Demo" />}
        </div>
      </div>
    </Link>
  );
}

function Sides({ creators }) {
  const [tab, setTab] = useState('get');
  const card = creators[0];
  return (
    <section className="container-page pb-4 pt-[72px]">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-[32px] md:text-[40px]">What are you here to do?</h2>
        <Segmented
          label="Choose a side"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'get', label: 'I need content' },
            { value: 'make', label: 'I make content' },
          ]}
          className="[&>button]:px-5 [&>button]:py-2.5 [&>button]:text-[15px]"
        />
      </div>

      <div className="grid items-center gap-9 overflow-hidden rounded-xl border border-line bg-white p-5 md:p-9 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col items-start gap-[18px]">
          <span className="eyebrow">{tab === 'get' ? 'For brands & agencies' : 'For creators'}</span>
          <h3 className="text-[28px] md:text-[32px]">{tab === 'get' ? 'One line in. The right creator out.' : 'Your process is your portfolio.'}</h3>
          {tab === 'get' ? (
            <Steps
              items={[
                ['Say the idea', 'AI writes the full brief — formats, style, budget, rights.'],
                ['See who fits, and why', 'Every match comes with a score and plain reasons.'],
                ['Approve with notes', 'Versions, feedback and messages live in one project.'],
              ]}
            />
          ) : (
            <Steps
              items={[
                ['Show how you made it', 'Add your tool chain and versions to each piece.'],
                ['Prove your tools once', 'A one-time code on a live recording — badge for 12 months.'],
                ['Earn ★ Made on UNIO', 'Every finished project here adds to your record.'],
              ]}
            />
          )}
          {tab === 'get' ? (
            <ButtonLink to="/brand/dashboard">
              See the brand workspace <ArrowRight className="size-4" />
            </ButtonLink>
          ) : (
            <ButtonLink to="/register?role=creator">
              Create your profile <ArrowRight className="size-4" />
            </ButtonLink>
          )}
        </div>

        <div className="relative min-h-[400px] rounded-lg bg-[radial-gradient(circle_at_60%_40%,#e3e8ea,transparent_70%),var(--color-soft)] md:min-h-[340px]">
          {tab === 'get' ? (
            <>
              <ExampleTag />
              <div className={`${MOCK} left-[4%] top-[8%] flex w-[250px] -rotate-2 flex-col gap-2.5 rounded-lg border border-line bg-white p-4 md:left-[6%] md:w-[300px]`}>
                <AiMark label="AI BRIEF" className="self-start" />
                <p className="text-[15px] font-semibold">“Diwali reel for our mithai box, warm, Hindi VO”</p>
                <div className="flex flex-wrap gap-1.5">
                  {['AI video', '9:16 · 30 s', '₹12–18K', 'India · 6 mo'].map((t) => (
                    <span key={t} className="rounded-[6px] border border-ai-ln bg-ai-bg px-2 py-1 text-[12px] font-semibold text-ai">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className={`${MOCK} bottom-[8%] right-[4%] flex w-[220px] rotate-[1.5deg] flex-col gap-3 rounded-lg border border-line bg-white p-4 md:right-[5%] md:w-[260px]`}>
                <div className="flex items-center gap-2.5">
                  <MatchRing score={91} size="sm" />
                  <div>
                    <b className="text-[14px]">A food creator</b>
                    <div className="text-[12.5px] text-steel">Food &amp; beverage</div>
                  </div>
                </div>
                <Reasons items={['Midjourney + Kling verified', '12 food pieces', 'Hindi voice-over']} />
              </div>
            </>
          ) : (
            <>
              {card && (
                <div className={`${MOCK} left-[4%] top-[6%] w-[250px] -rotate-2 rounded-lg md:left-[6%] md:w-[300px]`}>
                  <MiniCreatorCard creator={card} />
                </div>
              )}
              <div className={`${MOCK} bottom-[8%] right-[4%] flex w-[220px] rotate-[1.5deg] flex-col gap-2 overflow-hidden rounded-lg bg-ink p-5 md:right-[5%] md:w-[250px]`}>
                <span className="eyebrow text-mist">Challenge code · example</span>
                <b className="font-mono text-[30px] font-medium tracking-[0.14em] text-white">UNIO-9KD2</b>
                <span className="text-[12.5px] text-bone">Works once · 48 h</span>
                <span aria-hidden className="absolute -right-8 -top-8 size-36 rounded-full border-[16px] border-mist/10" />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- 4. Proof wall (real featured pieces) ---------- */

/** v9 wall rhythm: first tile wide, second tall, the rest single. */
const TILE_SPAN = ['col-span-2', 'row-span-2', '', '', '', ''];

function ProofTile({ item, span }) {
  const label = item.category || (item.mediaType === 'video' ? 'Video' : 'Image');
  return (
    <Link
      to={`/creators/${item.creator._id}`}
      className={`group relative overflow-hidden rounded-lg bg-navy ${span}`}
      aria-label={`${item.title} by ${item.creator.displayName}`}
    >
      <MediaFrame item={item} aspect="aspect-auto" className="absolute inset-0 h-full rounded-none" showLabel={false} />
      <span className="absolute left-3 top-3 z-10 rounded-full bg-ink/80 px-2.5 py-0.5 text-[11px] font-semibold text-white">{label}</span>
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1.5 bg-[linear-gradient(0deg,rgba(6,20,27,.92),rgba(6,20,27,0))] p-3.5 text-white transition-transform duration-300 md:translate-y-[calc(100%-58px)] md:group-hover:translate-y-0 md:group-focus-visible:translate-y-0">
        <b className="truncate text-[14px]">{item.title}</b>
        <span className="text-[12.5px] text-bone">
          {item.creator.displayName}
          {item.creator.isDemo && ' · demo profile'}
        </span>
        {item.tools?.length > 0 && <ToolChain dark steps={item.tools.slice(0, 4)} />}
      </div>
    </Link>
  );
}

function ProofWall({ work, isLoading, error, refetch }) {
  const tiles = work.slice(0, 6);
  return (
    <section className="container-page pb-4 pt-[72px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2.5">
          <span className="eyebrow">Proof wall</span>
          <h2 className="text-[32px] md:text-[40px]">Work you can trace back.</h2>
          <p className="text-steel">Hover any piece to see how it was made.</p>
        </div>
        <ButtonLink to="/creators" variant="secondary">
          Discover creators <ArrowRight className="size-4" />
        </ButtonLink>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading ? (
        <div className="grid auto-rows-[170px] grid-cols-2 gap-3.5 md:auto-rows-[220px] md:grid-cols-3 lg:grid-cols-4">
          {TILE_SPAN.map((span, i) => (
            <Skeleton key={i} className={`h-full ${span}`} />
          ))}
        </div>
      ) : tiles.length === 0 ? (
        <EmptyState icon={Images} title="No featured work yet" action={<ButtonLink to="/creators" size="sm">Browse creators</ButtonLink>}>
          Featured portfolio pieces appear here as creators add them.
        </EmptyState>
      ) : (
        <div className="grid auto-rows-[170px] grid-cols-2 gap-3.5 md:auto-rows-[220px] md:grid-cols-3 lg:grid-cols-4">
          {tiles.map((item, i) => (
            <ProofTile key={item._id} item={item} span={TILE_SPAN[i]} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- 5. Journey band ---------- */

function JourneyCard({ children, className = '' }) {
  return <div className={`flex min-h-[110px] flex-col justify-center gap-2 rounded-xl border border-slate bg-navy p-3.5 text-bone ${className}`}>{children}</div>;
}

function Journey() {
  const steps = [
    ['Idea', <JourneyCard key="i"><p className="text-[12.5px]">“30-sec Diwali reel, warm and festive, Hindi voice-over”</p></JourneyCard>],
    [
      'Brief',
      <JourneyCard key="b">
        <div className="flex flex-wrap gap-1.5">
          {['AI video', '9:16', '₹12–18K', '28 Oct'].map((t) => (
            <span key={t} className="rounded-[6px] border border-slate bg-white/[0.08] px-2 py-1 text-[12px] font-semibold text-bone">
              {t}
            </span>
          ))}
        </div>
      </JourneyCard>,
    ],
    [
      'Match',
      <JourneyCard key="m" className="!flex-row items-center">
        <MatchRing score={91} size="sm" dark />
        <span className="text-[12.5px]">Tools verified · budget fits · Hindi</span>
      </JourneyCard>,
    ],
    [
      'Versions',
      <JourneyCard key="v">
        <VersionDots />
        <span className="text-[12.5px]">“Bigger captions for mobile”</span>
      </JourneyCard>,
    ],
    [
      'Rights',
      <JourneyCard key="r" className="border-dashed bg-[linear-gradient(135deg,var(--color-slate),var(--color-navy))]">
        <b className="text-white">Paid ads · India</b>
        <span className="text-[12.5px]">6 months · non-exclusive</span>
      </JourneyCard>,
    ],
  ];
  return (
    <section className="mt-20 bg-ink py-20">
      <div className="container-page">
        <div className="mb-7 flex flex-col gap-2.5">
          <span className="eyebrow text-mist">The journey · example</span>
          <h2 className="text-[32px] text-white md:text-[40px]">From one line to a licensed file.</h2>
        </div>
        <ol className="journey-line relative grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {steps.map(([title, card], i) => (
            <li key={title} className="relative flex flex-col gap-2.5">
              <span className="grid size-[30px] place-items-center rounded-full bg-bone text-[13px] font-extrabold text-ink shadow-[0_0_0_6px_var(--color-ink)]">{i + 1}</span>
              <b className="text-[18px] text-white">{title}</b>
              {card}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- 6. Ending ---------- */

function Finale() {
  return (
    <section className="container-page flex flex-col items-center gap-[18px] py-14 text-center md:py-24">
      <h2 className="text-[32px] tracking-[-0.05em] md:text-[64px]">
        <span>Make it.</span> <span className="text-steel">Prove it.</span> <span className="font-light text-steel">License it.</span>
      </h2>
      <p className="text-steel">The AI content marketplace where how it was made is part of what you buy.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <ButtonLink to="/brand/campaigns/new" size="lg">
          <Sparkles className="size-4" /> Start with an idea
        </ButtonLink>
        <ButtonLink to="/creators" variant="secondary" size="lg">
          Browse creators
        </ButtonLink>
      </div>
    </section>
  );
}

export default function HomePage() {
  useDocumentTitle();
  const featured = useFeatured();
  return (
    <>
      <Hero />
      <Marquee />
      <Sides creators={featured.creators.filter((c) => c.portfolioPreview?.length)} />
      <ProofWall work={featured.work} isLoading={featured.isLoading} error={featured.error} refetch={featured.refetch} />
      <Journey />
      <Finale />
    </>
  );
}
