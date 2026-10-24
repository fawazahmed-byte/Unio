/**
 * One-off: brands that existed before brand verification keep working as "domain_verified".
 *
 *   npm --prefix server run grandfather-brands            dry run (lists the brands, writes nothing)
 *   npm --prefix server run grandfather-brands -- --apply write the changes
 *
 * Only brand profiles that have NO brandTrustLevel yet are touched, so brands that signed up after the
 * feature shipped (they start at signed_up) and brands a reviewer already decided are never changed.
 * Each brand gets an approved "Grandfathered" record, so a reviewer can see why. Safe to run twice.
 */
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { BrandProfile } from '../src/models/index.js';
import { grantLevel } from '../src/services/brandVerification.service.js';

const apply = process.argv.includes('--apply');

try {
  await connectDB();
  const legacy = await BrandProfile.collection
    .find({ brandTrustLevel: { $exists: false } }, { projection: { userId: 1, companyName: 1, accountType: 1 } })
    .toArray();
  console.log(`${legacy.length} brand(s) with no verification level`);
  for (const b of legacy) console.log(`  ${(b.accountType ?? 'brand').padEnd(7)} ${b.companyName}`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to mark them domain_verified.');
  } else {
    for (const b of legacy) await grantLevel(b.userId, 'domain_verified', { note: 'Grandfathered: existing brand before brand verification.' });
    console.log(`\nMarked ${legacy.length} brand(s) as domain_verified.`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
