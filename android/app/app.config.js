// Applies the build flavor's Android package id on top of app.json (set by build-apk.sh).
// Store build (default): com.jcaipps.swipeclean from app.json. Personal build: SC_PACKAGE (com.jada.swipeclean).
module.exports = ({ config }) => {
  const pkg = process.env.SC_PACKAGE;
  if (pkg && !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(pkg)) throw new Error('SC_PACKAGE is not a valid package id');
  return pkg ? { ...config, android: { ...config.android, package: pkg } } : config;
};
