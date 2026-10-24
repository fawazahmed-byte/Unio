import * as brandVerification from '../services/brandVerification.service.js';
import { ok } from '../utils/http.js';

export async function getOwn(req, res) {
  ok(res, await brandVerification.getOwn(req.user));
}

export async function checkDomain(req, res) {
  ok(res, brandVerification.checkDomain(req.valid.body));
}

export async function issueDomainCode(req, res) {
  ok(res, await brandVerification.issueDomainCode(req.user, req.valid.body), 201);
}

export async function submitDomain(req, res) {
  ok(res, await brandVerification.submitDomain(req.user, req.valid.body));
}

export async function submitBusiness(req, res) {
  ok(res, await brandVerification.submitBusiness(req.user, req.valid.body), 201);
}

export async function listForReview(req, res) {
  ok(res, await brandVerification.listForReview(req.valid.query));
}

export async function decide(req, res) {
  ok(res, await brandVerification.decide(req.user, req.valid.params.id, req.valid.body));
}
