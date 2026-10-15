/** `aud` of every reader JWT; a token for another audience is refused (ASVS V9.2.3). */
export const READER_JWT_AUDIENCE = 'micelio:reader';

/** `type` of every reader JWT, so it cannot pass as an admin token, which carries its own `type` (ASVS V9.2.2). */
export const READER_JWT_TYPE = 'reader';
