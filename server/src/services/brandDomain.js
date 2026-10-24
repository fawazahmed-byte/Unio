/**
 * Brand verification: domain matching and ID-number formats. Pure functions (no I/O), so they are easy to test.
 * No public-suffix list is bundled, so a "subdomain" is judged by a dot boundary only.
 */

// Mailbox providers that are never a company's own domain.
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'aol.com', 'rediffmail.com', 'zoho.com', 'gmx.com', 'mail.com',
]);

export const isFreeMailDomain = (domain) => FREE_MAIL.has(String(domain).toLowerCase());

/** The host of a website link, lower-cased, without a leading "www.". '' when it is not a valid link. */
export function domainOfUrl(raw) {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/\.$/, '');
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The domain part of an email address, lower-cased. '' when it is not an address. */
export function domainOfEmail(email) {
  const m = String(email ?? '').trim().toLowerCase().match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/);
  return m ? m[1].replace(/\.$/, '') : '';
}

const isSubdomainOf = (child, parent) => child === parent || child.endsWith(`.${parent}`);

/**
 * Does the work email belong to the website's domain? Subdomains are allowed in both directions
 * (mail.acme.com and acme.com), "evilacme.com" is not "acme.com", and free mailbox providers never match.
 * Returns { match, emailDomain, websiteDomain, reason } where reason is a plain sentence for the brand when there is no match.
 */
export function matchEmailToWebsite(email, websiteUrl) {
  const emailDomain = domainOfEmail(email);
  const websiteDomain = domainOfUrl(websiteUrl);
  if (!websiteDomain) return { match: false, emailDomain, websiteDomain, reason: 'Add your company website first, for example https://yourcompany.com.' };
  if (!emailDomain) return { match: false, emailDomain, websiteDomain, reason: 'Enter a valid work email address.' };
  if (isFreeMailDomain(emailDomain)) {
    return { match: false, emailDomain, websiteDomain, reason: `${emailDomain} is a free mailbox, not your company domain. Use an address on ${websiteDomain}.` };
  }
  if (isSubdomainOf(emailDomain, websiteDomain) || isSubdomainOf(websiteDomain, emailDomain)) return { match: true, emailDomain, websiteDomain, reason: '' };
  return { match: false, emailDomain, websiteDomain, reason: `${emailDomain} does not match your website ${websiteDomain}. Use an email on the same domain.` };
}

// Where a code may be published as proof of control. Hosts must match exactly (or be a subdomain).
const SOCIAL_HOSTS = { instagram: ['instagram.com'], linkedin: ['linkedin.com'], youtube: ['youtube.com', 'youtu.be'] };

export function isSocialUrlFor(kind, raw) {
  const host = domainOfUrl(raw);
  return !!host && (SOCIAL_HOSTS[kind] ?? []).some((h) => isSubdomainOf(host, h));
}

// Format only. The reviewer checks the number on the public government portal.
export const BUSINESS_ID_PATTERNS = {
  GSTIN: { re: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, hint: 'A GSTIN has 15 characters, like 22AAAAA0000A1Z5.' },
  CIN: { re: /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/, hint: 'A CIN has 21 characters, like U12345MH2020PTC123456.' },
  UDYAM: { re: /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/, hint: 'A Udyam number looks like UDYAM-MH-12-1234567.' },
};

export const normalizeBusinessId = (value) => String(value ?? '').trim().toUpperCase();
export const isValidBusinessId = (type, value) => !!BUSINESS_ID_PATTERNS[type]?.re.test(normalizeBusinessId(value));
