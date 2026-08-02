import urllib.request
import re
import json
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def fetch_embed(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req, context=ctx).read().decode('utf-8')
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
    data = json.loads(m.group(1))
    return data['props']['pageProps']['state']['data']['entity']

print("Base:")
ent = fetch_embed('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M')
print(len(ent['trackList']))

print("With ?offset=100")
ent2 = fetch_embed('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?offset=100')
print(len(ent2['trackList']))
if len(ent2['trackList']) > 0:
    print("Base first track:", ent['trackList'][0]['title'])
    print("Offset first track:", ent2['trackList'][0]['title'])
