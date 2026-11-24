// Eingebaute Liste bekannter Werbe- und Tracking-Domains (Subdomains werden mitgeblockt).
const DOMAINS = `
doubleclick.net googlesyndication.com googleadservices.com google-analytics.com googletagmanager.com
googletagservices.com adservice.google.com pagead2.googlesyndication.com analytics.google.com
facebook.net connect.facebook.net pixel.facebook.com graph.facebook.com
adnxs.com adsrvr.org advertising.com adform.net amazon-adsystem.com criteo.com criteo.net
outbrain.com taboola.com scorecardresearch.com quantserve.com hotjar.com hotjar.io
mixpanel.com segment.io segment.com amplitude.com fullstory.com mouseflow.com
chartbeat.com chartbeat.net newrelic.com nr-data.net bugsnag.com
rubiconproject.com pubmatic.com openx.net casalemedia.com indexexchange.com
moatads.com adsafeprotected.com doubleverify.com serving-sys.com smartadserver.com
yieldmo.com sharethrough.com teads.tv 33across.com bidswitch.net contextweb.com
adition.com ioam.de etracker.com webtrekk.net econda-monitoring.com
tiktok.com analytics.tiktok.com ads.linkedin.com px.ads.linkedin.com snap.licdn.com
ads-twitter.com analytics.twitter.com ads.yahoo.com adtech.com
yandex.ru mc.yandex.ru appsflyer.com adjust.com branch.io kochava.com
demdex.net omtrdc.net everesttech.net krxd.net bluekai.com exelator.com
tapad.com liveramp.com rlcdn.com id5-sync.com
`.split(/\s+/).filter(Boolean);

// tiktok.com & yandex.ru komplett zu blocken waere zu aggressiv -> nur Tracking-Subdomains
const EXACT_ONLY = new Set(['tiktok.com', 'yandex.ru']);
const SET = new Set(DOMAINS.filter(d => !EXACT_ONLY.has(d)));

function isBlocked(hostname) {
  const parts = hostname.toLowerCase().split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (SET.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

module.exports = { isBlocked };
