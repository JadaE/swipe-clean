// Swipe Clean config. The only thing to set for Google Photos mode is CLIENT_ID
// (an OAuth 2.0 "Web application" client ID from Google Cloud, with this site's origin as an authorized JavaScript origin).
// Leave it empty and the Google button stays disabled; demo mode still works.
window.SWIPECLEAN_CONFIG = {
  CLIENT_ID: '',
  // The ONLY scope this app ever requests: read-only access to the items you pick in Google's picker.
  SCOPE: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
  // Pre-selects this account in Google's sign-in (a hint only; the app never reads your email).
  LOGIN_HINT: '',
  MAX_ITEMS: 2000,
  THUMB_PARAMS: '=w1024-h1024',
  REVIEW_THUMB_PARAMS: '=w300-h300-c'
};
