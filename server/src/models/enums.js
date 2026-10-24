export const ROLES = ['creator', 'brand', 'reviewer'];
/** Roles a person can pick at sign-up. Reviewers are provisioned by an operator (seed / create-reviewer script). */
export const SELF_SERVE_ROLES = ['creator', 'brand'];
export const AVAILABILITY = ['available', 'busy', 'unavailable'];
export const MEDIA_TYPES = ['image', 'video'];
export const CAMPAIGN_STATUS = ['draft', 'open', 'closed'];
export const APPLICATION_STATUS = ['pending', 'accepted', 'rejected', 'withdrawn'];
export const INVITATION_STATUS = ['pending', 'accepted', 'declined', 'cancelled'];
export const PROJECT_STATUS = ['not_started', 'in_progress', 'submitted', 'revision_requested', 'completed', 'cancelled'];
export const DELIVERABLE_STATUS = ['pending', 'submitted', 'approved', 'revision_requested'];
export const SOURCE_TYPES = ['application', 'invitation'];
export const VERIFICATION_TYPES = ['tool', 'workflow', 'portfolio', 'certificate'];
export const VERIFICATION_METHODS = ['challenge', 'certificate', 'evidence'];
export const CHECK_RESULTS = ['pass', 'fail', 'unknown'];
export const VERIFICATION_STATUS = ['SELF_REPORTED', 'PENDING', 'VERIFIED', 'REJECTED'];
// Brand verification (levels are ordered: each needs the one before it).
export const BRAND_TRUST_LEVELS = ['signed_up', 'domain_verified', 'business_verified'];
export const BRAND_VERIFICATION_LEVELS = ['domain', 'business'];
export const BRAND_PROOF_KINDS = ['dns', 'instagram', 'linkedin', 'youtube'];
export const BUSINESS_ID_TYPES = ['GSTIN', 'CIN', 'UDYAM'];

export const schemaOptions = { timestamps: true, versionKey: false };

const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

export const urlField = (requiredMsg) => ({
  type: String,
  trim: true,
  ...(requiredMsg ? { required: [true, requiredMsg] } : {}),
  validate: { validator: (v) => !v || URL_RE.test(v), message: 'Must be a valid http(s) URL' },
});

export const stringList = { type: [{ type: String, trim: true }], default: [] };
