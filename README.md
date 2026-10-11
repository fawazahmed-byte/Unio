# UNIO
### Where Creators and Brands Unite

**UNIO is an AI-native creator marketplace that helps brands and creative agencies discover talent, define creative briefs, and manage collaborations from discovery to delivery.** Creators can showcase AI-powered work, apply to campaigns, respond to invitations, and track projects in one place.

> Discover the right talent. Build better briefs. Bring creative work to life.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Configuration](#environment-configuration)
- [User Roles and Workflows](#user-roles-and-workflows)
- [Creator Verification](#creator-verification)
- [AI-Assisted Brief Builder](#ai-assisted-brief-builder)
- [Demo Data and Accounts](#demo-data-and-accounts)
- [API and Data](#api-and-data)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security Notes](#security-notes)
- [Pre-Submission Checklist](#pre-submission-checklist)
- [Reviewer Access and Evaluation Guide](#reviewer-access-and-evaluation-guide)

---

## Overview

Traditional creator marketplaces are not always designed around AI-native creative work. UNIO focuses on helping brands evaluate creators based on their portfolios, tools, workflows, and campaign fit—not just a profile description.

The platform supports both sides of the creative relationship:

- **Brands and agencies** can publish briefs, discover creators, review proposals, send invitations, and manage engagements.
- **Creators** can present their work, list tools and skills, apply to campaigns, respond to invitations, and follow project progress.
- **Reviewers** can assess submitted evidence for creator verification signals.

Public pages can be browsed without an account. Authentication is required for role-specific actions.

## Key Features

### Creator discovery and AI portfolios
- Creator profiles with skills, tools, specialties, and portfolio items.
- Portfolio entries for image and video work using hosted media URLs.
- Campaign discovery and creator-to-campaign matching.
- Featured portfolio items and visible verification states.

### Campaigns and collaboration
- Brands can create and manage campaign briefs.
- Creators can submit applications and proposals.
- Brands can review applications and invite creators.
- Creators can accept or decline invitations.
- Accepted applications or invitations can create a project for the creator and campaign.
- Project status helps both sides track the engagement.

### Creator verification signals
- Creators can submit evidence for tools, workflows, and portfolio pieces.
- Evidence has a clear status, such as self-reported, pending, verified, or rejected.
- Reviewer permissions control verification decisions; creators cannot approve their own evidence.

### AI-Assisted Brief Builder
- Brands can describe a campaign idea in plain language.
- The brief builder creates an editable structured draft.
- Draft fields can include objectives, audience, style, deliverables, required skills and tools, budget, and deadline.
- The brand reviews and edits the draft before saving it as a campaign.

> AI-generated drafts are suggestions, not final campaign decisions. If an AI provider is not configured, the application may use a clearly labelled template-based fallback.

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS, React Router |
| Data and forms | TanStack Query, React Hook Form, Zod |
| Backend | Node.js, Express 5 |
| Database | MongoDB Atlas, Mongoose |
| Authentication | JWT-based sessions in HTTP-only cookies |
| Media | Hosted image/video URLs; Cloudinary can be configured where supported |
| Testing | Node.js test runner, Supertest, in-memory MongoDB for tests |

## Project Structure

```text
unio/
├── client/                 # React + Vite frontend
├── server/                 # Express API, Mongoose models, seed script and tests
├── IMPLEMENTATION_PLAN.md  # Implementation notes
└── package.json            # Root-level scripts
```

Check the current repository for the exact script names and route structure before relying on commands in this document.

## Getting Started

### Prerequisites
- A supported Node.js LTS release.
- npm.
- MongoDB Atlas credentials for persistent local development, or the project's configured in-memory development mode.
- Optional AI provider credentials if you want to test live brief generation.

### Install dependencies

From the repository root:

```bash
npm run install:all
```

### Configure environment variables

Copy the example file and edit it locally:

```bash
# macOS/Linux
cp server/.env.example server/.env
```

On Windows PowerShell:

```powershell
Copy-Item server/.env.example server/.env
```

Add the required local values to `server/.env`. Do not commit this file.

### Seed demo data

```bash
npm run seed
```

Set `SEED_DEMO_PASSWORD` before seeding so the demo accounts receive the intended password.

### Start the application

```bash
npm run dev
```

The documented local URLs are:

- Frontend: `http://localhost:5173`
- API: `http://localhost:5000`

Use the actual scripts in the root `package.json` if they differ from these examples.

### Run without a persistent database

If the repository provides the in-memory development script, run:

```bash
npm run dev:memory
```

This mode is intended for temporary development and demonstrations. Data is not persistent and may be lost when the process stops. Use MongoDB Atlas for persistent data.

## Environment Configuration

Backend environment variables belong in `server/.env`, unless the deployment configuration specifies otherwise.

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string for the `invitaizen` database. Keep the database name consistent with the application configuration. |
| `JWT_SECRET` | Long, randomly generated secret used to sign sessions or tokens. |
| `CLIENT_ORIGIN` | Exact frontend origin allowed by the API's CORS configuration. |
| `COOKIE_NAME` | Session cookie name; documented default is `unio_session`. |
| `SEED_DEMO_PASSWORD` | Password assigned to seeded demo accounts. |
| `REVIEWER_PASSWORD` | Password used when provisioning a reviewer account. |
| `DNS_SERVERS` | Optional DNS resolver override if MongoDB SRV lookup fails in the local environment. |
| `ANTHROPIC_API_KEY` | Optional server-side key for Anthropic-powered brief generation. |
| `BRIEF_AI_MODEL` | Optional model identifier for the Anthropic provider. |
| `OPENROUTER_API_KEY` | Optional alternative provider key. |
| `OPENROUTER_MODEL` | Model identifier used with OpenRouter, if enabled. |
| `CLOUDINARY_*` | Optional media-hosting settings, if the current upload integration uses them. |

The frontend may also use `VITE_API_URL` as described in `client/.env.example`. **Never put secrets in `VITE_*` variables**, because client-side values can be exposed in the browser bundle.

To generate a random secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## User Roles and Workflows

### Creator workflow
1. Browse public creators and campaigns.
2. Register or sign in as a creator.
3. Complete the creator profile and portfolio.
4. Apply to relevant campaigns or respond to invitations.
5. Track accepted engagements in the projects area.

### Brand workflow
1. Register or sign in as a brand.
2. Create a campaign brief manually or start with the AI-Assisted Brief Builder.
3. Discover creators and review their portfolios and verification signals.
4. Review applications or invite creators to a campaign.
5. Manage resulting projects and deliverables.

### Reviewer workflow
1. Sign in using a reviewer account provisioned by the project.
2. Review submitted verification evidence.
3. Approve or reject evidence based on the review process.
4. Ensure only authorized reviewers can change verification status.

### Workflow integrity
- The server must enforce user roles and resource ownership.
- Creators must explicitly submit applications.
- Brands may invite creators only to campaigns they own.
- Duplicate applications, invitations, and projects should be prevented.
- Accepting an application or invitation should create no more than one project for a given campaign/creator pair.

## Creator Verification

Verification states documented by the project:

| Status | Meaning |
|---|---|
| `SELF_REPORTED` | The creator listed the tool, workflow, or claim without reviewed evidence. |
| `PENDING` | Evidence has been submitted and is awaiting review. |
| `VERIFIED` | An authorized reviewer has reviewed and confirmed the evidence. |
| `REJECTED` | The evidence was not sufficient; a reviewer may provide an explanatory note. |

Creators manage submissions through `/creator/verification`. Portfolio items may also provide a verification action. A creator must not be able to set their own evidence status to `VERIFIED`.

To provision a reviewer, configure `REVIEWER_PASSWORD` in `server/.env`, then use the documented script if it exists in the current checkout:

```bash
npm --prefix server run create-reviewer -- reviewer@yourdomain.com "Reviewer Name"
```

Use an account controlled by the team. Never publish the reviewer's password.

Verification claims should reflect real evidence. Client feedback and completed-project indicators should come from actual project records, not invented testimonials or results.

## AI-Assisted Brief Builder

The documented endpoint is:

```http
POST /api/brand/briefs/draft
```

A brand enters a rough idea and receives a structured, editable draft. Supported fields may include:
- Campaign title and category
- Objective and target audience
- Creative direction or style
- Deliverables
- Required skills and tools
- Budget range and deadline

The draft should populate the campaign form and must not be published automatically.

**Provider configuration**
- With `ANTHROPIC_API_KEY`, the backend can request a structured draft from the configured Anthropic model.
- With `OPENROUTER_API_KEY`, the backend can use a configured compatible model if that integration is enabled.
- Without a provider key, the application may offer a template-based fallback. Label this as a template rather than AI-generated output.

Provider keys must remain on the server. Test the configured provider and fallback behavior before the demo. The project documentation specifies a limit of ten brief drafts per brand per 15 minutes; verify this against the current implementation.

## Demo Data and Accounts

Run the seed command to create the project's sample data. According to the project documentation, the seed process is intended to be idempotent and to use stable identifiers to avoid duplicate records when run repeatedly.

Documented seed data includes:
- Five team-member creator profiles: Fawaz Ahmed, Sai Charitha, Roha Nawaz, Shameer, and Jaison.
- Ten fictional creator profiles marked as demo accounts.
- A reviewer account and sample verification claims.
- Three demo brands and eight campaigns.
- Portfolio items and sample applications, invitations, and projects.

Team-member bios, skills, tools, and portfolio content should be reviewed by the people represented. Fictional accounts and placeholder content should be clearly understood as demo data.

### Example demo account emails

| Role | Email |
|---|---|
| Creator | `meera-kulkarni@creators.unio.example` |
| Creator | `zoya-siddiqui@creators.unio.example` |
| Brand | `team@verdant.unio.example` |
| Brand | `studio@northwind.unio.example` |
| Reviewer | `reviewer@unio.example` |

These are demo identities, not necessarily real email inboxes. The passwords depend on the deployed environment's seed configuration. Verify each account before sharing evaluation instructions.

### Portfolio media

Some demo portfolio records may use placeholder URLs under `media.unio.example`. These are not production assets. Replace them with working, authorized image or video URLs before the final demonstration and confirm that each URL opens correctly.

UNIO stores media URLs and related metadata rather than large image/video binaries in MongoDB.

## API and Data

The application exposes a REST API. The documented response envelope is:

**Success**
```json
{
  "success": true,
  "data": {}
}
```

**Error**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "A human-readable explanation",
    "details": {}
  }
}
```

Confirm the actual API response shape against the current implementation. For available routes, inspect `server/src/routes/index.js` and the associated route files.

The documented creator-matching weights are:
- Skills: 40%
- Tools: 25%
- Category: 20%
- Budget: 10%
- Availability: 5%

Treat matching as a recommendation aid, not as a guarantee of creative quality or campaign success.

## Testing

From the repository root, run:

```bash
npm test
npm run build
```

The project documentation reports API integration tests using Node's test runner, Supertest, and an in-memory MongoDB replica set. Verify the current test count and ensure the commands pass in the exact commit being submitted.

Documented test areas include:
- Authentication and role enforcement
- Resource ownership and input validation
- Application and invitation workflows
- Project creation and duplicate prevention
- Project status transitions
- Creator matching
- Seed idempotency
- Verification permissions
- Feedback rules
- Brief normalization and template fallback
- AI-provider error handling

If a command is not present in `package.json`, use the scripts actually available and update this README accordingly.

## Deployment

### Backend

The documented backend deployment uses a Node.js host such as Render.

| Setting | Expected value |
|---|---|
| Root directory | `server` |
| Install command | `npm install` |
| Start command | `npm start` |
| Environment | `NODE_ENV=production` plus required environment variables |
| CORS origin | Exact deployed frontend origin |

Confirm these settings against the repository and hosting dashboard. Serve the API over HTTPS in production. Configure secure cookies and proxy trust according to the host and the application's Express configuration.

For MongoDB Atlas, restrict network access to the backend's required outbound IPs when feasible. Do not use `0.0.0.0/0` unless you have deliberately assessed and accepted the associated exposure.

### Frontend

The documented frontend deployment uses Vercel.

| Setting | Expected value |
|---|---|
| Root directory | `client` |
| Framework preset | Vite |
| `VITE_API_URL` | Leave empty if the configured `/api` rewrite is used |

Verify that `client/vercel.json` points to the correct deployed backend URL. Update the rewrite and redeploy if the backend address changes.

### Project links

- **Live application:** https://unio-psi.vercel.app
- **GitHub repository:** https://github.com/fawazahmed-byte/Unio.git
- **API health endpoint:** https://unio-gq3j.onrender.com/api/health

## Security Notes

- Never commit `.env`, database connection strings, API keys, JWT secrets, reviewer passwords, or real demo passwords.
- Keep `.env.example` limited to safe placeholder values.
- Hash user passwords and never return password hashes from API responses.
- Keep AI provider keys on the backend.
- Enforce role checks and resource ownership on the server, not only in the frontend.
- Use dedicated demo credentials for judges. Do not publish personal account passwords.
- Rotate any credential that has been exposed in a screenshot, public repository, or submission form.
- Verify that reviewer-only actions cannot be performed by creators or brands.

## Pre-Submission Checklist

- [ ] A fresh clone can install dependencies successfully.
- [ ] The documented start, seed, test, and build commands work.
- [ ] Tests pass on the exact version being submitted.
- [ ] The production build succeeds.
- [ ] Seeding can be rerun without duplicating demo records.
- [ ] `.env` files and secrets are not committed.
- [ ] MongoDB Atlas access is configured securely.
- [ ] Creator, brand, and reviewer accounts have been tested.
- [ ] Creator verification permissions work as intended.
- [ ] AI brief generation and template fallback have both been tested.
- [ ] Portfolio media URLs load and placeholder assets are removed from the demo path.
- [ ] The deployed frontend communicates with the correct backend.
- [ ] Live application and public repository links are correct.
- [ ] Evaluation instructions use dedicated demo credentials without exposing personal passwords.

## Reviewer Access and Evaluation Guide

Use the deployed application: **https://unio-psi.vercel.app**

The accounts below are demo accounts created for evaluating UNIO. Their email addresses are not real inboxes.

### Demo credentials

| Role | Email | Password |
|---|---|---|
| Creator | `meera-kulkarni@creators.unio.example` | `UnioDemo2026!` |
| Brand | `team@verdant.unio.example` | `UnioDemo2026!` |
| Brand | `studio@northwind.unio.example` | `UnioDemo2026!` |
| Reviewer | `reviewer@unio.example` | `<REVIEWER_PASSWORD from .env>` |

### How to evaluate

1. Open https://unio-psi.vercel.app and sign in with the account for the role you want to test. Public creator and campaign pages can also be browsed without signing in.
2. **As a creator**, explore profile management, the portfolio, campaign applications, invitations, and projects.
3. **As a brand**, explore campaign creation (including the AI-Assisted Brief Builder), applicant review, creator invitations, and project management.
4. **As a reviewer**, open the verification queue and approve or reject the evidence that creators have submitted.

To see both sides of a workflow, sign in as a brand and invite a creator to a campaign. Then sign out, sign in as that creator, and accept the invitation. The resulting project appears for both accounts.

---

**UNIO** — *Where Creators and Brands Unite.*
