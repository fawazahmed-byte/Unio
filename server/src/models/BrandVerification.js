import mongoose from 'mongoose';
import { BRAND_PROOF_KINDS, BRAND_VERIFICATION_LEVELS, BUSINESS_ID_TYPES, CHECK_RESULTS, VERIFICATION_STATUS, schemaOptions, urlField } from './enums.js';

/**
 * A brand's verification claim for one level: "domain" (work email + website + challenge code) or
 * "business" (GSTIN / CIN / Udyam number + legal name). One document per brand per level.
 * Status flow: SELF_REPORTED → PENDING (brand submits) → VERIFIED | REJECTED (reviewer only).
 * brandId is the brand's User id, like Campaign.brandId.
 */
const brandVerificationSchema = new mongoose.Schema(
  {
    brandId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    level: { type: String, enum: BRAND_VERIFICATION_LEVELS, required: true },
    status: { type: String, enum: VERIFICATION_STATUS, default: 'SELF_REPORTED', index: true },
    submittedAt: { type: Date },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewNote: { type: String, trim: true, maxlength: 1000, default: '' },
    reviewedAt: { type: Date },

    // Domain level. The work email is for the reviewer only and is never shown publicly.
    websiteUrl: urlField(),
    websiteDomain: { type: String, trim: true, lowercase: true, maxlength: 255 },
    workEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    emailMatch: { type: Boolean },
    challengeCode: { type: String },
    challengeIssuedAt: { type: Date },
    challengeExpiresAt: { type: Date },
    challengeUsedAt: { type: Date },
    proof: {
      kind: { type: String, enum: BRAND_PROOF_KINDS },
      url: urlField(),
      domain: { type: String, trim: true, lowercase: true, maxlength: 255 },
    },

    // Business level.
    business: {
      idType: { type: String, enum: BUSINESS_ID_TYPES },
      idNumber: { type: String, trim: true, uppercase: true, maxlength: 30 },
      legalName: { type: String, trim: true, maxlength: 200 },
    },

    // "Automatic pre-check": a hint for the reviewer, never a decision.
    checks: {
      type: [{ id: String, label: String, result: { type: String, enum: CHECK_RESULTS }, detail: String, _id: false }],
      default: [],
    },
  },
  schemaOptions,
);

brandVerificationSchema.index({ brandId: 1, level: 1 }, { unique: true });
brandVerificationSchema.index({ status: 1, submittedAt: 1 });

export const BrandVerification = mongoose.model('BrandVerification', brandVerificationSchema, 'brandVerifications');
