import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Briefcase,
  FolderKanban,
  Home,
  Image,
  Inbox,
  LayoutGrid,
  LogOut,
  Mail,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Timer,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { useClientScope, withClient } from '../../lib/clientScope.js';
import { endpoints } from '../../services/api.js';
import { Avatar } from '../ui/Avatar.jsx';
import { ButtonLink, IconButton } from '../ui/Button.jsx';
import { Card, SectionHead } from '../ui/Card.jsx';
import { Logo } from '../ui/Logo.jsx';
import { SiteFooter } from './SiteFooter.jsx';
import { SiteHeader } from './SiteHeader.jsx';

function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-full focus:bg-navy focus:px-4 focus:py-2 focus:text-white"
    >
      Skip to content
    </a>
  );
}

/** Top-level wrapper shared by every route. */
export function AppRoot() {
  return (
    <>
      <SkipLink />
      <Outlet />
      <ScrollRestoration />
    </>
  );
}

/** Public chrome: white header, ink footer (guide §3.5). Also wraps guard states outside the app shell. */
export function PublicFrame({ children }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="min-h-[70vh]">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

export function RootLayout() {
  return (
    <PublicFrame>
      <Outlet />
    </PublicFrame>
  );
}

/* ---------- App shell ---------- */

const ACTIVE_PROJECT_STATUSES = ['not_started', 'in_progress', 'submitted', 'revision_requested'];

/** Real counts from existing list endpoints (their `total`). No badge when the count is unknown or zero. */
function useNavCounts(role, clientId = '', agency = false) {
  const applicants = useQuery({
    queryKey: ['mine', 'applications', 'nav-count', clientId],
    queryFn: () => endpoints.brand.applications({ status: 'pending', limit: 1, clientId }),
    enabled: role === 'brand',
    staleTime: 60_000,
    select: (d) => d.total,
  });
  const projects = useQuery({
    queryKey: ['mine', 'projects', 'nav-count', role, clientId],
    queryFn: async () => {
      const list = role === 'brand' ? endpoints.brand.projects : endpoints.creator.projects;
      const pages = await Promise.all(ACTIVE_PROJECT_STATUSES.map((status) => list({ status, limit: 1, ...(role === 'brand' ? { clientId } : {}) })));
      return pages.reduce((sum, p) => sum + (p.total ?? 0), 0);
    },
    enabled: role === 'brand' || role === 'creator',
    staleTime: 60_000,
  });
  // Agencies: approval links still waiting on the client, plus answers the agency has not acted on yet.
  const approvals = useQuery({
    queryKey: ['mine', 'approvals', 'nav-count', clientId],
    queryFn: () => endpoints.brand.approvals({ clientId }),
    enabled: agency,
    staleTime: 60_000,
    select: (d) => d.counts.awaiting + d.counts.answered,
  });
  return { applicants: applicants.data, projects: projects.data, approvals: approvals.data };
}

/** Only pages that exist today; later phases add Trust rules, Clients… */
function navFor(role, counts, agency = false) {
  if (role === 'brand' && agency) {
    // Agency workspace (A1/A2): same pages as a brand, scoped by the client switcher, plus clients and approvals.
    return {
      workspace: [
        { to: '/brand/dashboard', label: 'Overview', icon: Home, scoped: true },
        { to: '/brand/campaigns', label: 'Campaigns', icon: Briefcase, match: ['/brand/campaigns'], scoped: true },
        { to: '/brand/applications', label: 'Applicants', icon: UserRound, count: counts.applicants, scoped: true },
        { to: '/brand/recommended', label: 'Recommended', icon: Sparkles, scoped: true },
        { to: '/brand/projects', label: 'Projects', icon: FolderKanban, count: counts.projects, match: ['/projects/'], scoped: true },
        { to: '/brand/approvals', label: 'Client approvals', icon: Timer, count: counts.approvals, scoped: true },
        { to: '/brand/invitations', label: 'Invitations', icon: Mail, scoped: true },
      ],
      account: [
        { to: '/brand/clients', label: 'Clients', icon: LayoutGrid },
        { to: '/brand/profile', label: 'Agency profile', icon: UserRound },
        { to: '/brand/verification', label: 'Verification', icon: ShieldCheck },
      ],
      cta: { to: '/brand/campaigns/new', label: 'New brief for…', icon: Sparkles, scoped: true },
    };
  }
  if (role === 'brand') {
    return {
      workspace: [
        { to: '/brand/dashboard', label: 'Overview', icon: Home },
        { to: '/brand/campaigns', label: 'Campaigns', icon: Briefcase, match: ['/brand/campaigns'] },
        { to: '/brand/applications', label: 'Applicants', icon: UserRound, count: counts.applicants },
        { to: '/brand/recommended', label: 'Recommended', icon: Sparkles },
        { to: '/brand/projects', label: 'Projects', icon: FolderKanban, count: counts.projects, match: ['/projects/'] },
        { to: '/brand/invitations', label: 'Invitations', icon: Mail },
      ],
      account: [
        { to: '/brand/profile', label: 'Brand profile', icon: UserRound },
        { to: '/brand/verification', label: 'Verification', icon: ShieldCheck },
      ],
      cta: { to: '/brand/campaigns/new', label: 'New brief with AI', icon: Sparkles },
    };
  }
  if (role === 'creator') {
    return {
      workspace: [
        { to: '/creator/dashboard', label: 'Dashboard', icon: Home },
        { to: '/campaigns', label: 'Find campaigns', icon: Search },
        { to: '/creator/applications', label: 'Applications', icon: Inbox },
        { to: '/creator/projects', label: 'Projects', icon: FolderKanban, count: counts.projects, match: ['/projects/'] },
        { to: '/creator/invitations', label: 'Invitations', icon: Mail },
      ],
      account: [
        { to: '/creator/profile/edit', label: 'Edit profile', icon: UserRound },
        { to: '/creator/portfolio', label: 'Portfolio', icon: Image },
        { to: '/creator/verification', label: 'UNIO Trust', icon: ShieldCheck },
      ],
      cta: { to: '/creator/portfolio', label: 'Add work', icon: Plus },
    };
  }
  return {
    workspace: [{ to: '/review', label: 'Verification queue', icon: ShieldCheck, end: true }],
    account: [],
    cta: null,
  };
}

function isActive(item, pathname) {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`) || (item.match ?? []).some((m) => pathname.startsWith(m));
}

function SideLink({ item, active, onNavigate, clientId }) {
  const { to, label, icon: Icon, count } = item;
  return (
    <Link
      to={item.scoped ? withClient(to, clientId) : to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-[11px] rounded-[9px] px-3 py-[9px] text-[14px] transition-colors ${
        active ? 'bg-bone font-bold text-ink' : 'font-medium text-bone hover:bg-bone/[0.08]'
      }`}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && (
        <span className={`rounded-full px-[7px] text-[11px] font-bold text-white ${active ? 'bg-navy' : 'bg-steel'}`}>
          {count}
          <span className="sr-only"> open</span>
        </span>
      )}
    </Link>
  );
}

