# Public developer website root

This small GitHub Pages user site serves BarTally's AdMob seller authorization at:

https://billcorps.github.io/app-ads.txt

The app website stays at https://billcorps.github.io/BarTallyWebsite/ and its source is in [BarTallyWebsite](https://github.com/billcorps/BarTallyWebsite). The root homepage sends visitors there.

## Publishing

In Settings > Pages, use Deploy from a branch, `main`, `/ (root)`. This public user site uses GitHub Pages without a custom domain or paid hosting service. `.nojekyll` keeps these files as static content.

Keep `app-ads.txt` identical to `BarTallyWebsite/public/app-ads.txt`. The publisher identifier is intentionally public; do not put credentials here. Add other authorized sellers only from the actual ad network's supplied records.

After changes deploy, verify the root file returns HTTP 200 and the correct plain-text record. In AdMob, open Apps > View all apps > app-ads.txt, expand BarTally and select Check for updates. Google says verification can take up to 24 hours.

[Google app-ads.txt setup and crawler rules](https://support.google.com/admob/answer/9363762?hl=en)
