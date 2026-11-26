// Free Apple ID (personal team) signing does not support the Push Notifications
// capability. The app only uses LOCAL notifications, which need no entitlement,
// so remove aps-environment if any plugin (e.g. expo-notifications) adds it.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withNoPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