const WORKSPACE_SUB = { brand: 'Brand workspace', creator: 'Creator', reviewer: 'UNIO Trust reviewer' };
const TRUST_NAMES = ['Self-reported', 'Pending review', 'Certified', 'Verified', '★ Made on UNIO'];

/** "Creator · Verified" — the level is the server-computed trustLevel on the session profile. */
function workspaceSub(role, profile) {
  if (role === 'creator' && profile?.trustLevel > 1) return `Creator · ${TRUST_NAMES[profile.trustLevel - 1]}`;
  if (role === 'brand' && profile?.accountType === 'agency') return 'Agency workspace';
  return WORKSPACE_SUB[role];
}

function workspaceName(user, profile) {
  return profile?.companyName || profile?.displayName || user?.name || '';
}

function SidebarContent({ role, nav, pathname, onNavigate, onLogout, agency }) {
  const { user, profile } = useAuth();
  const name = workspaceName(user, profile);
  const clientId = agency?.clientId ?? '';
  return (
    <>
      <div className="flex flex-col gap-2.5 rounded-xl border border-slate p-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={name} size="sm" />
          <div className="min-w-0">
            <b className="block truncate text-[14.5px] text-white">{name}</b>
            <small className="block text-[12px] text-mist">
              {agency ? `Agency · ${agency.clients.length} ${agency.clients.length === 1 ? 'client' : 'clients'}` : workspaceSub(role, profile)}
            </small>
          </div>
        </div>
        {agency && (
          <select
            aria-label="Client"
            value={clientId}
            onChange={(e) => agency.setClient(e.target.value)}
            className="h-9 w-full rounded-[8px] border border-slate bg-ink px-2.5 text-[13.5px] font-semibold text-white outline-none focus:border-bone"
          >
            <option value="">All clients</option>
            {agency.clients.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="px-2.5 pt-1.5 font-mono text-[10px] tracking-[0.2em] text-steel">WORKSPACE</p>
      <nav aria-label="Workspace" className="flex flex-col gap-0.5">
        {nav.workspace.map((item) => (
          <SideLink key={item.to} item={item} active={isActive(item, pathname)} onNavigate={onNavigate} clientId={clientId} />
        ))}
      </nav>
      {nav.account.length > 0 && (
        <>
          <p className="px-2.5 pt-1.5 font-mono text-[10px] tracking-[0.2em] text-steel">ACCOUNT</p>
          <nav aria-label="Account" className="flex flex-col gap-0.5">
            {nav.account.map((item) => (
              <SideLink key={item.to} item={item} active={isActive(item, pathname)} onNavigate={onNavigate} clientId={clientId} />
            ))}
          </nav>
        </>
      )}
      <div className="mt-auto flex items-center gap-2.5 border-t border-slate px-2 pt-3.5 text-[13px]">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mist" title={user?.email}>
          {user?.email}
        </span>
        <button type="button" onClick={onLogout} className="rounded-full p-1.5 text-mist hover:bg-bone/[0.08] hover:text-white" aria-label="Sign out">
          <LogOut className="size-4" strokeWidth={1.8} />
        </button>
      </div>
    </>
  );
}

/** Bell = unread project messages (/me/unread, polled every 30 s while visible). Opens Projects. */
function UnreadBell({ role }) {
  const unread = useQuery({
    queryKey: ['me', 'unread'],
    queryFn: endpoints.me.unread,
    enabled: role === 'brand' || role === 'creator',
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const total = unread.data?.total ?? 0;
  const to = role === 'brand' ? '/brand/projects' : role === 'creator' ? '/creator/projects' : '/';
  return (
    <Link
      to={to}
      aria-label={total ? `${total} unread message${total > 1 ? 's' : ''}` : 'No unread messages'}
      className="relative grid size-[38px] shrink-0 place-items-center rounded-full border border-line bg-white text-ink hover:border-navy"
    >
      <Bell className="size-4" strokeWidth={1.8} aria-hidden />
      {total > 0 && (
        <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-att px-1 text-[10.5px] font-bold text-white">
          {total > 99 ? '99+' : total}
        </span>
      )}
    </Link>
  );
}

/** Sub-pages below a nav item get their own breadcrumb leaf. */
const SUB_CRUMBS = [
  [/\/campaigns\/new$/, 'New brief'],
  [/\/campaigns\/[^/]+\/edit$/, 'Edit brief'],
  [/^\/projects\/[^/]+$/, 'Project'],
  [/\/campaigns\/[^/]+\/applicants$/, 'Applicants'],
];

/**
 * Signed-in app shell (guide §3.5): 262px navy sidebar, white 68px top bar,
 * and on phones a navy bottom tab bar with the first five items.
 * `role` defaults to the session role (used by shared pages such as /projects/:id).
 */
export function DashboardLayout({ role: roleProp }) {
  const { user, logout, profile } = useAuth();
  const role = roleProp ?? user?.role;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isAgency = role === 'brand' && profile?.accountType === 'agency';
  const { clientId, setClient } = useClientScope();
  const clientsQuery = useQuery({ queryKey: ['mine', 'clients'], queryFn: endpoints.brand.clients, enabled: isAgency, staleTime: 60_000 });
  const clients = clientsQuery.data ?? [];
  // A stale ?client= (archived or unknown) is treated as "All clients".
  const activeClient = clients.find((c) => c._id === clientId);
  const scopeId = isAgency && (clientsQuery.isLoading || activeClient) ? clientId : '';
  const agency = isAgency ? { clients, clientId: scopeId, setClient } : null;
  const counts = useNavCounts(role, scopeId, isAgency);
  const nav = navFor(role, counts, isAgency);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [pathname]);

  const current = nav.workspace.find((item) => isActive(item, pathname)) ?? nav.account.find((item) => isActive(item, pathname));
  const sub = SUB_CRUMBS.find(([re]) => re.test(pathname))?.[1];
  // "Campaigns / New brief" on sub-pages; "Workspace / Campaigns" on section pages (v9).
  const crumbRoot = sub && current ? current.label : nav.account.includes(current) ? 'Account' : 'Workspace';
  const crumbLeaf = [sub ?? current?.label, activeClient && isAgency && !sub ? `· ${activeClient.name}` : null].filter(Boolean).join(' ');
  const handleLogout = async () => {
    await logout.mutateAsync().catch(() => {});
    navigate('/');
  };

  return (
    <div className="min-h-dvh bg-page lg:grid lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[262px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-3.5 overflow-y-auto bg-navy px-3.5 py-[22px] text-bone lg:flex">
        <Link to="/" aria-label="UNIO home" className="px-1">
          <Logo onDark className="h-[30px]" />
        </Link>
        <SidebarContent role={role} nav={nav} pathname={pathname} onLogout={handleLogout} agency={agency} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-[68px] items-center gap-3.5 border-b border-line bg-white px-4 lg:px-9">
          <Link to="/" aria-label="UNIO home" className="shrink-0 lg:hidden">
            <Logo className="h-6" />
          </Link>
          <p className="hidden min-w-0 flex-1 truncate text-[14px] text-steel sm:block">
            {crumbRoot}
            {crumbLeaf && (
              <>
                {' '}
                / <b className="font-semibold text-ink">{crumbLeaf}</b>
              </>
            )}
          </p>
          <span className="flex-1 sm:hidden" />
          <UnreadBell role={role} />
          {nav.cta && (
            <ButtonLink to={nav.cta.scoped ? withClient(nav.cta.to, scopeId) : nav.cta.to} size="sm">
              <nav.cta.icon className="size-4" strokeWidth={1.8} aria-hidden /> {nav.cta.label}
            </ButtonLink>
          )}
          <IconButton label={menuOpen ? 'Close menu' : 'Open menu'} className="lg:hidden" aria-expanded={menuOpen} aria-controls="app-menu" onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </IconButton>
        </header>

        {menuOpen && (
          <div id="app-menu" className="flex flex-col gap-3.5 bg-navy px-4 py-5 text-bone lg:hidden">
            {nav.cta && (
              <ButtonLink to={nav.cta.scoped ? withClient(nav.cta.to, scopeId) : nav.cta.to} variant="light" className="w-full">
                <nav.cta.icon className="size-4" aria-hidden /> {nav.cta.label}
              </ButtonLink>
            )}
            <SidebarContent role={role} nav={nav} pathname={pathname} onNavigate={() => setMenuOpen(false)} onLogout={handleLogout} agency={agency} />
          </div>
        )}

        <main id="main" className="flex min-w-0 flex-1 flex-col gap-[22px] px-4 pb-28 pt-5 lg:px-9 lg:pb-14 lg:pt-7">
          <Outlet />
        </main>

        <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-30 flex justify-around bg-navy px-1 py-2 text-[11px] text-bone lg:hidden">
          {nav.workspace.slice(0, 5).map((item) => {
            const active = isActive(item, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.scoped ? withClient(item.to, scopeId) : item.to}
                aria-current={active ? 'page' : undefined}
                className={`flex min-w-0 flex-col items-center gap-[3px] rounded-lg px-2 py-1 ${active ? 'bg-bone text-ink' : ''}`}
              >
                <Icon className="size-4" strokeWidth={1.8} aria-hidden />
                <span className="max-w-[4.5rem] truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

/** Page header (v9 .ph): mono eyebrow, 38px title (30 on phone), one-line subtitle, actions right. */
export function PageHeader({ eyebrow = 'Workspace', title, description, actions }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="text-[30px] sm:text-[38px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[15px] text-steel">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** White content panel with a v9 section header. */
export function Panel({ title, action, children, className = '', bodyClassName = 'p-5' }) {
  return (
    <Card className={className}>
      {(title || action) && <SectionHead title={title} action={action} />}
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}
