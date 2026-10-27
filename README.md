# Mate Next Door: website

Static one-page site plus one serverless function (`api/quote.js`) that emails quote requests to Will. Built for Vercel.

## Before launch
1. **Logo:** save Will's white line-art logo (transparent PNG) as `img/logo.png`. Until then a text badge shows in its place.
2. **Email address:** the site shows `will@matenextdoor.com`. Change it in `index.html` if the domain is different.

## Going live
1. **Domain:** done: `matenextdoor.com`.
2. **Hosting:** deploy this folder to Vercel and add the domain under Project → Domains.
3. **Email inbox:** set up Google Workspace (or forwarding) for `will@…` by adding its MX records at the domain's DNS.
4. **Quote form:** create a free Resend account, verify the domain (adds a few DNS records), then set these in Vercel → Settings → Environment Variables:
   - `RESEND_API_KEY`
   - `QUOTE_TO_EMAIL` = `will@matenextdoor.com`
   - `QUOTE_FROM_EMAIL` = `website@matenextdoor.com`

   Until these are set, the form shows "please call or email Will directly".

## Files
- `index.html`: the page
- `styles.css`: black / white / card red (`#e11b1b`), Barlow + Barlow Condensed
- `quote.js`: form submit
- `api/quote.js`: emails the request via Resend
- `img/icons/`: the 14 service icons, cut from Will's printed card
