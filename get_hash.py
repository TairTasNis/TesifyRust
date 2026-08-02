import urllib.request, re

html = open('spot_html.txt', 'r', encoding='utf-8').read()
bundles = re.findall(r'src="(https://open.spotifycdn.com/[^\"]+\.js)"', html)

for b in bundles:
    try:
        bsrc = urllib.request.urlopen(urllib.request.Request(b, headers={'User-Agent': 'Mozilla/5.0'})).read().decode('utf-8')
        matches = re.finditer(r'"([a-f0-9]{32})"', bsrc)
        for m in set(m.group(1) for m in matches):
            idx = bsrc.find(m.group(1)) if isinstance(m, re.Match) else bsrc.find(m)
            ctx = bsrc[max(0, idx-50):min(len(bsrc), idx+50)]
            if 'fetch' in ctx or 'query' in ctx or 'Playlist' in ctx:
                print('Found potential hash:', m, 'in ctx:', ctx.replace('\n', ' '))
    except Exception as e:
        pass
