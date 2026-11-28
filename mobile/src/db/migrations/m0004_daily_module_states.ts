/**
 * Migration 4 (v0.3.1): each logical day keeps the state of every module as last recorded
 * (complete, incomplete, not_applicable, no_content, disabled), so daily adherence can leave
 * out modules that did not apply that day (spec Section 10). Additive: older backups restore
 * with the column empty, and those days fall back to completed ÷ enabled.
 */
export const M0004_DAILY_MODULE_STATES = `
ALTER TABLE daily_session ADD COLUMN module_states_json TEXT;
`;
