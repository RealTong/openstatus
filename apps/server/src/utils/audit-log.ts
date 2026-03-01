/**
 * Audit logging stub.
 *
 * The @openstatus/tinybird package has been removed.  This module previously
 * published audit events to Tinybird.  It now exports a no-op so that any
 * remaining call-sites continue to compile without side-effects.
 */
export const checkerAudit = {
  publishAuditLog(..._args: unknown[]): Promise<void> {
    return Promise.resolve();
  },
};
