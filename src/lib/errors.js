// Les messages sont affichés tels quels dans l'interface : ils sont en français et s'adressent au joueur.
export class HttpError extends Error {
  constructor(status, message, code = 'error', extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message) => new HttpError(400, message, 'bad_request');
export const unauthorized = (message = 'Connecte-toi pour continuer.') => new HttpError(401, message, 'unauthorized');
export const forbidden = (message = "Tu n'as pas le droit de faire ça.") => new HttpError(403, message, 'forbidden');
export const notFound = (message = 'Introuvable.') => new HttpError(404, message, 'not_found');
export const conflict = (message) => new HttpError(409, message, 'conflict');
