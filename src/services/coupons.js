import crypto from 'node:crypto';
import { HttpError, notFound } from '../lib/errors.js';
import { DAY, newId, sha256 } from '../lib/util.js';

// Sans 0/O ni 1/I : un code se recopie sans erreur. 12 caractères sur 32 = 60 bits, avec la limite d'essais par appareil.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 12;
export const COUPON_DAYS = [7, 30, 90, null]; // validités proposées (null : sans date limite)

/** Un code tapé à la main, en minuscules, avec ou sans tirets : la forme comparée (majuscules, sans séparateurs). */
export const normalizeCoupon = (code) => String(code ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const format = (raw) => raw.match(/.{1,4}/g).join('-');

export function couponState(c, now) {
  if (c.used_at) return 'used';
  if (c.revoked_at) return 'revoked';
  if (c.expires_at && c.expires_at <= now) return 'expired';
  return 'available';
}

export const publicCoupon = (c, now) => ({
  id: c.id, hint: c.hint, note: c.note, state: couponState(c, now), createdAt: c.created_at, expiresAt: c.expires_at,
  revokedAt: c.revoked_at, usedAt: c.used_at, usedBy: c.used_by, usedByPseudo: c.current_pseudo ?? c.used_by_pseudo, groupId: c.group_id, groupName: c.group_name,
});

const REFUSED = {
  used: ['Ce coupon a déjà servi : un coupon ne crée qu’un seul groupe. Demande-en un nouveau.', 'coupon_used'],
  revoked: ['Ce coupon a été annulé. Demande-en un nouveau.', 'coupon_revoked'],
  expired: ['Ce coupon a expiré. Demande-en un nouveau.', 'coupon_expired'],
};

/**
 * Coupons de création de groupe : générés par l'admin de l'instance, à usage unique (ils expirent en servant), avec une
 * date limite facultative. Créer un groupe (et le compte qui va avec) en demande un ; rejoindre un groupe passe par son lien.
 */
export class CouponService {
  /** siteName() : le nom de l'installation (page Configuration de l'admin), dans les messages. */
  constructor(db, clock, { siteName = () => 'Pari tenu !' } = {}) {
    this.siteName = siteName;
    this.db = db;
    this.clock = clock;
  }

  /** Rend le code en clair (« ABCD-EFGH-JKMN ») : c'est la seule fois qu'on le voit, la base n'en garde que l'empreinte. */
  create({ note = '', days = 30 } = {}) {
    let raw = '';
    for (let i = 0; i < LENGTH; i++) raw += ALPHABET[crypto.randomInt(ALPHABET.length)];
    const now = this.clock.now();
    const id = newId();
    const expiresAt = days ? now + days * DAY : null;
    this.db.prepare('INSERT INTO coupons (id, code_hash, hint, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, sha256(raw), raw.slice(-4), note, now, expiresAt);
    return { id, code: format(raw), expiresAt };
  }

  find(id) {
    return this.db.prepare('SELECT * FROM coupons WHERE id = ?').get(String(id)) ?? null;
  }

  list() {
    const now = this.clock.now();
    // Celui qui l'a utilisé, sous son pseudo du moment ; compte supprimé : « Max (supprimé) », gardé dans le coupon.
    return this.db.prepare(`SELECT c.*, p.pseudo AS current_pseudo FROM coupons c LEFT JOIN players p ON p.id = c.used_by
        ORDER BY c.created_at DESC`).all().map((c) => publicCoupon(c, now));
  }

  revoke(id) {
    const coupon = this.find(id);
    if (!coupon) throw notFound('Coupon introuvable.');
    if (couponState(coupon, this.clock.now()) !== 'available') throw new HttpError(409, 'Ce coupon ne peut plus servir : rien à annuler.', 'conflict');
    this.db.prepare('UPDATE coupons SET revoked_at = ? WHERE id = ?').run(this.clock.now(), coupon.id);
    return coupon;
  }

  /** Vérifie un coupon avant de créer le groupe (et avant de calculer le PIN) : lève l'erreur à montrer, sinon le rend. */
  check(code) {
    const raw = normalizeCoupon(code);
    if (!raw) throw new HttpError(400, `Il faut un coupon pour créer un groupe : demande-le à la personne qui gère ${this.siteName()}`, 'coupon_required');
    const coupon = raw.length === LENGTH ? this.db.prepare('SELECT * FROM coupons WHERE code_hash = ?').get(sha256(raw)) : null;
    if (!coupon) throw new HttpError(403, 'Ce coupon n’existe pas : vérifie-le (12 caractères), ou demande-en un nouveau.', 'coupon_invalid');
    const state = couponState(coupon, this.clock.now());
    if (state !== 'available') throw new HttpError(403, ...REFUSED[state]);
    return coupon;
  }

  /** Le coupon sert, dans la transaction qui crée le groupe : deux créations en même temps n'en consomment qu'une. */
  redeem(code, { playerId, pseudo, groupId, groupName }) {
    const coupon = this.check(code);
    const now = this.clock.now();
    const done = this.db.prepare(`UPDATE coupons SET used_at = ?, used_by = ?, used_by_pseudo = ?, group_id = ?, group_name = ?
        WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`)
      .run(now, playerId, pseudo, groupId, groupName, coupon.id, now);
    if (done.changes !== 1) throw new HttpError(403, ...REFUSED.used);
  }
}
