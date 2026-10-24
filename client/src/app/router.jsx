import { Navigate, createBrowserRouter, isRouteErrorResponse, useLocation, useRouteError } from 'react-router';
import { AppRoot, DashboardLayout, PublicFrame, RootLayout } from '../components/layout/Layouts.jsx';
import { GuestOnly, ProtectedRoute } from '../components/layout/ProtectedRoute.jsx';
import { Button, ButtonLink } from '../components/ui/Button.jsx';
import { LoginPage, RegisterPage } from '../pages/public/AuthPages.jsx';
import CampaignDetailPage from '../pages/public/CampaignDetailPage.jsx';
import CampaignsPage from '../pages/public/CampaignsPage.jsx';
import CreatorDetailPage from '../pages/public/CreatorDetailPage.jsx';
import CreatorsPage from '../pages/public/CreatorsPage.jsx';
import HomePage from '../pages/public/HomePage.jsx';
import HowItWorksPage from '../pages/public/HowItWorksPage.jsx';
import NotFoundPage from '../pages/public/NotFoundPage.jsx';

/** Old /about links (including #demo-content) land on How it works. */
function AboutRedirect() {
  const { hash } = useLocation();
  return <Navigate to={`/how-it-works${hash}`} replace />;
}

/** Dashboard pages are code-split so public pages load less JavaScript. */
const page = (load, props) => async () => {
  const { default: Page } = await load();
  return { Component: props ? () => <Page {...props} /> : Page };
};

function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <PublicFrame>
        <NotFoundPage />
      </PublicFrame>
    );
  }
  return (
    <PublicFrame>
      <div className="container-page py-24">
        <h1 className="text-[30px] sm:text-[38px]">Something went wrong</h1>
        <p className="mt-3 max-w-md text-steel">An unexpected error stopped this page from loading. Reloading usually fixes it.</p>
        <div className="mt-6 flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <ButtonLink to="/" variant="secondary">
            Home
          </ButtonLink>
        </div>
      </div>
    </PublicFrame>
  );
}

/** Signed-in area for one role: guard → app shell → pages. */
const workspace = (path, role, children) => ({
  path,
  element: <ProtectedRoute role={role} />,
  errorElement: <RouteError />,
  children: [{ element: <DashboardLayout role={role} />, children }],
});

/* Kit preview for comparing components with design/screens. Development builds only:
   `import.meta.env.DEV` is false in production, so the route and its chunk are dropped. */
const devRoutes = import.meta.env.DEV ? [{ path: 'dev/kit', lazy: page(() => import('../pages/dev/KitPage.jsx')) }] : [];

export const router = createBrowserRouter([
  {
    element: <AppRoot />,
    errorElement: <RouteError />,
    children: [
      {
        element: <RootLayout />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <HomePage />, handle: { darkHeader: true } },
          { path: 'creators', element: <CreatorsPage /> },
          { path: 'creators/:id', element: <CreatorDetailPage /> },
          { path: 'creators/:id/work/:itemId', lazy: page(() => import('../pages/public/PortfolioPiecePage.jsx')) },
          { path: 'campaigns', element: <CampaignsPage /> },
          { path: 'campaigns/:id', element: <CampaignDetailPage /> },
          { path: 'how-it-works', element: <HowItWorksPage /> },
          { path: 'about', element: <AboutRedirect /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      // Split-screen auth pages carry their own logo (v9 P7/P8), so no public header/footer.
      { path: 'login', element: <GuestOnly><LoginPage /></GuestOnly> },
      { path: 'register', element: <GuestOnly><RegisterPage /></GuestOnly> },
      // A3: the agency's client approves without an account. Its own minimal page, no site chrome.
      { path: 'approve/:token', lazy: page(() => import('../pages/public/ClientApprovalPage.jsx')) },
      {
        element: <ProtectedRoute />,
        errorElement: <RouteError />,
        children: [
          {
            // Shared project page uses the signed-in user's own sidebar.
            element: <DashboardLayout />,
            children: [{ path: 'projects/:id', lazy: page(() => import('../pages/shared/ProjectDetail.jsx')) }],
          },
        ],
      },
      workspace('creator', 'creator', [
        { path: 'dashboard', lazy: page(() => import('../pages/creator/CreatorDashboard.jsx')) },
        { path: 'profile/edit', lazy: page(() => import('../pages/creator/CreatorProfileEdit.jsx')) },
        { path: 'portfolio', lazy: page(() => import('../pages/creator/CreatorPortfolio.jsx')) },
        { path: 'applications', lazy: page(() => import('../pages/creator/CreatorApplications.jsx')) },
        { path: 'invitations', lazy: page(() => import('../pages/creator/CreatorInvitations.jsx')) },
        { path: 'projects', lazy: page(() => import('../pages/shared/ProjectsList.jsx'), { role: 'creator' }) },
        { path: 'verification', lazy: page(() => import('../pages/creator/CreatorVerification.jsx')) },
      ]),
      workspace('brand', 'brand', [
        { path: 'dashboard', lazy: page(() => import('../pages/brand/BrandDashboard.jsx')) },
        { path: 'campaigns', lazy: page(() => import('../pages/brand/BrandCampaigns.jsx')) },
        { path: 'campaigns/new', lazy: page(() => import('../pages/brand/CampaignFormPage.jsx')) },
        { path: 'campaigns/:id/edit', lazy: page(() => import('../pages/brand/CampaignFormPage.jsx')) },
        { path: 'campaigns/:id/applicants', lazy: page(() => import('../pages/brand/CampaignApplicants.jsx')) },
        { path: 'applications', lazy: page(() => import('../pages/brand/BrandApplications.jsx')) },
        { path: 'recommended', lazy: page(() => import('../pages/brand/RecommendedCreators.jsx')) },
        { path: 'invitations', lazy: page(() => import('../pages/brand/BrandInvitations.jsx')) },
        { path: 'clients', lazy: page(() => import('../pages/brand/AgencyClients.jsx')) },
        { path: 'approvals', lazy: page(() => import('../pages/brand/AgencyApprovals.jsx')) },
        { path: 'projects', lazy: page(() => import('../pages/shared/ProjectsList.jsx'), { role: 'brand' }) },
        { path: 'profile', lazy: page(() => import('../pages/brand/BrandProfile.jsx')) },
        { path: 'verification', lazy: page(() => import('../pages/brand/BrandVerification.jsx')) },
      ]),
      workspace('review', 'reviewer', [{ index: true, lazy: page(() => import('../pages/review/ReviewQueue.jsx')) }]),
      ...devRoutes,
    ],
  },
]);
