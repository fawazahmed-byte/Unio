import mongoose from 'mongoose';
import { BRAND_TRUST_LEVELS, schemaOptions, urlField } from './enums.js';
import { CLIENT_COLOR_IDS, SPECIALIZATION_IDS, TEAM_SIZE_IDS } from './taxonomy.js';

export const ACCOUNT_TYPES = ['brand', 'agency'];

/** An agency's client (guide §5.4). Agencies are role 'brand' with accountType 'agency'. */
const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    industry: { type: String, enum: SPECIALIZATION_IDS },
    initials: { type: String, trim: true, maxlength: 3 },
    color: { type: String, enum: CLIENT_COLOR_IDS },
    approverName: { type: String, trim: true, maxlength: 120 },
    approverEmail: { type: String, lowercase: true, trim: true, maxlength: 254 },
    archived: { type: Boolean, default: false },
  },
  { _id: true, timestamps: true },
);

const brandProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    companyName: { type: String, required: true, trim: true, maxlength: 160 },
    accountType: { type: String, enum: ACCOUNT_TYPES, default: 'brand', index: true },
    contactName: { type: String, trim: true, maxlength: 120 },
    jobTitle: { type: String, trim: true, maxlength: 80 },
    teamSize: { type: String, enum: TEAM_SIZE_IDS },
    logoUrl: urlField(),
    websiteUrl: urlField(),
    // Round 2 sign-ups store a specialization id; Round 1 profiles keep free text until Phase 5 (B8).
    industry: { type: String, trim: true, maxlength: 80, default: '', index: true },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    clients: { type: [clientSchema], default: [] },
    /** Brand kit (B8): passed to the AI brief builder as context and shown on briefs. */
    brandKit: {
      colors: {
        type: [
          new mongoose.Schema(
            { name: { type: String, trim: true, maxlength: 40 }, hex: { type: String, trim: true, match: /^#[0-9a-f]{6}$/i } },
            { _id: false },
          ),
        ],
        default: [],
      },
      headingFont: { type: String, trim: true, maxlength: 60 },
      bodyFont: { type: String, trim: true, maxlength: 60 },
      tone: { type: [{ type: String, trim: true, maxlength: 30 }], default: [] },
      neverDo: { type: String, trim: true, maxlength: 500, default: '' },
      assetUrls: { type: [urlField()], default: [] },
    },
    /** Brand verification level. Only the brand verification service raises it (reviewer decisions, seed, grandfather script). */
    brandTrustLevel: { type: String, enum: BRAND_TRUST_LEVELS, default: 'signed_up' },
    isDemo: { type: Boolean, default: false },
  },
  schemaOptions,
);

export const BrandProfile = mongoose.model('BrandProfile', brandProfileSchema, 'brandProfiles');
